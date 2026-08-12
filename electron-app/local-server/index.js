'use strict'
// ─── Fullsite Local Server ────────────────────────────────────────────────────
// Entry point. Called from Electron main.js with the Electron-provided data dir.
// Exports { startLocalServer } which returns the running server handle.
//
// Architecture (Phase 1):
//   • HTTP server on 0.0.0.0:7717 (LAN accessible, not just localhost)
//   • WebSocket hub on /ws (attached to same HTTP server — no second port)
//   • Print endpoints (/print, /drawer, /test, /config) — backwards compatible
//   • /events REST endpoint — accept events from any terminal
//   • /state REST endpoint — return state snapshot
//   • /health — server status for monitoring
//   • mDNS announcement (_fullsite-pos._tcp)
//   • Fleet heartbeat to Supabase (telemetry only)
//   • EventStore backed by NDJSON (interface abstracts the implementation)
//   • In-memory state projection rebuilt from event log on startup
//   • Supabase is still primary write authority (Phase 2 will change this)

const http    = require('http')
const crypto  = require('crypto')
const os      = require('os')

const { PROTOCOL_VERSION, EVENT, parseClientMessage } = require('./protocol')
const processAdapter = require('./adapters/process')
const printerAdapter = require('./adapters/printer')
const networkAdapter = require('./adapters/network')
const { NdjsonEventStore }  = require('./adapters/storage/ndjson')
const { CoreEventStore }    = require('./core/event-store')
const { RestaurantState }   = require('./core/state')
const { WsHub }             = require('./core/ws-hub')
const { CommandHandler }    = require('./core/command-handler')
const mdns      = require('./discovery/mdns')
const heartbeat = require('./telemetry/heartbeat')
const updater   = require('./update/manager')

// ─── Server ID (stable across restarts) ──────────────────────────────────────

function loadOrCreateServerId(dataDir) {
  const fs   = require('fs')
  const path = require('path')
  const file = path.join(dataDir, 'server-id')
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  } catch {}
  const id = crypto.randomUUID()
  try { fs.writeFileSync(file, id) } catch {}
  return id
}

// ─── Supabase poll (Phase 1: bridge → local server observes Supabase) ────────

let _supabasePolling = null

async function startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, serviceEmail, servicePassword, state, eventStore, wsHub }) {
  if (!supabaseUrl || !supabaseKey) return
  const POLL_INTERVAL = 5000

  // Auth SCOPED al tenant. Si hay una service-account (usuario Supabase miembro
  // SOLO de este client_id), se usa su JWT (role authenticated) → la RLS deja leer
  // únicamente ESTE tenant. Así NO va la god service_role key en la terminal (si se
  // filtra, solo expone este local). Fallback a la anon key (legacy) si no está
  // configurada — tras el RLS lockdown ese fallback devuelve 0 filas, por eso se
  // recomienda configurar la service-account por restaurante.
  let _tok = null, _tokExp = 0
  async function getBearer() {
    if (!serviceEmail || !servicePassword) return supabaseKey
    if (_tok && Date.now() < _tokExp - 60000) return _tok
    try {
      const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
      })
      if (!r.ok) return supabaseKey
      const j = await r.json()
      _tok = j.access_token
      _tokExp = Date.now() + (Number(j.expires_in) || 3600) * 1000
      return _tok || supabaseKey
    } catch { return supabaseKey }
  }

  async function poll() {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 6000)

      const bearer = await getBearer()
      const res = await fetch(
        `${supabaseUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(restaurantId)}&status=neq.closed&select=id,mesa,status,items,turno_id,updated_at`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` },
          signal:  controller.signal,
        }
      ).finally(() => clearTimeout(t))

      if (!res.ok) return

      const orders = await res.json()

      // Build mesa state from active orders
      const mesaMap = {}
      for (const o of orders) {
        mesaMap[String(o.mesa)] = { status: o.status === 'pagando' ? 'pagando' : 'ocupada', order_id: o.id }
      }

      const event = await eventStore.appendInternal(EVENT.STATE_SYNC, {
        mesas:      Object.entries(mesaMap).map(([mesa, v]) => ({ mesa, ...v })),
        kds_queue:  orders.filter(o => o.status === 'enviada' || o.status === 'preparando').map(o => ({
          order_id: o.id, mesa: o.mesa, items_sent: o.items, sent_at: o.updated_at,
        })),
        turno:      null, // TODO: fetch active turno separately
        synced_at:  new Date().toISOString(),
      }, { restaurantId })

      const prevSnap = JSON.stringify(state.toSnapshot())
      state.apply(event)
      const newSnap = JSON.stringify(state.toSnapshot())

      if (prevSnap !== newSnap) {
        await wsHub.broadcast(event)
      }

      heartbeat.recordSync()
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[supabase-poll] Error (non-fatal):', err.message)
      }
    }
  }

  await poll() // immediate first poll
  _supabasePolling = setInterval(poll, POLL_INTERVAL)
}

// ─── HTTP routes ──────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) } })
  })
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(payload))
}

function buildHttpRouter({ state, eventStore, wsHub, cmdHandler, printer, version, serverId, restaurantId }) {
  return async function router(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = req.url?.split('?')[0]

    // ── GET /identity ─────────────────────────────────────────────────────────
    // Fast identity check for discovery. Returns only the fields needed to
    // validate that a terminal found the right server before opening a WS.
    // No auth required — the information is already in mDNS TXT records.
    if (url === '/identity' && req.method === 'GET') {
      json(res, 200, {
        ok:               true,
        server_id:        serverId,
        restaurant_id:    restaurantId,
        branch_id:        config.branchId || null,
        instance_name:    instanceName,
        version,
        protocol_version: PROTOCOL_VERSION,
        capabilities:     ['orders', 'kds', 'printing', 'mesa-lock', 'sync-queue'],
        lan_ips:          networkAdapter.getAllLanIps(),
        ts:               Date.now(),
      })
      return
    }

    // ── GET /health ──────────────────────────────────────────────────────────
    if (url === '/health' && req.method === 'GET') {
      const seq = await eventStore.getLastSequence()
      json(res, 200, {
        ok:               true,
        server_id:        serverId,
        restaurant_id:    restaurantId,
        version,
        protocol_version: PROTOCOL_VERSION,
        hostname:         os.hostname(),
        platform:         process.platform,
        uptime_s:         Math.floor(process.uptime()),
        lan_ip:           networkAdapter.getLanIp(),
        clients_connected: wsHub.clientCount(),
        clients:          wsHub.getClientList(),
        last_sequence:    seq,
        sync_queue_size:  await eventStore.unsyncedCount(),
        print_jobs_failed: printer.getPrintJobsFailed(),
        staged_update:    updater.getStagedUpdate(),
        update_channel:   updater.getChannel(),
        stations:         Object.keys(printer.getStations()),
      })
      return
    }

    // ── GET /state ───────────────────────────────────────────────────────────
    if (url === '/state' && req.method === 'GET') {
      const seq = await eventStore.getLastSequence()
      json(res, 200, { sequence: seq, ...state.toSnapshot() })
      return
    }

    // ── POST /events ─────────────────────────────────────────────────────────
    // Accepts events from terminals that are not connected via WS.
    if (url === '/events' && req.method === 'POST') {
      try {
        const body = await parseBody(req)
        const events = Array.isArray(body) ? body : [body]
        const results = []
        for (const ev of events) {
          if (!ev.command_id || !ev.command_type) {
            results.push({ error: 'Missing command_id or command_type' })
            continue
          }
          const fakeMsg = {
            protocol_version: PROTOCOL_VERSION,
            type:             'COMMAND',
            restaurant_id:    ev.restaurant_id || restaurantId,
            payload:          ev,
          }
          const result = await cmdHandler.handle(fakeMsg, ev.client_id || 'rest-api')
          results.push(result)
        }
        json(res, 200, { results })
      } catch (e) {
        json(res, 500, { error: e.message })
      }
      return
    }

    // ── GET /events?since=N ──────────────────────────────────────────────────
    if (url && url.startsWith('/events') && req.method === 'GET') {
      const since = parseInt(new URL(req.url, 'http://localhost').searchParams.get('since') || '0', 10)
      const events = await eventStore.readAfter(since)
      json(res, 200, { events })
      return
    }

    // ── Print endpoints (backwards compatible) ───────────────────────────────
    if (url === '/print' && req.method === 'POST') {
      try {
        const body   = await parseBody(req)
        const station = body.station || 'caja'
        if (!body.data) { json(res, 400, { error: 'Missing data' }); return }
        const bytes = Buffer.from(body.data, 'base64')
        await printer.printToStation(station, bytes)
        console.log(`[server] ${bytes.length}B → ${station}`)
        json(res, 200, { ok: true, station, bytes: bytes.length })
      } catch (e) {
        console.error('[server] Print error:', e.message)
        json(res, 500, { error: e.message })
      }
      return
    }

    if (url === '/drawer' && req.method === 'POST') {
      try {
        await printer.kickDrawer()
        json(res, 200, { ok: true })
      } catch (e) {
        json(res, 500, { error: e.message })
      }
      return
    }

    if (url === '/test' && req.method === 'POST') {
      const results = {}
      for (const name of Object.keys(printer.getStations())) {
        try {
          await printer.printToStation(name, printer.buildTestTicket(name, version))
          results[name] = 'ok'
        } catch (e) { results[name] = e.message }
      }
      json(res, 200, { ok: true, results })
      return
    }

    if (url === '/config' && req.method === 'GET') {
      json(res, 200, { stations: printer.getStations() })
      return
    }

    if (url === '/config' && req.method === 'POST') {
      try {
        const body = await parseBody(req)
        if (body.stations) printer.setStations({ ...printer.getStations(), ...body.stations })
        json(res, 200, { ok: true, stations: printer.getStations() })
      } catch (e) {
        json(res, 500, { error: e.message })
      }
      return
    }

    // ── /fp/* proxy → fingerprint service on port 7718 ───────────────────────
    // The web app calls /fp/health, /fp/enroll, /fp/auth, /fp/list via this
    // proxy so it only needs to know about one local port (7717).
    if (url?.startsWith('/fp')) {
      const fpPath = url.slice(3) || '/'
      const fpQuery = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
      const fpUrl = `http://127.0.0.1:7718${fpPath}${fpQuery}`
      try {
        const fpReq = require('http').request(fpUrl, { method: req.method, timeout: 90000 }, fpRes => {
          res.writeHead(fpRes.statusCode, {
            'Content-Type': fpRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          fpRes.pipe(res)
        })
        fpReq.on('error', () => json(res, 503, { ok: false, error: 'Fingerprint service not running' }))
        fpReq.setTimeout(90000, () => { fpReq.destroy(); json(res, 504, { ok: false, error: 'Fingerprint timeout' }) })
        req.pipe(fpReq)
      } catch (e) {
        json(res, 503, { ok: false, error: e.message })
      }
      return
    }

    json(res, 404, { error: 'Not found' })
  }
}

// ─── startLocalServer ─────────────────────────────────────────────────────────

/**
 * @param {{ dataDir: string, port?: number, config: object }} opts
 *   config: { restaurantId, channel, instanceName, supabaseUrl, supabaseKey,
 *             printersConfig, printerConfigPath, queueFilePath, clientId }
 * @returns {{ httpServer, close }}
 */
async function startLocalServer({ dataDir, port = 7717, config = {} }) {
  // CFG-02: refuse to start if restaurant identity is missing or invalid.
  // The Electron main process gate (loadAndValidateConfig) should prevent this,
  // but the Local Server is the last line of defense.
  const restaurantId = config.restaurantId || config.clientId
  if (!restaurantId || restaurantId === 'unknown') {
    throw Object.assign(
      new Error('[CFG-02] Local Server refuses to start: restaurant_id is missing or "unknown". Provision this terminal first via the setup wizard.'),
      { code: 'NOT_PROVISIONED' }
    )
  }

  const {
    channel            = config.channel || 'stable',
    instanceName       = config.instanceName || `Fullsite POS — ${os.hostname()}`,
    supabaseUrl        = process.env.SUPABASE_URL || '',
    supabaseKey        = process.env.SUPABASE_ANON_KEY || '',
    // Service-account por-tenant (miembro SOLO de este client_id) para que el poll
    // lea con JWT authenticated en vez de la anon key. Opcional (fallback a anon).
    serviceEmail       = config.serviceEmail || process.env.SUPABASE_SERVICE_EMAIL || '',
    servicePassword    = config.servicePassword || process.env.SUPABASE_SERVICE_PASSWORD || '',
    // CFG-01: printersConfig is the validated v2 printers config, or null.
    // null means PRINTER_NOT_CONFIGURED — printer adapter handles safely.
    printersConfig     = null,
    printerConfigPath  = null,
    queueFilePath      = null,
  } = config

  // ── Init adapters ────────────────────────────────────────────────────────
  processAdapter.init({ dataDir })
  printerAdapter.init({ printersConfig, configPath: printerConfigPath, queueFilePath })

  const version  = processAdapter.getVersion()
  const serverId = loadOrCreateServerId(dataDir)

  // ── Event store ──────────────────────────────────────────────────────────
  const ndjsonStore = new NdjsonEventStore({
    eventLogPath:           processAdapter.getEventLogPath(),
    processedCommandsPath:  processAdapter.getProcessedCommandsPath(),
  })
  const eventStore = new CoreEventStore(ndjsonStore)
  await eventStore.load()

  // ── State machine: rebuild from event log ────────────────────────────────
  const state  = new RestaurantState()
  const events = await eventStore.readAfter(0)
  console.log(`[server] Replaying ${events.length} events to rebuild state...`)
  for (const ev of events) state.apply(ev)
  console.log('[server] State ready.')

  // ── WebSocket hub ────────────────────────────────────────────────────────
  const wsHub = new WsHub({
    serverId,
    restaurantId,
    getState:        () => state.toSnapshot(),
    getLastSequence: () => eventStore.getLastSequence(),
    readAfter:       (seq) => eventStore.readAfter(seq),
  })

  // ── Command handler ──────────────────────────────────────────────────────
  const cmdHandler = new CommandHandler({
    eventStore,
    state,
    wsHub,
    printer:      printerAdapter,
    restaurantId,
  })

  wsHub.onCommand((msg, clientId) => cmdHandler.handle(msg, clientId))

  // ── HTTP server ──────────────────────────────────────────────────────────
  const router = buildHttpRouter({ state, eventStore, wsHub, cmdHandler, printer: printerAdapter, version, serverId, restaurantId })
  const httpServer = http.createServer(router)

  wsHub.attach(httpServer)

  // ── Lock GC every 30s ────────────────────────────────────────────────────
  setInterval(() => state.gcLocks(), 30_000)

  // ── Listen ───────────────────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', resolve)
    httpServer.on('error', reject)
  })

  const lanIp = networkAdapter.getLanIp()
  console.log(`\n  Fullsite Local Server v${version}`)
  console.log(`  http://0.0.0.0:${port}  (LAN: ${lanIp || 'unknown'}:${port})`)
  console.log(`  WS: ws://${lanIp || 'localhost'}:${port}/ws`)
  console.log(`  Channel: ${channel} | Restaurant: ${restaurantId}`)
  console.log(`  Server ID: ${serverId}\n`)

  // ── mDNS ─────────────────────────────────────────────────────────────────
  mdns.start({ restaurantId, serverId, instanceName, version, protocolVersion: PROTOCOL_VERSION, port, channel })

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  heartbeat.start({
    supabaseUrl, supabaseKey, serverId, restaurantId, version,
    protocolVersion:    PROTOCOL_VERSION,
    platform:           process.platform,
    getClientCount:     () => wsHub.clientCount(),
    getUnsyncedCount:   () => eventStore.unsyncedCount(),
    getPrintJobsFailed: () => printerAdapter.getPrintJobsFailed(),
    getDiskFreeMb:      () => processAdapter.getDiskFreeMb(),
  })

  // ── Update manager ────────────────────────────────────────────────────────
  updater.init({
    channel, currentVersion: version, supabaseUrl, supabaseKey, restaurantId,
    onUpdateAvailable: (info) => wsHub.broadcastUpdateAvailable(info),
  })

  // ── Supabase poll (Phase 1 bridge) ────────────────────────────────────────
  if (supabaseUrl && supabaseKey) {
    startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, serviceEmail, servicePassword, state, eventStore, wsHub })
      .catch(e => console.warn('[server] Supabase poll start error:', e.message))
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────
  function close() {
    if (_supabasePolling) clearInterval(_supabasePolling)
    mdns.stop()
    heartbeat.stop()
    updater.stop()
    wsHub.close()
    httpServer.close()
    console.log('[server] Shut down cleanly.')
  }

  return { httpServer, close, serverId, lanIp, wsHub }
}

module.exports = { startLocalServer }
