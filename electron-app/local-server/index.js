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
const { OutboxWorker }      = require('./core/outbox')
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

function deliveryStation(name = '', explicit) {
  if (explicit === 'cocina' || explicit === 'barra' || explicit === 'caja') return explicit
  const n = String(name).toLowerCase()
  if (/cafe|café|latte|frappe|frappé|jugo|juice|soda|smoothie|cerveza|beer|vino|tea|tisana|limonada|mojito/.test(n)) return 'barra'
  if (/ice cream|helado|nieve|market|snack|regalo|suplemento/.test(n)) return 'caja'
  return 'cocina'
}

function deliveryOrderCommand(row, restaurantId) {
  const rawItems = Array.isArray(row.items) ? row.items : []
  const items = rawItems.map((item, index) => ({
    id: item.id || item.sku || `${row.id}-${index}`,
    menuItemId: item.sku || item.id || null,
    nombre: item.name || item.nombre || 'Producto',
    cantidad: Number(item.qty ?? item.quantity ?? 1),
    modificadores: item.modifiers || [],
    notas: item.notes || '',
    station: deliveryStation(item.name || item.nombre, item.station),
  }))
  return {
    command_id: `delivery-ingest:${row.platform}:${row.platform_order_id}`,
    command_type: 'ORDER_SENT',
    restaurant_id: restaurantId,
    order_id: row.id,
    mesa: null,
    mesero: row.platform === 'rappi' ? '🟠 Rappi' : '🟢 Uber',
    status: 'enviada',
    items,
    personas: 1,
    total: Number(row.total || 0),
    notas: [row.customer_name, row.notes].filter(Boolean).join(' · '),
    delivery: true,
    platform: row.platform,
    platform_order_id: row.platform_order_id,
  }
}

function buildDeliveryTicket(command, station) {
  const items = command.items.filter(item => item.station === station)
  if (!items.length) return null
  const lines = items.flatMap(item => {
    const out = [`${item.cantidad} x ${item.nombre}`]
    if (Array.isArray(item.modificadores)) for (const mod of item.modificadores) out.push(`  + ${typeof mod === 'string' ? mod : (mod.name || mod.nombre || '')}`)
    if (item.notas) out.push(`  NOTA: ${item.notas}`)
    return out
  })
  return Buffer.from(
    '\x1b\x40\x1b\x61\x01\x1b\x45\x01' + `${command.mesero} — ${station.toUpperCase()}\n` +
    '\x1b\x45\x00' + `Orden: ${command.platform_order_id}\n` +
    (command.notas ? `${command.notas}\n` : '') + '\n' +
    '\x1b\x61\x00' + lines.join('\n') + '\n\n\x1d\x56\x41\x03',
    'binary'
  )
}

async function startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, serviceEmail, servicePassword, state, eventStore, wsHub, cmdHandler }) {
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
      const turnoRes = await fetch(
        `${supabaseUrl}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(restaurantId)}&closed_at=is.null&select=id,opened_by,opened_at&order=opened_at.desc`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        }
      )
      const activeTurnos = turnoRes.ok ? await turnoRes.json() : []
      const activeTurno = activeTurnos[0] || null
      const res = await fetch(
        `${supabaseUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(restaurantId)}&status=neq.closed&select=id,mesa,status,items,turno_id,updated_at`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` },
          signal:  controller.signal,
        }
      ).finally(() => clearTimeout(t))

      if (!res.ok) return

      const orders = await res.json()
      // A restaurant can have historical/open-order residue from an older shift.
      // Only the newest active shift belongs on today's operational surfaces. A
      // duplicate active shift is reported in the turno snapshot for remediation,
      // but its orders must never bleed into the current KDS.
      const operationalOrders = activeTurno
        ? orders.filter(order => order.turno_id === activeTurno.id)
        : []

      // Marketplace orders live in delivery_orders. Mirror them into the same
      // durable ORDER_SENT protocol consumed by Electron KDS and printer queues.
      // Stable command IDs make every 5s poll and every restart exactly-once.
      const deliveryRes = await fetch(
        `${supabaseUrl}/rest/v1/delivery_orders?client_id=eq.${encodeURIComponent(restaurantId)}&platform=in.(ubereats,rappi)&status=in.(nueva,aceptada,preparando)&select=id,platform,platform_order_id,status,customer_name,total,notes,items,created_at`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` }, signal: controller.signal }
      )
      const deliveryOrders = deliveryRes.ok ? await deliveryRes.json() : []
      if (cmdHandler) {
        for (const row of deliveryOrders) {
          const command = deliveryOrderCommand(row, restaurantId)
          const ingestResult = await cmdHandler.handle({ protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: restaurantId, payload: command }, 'delivery-poll')
          // This event originated in Supabase; do not echo it back through the outbox.
          if (ingestResult.event?.sequence) await eventStore.markSynced(ingestResult.event.sequence)
          for (const station of ['cocina', 'barra', 'caja']) {
            const ticket = buildDeliveryTicket(command, station)
            if (!ticket) continue
            const printResult = await cmdHandler.handle({
              protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: restaurantId,
              payload: { command_id: `delivery-print:${row.platform}:${row.platform_order_id}:${station}`, command_type: 'PRINT_COMMAND', station, data_b64: ticket.toString('base64') },
            }, 'delivery-poll')
            if (printResult.event?.sequence) await eventStore.markSynced(printResult.event.sequence)
          }
        }
      }

      // Build mesa state from active orders
      const mesaMap = {}
      for (const o of operationalOrders) {
        mesaMap[String(o.mesa)] = { status: o.status === 'pagando' ? 'pagando' : 'ocupada', order_id: o.id }
      }

      const event = await eventStore.appendInternal(EVENT.STATE_SYNC, {
        mesas:      Object.entries(mesaMap).map(([mesa, v]) => ({ mesa, ...v })),
        kds_queue:  operationalOrders.filter(o => o.status === 'enviada' || o.status === 'preparando').map(o => ({
          order_id: o.id, mesa: o.mesa, items_sent: o.items, sent_at: o.updated_at, turno_id: o.turno_id,
        })),
        turno:      activeTurno ? {
          id: activeTurno.id,
          opened_by: activeTurno.opened_by,
          opened_at: activeTurno.opened_at,
          conflict_count: activeTurnos.length,
        } : null,
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

// Forward a POST to another local server (the caja) over Node http — no browser
// mixed-content wall applies here. Used by secondary POS terminals so their https
// page can reach the caja's printers/state via their own localhost server.
function forwardPost(targetUrl, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl)
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }, timeout: 5000 },
      (resp) => { let d = ''; resp.on('data', c => { d += c }); resp.on('end', () => resolve({ status: resp.statusCode, body: d })) }
    )
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    r.write(bodyStr); r.end()
  })
}

// Keep identity and routing configuration explicit so every cloned terminal can
// discover the caja without relying on process-global or customer-specific state.
function buildHttpRouter({ state, eventStore, wsHub, cmdHandler, printer, version, serverId, restaurantId, config = {}, instanceName = '', branchId = config.branchId || null, posServerIp = config.posServerIp || null, port = 7717 }) {
  return async function router(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = req.url?.split('?')[0]

    // ── Secondary-POS forward (role 'pos', posServerIp set) ───────────────────
    // A secondary POS has no physical printers and its state isn't the KDS source
    // of truth. Its POS page is https and CANNOT POST to the caja's http LAN IP
    // (mixed content). So it POSTs to THIS local server (127.0.0.1, exempt from the
    // wall) and we forward /print, /events and /drawer to the caja over Node http.
    if (posServerIp && req.method === 'POST' && (url === '/print' || url === '/events' || url === '/drawer')) {
      try {
        const body = await parseBody(req)
        const up = await forwardPost(`http://${posServerIp}:${port || 7717}${url}`, JSON.stringify(body))
        res.writeHead(up.status || 502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(up.body || '{}')
      } catch (e) {
        console.error('[forward→caja] failed:', e.message)
        json(res, 502, { error: 'forward to caja failed: ' + e.message })
      }
      return
    }

    // ── GET /identity ─────────────────────────────────────────────────────────
    // Fast identity check for discovery. Returns only the fields needed to
    // validate that a terminal found the right server before opening a WS.
    // No auth required — the information is already in mDNS TXT records.
    if (url === '/identity' && req.method === 'GET') {
      json(res, 200, {
        ok:               true,
        server_id:        serverId,
        restaurant_id:    restaurantId,
        branch_id:        branchId || null,
        instance_name:    instanceName || null,
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

    // ── GET /kds — self-contained kitchen display, served over http on the LAN ──
    // Renders kds_orders from /state without Supabase. Served over http so the page
    // can reach the bridge without the https mixed-content wall (an http page may
    // freely fetch http://<lan-ip>:7717/state). Works fully offline: page + data are
    // both local/LAN, no internet needed to load the screen OR receive new orders.
    if (url === '/kds' && req.method === 'GET') {
      try {
        const fsMod = require('fs')
        const pathMod = require('path')
        let html = fsMod.readFileSync(pathMod.join(__dirname, 'kds-ui.html'), 'utf8')
        // Where the page reads /state from: the caja's LAN IP for a dedicated KDS
        // terminal (so it pulls the caja's orders), or same-origin ('') for the caja.
        const bridgeBase = posServerIp ? `http://${posServerIp}:${port || 7717}` : ''
        const cfg = JSON.stringify({ bridge_base: bridgeBase, client_id: restaurantId })
        html = html.replace('<script>', `<script>window.__KDS_CFG__=${cfg};</script>\n<script>`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(html)
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('KDS UI unavailable: ' + e.message)
      }
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
  const router = buildHttpRouter({
    state,
    eventStore,
    wsHub,
    cmdHandler,
    printer: printerAdapter,
    version,
    serverId,
    restaurantId,
    config,
    instanceName,
    branchId: config.branchId || null,
    posServerIp: config.posServerIp || null,
    port,
  })
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
    startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, serviceEmail, servicePassword, state, eventStore, wsHub, cmdHandler })
      .catch(e => console.warn('[server] Supabase poll start error:', e.message))
  }

  // ── Outbox Worker (Phase 2 — SHADOW MODE, OFF por default) ─────────────────
  // Con OFFLINE_OUTBOX_SHADOW=1 sube los eventos locales a pos_local_events en
  // paralelo (el browser sigue siendo autoridad) → valida el pipeline del modelo
  // Pedro sin riesgo. Prerequisito: schema pos_local_events aplicado en Supabase.
  let _outbox = null
  if (supabaseUrl && supabaseKey && process.env.OFFLINE_OUTBOX_SHADOW === '1') {
    _outbox = new OutboxWorker({ eventStore, supabaseUrl, supabaseKey, restaurantId })
    _outbox.start()
    console.log('[server] Outbox Worker: SHADOW MODE activo')
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────
  function close() {
    if (_supabasePolling) clearInterval(_supabasePolling)
    if (_outbox) _outbox.stop()
    mdns.stop()
    heartbeat.stop()
    updater.stop()
    wsHub.close()
    httpServer.close()
    console.log('[server] Shut down cleanly.')
  }

  return { httpServer, close, serverId, lanIp, wsHub }
}

// buildHttpRouter se exporta para poder probar las rutas sin levantar el servidor
// completo (mDNS + heartbeat + polling quedarían corriendo y colgarían el test).
module.exports = { startLocalServer, buildHttpRouter, deliveryStation, deliveryOrderCommand, buildDeliveryTicket }
