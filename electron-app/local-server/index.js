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
const { ActorAuthority } = require('./core/actor-authority')
const { CatalogStore } = require('./core/catalog-store')
const { handleAuthenticatedCommand } = require('./core/command-authority')
const { conectarConLaCaja } = require('./core/enlace-con-caja')
const credLan = require('./core/credencial-lan')
const { OutboxWorker }      = require('./core/outbox')
const { BusinessOutbox } = require('./core/business-outbox')
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

async function startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, branchId, serviceEmail, servicePassword, state, eventStore, wsHub, cmdHandler }) {
  if (!supabaseUrl || !supabaseKey) return
  const POLL_INTERVAL = 5000
  const { readOperationalOrders } = require('./core/operational-order-poll')
  let polling = false

  // Auth SCOPED al tenant. Si hay una service-account (usuario Supabase miembro
  // SOLO de este client_id), se usa su JWT (role authenticated) → la RLS deja leer
  // únicamente ESTE tenant. Así NO va la god service_role key en la terminal (si se
  // filtra, solo expone este local). Fallback a la anon key (legacy) si no está
  // configurada — tras el RLS lockdown ese fallback devuelve 0 filas, por eso se
  // recomienda configurar la service-account por restaurante.
  let _tok = null, _tokExp = 0
  async function getBearer(signal) {
    if (!serviceEmail || !servicePassword) return supabaseKey
    if (_tok && Date.now() < _tokExp - 60000) return _tok
    try {
      const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        signal,
        headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
      })
      if (!r.ok) return null
      const j = await r.json()
      _tok = j.access_token
      _tokExp = Date.now() + (Number(j.expires_in) || 3600) * 1000
      return _tok || null
    } catch { return null }
  }

  async function poll() {
    if (polling) return
    polling = true
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 6000)
    try {
      const bearer = await getBearer(controller.signal)
      if (!bearer) return
      const locationFilter = branchId ? `&location_id=eq.${encodeURIComponent(branchId)}` : ''
      const turnoRes = await fetch(
        `${supabaseUrl}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(restaurantId)}&closed_at=is.null&select=id,opened_by,opened_at&order=opened_at.desc${locationFilter}`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        }
      )
      if (!turnoRes.ok) return
      const activeTurnos = await turnoRes.json()
      if (!Array.isArray(activeTurnos)) return
      const activeTurno = activeTurnos[0] || null
      const orders = await readOperationalOrders({ supabaseUrl, restaurantId, branchId,
        turnoId: activeTurno?.id,
        headers: { apikey: supabaseKey, Authorization: `Bearer ${bearer}` }, signal: controller.signal })
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
          if (ingestResult.event?.sequence) await eventStore.markSynced([ingestResult.event.sequence])
          for (const station of ['cocina', 'barra', 'caja']) {
            const ticket = buildDeliveryTicket(command, station)
            if (!ticket) continue
            const printResult = await cmdHandler.handle({
              protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: restaurantId,
              payload: { command_id: `delivery-print:${row.platform}:${row.platform_order_id}:${station}`, command_type: 'PRINT_COMMAND', station, data_b64: ticket.toString('base64') },
            }, 'delivery-poll')
            if (printResult.event?.sequence) await eventStore.markSynced([printResult.event.sequence])
          }
        }
      }

      // Build mesa state from active orders
      const mesaMap = {}
      for (const o of operationalOrders) {
        if (['cerrada', 'pagada', 'cancelada', 'closed'].includes(o.status)) continue
        mesaMap[String(o.mesa)] = { status: o.status === 'pagando' ? 'pagando' : 'ocupada', order_id: o.id }
      }

      const event = await eventStore.appendInternal(EVENT.STATE_SYNC, {
        orders:     operationalOrders,
        order_snapshot_complete: true,
        mesas:      Object.entries(mesaMap).map(([mesa, v]) => ({ mesa, ...v })),
        kds_queue:  operationalOrders.filter(o => o.status === 'enviada' || o.status === 'preparando' || o.status === 'lista').map(o => ({
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
      console.warn('[supabase-poll] Snapshot omitido:', err.name === 'AbortError' ? 'deadline total de 6s excedido' : err.message)
    } finally { clearTimeout(t); polling = false }
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
function forwardPost(targetUrl, bodyStr, credenciales = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl)
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        // La credencial viaja al reenviar: la caja exige la misma que este Pedro.
        // Sin esto, activar la seguridad dejaria a las terminales secundarias sin
        // imprimir ni mandar comandas — el reenvio moriria con 401.
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...credenciales }, timeout: 5000 },
      (resp) => { let d = ''; resp.on('data', c => { d += c }); resp.on('end', () => resolve({ status: resp.statusCode, body: d })) }
    )
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    r.write(bodyStr); r.end()
  })
}

/**
 * Reenvío de LECTURA hacia la caja. La mitad que faltaba.
 *
 * POR QUÉ EXISTE: hasta 2026-09-02 el reenvío entre terminales era
 * `req.method === 'POST'` y nada más — tres rutas de escritura (/print, /events,
 * /drawer) y ninguna forma de PREGUNTAR. Una terminal secundaria podía avisar,
 * no consultar. Su única fuente de estado era la nube, así que sin internet cada
 * caja quedaba con lo suyo.
 *
 * En campo, con tres cajas y el WAN caído (Eduardo Esquivel, AMALAY):
 *   «no hay comunicación correcta entre los puntos de venta, no muestran lo mismo»
 *
 * La caja ya sabía contestar `GET /state` y `GET /events?since=N`. Nadie podía
 * alcanzarlas. Esto abre esa dirección.
 *
 * Se conserva `query` porque `/events?since=N` no sirve de nada sin ella: es
 * justo el parámetro que permite a una terminal ponerse al día tras reconectar.
 */
function forwardGet(targetUrl, credenciales = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl)
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
        headers: { ...credenciales },
        // Más corto que el POST (5 s) a propósito: una lectura la está esperando
        // una pantalla con alguien enfrente. Si la caja no contesta en 2 s, el
        // consumidor cae a su caché local, que es lo correcto — mejor mostrar
        // algo viejo y decirlo que congelar el mapa de mesas.
        timeout: 2000 },
      (resp) => { let d = ''; resp.on('data', c => { d += c }); resp.on('end', () => resolve({ status: resp.statusCode, body: d })) }
    )
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    r.end()
  })
}

/** Lecturas que una terminal secundaria puede hacerle a la caja. */
const LECTURAS_REENVIADAS = ['/state', '/events', '/print/uncertain', '/auth/status', '/catalog', '/catalog/status', '/sync/status']

// Keep identity and routing configuration explicit so every cloned terminal can
// discover the caja without relying on process-global or customer-specific state.
function buildHttpRouter({ state, eventStore, wsHub, cmdHandler, actorAuthority = null, catalogStore = null, authorityReason = null, catalogReason = null, getBusinessSyncStatus = () => ({ configured: false }), printer, version, serverId, restaurantId, config = {}, instanceName = '', branchId = config.branchId || config.locationId || null, posServerIp = config.posServerIp || null, port = 7717, posServerPort = config.posServerPort || null }) {
  // Puerto de la CAJA al reenviar. Antes se usaba `port` — el puerto PROPIO del
  // secundario — lo que acopla ambos al 7717: dos Pedros en una misma maquina
  // (pruebas, demos) o una terminal en puerto distinto rompian el forward.
  const cajaPort = posServerPort || port || 7717
  // Se calcula UNA vez, no por peticion: es el mismo secreto toda la vida del
  // proceso y recalcularlo en cada comanda no aporta nada.
  const credencialesHaciaLaCaja = credLan.cabecerasDeCredencial({
    secreto: config.lanSecret || null, restaurantId, terminalId: config.terminalId, branchId,
  })
  return async function router(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    // Sin listar la cabecera de credencial, el preflight la rechaza y el POS
    // recibe un error de red sin explicacion.
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${credLan.CABECERA}, x-fullsite-restaurante, x-fullsite-terminal, x-fullsite-sucursal, x-fullsite-actor`)
    res.setHeader('Cache-Control', 'no-store')
    // Chrome/Electron sends a Private Network Access preflight when the POS
    // loaded from https://app.fullsite.mx calls its bridge on localhost/LAN.
    // A top-level navigation to /health works without this header, while fetch()
    // is rejected as a network error — exactly the AMALAY Entrada field failure.
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
    // Sin exponerla, `fetch()` NO puede leer esta cabecera cross-origin: existiría
    // en el cable y sería invisible para el POS. Es la que avisa que el dato NO
    // viene de la caja. (El cuerpo también lo declara — ver `authoritative`; la
    // cabecera es la vía barata para un consumidor que no parsea el JSON.)
    res.setHeader('Access-Control-Expose-Headers', 'X-Fullsite-Origen')
    res.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // `url` es SÓLO la ruta, para enrutar. `rutaCompleta` conserva la query, para
    // REENVIAR.
    //
    // Antes había una sola variable, `req.url.split('?')[0]`, y el reenvío usaba
    // ésa — así que `GET /events?since=57` salía hacia la caja como `/events` y el
    // cursor se perdía: la terminal recibía el historial completo en cada
    // reconexión, sin forma de saber qué ya había visto. Es justo lo que `since`
    // existe para resolver.
    //
    // El bug sobrevivió a una prueba en verde porque esa prueba comprobaba que el
    // código CONTUVIERA `u.pathname + u.search`, no que la query llegara. Ver
    // `tests/reenvio-lectura-integracion.test.js`, que levanta dos servidores
    // reales y afirma sobre lo que recibió el de enfrente.
    const url = req.url?.split('?')[0]
    const rutaCompleta = req.url || url

    // ── Credencial de la red local ──────────────────────────────────────────
    // Pedro escucha en 0.0.0.0: sin esto, cualquier equipo del WiFi puede leer
    // las ordenes del dia, emitir un cierre, imprimir o ABRIR EL CAJON. Va antes
    // que TODO lo operativo, incluido el reenvio: una peticion que no puede
    // entrar aqui tampoco debe poder salir hacia la caja usando a este Pedro de
    // puente. Ver core/credencial-lan.js.
    const credencial = credLan.verificarCredencial({
      ruta: url, metodo: req.method, cabeceras: req.headers,
      secreto: config.lanSecret || null, restaurantId, branchId,
    })
    if (!credencial.permitido) {
      console.warn(`${credLan.LOG} rechazada ${req.method} ${url} desde ${req.socket?.remoteAddress}: ${credencial.motivo}`)
      // 401 y no 403: falta credencial, no permiso. El mensaje NO dice cual es
      // el secreto ni si el restaurante acerto — quien no tiene la llave no
      // merece pistas.
      json(res, 401, { error: credencial.motivo })
      return
    }

    // Installation credentials establish transport, not permission to open a
    // drawer or execute arbitrary ESC/POS bytes. Until these controls have an
    // actor-authorized domain command, disable every legacy printing bypass.
    if (req.method === 'POST' && ['/print', '/drawer', '/test', '/config', '/print/resolve'].includes(url) &&
      (config.localAuthorityEnabled === true || state?.toSnapshot?.().write_authority === 'caja')) {
      json(res, 409, { code: 'CONTROLLED_PRINT_REQUIRED', error: 'Esta acción de impresión requiere una operación autorizada en Caja' })
      return
    }

    // ── Secondary-POS forward (role 'pos', posServerIp set) ───────────────────
    // A secondary POS has no physical printers and its state isn't the KDS source
    // of truth. Its POS page is https and CANNOT POST to the caja's http LAN IP
    // (mixed content). So it POSTs to THIS local server (127.0.0.1, exempt from the
    // wall) and we forward /print, /events and /drawer to the caja over Node http.
    if (posServerIp && req.method === 'POST' && (url === '/print' || url === '/events' || url === '/drawer' || url === '/print/resolve' || url === '/auth/pin')) {
      try {
        const body = await parseBody(req)
        const up = await forwardPost(`http://${posServerIp}:${cajaPort}${url}`, JSON.stringify(body), {
          ...credencialesHaciaLaCaja,
          ...(req.headers['x-fullsite-terminal'] ? { 'x-fullsite-terminal': req.headers['x-fullsite-terminal'] } : {}),
          ...(req.headers['x-fullsite-actor'] ? { 'x-fullsite-actor': req.headers['x-fullsite-actor'] } : {}),
        })
        res.writeHead(up.status || 502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(up.body || '{}')
      } catch (e) {
        console.error('[forward→caja] failed:', e.message)
        json(res, 502, { error: 'forward to caja failed: ' + e.message })
      }
      return
    }

    // ── Reenvío de LECTURA hacia la caja (rol 'pos') ─────────────────────────
    // La mitad que faltaba del bloque de arriba. Una terminal secundaria no es
    // la fuente de verdad del salón: su propio `state` sólo conoce lo que ella
    // misma hizo. Preguntarle a la caja es lo único que hace que las tres
    // terminales vean lo mismo sin internet.
    //
    // Va DESPUÉS del reenvío de escritura y ANTES de las rutas locales, para que
    // en un secundario `/state` signifique «el salón» y no «lo que yo vi».
    //
    // `/identity` y `/health` NO se reenvían a propósito: preguntan por ESTA
    // máquina. Reenviarlas haría que un secundario se presentara como la caja,
    // y el descubrimiento de terminales dejaría de funcionar.
    if (posServerIp && req.method === 'GET' && LECTURAS_REENVIADAS.includes(url)) {
      try {
        // `rutaCompleta`, NO `url`: sin la query se pierde `?since=N`.
        const up = await forwardGet(`http://${posServerIp}:${cajaPort}${rutaCompleta}`, credencialesHaciaLaCaja)
        res.writeHead(up.status || 502, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Fullsite-Origen',
        })
        res.end(up.body || '{}')
      } catch (e) {
        // Falla ABIERTO hacia el estado local, y lo DICE en una cabecera. Si la
        // caja está apagada o la LAN se cortó, devolver un error dejaría el mapa
        // de mesas en blanco — peor que mostrar lo que esta terminal sabe. Pero
        // el consumidor tiene que poder distinguir «el salón» de «lo que yo vi»:
        // confundirlos es exactamente la familia de bugs que costó la semana.
        console.warn('[forward→caja GET] falló, sirvo estado local:', e.message)
        if (url === '/state') {
          const seq = await eventStore.getLastSequence()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Fullsite-Origen',
            'X-Fullsite-Origen': 'local-degradado',
          })
          // En el CUERPO, no sólo en la cabecera. Una cabecera cross-origin es
          // invisible para `fetch()` salvo que se exponga, y un consumidor puede
          // no mirarla nunca. `authoritative: false` viaja con el dato y obliga a
          // quien lo lea a decidir qué hace — que es el punto: este snapshot es
          // lo que ESTA terminal vio, no el salón.
          res.end(JSON.stringify({
            sequence: seq,
            authoritative: false,
            source: 'local-degradado',
            ...state.toSnapshot(),
          }))
          return
        }
        json(res, 502, { error: 'no se pudo consultar a la caja: ' + e.message })
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
        // Sin esto, una Caja que arrancó sin autoridad se ve idéntica a una sana
        // hasta que alguien intenta entrar con su PIN en plena comida.
        authority:        { ready: !!actorAuthority, reason: authorityReason },
        catalog:          { ready: !!catalogStore, reason: catalogReason },
        staged_update:    updater.getStagedUpdate(),
        update_channel:   updater.getChannel(),
        stations:         Object.keys(printer.getStations()),
      })
      return
    }

    // ── GET /state ───────────────────────────────────────────────────────────
    if (url === '/state' && req.method === 'GET') {
      const seq = await eventStore.getLastSequence()
      // La simétrica del degradado. Si sólo se marcara el caso malo, un consumidor
      // no podría distinguir "esto es autoritativo" de "esto lo sirvió una versión
      // vieja de Pedro que aún no sabía marcarlo" — y ante la duda tendría que
      // asumir lo peor de un dato bueno.
      json(res, 200, { sequence: seq, authoritative: true, source: 'caja', ...state.toSnapshot() })
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
        const bridgeBase = posServerIp ? `http://${posServerIp}:${cajaPort}` : ''
        const cfg = JSON.stringify({ bridge_base: bridgeBase, client_id: restaurantId, headers: credencialesHaciaLaCaja }).replace(/</g, '\\u003c')
        html = html.replace('<script>', `<script>window.__KDS_CFG__=${cfg};</script>\n<script>`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(html)
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('KDS UI unavailable: ' + e.message)
      }
      return
    }

    if ((url === '/catalog' || url === '/catalog/status') && req.method === 'GET') {
      try {
        if (!catalogStore) throw Object.assign(new Error('Catálogo no preparado en Caja'), { code: 'CATALOG_NOT_READY' })
        if (url === '/catalog' && !catalogStore.status().ready && catalogStore.pending) await catalogStore.pending.catch(() => {})
        json(res, 200, url === '/catalog' ? catalogStore.read() : catalogStore.status())
      } catch (error) { json(res, 503, { error: error.message, code: error.code }) }
      return
    }
    if (url === '/auth/status' && req.method === 'GET') {
      try {
        json(res, actorAuthority ? 200 : 503, actorAuthority ? actorAuthority.status()
          : { error: 'Autorización no preparada', reason: authorityReason, code: 'ACTOR_AUTHORITY_UNAVAILABLE' })
      }
      catch (error) { json(res, error.status || 503, { error: error.message, code: error.code }) }
      return
    }
    if (url === '/auth/pin' && req.method === 'POST') {
      // El motivo viaja para que la pantalla y el soporte puedan distinguir
      // "todavía no arranca" de "el archivo de credenciales está dañado".
      if (!actorAuthority) {
        json(res, 503, { error: 'Autorización no preparada en Caja', reason: authorityReason, code: 'ACTOR_AUTHORITY_UNAVAILABLE' })
        return
      }
      try {
        const body = await parseBody(req)
        if (credLan.verificarScope(body, { restaurantId, branchId })) { json(res, 403, { error: 'Scope de otra instalación' }); return }
        const result = await actorAuthority.login({ pin: body.pin, restaurantId,
          deviceId: req.headers['x-fullsite-terminal'], minRole: body.min_role })
        // Server-issued token only, held for acquisition, never persisted.
        if (!result.offline && result.shiftToken && catalogStore) {
          void catalogStore.refresh(result.shiftToken).catch(() => {})
        }
        json(res, 200, result)
      } catch (error) { json(res, error.status || 500, { error: error.message, code: error.code }) }
      return
    }

    // ── POST /events ─────────────────────────────────────────────────────────
    // Accepts events from terminals that are not connected via WS.
    if (url === '/events' && req.method === 'POST') {
      try {
        const body = await parseBody(req)
        const events = Array.isArray(body) ? body : [body]
        const fueraDeScope = events.some(ev => credLan.verificarScope(ev, { restaurantId, branchId }))
        if (fueraDeScope) { json(res, 403, { error: 'scope de otra instalacion' }); return }
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
          const result = await handleAuthenticatedCommand({ cmdHandler, actorAuthority, msg: fakeMsg,
            clientId: req.headers['x-fullsite-terminal'] || ev.client_id || 'rest-api',
            terminalId: req.headers['x-fullsite-terminal'], actorToken: req.headers['x-fullsite-actor'] })
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

    // Resolver papel incierto exige credencial; nunca se reimprime automáticamente.
    if (url === '/print/uncertain' && req.method === 'GET') {
      if (typeof printer.getUncertainJobs !== 'function') { json(res, 503, { error: 'reconciliacion no disponible' }); return }
      json(res, 200, { jobs: await printer.getUncertainJobs() })
      return
    }
    if (url === '/print/resolve' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!body.job_id || !['printed', 'reprint'].includes(body.resolution)) {
        json(res, 400, { error: 'job_id y resolution printed/reprint requeridos' }); return
      }
      if (typeof printer.resolveUncertain !== 'function') { json(res, 503, { error: 'reconciliacion no disponible' }); return }
      try {
        const resolved = await printer.resolveUncertain(body.job_id, body.resolution)
        json(res, resolved ? 200 : 409, resolved ? { ok: true, status: body.resolution === 'reprint' ? 'queued' : 'resolved' } : { error: 'trabajo no incierto o inexistente' })
      }
      catch (error) { json(res, 409, { error: error.message }) }
      return
    }

    // ── Print endpoints (backwards compatible) ───────────────────────────────
    if (url === '/print' && req.method === 'POST') {
      try {
        const body   = await parseBody(req)
        const station = body.station || 'caja'
        if (!body.data) { json(res, 400, { error: 'Missing data' }); return }
        const bytes = Buffer.from(body.data, 'base64')
        await printer.printToStation(station, bytes, undefined, { commandId: body.command_id || body.idempotency_key })
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

    if (url === '/sync/status' && req.method === 'GET') {
      json(res, 200, getBusinessSyncStatus())
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
async function startLocalServer({ dataDir, port = 7717, config = {}, businessSync = null }) {
  let _businessOutbox = null
  let businessSyncIssue = businessSync ? 'BUSINESS_SYNC_NOT_STARTED' : 'BUSINESS_SYNC_NOT_CONFIGURED'
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

  // Antes de capturar credenciales en el router/hub y ANTES de abrir el puerto.
  credLan.prepararCredencial({ dataDir, config })
  console.log(`[server] Credencial LAN: ${credLan.paraLog(config.lanSecret)}`)
  if (!config.lanSecret) console.warn('[server] Terminal sin emparejar: operacion bloqueada, diagnostico disponible')

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
  printerAdapter.init({ printersConfig, configPath: printerConfigPath, queueFilePath: queueFilePath || require('path').join(dataDir, 'print-queue.json') })

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
  const state  = new RestaurantState({ localAuthorityEnabled: config.localAuthorityEnabled === true && !config.posServerIp })
  const events = await eventStore.readAfter(0)
  if (!config.posServerIp && config.localAuthorityEnabled !== true && events.some(event =>
    event.result?.operational_order?.authority === 'caja' || event.result?.turno?.authority === 'caja')) {
    throw new Error('LOCAL_AUTHORITY_CUTOVER_REQUIRED: este log ya tiene escritura de Caja; no se puede volver al escritor legacy sin migración validada')
  }
  console.log(`[server] Replaying ${events.length} events to rebuild state...`)
  for (const ev of events) state.apply(ev)
  console.log('[server] State ready.')

  // La autoridad lanza si su archivo quedó a medias por un apagón, o si alguien
  // cambió el restaurante o la sucursal en la configuración. Construirla sin
  // resguardo tumbaba TODO el arranque de Pedro: la ventana del POS abría igual
  // (main.js atrapa el error y sigue), pero sin impresión, sin KDS, sin reenvío
  // para las otras terminales y sin PIN, y el operador sólo leía "Sin conexión
  // con Caja" sin una sola pista de la causa. Se degrada como ya hace su hermano
  // CatalogStore: se guarda el motivo, se contesta 503 y se publica en /health.
  const construirODegradar = (que, construir) => {
    try { return { instancia: construir(), motivo: null } }
    catch (error) {
      console.error(`[server] ${que} no disponible: ${error.message}`)
      return { instancia: null, motivo: error.message }
    }
  }
  const autoridad = config.posServerIp
    ? { instancia: null, motivo: 'Esta terminal autoriza contra la Caja' }
    : construirODegradar('Autoridad de PIN', () => new ActorAuthority({
      directory: require('path').join(dataDir, 'actor-authority'), restaurantId,
      branchId: config.branchId || config.locationId || null,
    }))
  const catalogo = config.posServerIp
    ? { instancia: null, motivo: 'Esta terminal lee el catálogo de la Caja' }
    : construirODegradar('Catálogo', () => new CatalogStore({
      directory: require('path').join(dataDir, 'catalog'), restaurantId,
      branchId: config.branchId || config.locationId || null,
    }))
  const actorAuthority = autoridad.instancia
  const catalogStore = catalogo.instancia

  // ── WebSocket hub ────────────────────────────────────────────────────────
  const wsHub = new WsHub({
    serverId,
    restaurantId,
    branchId: config.branchId || config.locationId || null,
    lanSecret: config.lanSecret,
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
    catalogStore,
    localAuthorityEnabled: config.localAuthorityEnabled === true && !config.posServerIp,
  })

  if (typeof cmdHandler.recoverPendingEffects === 'function') await cmdHandler.recoverPendingEffects()
  wsHub.onCommand(async (msg, clientId, transport = {}) => {
    // A WS command at a secondary must reach the same Caja as HTTP writes.
    // Committing it locally would create a second writer and a private account.
    if (config.posServerIp) {
      const credentials = credLan.cabecerasDeCredencial({ secreto: config.lanSecret, restaurantId,
        terminalId: transport.terminalId, branchId: config.branchId || config.locationId || null })
      if (transport.actorToken) credentials['x-fullsite-actor'] = transport.actorToken
      const up = await forwardPost(`http://${config.posServerIp}:${config.posServerPort || port}/events`,
        JSON.stringify(msg.payload), credentials)
      const body = JSON.parse(up.body || '{}')
      if (up.status !== 200 || !Array.isArray(body.results) || body.results.length !== 1) {
        return { error: body.error || 'Caja no confirmó el comando', code: 'CAJA_UNAVAILABLE' }
      }
      return body.results[0]
    }
    return handleAuthenticatedCommand({ cmdHandler, actorAuthority, msg, clientId, ...transport })
  })

  // ── HTTP server ──────────────────────────────────────────────────────────
  const router = buildHttpRouter({
    state,
    eventStore,
    wsHub,
    cmdHandler,
    actorAuthority,
    catalogStore,
    authorityReason: autoridad.motivo,
    catalogReason: catalogo.motivo,
    getBusinessSyncStatus: () => _businessOutbox?.status() || { configured: !!businessSync, error: businessSyncIssue },
    printer: printerAdapter,
    version,
    serverId,
    restaurantId,
    config,
    instanceName,
    branchId: config.branchId || config.locationId || null,
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
    // Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4). El
    // updater consulta el estado VIVO para no reiniciar a media operacion. Si esto
    // no se pasara, `puedeInstalarAhora` recibe null y falla CERRADO — no instala.
    getSnapshot: () => state.toSnapshot(),
  })

  // ── Supabase poll (Phase 1 bridge) ────────────────────────────────────────
  if (supabaseUrl && supabaseKey && !config.posServerIp && config.localAuthorityEnabled !== true) {
    startSupabasePoll({ supabaseUrl, supabaseKey, restaurantId, branchId: config.branchId || config.locationId || null, serviceEmail, servicePassword, state, eventStore, wsHub, cmdHandler })
      .catch(e => console.warn('[server] Supabase poll start error:', e.message))
  }

  // Business receipts require the matching cloud branch fence and an explicit
  // reconciled stream. A secondary and a legacy installation never start it.
  if (businessSync && config.localAuthorityEnabled === true && config.terminalRole === 'server_pos' && !config.posServerIp) {
    try {
      _businessOutbox = new BusinessOutbox({ eventStore, directory: dataDir, supabaseUrl, anonKey: supabaseKey,
        restaurantId, locationId: config.branchId || config.locationId,
        streamId: businessSync.stream_id, credential: businessSync.credential,
        baselineSequence: businessSync.baseline_sequence, baselineHistoryHash: businessSync.baseline_history_hash })
      _businessOutbox.start()
      businessSyncIssue = null
    } catch {
      // No credential/config dump; LAN service stays available with visible sync
      // pending status. It must not call this a confirmed cloud publication.
      businessSyncIssue = 'BUSINESS_SYNC_CONFIG_INVALID'
      console.warn('[server] Business sync configuration invalid; local data retained')
    }
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

  // ── Enlace ascendente con la caja (sólo terminales secundarias) ───────────
  //
  // Cierra el hueco de campo del 2026-09-02: una comanda de POS 3 no llegaba
  // nunca a los tableros de POS 2, porque este Pedro no era cliente de nadie.
  //
  // SE ACTIVA SÓLO en una terminal secundaria: `terminal_role === 'pos'` Y con
  // `pos_server_ip` configurado. Las dos condiciones, no una:
  //   · La CAJA (`server_pos`) no debe conectarse a sí misma — sería un bucle
  //     de retransmisión que se multiplica solo.
  //   · Un KDS dedicado ya recibe por su propio WebSocket; abrirle otro canal
  //     le entregaría cada evento dos veces.
  //   · Un rol nulo o desconocido NO activa nada: falla cerrado. Una terminal
  //     mal aprovisionada se queda como estaba, no en un estado a medias.
  let _enlaceCaja = null
  const _rolTerminal = config.terminalRole || null
  if (_rolTerminal === 'pos' && config.posServerIp) {
    // El cursor vive en el dataDir de ESTA terminal. Sin persistirlo, un reinicio
    // vuelve con -1 y el hub no manda catch-up (ws-hub.js:88): se pierde en
    // silencio todo lo ocurrido mientras estuvo apagada.
    // `fs` y `path` viven dentro de otras funciones en este archivo, no a nivel
    // de modulo. Se requieren aqui en vez de mover los de arriba: cambio minimo.
    const fsCursor = require('fs')
    const pathCursor = require('path')
    const rutaCursor = pathCursor.join(dataDir, 'cursor-caja.json')
    const cajaWs = `ws://${config.posServerIp}:${config.posServerPort || port || 7717}`
    _enlaceCaja = conectarConLaCaja({
      cajaUrl: cajaWs,
      serverId,
      restaurantId,
      lanSecret: config.lanSecret,
      branchId: config.branchId || config.locationId || null,
      leerCursor: () => {
        try { return JSON.parse(fsCursor.readFileSync(rutaCursor, 'utf8')).cursor } catch { return -1 }
      },
      guardarCursor: (n) => {
        try { fsCursor.writeFileSync(rutaCursor, JSON.stringify({ cursor: n, ts: Date.now() })) } catch {}
      },
      // El salón completo al (re)conectar. Sin esto, una terminal reiniciada se
      // queda sin las órdenes de las demás y su KDS aparece en blanco.
      alRecibirEstado: (snap) => {
        try {
          state.hidratarDesdeSnapshot(snap)
          // Se reparte a los tableros de ESTA terminal: si no, siguen pintando lo
          // que tenían antes del reinicio.
          wsHub.broadcast({ type: 'STATE_SYNC', payload: {} }).catch(() => {})
          console.log('[enlace-caja] estado hidratado desde la caja')
        } catch (e) { console.warn('[enlace-caja] no se pudo hidratar:', e.message) }
      },
      alRecibirEvento: (ev) => {
        // Se aplica al estado local Y se retransmite a los clientes de ESTA
        // terminal: cocina, barra y plano escuchan aquí, no en la caja.
        try { state.apply(ev) } catch (e) { console.warn('[enlace-caja] no se pudo aplicar:', e.message) }
        wsHub.broadcast(ev).catch(() => {})
      },
    })
    console.log(`[server] Enlace con la caja: ${cajaWs} (rol ${_rolTerminal})`)
  } else {
    console.log(`[server] Sin enlace ascendente (rol ${_rolTerminal || 'sin definir'}, caja ${config.posServerIp || 'no configurada'})`)
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────
  function close() {
    if (_supabasePolling) clearInterval(_supabasePolling)
    if (_outbox) _outbox.stop()
    if (_businessOutbox) _businessOutbox.stop()
    // Antes que el hub: `detener()` cancela el reintento agendado. Si no, el
    // 'close' del socket agenda otro y el proceso no termina nunca.
    if (_enlaceCaja) _enlaceCaja.detener()
    mdns.stop()
    heartbeat.stop()
    updater.stop()
    wsHub.close()
    httpServer.close()
    console.log('[server] Shut down cleanly.')
  }

  // `state` se expone para que el proceso main de Electron pueda preguntar si el
  // restaurante esta en reposo ANTES de instalar una actualizacion (regla dura #4:
  // Pedro muere con Electron). Sin esto, el auto-instalador recibe undefined, la
  // politica falla cerrado, y NUNCA se instala — en silencio. Ver
  // update/auto-installer.js y la prueba del contrato en update-contrato.test.js.
  return { httpServer, close, serverId, lanIp, wsHub, state, lanSecret: config.lanSecret }
}

// buildHttpRouter se exporta para poder probar las rutas sin levantar el servidor
// completo (mDNS + heartbeat + polling quedarían corriendo y colgarían el test).
module.exports = { startLocalServer, buildHttpRouter, deliveryStation, deliveryOrderCommand, buildDeliveryTicket }
