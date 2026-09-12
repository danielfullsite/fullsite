'use strict'

/**
 * UI real de Fullsite, tres procesos Electron y un KDS, sin datos de clientes.
 *
 * Next sirve el POS real. Sólo catálogo, personal y turno son fixtures HTTP;
 * órdenes, snapshots, enlace, credenciales y reinicios pasan por Pedro real.
 * No se acepta una URL remota ni se heredan credenciales de la máquina.
 * Esta suite funcional no certifica el paquete/SW offline, huella, cobro
 * bancario ni impresoras físicas. El servidor local sirve los assets. Con
 * FULLSITE_LAB_PIN=1 POS 3 arranca sin sesión y teclea el PIN en el escondite.
 *
 * node electron-app/lab/laboratorio-ui-multiterminal.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const net = require('node:net')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const ROOT = path.resolve(__dirname, '../..')
const APP = path.join(ROOT, 'dashboard-app')
const ELECTRON_APP = path.join(ROOT, 'electron-app')
const { _electron } = require(path.join(APP, 'node_modules/playwright'))
const { expect } = require(path.join(APP, 'node_modules/@playwright/test'))
const electronBinary = require(path.join(ELECTRON_APP, 'node_modules/electron'))
const { CURRENT_CONFIG_VERSION } = require('../local-server/config-schema')
const cred = require('../local-server/core/credencial-lan')
const { ActorAuthority } = require('../local-server/core/actor-authority')
const { CatalogStore } = require('../local-server/core/catalog-store')
const WebSocket = require(path.join(ELECTRON_APP, 'node_modules/ws'))

// Cold compilation is test setup, separate from UI interaction deadlines.
const compileTimeout = process.env.CI ? 300000 : 90000
const tenant = 'closure-lab'
const operationalMode = process.env.FULLSITE_LAB_OPERATIONAL === '1'
const printMode = process.env.FULLSITE_LAB_PRINT === '1'
const drawerMode = process.env.FULLSITE_LAB_DRAWER === '1'
if (drawerMode && !printMode) throw new Error('Drawer lab requires synthetic print mode')
if (printMode && !operationalMode) throw new Error('Print UI lab requires operational mode')
let syntheticPrinter = null
const printedPackets = []
const printedHex = []
const packagedBundle = process.env.FULLSITE_LAB_UI_BUNDLE ? path.resolve(process.env.FULLSITE_LAB_UI_BUNDLE) : null
const packagedManifest = packagedBundle ? require('../offline-ui/package-store').verifyPackage(packagedBundle).manifest : null
if (packagedBundle && !operationalMode) throw new Error('Packaged service lab requires operational mode')
const secret = cred.generarSecreto()
const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: tenant })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-ui-'))
const output = path.join(ROOT, packagedBundle ? 'output/closure/ui-paquete-operacion' : operationalMode ? 'output/closure/ui-operacion' : 'output/closure/ui')
fs.mkdirSync(output, { recursive: true })
const terminals = []
const results = []
const prepared = new Map()
const reservedPorts = new Map()
let nextProcess
let nextLog = ''
let wan = !packagedBundle
// La «nube» del laboratorio: un stub HTTP local al que el bootstrap de cada
// Electron redirige `https://app.fullsite.mx`. Registra cada petición SIN el PIN.
let nube = null
const nubeRequests = []

function cleanEnv(extra = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: base,
    LANG: 'en_US.UTF-8', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', FULLSITE_UI_LAB: '1' }
  for (const key of ['DISPLAY', 'XAUTHORITY', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return { ...env, ...extra }
}

async function freePort(reserve = false) {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      if (reserve) { reservedPorts.set(port, s); resolve(port) }
      else s.close(() => resolve(port))
    })
  })
}
async function until(fn, label, timeout = 30000) {
  const limit = Date.now() + timeout
  let last
  while (Date.now() < limit) {
    try { if (await fn()) return } catch (e) { last = e.message }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`${label}: timeout${last ? ` (${last})` : ''}`)
}
// EL ESCONDITE FALSO. Next sirve el HTML del layout del POS con `unlocked=false`:
// la pantalla del PIN. La sesión sembrada la restaura un efecto de React, o sea,
// DESPUÉS de hidratar. En dev, con cuatro Electron y Next compilando a la vez,
// hidratar puede tardar más de 20 s, y en ese hueco la pantalla dice «Ingresa tu
// PIN para abrir» sin que haya pasado nada con la sesión. Costó dos corridas
// (2026-09-10): una asercion de 20 s sobre el cuerpo de la página leía el
// escondite y concluía que la terminal se había bloqueado. Tras cada `goto` se
// espera a que algún botón tenga su onClick colgado —eso es hidratación, no un
// sleep— antes de mirar cualquier cosa.
const esperarHidratacion = async page => {
  // Exercise the active terminal as a user would; Chromium throttles background
  // windows while four Electron processes are open on the same desktop.
  await page.bringToFront()
  return until(() => page.evaluate(() =>
  [...document.querySelectorAll('button')].some(b => {
    const clave = Object.keys(b).find(k => k.startsWith('__reactProps'))
    return !!clave && typeof b[clave]?.onClick === 'function'
  })).catch(() => false), 'hidratación de la pantalla', 90000)
}
function request(terminal, route, init = {}) {
  return fetch(`http://127.0.0.1:${terminal.port}${route}`, {
    ...init, headers: { ...headers,
      ...(terminal.terminalId ? { 'x-fullsite-terminal': terminal.terminalId } : {}),
      ...(terminal.actorSession ? { 'x-fullsite-actor': terminal.actorSession.actor_token } : {}),
      ...init.headers }, signal: AbortSignal.timeout(3000),
  })
}
async function command(terminal, type, payload = {}, commandId = randomUUID()) {
  const response = await request(terminal, '/events', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, command_id: commandId, command_type: type, client_id: tenant }),
  })
  const data = await response.json()
  assert.equal(response.ok, true, `Comando ${type}: ${JSON.stringify(data)}`)
  assert.equal(data.results?.length, 1, `Recibo ${type}: ${JSON.stringify(data)}`)
  assert(!data.results[0].error, `Rechazo ${type}: ${JSON.stringify(data)}`)
  return data
}

async function commandWs(terminal, type, payload) {
  const ws = new WebSocket(`ws://127.0.0.1:${terminal.port}/ws`)
  const commandId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Caja no confirmó el comando WS')) }, 6000)
    ws.on('open', () => ws.send(JSON.stringify({ protocol_version: '1.0', type: 'SUBSCRIBE',
      restaurant_id: tenant, client_id: `ws-${terminal.terminalId}`, terminal_id: terminal.terminalId, client_type: 'pos', lan_secret: secret })))
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'SNAPSHOT') ws.send(JSON.stringify({ protocol_version: '1.0', type: 'COMMAND',
        restaurant_id: tenant, actor_token: terminal.actorSession.actor_token,
        payload: { ...payload, command_id: commandId, command_type: type } }))
      if (['ACK', 'REJECT'].includes(msg.type)) {
        clearTimeout(timer); ws.close()
        if (msg.type === 'REJECT') reject(new Error(msg.payload.reason))
        else resolve(msg.payload)
      }
    })
    ws.on('error', error => { clearTimeout(timer); reject(error) })
  })
}

const labPin = '9876543210'

// ── PIN desde la pantalla ─────────────────────────────────────────────────────
//
// Con FULLSITE_LAB_PIN=1, POS 3 arranca SIN sesión sembrada y el recorrido teclea
// el PIN en el teclado real. Cubre lo que este laboratorio declaraba como no
// probado: «Sesión preparada: no prueba PIN». Es la puerta por la que entra
// todo lo demás, y donde Eduardo reportó lentitud en campo el 2026-09-02.
//
// El camino real en Electron NO es el del navegador. `requiereCaja()`
// (pedro-cliente.ts:23) es verdadero bajo Electron y pos/layout.tsx:531 manda el
// PIN a `POST /auth/pin` del Pedro local (pedro-actor.ts:24). Un POS secundario lo
// reenvía a Caja (index.js:401) y Caja lo valida en `ActorAuthority._login`:
// con nube, contra `https://app.fullsite.mx/api/pos/pin` desde el proceso Node;
// sin nube, contra el verificador scrypt que dejó el último login online de ESA
// persona en ESA terminal. Ni `verifyPinOffline` ni `pos_manager_credentials_v2`
// ni `pos_staff_cache` participan.
//
// Consecuencia para el laboratorio: la ruta de Playwright NO ve ese fetch (es
// Node, no el renderer). Sin el bootstrap de `startTerminal`, un PIN tecleado
// aquí viajaba al restaurante real. Por eso cada Electron arranca con
// `lab-bootstrap.cjs`, que redirige `https://app.fullsite.mx` a la nube del
// laboratorio y bloquea todo lo demás, con bitácora en `<userData>/lab-egress.log`.
//
// El PIN del laboratorio es dato de prueba; nunca sale de esta máquina. No se
// imprime ni se registra (CLAUDE.md §13).
const pinDesdePantalla = process.env.FULLSITE_LAB_PIN === '1'
// El default es SINTÉTICO a propósito. El PIN real de una instalación se pasa
// por FULLSITE_LAB_PIN_VALUE en la corrida y no se escribe en el repo (§13):
// un PIN de producción en código fuente es un PIN filtrado.
const pinDelLab = process.env.FULLSITE_LAB_PIN_VALUE || '2468'
const pinIncorrecto = pinDelLab === '9999' ? '8888' : '9999'
// Otra persona que el operador sembrado: si la nube devolviera el MISMO staff,
// `ActorAuthority._login` reemplazaría su credencial y revocaría las sesiones
// preparadas de Caja, POS 2 y Cocina a media corrida.
const staffPantalla = { id: '00000000-0000-4000-8000-000000000073', name: 'Cajera de laboratorio', role: 'gerente' }
const shiftTokenPantalla = 'lab-shift-desde-pantalla'
// Una sola verdad para las dos nubes (la del renderer y la del proceso Node). La
// forma del rechazo copia a la ruta real (api/pos/pin/route.ts:155).
function respuestaDePin(pin) {
  if (!pinDesdePantalla) return { status: 200, json: { staff, shiftToken: 'synthetic-lab-session' } }
  if (pin !== pinDelLab) return { status: 401, json: { error: 'Empleado no encontrado o desactivado' } }
  return { status: 200, json: { staff: staffPantalla, shiftToken: shiftTokenPantalla } }
}
const staff = { id: '00000000-0000-4000-8000-000000000071', name: 'Operador de laboratorio', role: operationalMode ? 'admin' : 'gerente' }
const turno = { id: '00000000-0000-4000-8000-000000000072', client_id: tenant,
  fondo_inicial: 500, opened_by: staff.name, opened_at: new Date().toISOString(), closed_at: null }
const fixture = {
  clients: [{ id: tenant, display_name: 'Restaurante de laboratorio', mesas: 7, meseros: [staff.name],
    timezone: 'America/Monterrey', iva_rate: 0.16, features: { pos: true, posRestaurant: true } }],
  pos_menu_categories: [{ id: 'lab-bebidas', name: 'Bebidas laboratorio', active: true, sort_order: 1, color: '#327867' }],
  pos_menu_items: [{ id: 'lab-cafe', category_id: 'lab-bebidas', name: 'Café de laboratorio', price: 50,
    active: true, sort_order: 1, station: 'barra' }],
  pos_payment_methods: [{ id: 'lab-cash', name: 'Efectivo', type: 'efectivo', commission_pct: 0 }],
  pos_mesas: [1, 2, 3, 4, 5, 6, 7].map(number => ({ id: `mesa-${number}`, client_id: tenant, number,
    capacity: 4, active: true, x_pct: 15 + number * 20, y_pct: 40, shape: 'square', zone: 'Salón' })),
  pos_turnos: [turno], pos_staff: [staff], pos_orders: [],
}
// Un solo catálogo completo: lo consume la preparación de Caja antes de arrancar
// y lo sirve la nube del laboratorio cuando Caja lo refresca tras un PIN online.
const catalogoDeLab = () => ({ schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: tenant,
  refreshed_at: new Date().toISOString(), config: fixture.clients[0], settings: {
    'pos.station_routing': { barra: ['lab-bebidas'] },
    'pos.no_print_stations': ['cocina', 'barra', 'caja'],
  },
  categories: [{ ...fixture.pos_menu_categories[0], items: fixture.pos_menu_items }], payment_methods: fixture.pos_payment_methods,
  modifiers: { groups: [{ id: 'lab-temperature', name: 'Preparación de laboratorio', level: 1, min_selections: 1, max_selections: 1, required: true }],
    mods: [{ id: 'lab-hot', group_id: 'lab-temperature', name: 'Caliente de laboratorio', price: 0 }],
    item_links: [{ item_id: 'lab-cafe', group_id: 'lab-temperature' }], category_links: [] },
})

// ── Nube del laboratorio ──────────────────────────────────────────────────────
// Sirve lo que Caja pide a `app.fullsite.mx` desde su proceso Node: validación de
// PIN y catálogo. Con `wan = false` corta la conexión (ECONNRESET), que es lo que
// ve Caja cuando el módem pierde WAN; así ActorAuthority cae a su verificador
// local en vez de recibir una respuesta.
async function startNube() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!wan) { nubeRequests.push({ ruta: url.pathname, wan: false, ts: Date.now() }); req.socket.destroy(); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const responder = (status, json) => { res.writeHead(status, {
        'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      }); res.end(JSON.stringify(json)) }
      // A real HTTP response avoids the status=0 observed when Electron receives
      // Playwright's fulfilled PATCH response. Only synthetic renderer fixtures
      // use this prefix; the real Caja PIN/catalog paths below stay separate.
      if (url.pathname.startsWith('/renderer/')) {
        if (req.method === 'OPTIONS') return responder(200, {})
        const pathname = url.pathname.slice('/renderer'.length)
        nubeRequests.push({ ruta: pathname, method: req.method, fixture: 'renderer', wan: true, ts: Date.now() })
        const rest = pathname.startsWith('/rest/v1/') ? pathname.slice('/rest/v1/'.length)
          : pathname === '/api/pos/db' ? url.searchParams.get('path') || '' : null
        if (rest !== null) return responder(200, fixture[rest.split('?')[0]] || [])
        if (pathname === '/api/pos/pin') {
          let input = {}
          try { input = JSON.parse(body || '{}') } catch {}
          const reply = respuestaDePin(input.pin)
          return responder(reply.status, reply.json)
        }
        if (/save-order|add-items|payment|merge-orders|transfer|split|liquidar/.test(pathname)) {
          return responder(503, { error: 'El laboratorio exige escritura por Caja' })
        }
        return responder(200, {})
      }
      if (req.method === 'POST' && url.pathname === '/api/pos/pin') {
        let cuerpo = {}
        try { cuerpo = JSON.parse(body || '{}') } catch {}
        const r = respuestaDePin(cuerpo.pin)
        // Se registra a quién y con qué resultado; nunca el PIN.
        nubeRequests.push({ ruta: url.pathname, wan: true, ts: Date.now(), status: r.status,
          device_id: cuerpo.device_id ?? null, client_id: cuerpo.client_id ?? null })
        return responder(r.status, r.json)
      }
      if (req.method === 'GET' && url.pathname === '/api/pos/menu') {
        nubeRequests.push({ ruta: url.pathname, wan: true, ts: Date.now(), status: 200,
          authorization: req.headers.authorization || null, tenant: req.headers['x-fullsite-tenant'] || null })
        return responder(200, catalogoDeLab())
      }
      nubeRequests.push({ ruta: url.pathname, wan: true, ts: Date.now(), status: 404 })
      responder(404, { error: 'La nube del laboratorio no sirve esta ruta' })
    })
  })
  server.keepAliveTimeout = 1000
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}
function leerEgreso(userData) {
  const archivo = path.join(userData, 'lab-egress.log')
  if (!fs.existsSync(archivo)) return []
  return fs.readFileSync(archivo, 'utf8').split('\n').filter(Boolean).map(linea => JSON.parse(linea))
}

async function fixtureRoute(route, uiOrigin, pedroPorts) {
  const request = route.request()
  const url = new URL(request.url())
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  // Only verified package files may use this origin. The Electron protocol
  // serves them from disk; API requests and every other WAN origin stay blocked.
  if (packagedBundle && url.origin === uiOrigin && !/^\/(api|rest|auth)(\/|$)/.test(url.pathname)) return route.continue()
  // Nunca enviar tráfico de este laboratorio a un restaurante o proveedor real.
  if (!local && !['data:', 'blob:', 'about:'].includes(url.protocol)) return route.abort('blockedbyclient')
  if (pedroPorts.includes(Number(url.port))) return route.continue()
  // Chromium may issue a preflight at the redirected local origin.
  if (nube && url.origin === nube.origin && url.pathname.startsWith('/renderer/')) return route.continue()
  if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    if (!wan) return route.abort('internetdisconnected')
    // The original full-page referrer violates Chromium's cross-origin policy
    // after this test-only redirect. Strip it; keep browser security enabled.
    return route.continue({ url: `${nube.origin}/renderer${url.pathname}${url.search}`,
      headers: { ...request.headers(), referer: undefined } })
  }
  if (url.origin === uiOrigin) return route.continue()
  return route.abort('blockedbyclient')
}

async function startTerminal(name, role, port, cajaPort, uiOrigin, ports, opts = {}) {
  const userData = path.join(base, name)
  fs.mkdirSync(userData, { recursive: true })
  const idlePage = path.join(userData, 'lab-idle.html')
  fs.writeFileSync(idlePage, '<!doctype html><meta charset="utf-8"><title>Fullsite Lab</title>')
  if (syntheticPrinter && role === 'server_pos') fs.writeFileSync(path.join(userData, 'printers.json'), JSON.stringify({
    schema_version: 2, ...(drawerMode ? { drawer_printer_id: 'lab-tcp-caja' } : {}), routing: { default_station: 'caja' }, printers: [{ printer_id: 'lab-tcp-caja', name: 'Caja laboratorio TCP', enabled: true,
      connection: { type: 'tcp', host: '127.0.0.1', port: syntheticPrinter.address().port }, station_ids: ['caja'],
      document_types: ['pre_ticket', 'receipt'], copies: 1, encoding: 'cp850' }],
  }))
  const { terminalId, actorSession } = prepared.get(name)
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    config_version: CURRENT_CONFIG_VERSION, restaurant_id: tenant, terminal_id: terminalId,
    terminal_role: role, kds_only: role === 'kds', terminal_name: name, local_server_host: '127.0.0.1',
    local_server_port: port, protocol_version: '1.0', provisioned_at: new Date().toISOString(),
    pos_server_ip: role === 'server_pos' ? null : '127.0.0.1',
    pos_server_port: role === 'server_pos' ? null : cajaPort, lan_secret: secret, instance_name: name,
    localAuthorityEnabled: operationalMode,
  }))
  // Todo Electron del laboratorio arranca por este bootstrap, que envuelve
  // `global.fetch` del proceso main ANTES del JS de producto. Lo que Pedro pida
  // a `https://app.fullsite.mx` va a la nube del laboratorio; cualquier otro
  // host queda bloqueado. Cada decisión se escribe en `lab-egress.log` con
  // método y ruta — nunca cuerpo ni cabeceras. Sólo cubre `global.fetch`:
  // `https.request`/`net.request` no pasan por aquí (ver límites en el doc).
  const entry = path.join(base, 'lab-bootstrap.cjs')
  if (!fs.existsSync(entry)) fs.writeFileSync(entry, `const fs = require('node:fs');
const path = require('node:path');
const userData = process.env.FULLSITE_USER_DATA_DIR;
const startupLog = path.join(userData, 'lab-startup.log');
for (const stream of [process.stdout, process.stderr]) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, ...args) => { fs.appendFileSync(startupLog, chunk); return originalWrite(chunk, ...args); };
}
const egressLog = path.join(userData, 'lab-egress.log');
const nube = process.env.FULLSITE_LAB_NUBE;
const originalFetch = global.fetch;
global.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
  const redirigido = url.origin === 'https://app.fullsite.mx' && !!nube;
  fs.appendFileSync(egressLog, JSON.stringify({ ts: new Date().toISOString(), metodo: (init && init.method) || (input && input.method) || 'GET',
    url: url.origin + url.pathname, decision: redirigido ? 'redirigido-a-la-nube-del-lab' : 'bloqueado' }) + '\\n');
  if (!redirigido) return Promise.reject(new TypeError('Laboratorio sin WAN'));
  const destino = nube + url.pathname + url.search;
  return originalFetch(typeof input === 'string' || input instanceof URL ? destino : new Request(destino, input), init);
};
require(${JSON.stringify(path.join(ELECTRON_APP, 'main.js'))});\n`)
  // Keep not-yet-started server ports reserved while earlier terminals make
  // outbound LAN connections, which can otherwise claim the same ephemeral port.
  if (reservedPorts.has(port)) {
    await new Promise(resolve => reservedPorts.get(port).close(resolve)); reservedPorts.delete(port)
  }
  const app = await _electron.launch({ executablePath: electronBinary, args: [entry],
    env: cleanEnv({ FULLSITE_DEV: '1', FULLSITE_USER_DATA_DIR: userData, FULLSITE_LOCAL_SERVER_PORT: String(port),
      FULLSITE_LAB_NUBE: nube.origin,
      ...(packagedBundle ? { FULLSITE_UI_BUNDLE_DIR: packagedBundle } : {}),
      // Arranque inerte en file://: instala interceptores antes del JS de producto
      // y setupOfflineRetry no compite con el page.goto controlado por el lab.
      FULLSITE_POS_URL: pathToFileURL(idlePage).href, FULLSITE_KDS_URL: pathToFileURL(idlePage).href }), timeout: 60000,
  })
  const terminal = { name, role, port, app, process: app.process(), userData, terminalId, actorSession, log: [], errors: [] }
  terminals.push(terminal)
  terminal.process.stdout.on('data', d => terminal.log.push(String(d)))
  terminal.process.stderr.on('data', d => terminal.log.push(String(d)))
  const context = app.context()
  await context.route('**/*', route => fixtureRoute(route, uiOrigin, ports))
  await context.addInitScript(({ tenant, staff, turno, terminalId, port, secret, actorSession, operationalMode, uiOrigin, sinSesion }) => {
    if (!['localhost', '127.0.0.1'].includes(location.hostname) && location.origin !== uiOrigin) return
    localStorage.setItem('fullsite_client_id', tenant)
    localStorage.setItem('pos_terminal_id', terminalId)
    localStorage.setItem('FULLSITE_BRIDGE_URL', `http://127.0.0.1:${port}`)
    localStorage.setItem('FULLSITE_LAN_SECRET', secret)
    localStorage.setItem('FULLSITE_TERMINAL_ID', terminalId)
    localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
    localStorage.setItem('kds_settings_v1', JSON.stringify({ station: 'todas' }))
    localStorage.setItem('pos_shift_token', 'synthetic-lab-session')
    if (!operationalMode) {
      localStorage.setItem('pos_turno_id', turno.id)
      localStorage.setItem('pos_turno_cache', JSON.stringify({ turno, turnos: [turno], ts: Date.now() }))
    }
    // Sin sesión sembrada la terminal arranca en el escondite, y el recorrido de
    // PIN teclea de verdad. Con sesión sembrada se conserva el comportamiento
    // original de este laboratorio.
    if (!sinSesion) {
      sessionStorage.setItem('pos_staff', JSON.stringify(staff))
      sessionStorage.setItem('pos_actor_session', JSON.stringify(actorSession))
      sessionStorage.setItem('pos_last_activity', String(Date.now()))
    }
  }, { tenant, staff, turno, terminalId, port, secret, actorSession, operationalMode, uiOrigin, sinSesion: !!opts.sinSesion })
  const page = await app.firstWindow()
  terminal.page = page
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/renderer/')) terminal.log.push(`[asset-failed] ${url.pathname} ${request.failure()?.errorText}\n`)
  })
  page.on('pageerror', error => terminal.errors.push(error.stack || error.message))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) terminal.log.push(`[renderer] ${message.text()}\n`)
  })
  await until(async () => (await request(terminal, '/health')).ok, `${name}: arranque de Pedro`)
  const target = role === 'kds' ? `http://127.0.0.1:${port}/kds` : `${uiOrigin}/pos/mesas`
  await page.waitForLoadState('domcontentloaded', { timeout: 90000 })
  if (role === 'kds') {
    // main.js ya navega el KDS al HTML privado con sus credenciales LAN. Volver a
    // llamar loadURL aquí crea dos navegaciones al mismo destino: Electron 44
    // cancela una con ERR_FAILED aunque la pantalla haya cargado correctamente.
    // Se espera la navegación real y se aplica el estado que el init script dejó
    // preparado para las navegaciones posteriores del laboratorio.
    await until(() => page.evaluate(target => location.href === target && document.readyState !== 'loading', target),
      `${name}: KDS local visible`, 90000)
    await page.evaluate(({ tenant, staff, turno, terminalId, port, secret, actorSession, operationalMode, uiOrigin, sinSesion }) => {
      localStorage.setItem('fullsite_client_id', tenant)
      localStorage.setItem('pos_terminal_id', terminalId)
      localStorage.setItem('FULLSITE_BRIDGE_URL', `http://127.0.0.1:${port}`)
      localStorage.setItem('FULLSITE_LAN_SECRET', secret)
      localStorage.setItem('FULLSITE_TERMINAL_ID', terminalId)
      localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
      localStorage.setItem('kds_settings_v1', JSON.stringify({ station: 'todas' }))
      localStorage.setItem('pos_shift_token', 'synthetic-lab-session')
      if (!operationalMode) {
        localStorage.setItem('pos_turno_id', turno.id)
        localStorage.setItem('pos_turno_cache', JSON.stringify({ turno, turnos: [turno], ts: Date.now() }))
      }
      if (!sinSesion) {
        sessionStorage.setItem('pos_staff', JSON.stringify(staff))
        sessionStorage.setItem('pos_actor_session', JSON.stringify(actorSession))
        sessionStorage.setItem('pos_last_activity', String(Date.now()))
      }
    }, { tenant, staff, turno, terminalId, port, secret, actorSession, operationalMode, uiOrigin, sinSesion: !!opts.sinSesion })
  } else await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 })
  return terminal
}

async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error }
}

async function main() {
  if (printMode) {
    syntheticPrinter = net.createServer(socket => {
      const chunks = []
      socket.on('data', chunk => chunks.push(chunk))
      socket.on('end', () => { const bytes = Buffer.concat(chunks); printedPackets.push(bytes.toString('ascii')); printedHex.push(bytes.toString('hex')) })
    })
    await new Promise(resolve => syntheticPrinter.listen(0, '127.0.0.1', resolve))
  }
  const uiPort = await freePort()
  const ports = []
  for (let i = 0; i < 4; i++) ports.push(await freePort(true))
  assert.equal(new Set([uiPort, ...ports]).size, 5, 'Puertos independientes')
  const uiOrigin = packagedBundle ? 'https://app.fullsite.mx' : `http://127.0.0.1:${uiPort}`
  if (!packagedBundle) {
  nextProcess = spawn(process.execPath, [path.join(APP, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', String(uiPort)], {
    cwd: APP, env: cleanEnv({ NEXT_PUBLIC_SUPABASE_URL: uiOrigin,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-lab-anon-key' }), stdio: ['ignore', 'pipe', 'pipe'],
  })
  const recordNext = d => { nextLog += d; fs.writeFileSync(path.join(output, 'next.log'), nextLog) }
  nextProcess.stdout.on('data', recordNext)
  nextProcess.stderr.on('data', recordNext)
  await until(async () => (await fetch(`${uiOrigin}/pos/mesas`, { signal: AbortSignal.timeout(5000) })).ok,
    'Next sirve la pantalla real', Math.max(150000, compileTimeout))
  for (const route of ['/pos', '/pos/cocina', '/pos/barra', '/pos/plano', ...(operationalMode ? ['/pos/corte', '/pos/turno'] : [])]) {
    await until(async () => (await fetch(`${uiOrigin}${route}`, { signal: AbortSignal.timeout(15000) })).ok,
      `Preparar compilación ${route}`, compileTimeout)
  }
  }
  // Prepare real signed sessions in the synthetic Caja profile before it boots.
  // Only the HTTPS PIN provider response is a fixture; token verification in
  // the running servers and the financial transport are real.
  const actors = new ActorAuthority({ directory: path.join(base, 'Caja', 'actor-authority'), restaurantId: tenant,
    fetchImpl: async () => Response.json({ staff }) })
  for (const name of ['Caja', 'POS 2', 'POS 3', 'Cocina']) {
    const terminalId = randomUUID()
    const actorSession = await actors.login({ pin: labPin, deviceId: terminalId, restaurantId: tenant })
    prepared.set(name, { terminalId, actorSession })
  }
  // Prepare ONE complete catalog on Caja. POS 3 never gets a private fixture
  // cache; its menu/config/modifier readers must retrieve this over real LAN.
  const catalog = new CatalogStore({ directory: path.join(base, 'Caja', 'catalog'), restaurantId: tenant,
    fetchImpl: async () => Response.json(catalogoDeLab()) })
  await catalog.refresh('synthetic-lab-session')
  nube = await startNube()
  let caja = await startTerminal('Caja', 'server_pos', ports[0], ports[0], uiOrigin, ports)
  const pos2 = await startTerminal('POS 2', 'pos', ports[1], ports[0], uiOrigin, ports)
  const pos3 = await startTerminal('POS 3', 'pos', ports[2], ports[0], uiOrigin, ports, { sinSesion: pinDesdePantalla })
  const kds = await startTerminal('Cocina', 'kds', ports[3], ports[0], uiOrigin, ports)
  if (operationalMode) {
    wan = false
    await require('./recorrido-operacional-ui')({ caja, pos2, pos3, kds, check, expect, assert, until, request,
      tenant, output, uiOrigin, labPin, printLab: printMode ? { packets: printedPackets, hex: printedHex, drawer: drawerMode } : null, restartCaja: () => startTerminal('Caja', 'server_pos', ports[0], ports[0], uiOrigin, ports) })
    return
  }
  if (pinDesdePantalla) {
    // El teclado real: botones con texto 1–9 y 0, y «Entrar» por aria-label
    // (pos/layout.tsx:905-940). No se escribe en un input: se toca como en la
    // terminal. El PIN nunca se imprime (CLAUDE.md §13).
    // Cuántos puntos del PIN están llenos: los puntos se pintan con fondo #10b981
    // (pos/layout.tsx:895) → rgb(16, 185, 129) en el DOM. Es la única lectura
    // del estado `pin` posible desde afuera sin exponer el PIN.
    // Los puntos son <span> (pos/layout.tsx:889), no <div>. La primera versión
    // de este contador buscaba `div`, devolvía SIEMPRE 0, y el reintento —engañado
    // por él— tecleó dígitos de más. Lo delató la sonda de Borrar, que lee
    // `pin.length` por otra vía. Se selecciona por el estilo, sin asumir etiqueta.
    const puntosLlenos = page => page.evaluate(() =>
      [...document.querySelectorAll('[style]')].filter(el => /16,\s*185,\s*129/.test(el.style.background || el.style.backgroundColor || '')).length)
    const entrarDeshabilitado = page => page.getByRole('button', { name: 'Entrar' }).isDisabled()

    // Se afirma DESPUÉS de cada dígito que el punto se llenó. En la primera corrida
    // los cuatro clics "llegaron" (Playwright los dio por buenos) y aun así «Entrar»
    // siguió deshabilitado con pin.length < 4: sin esta lectura por dígito no hay
    // forma de saber en qué clic se perdió el estado.
    // HIDRATACIÓN. Next sirve el HTML del escondite antes de que React cuelgue
    // los `onClick`. Playwright ve el botón "habilitado" (sin atributo disabled)
    // y clica al vacío: en la corrida diagnóstica el PRIMER dígito ya dejaba
    // llenos=0. Las diez pruebas originales nunca lo sufrieron porque no clican
    // el escondite — estos son los primeros clics tras el `goto`.
    //
    // React marca el nodo con una clave `__reactProps$…` que contiene `onClick`
    // sólo cuando el handler está colgado. Se espera ESO, no un sleep.
    const hidratado = (page, nombre) => page.evaluate(nombre => {
      const boton = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === nombre)
      if (!boton) return 'sin-boton'
      const clave = Object.keys(boton).find(k => k.startsWith('__reactProps'))
      return clave && typeof boton[clave]?.onClick === 'function' ? 'hidratado' : 'sin-handler'
    }, nombre)

    const teclear = async (page, digitos) => {
      await until(async () => (await hidratado(page, digitos[0])) === 'hidratado',
        `el teclado no se hidrató (estado=${await hidratado(page, digitos[0])})`, 30000)
      const antes = await puntosLlenos(page)
      for (let i = 0; i < digitos.length; i++) {
        const boton = page.getByRole('button', { name: digitos[i], exact: true })
        await expect(boton).toBeEnabled({ timeout: 10000 })
        // UN clic, y se espera el punto. Sin reintentos: la hidratación ya se
        // esperó arriba, así que un punto que no se llena es un fallo real. La
        // versión anterior reintentaba hasta 3 veces con un contador ciego y
        // tecleó dígitos de más — un PIN "9999" acabó siendo "99999".
        await boton.click()
        let lleno = await until(async () => (await puntosLlenos(page)) === antes + i + 1, '', 4000).then(() => true, () => false)
        if (!lleno) {
          // DIAGNÓSTICO DISCRIMINANTE. Con el handler hidratado, un solo escondite y
          // tres clics CDP sin efecto, hay que separar "el evento no llega" de "el
          // estado no cambia". Tres caminos distintos hasta el mismo handler, y la
          // señal de Borrar (disabled ⇔ pin.length === 0, pos/layout.tsx:917) como
          // lectura independiente del contador de puntos.
          const sonda = await page.evaluate(async nombre => {
            const boton = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === nombre)
            const borrar = document.querySelector('button[aria-label="Borrar"]')
            // Mismo selector que `puntosLlenos`: por estilo, sin asumir etiqueta.
            const puntos = () => [...document.querySelectorAll('[style]')].filter(el => /16,\s*185,\s*129/.test(el.style.background || el.style.backgroundColor || '')).length
            const espera = () => new Promise(r => setTimeout(r, 400))
            const foto = etiqueta => ({ etiqueta, puntos: puntos(), borrarDeshabilitado: borrar?.disabled ?? null })
            const fotos = [foto('antes')]
            // camino 2: evento DOM real (bubbles), sin pasar por CDP
            boton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
            await espera(); fotos.push(foto('tras dispatchEvent'))
            // camino 3: el handler de React directo, sin evento
            const clave = Object.keys(boton).find(k => k.startsWith('__reactProps'))
            try { boton[clave].onClick({ preventDefault() {}, stopPropagation() {} }) } catch (e) { fotos.push({ etiqueta: 'onClick directo lanzó', error: String(e) }) }
            await espera(); fotos.push(foto('tras onClick directo'))
            return { botonesConEseTexto: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === nombre).length,
              activo: document.activeElement?.tagName, fotos }
          }, digitos[i])
          console.log(`[pin] SONDA dígito ${i + 1}: ${JSON.stringify(sonda)}`)
          fs.writeFileSync(path.join(output, `pin-sonda-digito-${i + 1}.json`), JSON.stringify(sonda, null, 2))
          lleno = (await puntosLlenos(page)) >= antes + i + 1
        }
        assert(lleno, `dígito ${i + 1}/${digitos.length}: el punto no se llenó con el clic ni con las sondas (llenos=${await puntosLlenos(page)}, hidratación=${await hidratado(page, digitos[i])}) — ver pin-sonda-digito-${i + 1}.json`)
      }
      console.log(`[pin] tecleados ${digitos.length} dígitos · puntos llenos=${await puntosLlenos(page)} · Entrar deshabilitado=${await entrarDeshabilitado(page)}`)
    }
    const entrar = async page => {
      await page.screenshot({ path: path.join(output, `pin-antes-de-entrar-${Date.now()}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Entrar' }).click()
    }
    const escondite = page => page.getByRole('button', { name: 'Entrar' })
    const sesionDeCaja = () => pos3.page.evaluate(() => JSON.parse(sessionStorage.getItem('pos_actor_session') || 'null'))
    const pinsEnLaNube = () => nubeRequests.filter(r => r.ruta === '/api/pos/pin')
    const credencialesDeCaja = () => JSON.parse(fs.readFileSync(path.join(base, 'Caja', 'actor-authority', 'actor-credentials.json'), 'utf8'))

    await check('POS 3 sin sesión sembrada arranca en el escondite', async () => {
      await pos3.page.goto(`${uiOrigin}/pos`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await expect(escondite(pos3.page)).toBeVisible({ timeout: 20000 })
      assert.equal(await pos3.page.evaluate(() => sessionStorage.getItem('pos_staff')), null, 'no debe haber sesión previa')
      assert.equal(await sesionDeCaja(), null, 'no debe haber sesión de Caja previa')
      assert.equal(pinsEnLaNube().length, 0, 'premisa: la nube del laboratorio no ha visto ningún PIN')
    })
    await check('Con internet, Caja rechaza el PIN incorrecto y la terminal sigue en el escondite', async () => {
      await teclear(pos3.page, pinIncorrecto); await entrar(pos3.page)
      // Texto de `ActorAuthority._login` (rama 401), que pos/layout.tsx:537 muestra
      // tal cual. Aquí no aparece «PIN incorrecto»: ése es el texto del camino de
      // navegador, que Electron no recorre.
      await expect(pos3.page.locator('body')).toContainText(/PIN rechazado por la autoridad/, { timeout: 10000 })
      await expect(escondite(pos3.page)).toBeVisible()
      assert.equal(await sesionDeCaja(), null)
      const intento = pinsEnLaNube().at(-1)
      assert.equal(intento?.status, 401, `la nube debió rechazar: ${JSON.stringify(intento)}`)
      assert.equal(intento.device_id, pos3.terminalId, 'Caja presenta a la nube la terminal que tecleó, no la suya')
      assert.equal(intento.client_id, tenant)
    })
    await check('Con internet, el PIN correcto entra por Caja y deja preparada la credencial sin red', async () => {
      await teclear(pos3.page, pinDelLab); await entrar(pos3.page)
      await expect(escondite(pos3.page)).toBeHidden({ timeout: 20000 })
      const sesion = await sesionDeCaja()
      assert.equal(sesion?.staff?.id, staffPantalla.id, 'la sesión es de la persona que la nube confirmó')
      assert.equal(sesion.offline, false)
      assert.equal(await pos3.page.evaluate(() => JSON.parse(sessionStorage.getItem('pos_staff') || 'null')?.name), staffPantalla.name)
      // pos/layout.tsx:534 guarda el token de turno que emitió la nube; con él
      // Caja refresca el catálogo (index.js `/auth/pin`). La cadena completa:
      // PIN → nube → shiftToken → renderer y catálogo.
      assert.equal(await pos3.page.evaluate(() => localStorage.getItem('pos_shift_token')), shiftTokenPantalla)
      assert.equal(pinsEnLaNube().at(-1)?.status, 200)
      await until(() => nubeRequests.some(r => r.ruta === '/api/pos/menu' && r.authorization === `Bearer ${shiftTokenPantalla}` && r.tenant === tenant),
        'Caja refresca el catálogo con el token de turno recién emitido', 10000)
      // Lo que permitirá entrar sin red: el verificador de ESTA persona en ESTA
      // terminal, en disco de Caja (`ActorAuthority._persist`).
      const preparada = Object.values(credencialesDeCaja().credentials).find(c => c.staff.id === staffPantalla.id)
      assert(preparada, 'Caja debe conservar la credencial preparada')
      assert(preparada.devices?.[pos3.terminalId] > Date.now(), 'preparada para la terminal que tecleó')
      assert(typeof preparada.hash === 'string' && !Object.values(preparada).includes(pinDelLab), 'el PIN no se guarda en claro')
      await pos3.page.screenshot({ path: path.join(output, 'pin-online-entra.png'), fullPage: true })
    })
    await check('Sin internet, Caja rechaza el PIN sin preparar y acepta el preparado sin consultar la nube', async () => {
      // Cierre de turno: se vacía la sesión y se recarga, como al reabrir la
      // terminal. Luego se corta la WAN de Caja (la nube cierra la conexión).
      await pos3.page.evaluate(() => sessionStorage.clear())
      wan = false
      const vistosAntes = pinsEnLaNube().length
      await pos3.page.goto(`${uiOrigin}/pos`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await expect(escondite(pos3.page)).toBeVisible({ timeout: 20000 })

      await teclear(pos3.page, pinIncorrecto); await entrar(pos3.page)
      // Sin nube, un PIN que nadie preparó no puede entrar y cuenta como intento
      // (`ActorAuthority._login`, rama offline).
      await expect(pos3.page.locator('body')).toContainText(/sin preparar|valida PIN con internet/, { timeout: 10000 })
      await expect(escondite(pos3.page)).toBeVisible()

      await teclear(pos3.page, pinDelLab); await entrar(pos3.page)
      await expect(escondite(pos3.page)).toBeHidden({ timeout: 20000 })
      const sesion = await sesionDeCaja()
      assert.equal(sesion?.staff?.id, staffPantalla.id)
      assert.equal(sesion.offline, true, 'Caja debe declarar que autorizó sin nube')
      const sinNube = pinsEnLaNube().slice(vistosAntes)
      assert.equal(sinNube.length, 2, `Caja intentó la nube en ambos PIN: ${JSON.stringify(sinNube)}`)
      assert(sinNube.every(r => r.wan === false), 'ninguna llegó a responderse: la nube estaba caída')
      await pos3.page.screenshot({ path: path.join(output, 'pin-offline-entra.png'), fullPage: true })
      wan = true
      // El resto del recorrido usa la sesión firmada preparada (comandos
      // financieros por HTTP con actor_token). El PIN ya probó la ENTRADA; se
      // restaura la sesión preparada para no cambiar lo que las 10 pruebas
      // originales verifican.
      await pos3.page.evaluate(({ staff, actorSession }) => {
        sessionStorage.setItem('pos_staff', JSON.stringify(staff))
        sessionStorage.setItem('pos_actor_session', JSON.stringify(actorSession))
        sessionStorage.setItem('pos_last_activity', String(Date.now()))
      }, { staff, actorSession: pos3.actorSession })
    })
  }

  const orderId = randomUUID()
  await command(caja, 'TURNO_OPENED', { ...turno, turno_id: turno.id, ts: turno.opened_at })
  await command(pos2, 'ORDER_SENT', { order_id: orderId, mesa: 1, mesero: staff.name,
    customer_name: 'Familia laboratorio', personas: 3, status: 'enviada', total: 116,
    subtotal: 100, iva: 16, saldo: 116, turno_id: turno.id, order_revision: 4,
    items: [{ id: 'lab-line-1', nombre: 'Café de laboratorio', cantidad: 2, precio: 50,
      subtotal: 100, precioExtra: 0, modificadores: [], notas: '', station: 'barra', menuItemId: 'lab-cafe' }],
  })
  await check('La comanda llega a la pantalla de cocina por LAN', async () => {
    await expect(kds.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
  })
  await check('Un comando WebSocket del POS secundario se confirma en Caja', async () => {
    const id = randomUUID()
    await commandWs(pos2, 'ORDER_SENT', { order_id: id, mesa: 2, total: 20, turno_id: turno.id,
      items: [{ id: 'water', nombre: 'Agua por WebSocket', cantidad: 1, precio: 20, subtotal: 20 }] })
    const snapshot = await (await request(caja, '/state')).json()
    assert(snapshot.salon_orders.some(o => o.id === id || o.order_id === id))
    await expect(kds.page.locator('body')).toContainText('Agua por WebSocket')
  })
  wan = false
  await check('Sin internet, POS 3 abre los productos y el total de la misma cuenta', async () => {
    await pos3.page.goto(`${uiOrigin}/pos?mesa=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await esperarHidratacion(pos3.page)
    await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
    await expect(pos3.page.locator('body')).toContainText(/116[.,]00/, { timeout: 10000 })
    const visible = await pos3.page.evaluate(tenant => JSON.parse(localStorage.getItem(`pos_cuenta_${tenant}_mesa:1`) || 'null')?.confirmed, tenant)
    assert.equal(visible?.id, orderId, 'El editor conservó el ID de la cuenta de Caja')
    assert.equal(visible?.items?.[0]?.cantidad, 2)
    await pos3.page.screenshot({ path: path.join(output, 'cuenta-compartida-sin-internet.png'), fullPage: true })
  })
  await check('POS 3 sin caché obtiene menú y opciones obligatorias de Caja sin internet', async () => {
    await pos3.page.getByRole('button', { name: /Bebidas laboratorio/ }).click()
    await pos3.page.getByRole('button', { name: /Café de laboratorio.*50/ }).click()
    await expect(pos3.page.getByRole('button', { name: 'Elige Preparación de laboratorio' })).toBeDisabled()
    await pos3.page.getByText('Caliente de laboratorio', { exact: true }).click()
    await expect(pos3.page.getByRole('button', { name: /Agregar.*50/ })).toBeEnabled()
    await pos3.page.screenshot({ path: path.join(output, 'catalogo-compartido-sin-internet.png'), fullPage: true })
    await pos3.page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  })
  await check('Una instalación sin transición rechaza crear otra autoridad monetaria', async () => {
    const response = await request(pos2, '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_type: 'FINANCIAL_OPEN', command_id: randomUUID(), order_id: orderId,
        turno_id: turno.id, expected_revision: 0, expected_order_revision: 4, total_cents: 11600, currency: 'MXN' }) })
    assert.equal((await response.json()).results[0].code, 'LOCAL_AUTHORITY_DISABLED')
    assert.equal((await (await request(caja, '/state')).json()).financial_orders.length, 0)
  })
  await check('Reiniciar Caja recupera la misma cuenta y preparación de la instalación anterior', async () => {
    const crashed = caja
    crashed.process.kill('SIGKILL')
    await until(() => crashed.process.exitCode !== null || crashed.process.signalCode !== null, 'Termina el binario real de Caja')
    caja = await startTerminal('Caja', 'server_pos', ports[0], ports[0], uiOrigin, ports)
    const snapshot = await (await request(caja, '/state')).json()
    const recovered = snapshot.salon_orders.find(o => o.id === orderId || o.order_id === orderId)
    assert.equal(recovered.total, 116)
    assert(snapshot.kds_orders.some(o => o.id === orderId || o.order_id === orderId))
    await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*116[.,]00/)
  })
  await check('Cocina legacy confirma preparación sin inventar liquidación', async () => {
    await kds.page.locator('.card').filter({ hasText: 'Café de laboratorio' }).getByRole('button', { name: /Todo listo/ }).click()
    await until(async () => {
      const snapshot = await (await request(caja, '/state')).json()
      return snapshot.kds_orders.find(o => o.id === orderId || o.order_id === orderId)?.status === 'lista'
    }, 'Caja registra el toque real de cocina')
    const snapshot = await (await request(caja, '/state')).json()
    assert(snapshot.salon_orders.some(o => o.id === orderId || o.order_id === orderId))
    assert.equal(snapshot.financial_orders.length, 0)
  })
  // Los videos de Eduardo del 2026-08-24, con los botones reales y sin internet.
  // Van AQUÍ porque cobran la mesa 1: lo anterior la necesita abierta, lo de
  // abajo apaga Caja y ya no lee cuentas. `caja` es `let` (se reinició arriba),
  // por eso viaja como función y no como valor.
  await require('./videos-de-eduardo-ui.cjs')({ caja: () => caja, pos2, pos3, kds, check, expect, assert, until, request,
    esperarHidratacion, tenant, output, uiOrigin, orderId, path })
  // Las mutaciones que iban solo a la nube (anular, transferir mesa) tienen que
  // llegar a Pedro. `setWan` porque anular pide validar el PIN del gerente en la
  // nube antes de poder hacerlo sin ella (el caché de 30 min).
  await require('./mutaciones-llegan-a-pedro-ui.cjs')({ caja: () => caja, pos2, pos3, check, expect, assert, until, request,
    command, esperarHidratacion, tenant, output, uiOrigin, turno, staff, path, randomUUID, setWan: v => { wan = v } })
  await check('Al apagarse Caja, POS 2 muestra que la cuenta no está confirmada', async () => {
    caja.process.kill('SIGKILL')
    await until(async () => {
      const state = await (await request(pos2, '/state')).json()
      return state.authoritative === false
    }, 'POS detecta Caja caída')
    await pos2.page.goto(`${uiOrigin}/pos/mesas`, { waitUntil: 'domcontentloaded' })
    await esperarHidratacion(pos2.page)
    await expect(pos2.page.locator('body')).toContainText(/Sin conexión con la caja.*sólo borradores pendientes/i, { timeout: 15000 })
  })
  await check('Las pantallas completan el recorrido sin errores sin manejar', async () => {
    assert.deepEqual(terminals.flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))), [])
    for (const terminal of [pos2, pos3]) {
      assert.equal(await terminal.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0,
        `${terminal.name}: ningún componente debe ignorar FULLSITE_OFFLINE_DISABLED`)
    }
  })
  if (pinDesdePantalla) {
    await check('Ningún PIN del recorrido salió de esta máquina', async () => {
      // Bitácora del bootstrap de cada Electron: toda petición del proceso Node a
      // un host que no es loopback, con su decisión. Un PIN rumbo al
      // `app.fullsite.mx` real aparecería aquí como «bloqueado».
      const egreso = terminals.map(t => ({ terminal: t.name, entradas: leerEgreso(t.userData) }))
      const pins = egreso.flatMap(e => e.entradas.filter(x => x.url.endsWith('/api/pos/pin')).map(x => ({ terminal: e.terminal, ...x })))
      assert(pins.length >= 4, `Caja debió consultar la nube por cada PIN tecleado: ${JSON.stringify(pins)}`)
      assert(pins.every(p => p.decision === 'redirigido-a-la-nube-del-lab' && p.terminal === 'Caja'),
        `todo PIN va de Caja a la nube del laboratorio, y de ninguna otra terminal: ${JSON.stringify(pins)}`)
      const bloqueado = egreso.flatMap(e => e.entradas.filter(x => x.decision === 'bloqueado').map(x => `${e.terminal} ${x.metodo} ${x.url}`))
      if (bloqueado.length) console.log(`[egreso] bloqueado por el bootstrap (no es PIN): ${JSON.stringify([...new Set(bloqueado)])}`)
    })
  }
}

main().catch(error => {
  console.error(error.stack)
  if (!results.some(r => !r.passed)) results.push({ name: 'Preparación del laboratorio', passed: false, error: error.message })
  process.exitCode = 1
}).finally(async () => {
  for (const server of reservedPorts.values()) await new Promise(resolve => server.close(resolve))
  for (const terminal of terminals) {
    try {
      if (!terminal.page.isClosed()) {
        await terminal.page.screenshot({ path: path.join(output, `${terminal.name}.png`), fullPage: true, timeout: 5000 })
        fs.writeFileSync(path.join(output, `${terminal.name}.txt`), await terminal.page.locator('body').innerText({ timeout: 3000 }))
      }
    } catch { /* también se captura el fallo cuando el proceso ya murió */ }
    fs.writeFileSync(path.join(output, `${terminal.name}.log`), terminal.log.join(''))
  }
  // Capture every screen before stopping Caja; otherwise secondary evidence
  // depicts a disconnection caused by cleanup rather than the failing step.
  for (const terminal of terminals) {
    try { await Promise.race([terminal.app.close(), new Promise(resolve => setTimeout(resolve, 2500))]) } catch {}
    if (terminal.process.exitCode === null && terminal.process.signalCode === null) terminal.process.kill('SIGKILL')
  }
  if (syntheticPrinter) { syntheticPrinter.close(); fs.writeFileSync(path.join(output, 'synthetic-printed-documents.json'), JSON.stringify({ documents: printedPackets, hex: printedHex }, null, 2)) }
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill('SIGTERM')
  if (nube) { nube.server.closeAllConnections(); nube.server.close() }
  fs.writeFileSync(path.join(output, 'next.log'), nextLog)
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, fixture: base,
    ui_source: packagedBundle ? 'verified-installed-package' : 'next-dev', ui_revision: packagedManifest?.revision ?? null,
    pin_desde_pantalla: pinDesdePantalla,
    // Evidencia de egreso: qué pidió cada proceso Pedro fuera de loopback y qué
    // vio la nube del laboratorio. Sin PIN ni cabeceras.
    nube: nubeRequests, egreso: terminals.map(t => ({ terminal: t.name, entradas: leerEgreso(t.userData) })),
    limitations: [pinDesdePantalla
      ? 'PIN tecleado en pantalla en POS 3: rechazo y entrada con nube, rechazo y entrada sin nube; enrolamiento de terminal y huella siguen sin probar; TLS hacia la nube no se prueba (el bootstrap redirige a HTTP local)'
      : 'Sesión preparada: no prueba PIN o enrolamiento', 'No certifica impresoras, Windows o huella',
      packagedBundle ? 'Paquete instalado sin Next ni WAN; sesión previamente preparada' : 'Assets servidos por Next local: esta suite no certifica el paquete offline ni Service Worker',
      'La nube está simulada; órdenes y réplicas usan Pedro real'],
    errors: terminals.flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))),
  }, null, 2))
  console.log(`${results.filter(r => r.passed).length}/${results.length} casos UI. Evidencia: ${output}`)
})
