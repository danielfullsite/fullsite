'use strict'

/**
 * UI real de Fullsite, tres procesos Electron y un KDS, sin datos de clientes.
 *
 * Next sirve el POS real. Sólo catálogo, personal y turno son fixtures HTTP;
 * órdenes, snapshots, enlace, credenciales y reinicios pasan por Pedro real.
 * No se acepta una URL remota ni se heredan credenciales de la máquina.
 * Esta suite funcional no certifica el paquete/SW offline, PIN, huella,
 * cobro bancario ni impresoras físicas. El servidor local sirve los assets.
 *
 * node electron-app/lab/laboratorio-ui-multiterminal.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
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
const WebSocket = require(path.join(ELECTRON_APP, 'node_modules/ws'))

const tenant = 'closure-lab'
const secret = cred.generarSecreto()
const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: tenant })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-ui-'))
const output = path.join(ROOT, 'output/closure/ui')
fs.mkdirSync(output, { recursive: true })
const terminals = []
const results = []
const prepared = new Map()
let nextProcess
let nextLog = ''
let wan = true

function cleanEnv(extra = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: base,
    LANG: 'en_US.UTF-8', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' }
  for (const key of ['DISPLAY', 'XAUTHORITY', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return { ...env, ...extra }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)) })
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

const staff = { id: '00000000-0000-4000-8000-000000000071', name: 'Mesero de laboratorio', role: 'gerente' }
const turno = { id: '00000000-0000-4000-8000-000000000072', client_id: tenant,
  fondo_inicial: 500, opened_by: staff.name, opened_at: new Date().toISOString(), closed_at: null }
const fixture = {
  clients: [{ id: tenant, display_name: 'Restaurante de laboratorio', mesas: 3, meseros: [staff.name],
    timezone: 'America/Monterrey', iva_rate: 0.16, features: { pos: true, posRestaurant: true } }],
  pos_menu_categories: [{ id: 'lab-bebidas', name: 'Bebidas laboratorio', active: true, sort_order: 1, color: '#327867' }],
  pos_menu_items: [{ id: 'lab-cafe', category_id: 'lab-bebidas', name: 'Café de laboratorio', price: 50,
    active: true, sort_order: 1, station: 'barra' }],
  pos_payment_methods: [{ id: 'lab-cash', name: 'Efectivo', type: 'efectivo', commission_pct: 0 }],
  pos_mesas: [1, 2, 3].map(number => ({ id: `mesa-${number}`, client_id: tenant, number,
    capacity: 4, active: true, x_pct: 15 + number * 20, y_pct: 40, shape: 'square', zone: 'Salón' })),
  pos_turnos: [turno], pos_staff: [staff], pos_orders: [],
}

async function fixtureRoute(route, uiOrigin, pedroPorts) {
  const request = route.request()
  const url = new URL(request.url())
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  // Nunca enviar tráfico de este laboratorio a un restaurante o proveedor real.
  if (!local && !['data:', 'blob:', 'about:'].includes(url.protocol)) return route.abort('blockedbyclient')
  if (pedroPorts.includes(Number(url.port))) return route.continue()
  const rest = url.pathname.startsWith('/rest/v1/') ? url.pathname.slice('/rest/v1/'.length)
    : url.pathname === '/api/pos/db' ? url.searchParams.get('path') || '' : null
  if (rest !== null) {
    if (!wan) return route.abort('internetdisconnected')
    const table = rest.split('?')[0]
    const rows = fixture[table] || []
    return route.fulfill({ status: 200, json: rows, headers: { 'access-control-allow-origin': '*' } })
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    if (!wan) return route.abort('internetdisconnected')
    if (url.pathname === '/api/pos/pin') return route.fulfill({ json: { staff, shiftToken: 'synthetic-lab-session' } })
    // Unexpected order mutations must not silently succeed in the fixture.
    if (/save-order|add-items|payment|merge-orders|transfer|split|liquidar/.test(url.pathname)) {
      return route.fulfill({ status: 503, json: { error: 'El laboratorio exige escritura por Caja' } })
    }
    return route.fulfill({ json: {} })
  }
  if (url.origin === uiOrigin) return route.continue()
  return route.abort('blockedbyclient')
}

async function startTerminal(name, role, port, cajaPort, uiOrigin, ports) {
  const userData = path.join(base, name)
  fs.mkdirSync(userData, { recursive: true })
  const { terminalId, actorSession } = prepared.get(name)
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    config_version: CURRENT_CONFIG_VERSION, restaurant_id: tenant, terminal_id: terminalId,
    terminal_role: role, kds_only: role === 'kds', terminal_name: name, local_server_host: '127.0.0.1',
    local_server_port: port, protocol_version: '1.0', provisioned_at: new Date().toISOString(),
    pos_server_ip: role === 'server_pos' ? null : '127.0.0.1',
    pos_server_port: role === 'server_pos' ? null : cajaPort, lan_secret: secret, instance_name: name,
  }))
  const app = await _electron.launch({ executablePath: electronBinary, args: [path.join(ELECTRON_APP, 'main.js')],
    env: cleanEnv({ FULLSITE_DEV: '1', FULLSITE_USER_DATA_DIR: userData, FULLSITE_LOCAL_SERVER_PORT: String(port),
      // Arranque inerte del mismo origen: instalar interceptores antes del JS de
      // producto impide que la precarga del SW escape al aislamiento de pruebas.
      FULLSITE_POS_URL: `${uiOrigin}/icon-192v2.png`, FULLSITE_KDS_URL: `${uiOrigin}/icon-192v2.png` }), timeout: 60000,
  })
  const terminal = { name, role, port, app, process: app.process(), userData, terminalId, actorSession, log: [], errors: [] }
  terminals.push(terminal)
  terminal.process.stdout.on('data', d => terminal.log.push(String(d)))
  terminal.process.stderr.on('data', d => terminal.log.push(String(d)))
  const context = app.context()
  await context.route('**/*', route => fixtureRoute(route, uiOrigin, ports))
  await context.addInitScript(({ tenant, staff, turno, terminalId, port, secret, actorSession }) => {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return
    localStorage.setItem('fullsite_client_id', tenant)
    localStorage.setItem('pos_terminal_id', terminalId)
    localStorage.setItem('FULLSITE_BRIDGE_URL', `http://127.0.0.1:${port}`)
    localStorage.setItem('FULLSITE_LAN_SECRET', secret)
    localStorage.setItem('FULLSITE_TERMINAL_ID', terminalId)
    localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
    localStorage.setItem('kds_settings_v1', JSON.stringify({ station: 'todas' }))
    localStorage.setItem('pos_shift_token', 'synthetic-lab-session')
    localStorage.setItem('pos_turno_id', turno.id)
    localStorage.setItem('pos_turno_cache', JSON.stringify({ turno, turnos: [turno], ts: Date.now() }))
    sessionStorage.setItem('pos_staff', JSON.stringify(staff))
    sessionStorage.setItem('pos_actor_session', JSON.stringify(actorSession))
    sessionStorage.setItem('pos_last_activity', String(Date.now()))
  }, { tenant, staff, turno, terminalId, port, secret, actorSession })
  const page = await app.firstWindow()
  terminal.page = page
  page.on('pageerror', error => terminal.errors.push(error.stack || error.message))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) terminal.log.push(`[renderer] ${message.text()}\n`)
  })
  await until(async () => (await request(terminal, '/health')).ok, `${name}: arranque de Pedro`)
  const target = role === 'kds' ? `http://127.0.0.1:${port}/kds` : `${uiOrigin}/pos/mesas`
  await page.waitForLoadState('domcontentloaded', { timeout: 90000 })
  if (role === 'kds') {
    // La navegación al HTML privado usa el mismo extraHeaders que main.js;
    // los fetch posteriores se autentican desde el código real del KDS.
    await app.evaluate(({ BrowserWindow }, { target, headers }) => {
      return BrowserWindow.getAllWindows()[0].loadURL(target, {
        extraHeaders: Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n'),
      })
    }, { target, headers })
  } else await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 })
  return terminal
}

async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error }
}

async function main() {
  const uiPort = await freePort()
  const ports = []
  for (let i = 0; i < 4; i++) ports.push(await freePort())
  assert.equal(new Set([uiPort, ...ports]).size, 5, 'Puertos independientes')
  const uiOrigin = `http://127.0.0.1:${uiPort}`
  nextProcess = spawn(process.execPath, [path.join(APP, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', String(uiPort)], {
    cwd: APP, env: cleanEnv({ NEXT_PUBLIC_SUPABASE_URL: uiOrigin,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-lab-anon-key' }), stdio: ['ignore', 'pipe', 'pipe'],
  })
  const recordNext = d => { nextLog += d; fs.writeFileSync(path.join(output, 'next.log'), nextLog) }
  nextProcess.stdout.on('data', recordNext)
  nextProcess.stderr.on('data', recordNext)
  await until(async () => (await fetch(`${uiOrigin}/pos/mesas`, { signal: AbortSignal.timeout(5000) })).ok,
    'Next sirve la pantalla real', 150000)
  for (const route of ['/pos', '/pos/cocina', '/pos/barra', '/pos/plano']) {
    await until(async () => (await fetch(`${uiOrigin}${route}`, { signal: AbortSignal.timeout(15000) })).ok,
      `Preparar compilación ${route}`, 90000)
  }
  // Prepare real signed sessions in the synthetic Caja profile before it boots.
  // Only the HTTPS PIN provider response is a fixture; token verification in
  // the running servers and the financial transport are real.
  const actors = new ActorAuthority({ directory: path.join(base, 'Caja', 'actor-authority'), restaurantId: tenant,
    fetchImpl: async () => Response.json({ staff }) })
  for (const name of ['Caja', 'POS 2', 'POS 3', 'Cocina']) {
    const terminalId = randomUUID()
    const actorSession = await actors.login({ pin: '9876543210', deviceId: terminalId, restaurantId: tenant })
    prepared.set(name, { terminalId, actorSession })
  }
  const caja = await startTerminal('Caja', 'server_pos', ports[0], ports[0], uiOrigin, ports)
  const pos2 = await startTerminal('POS 2', 'pos', ports[1], ports[0], uiOrigin, ports)
  const pos3 = await startTerminal('POS 3', 'pos', ports[2], ports[0], uiOrigin, ports)
  const kds = await startTerminal('Cocina', 'kds', ports[3], ports[0], uiOrigin, ports)
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
    await expect(pos3.page.locator('body')).toContainText('Café de laboratorio', { timeout: 20000 })
    await expect(pos3.page.locator('body')).toContainText(/116[.,]00/, { timeout: 10000 })
    const visible = await pos3.page.evaluate(tenant => JSON.parse(localStorage.getItem(`pos_cuenta_${tenant}_mesa:1`) || 'null')?.confirmed, tenant)
    assert.equal(visible?.id, orderId, 'El editor conservó el ID de la cuenta de Caja')
    assert.equal(visible?.items?.[0]?.cantidad, 2)
    await pos3.page.screenshot({ path: path.join(output, 'cuenta-compartida-sin-internet.png'), fullPage: true })
  })
  let finance
  const money = async (terminal, type, payload) => {
    const response = await command(terminal, type, { order_id: orderId, expected_revision: finance?.revision || 0, ...payload })
    finance = response.results[0].result.financial_order
  }
  const collect = async (terminal, accountId, paymentId, amount) => {
    await money(terminal, 'FINANCIAL_PAYMENT_START', { account_id: accountId, payment_id: paymentId, amount_cents: amount, method: 'cash' })
    await money(terminal, 'FINANCIAL_PAYMENT_RESULT', { payment_id: paymentId, status: 'accepted', evidence: { kind: 'cash_received', received_by: staff.id, received_cents: amount } })
  }
  await check('Sin WAN, un pago parcial desde POS 2 actualiza el saldo visible en POS 3', async () => {
    await money(pos2, 'FINANCIAL_OPEN', { turno_id: turno.id, expected_order_revision: 4, total_cents: 11600, currency: 'MXN' })
    await money(pos2, 'FINANCIAL_SPLIT', { accounts: [{ account_id: 'A', total_cents: 5800 }, { account_id: 'B', total_cents: 5800 }] })
    await collect(pos2, 'A', 'partial', 2900)
    assert.equal(finance.balance_cents, 8700)
    await expect(pos3.page.locator('body')).toContainText(/Saldo confirmado en Caja:.*87[.,]00/)
  })
  await check('Una cuenta pagada sigue en cocina mientras no se entregue', async () => {
    await collect(pos3, 'A', 'finish-A', 2900)
    await collect(pos3, 'B', 'finish-B', 5800)
    assert.equal(finance.paid_cents, 11600)
    await expect(kds.page.locator('body')).toContainText('Café de laboratorio', { timeout: 10000 })
    const snapshot = await (await request(caja, '/state')).json()
    assert(snapshot.kds_orders.some(o => o.order_id === orderId || o.id === orderId))
    await kds.page.screenshot({ path: path.join(output, 'pagada-pendiente-en-cocina.png'), fullPage: true })
  })
  await check('Al apagarse Caja, POS 2 muestra que la cuenta no está confirmada', async () => {
    caja.process.kill('SIGKILL')
    await until(async () => {
      const state = await (await request(pos2, '/state')).json()
      return state.authoritative === false
    }, 'POS detecta Caja caída')
    await pos2.page.goto(`${uiOrigin}/pos/mesas`, { waitUntil: 'domcontentloaded' })
    await expect(pos2.page.locator('body')).toContainText(/Sin conexión con la caja.*sólo borradores pendientes/i, { timeout: 15000 })
  })
  await check('Las pantallas completan el recorrido sin errores sin manejar', async () => {
    assert.deepEqual(terminals.flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))), [])
  })
}

main().catch(error => {
  console.error(error.stack)
  process.exitCode = 1
}).finally(async () => {
  for (const terminal of terminals) {
    try {
      if (!terminal.page.isClosed()) {
        await terminal.page.screenshot({ path: path.join(output, `${terminal.name}.png`), fullPage: true, timeout: 5000 })
        fs.writeFileSync(path.join(output, `${terminal.name}.txt`), await terminal.page.locator('body').innerText({ timeout: 3000 }))
      }
    } catch { /* también se captura el fallo cuando el proceso ya murió */ }
    fs.writeFileSync(path.join(output, `${terminal.name}.log`), terminal.log.join(''))
    try { await Promise.race([terminal.app.close(), new Promise(resolve => setTimeout(resolve, 2500))]) } catch {}
    if (terminal.process.exitCode === null && terminal.process.signalCode === null) terminal.process.kill('SIGKILL')
  }
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill('SIGTERM')
  fs.writeFileSync(path.join(output, 'next.log'), nextLog)
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, fixture: base,
    limitations: ['Sesión preparada: no prueba PIN o enrolamiento', 'No certifica impresoras, Windows o huella',
      'Assets servidos por Next local: esta suite no certifica el paquete offline ni Service Worker',
      'La nube está simulada; órdenes y réplicas usan Pedro real'],
    errors: terminals.flatMap(t => t.errors.map(error => ({ terminal: t.name, error }))),
  }, null, 2))
  console.log(`${results.filter(r => r.passed).length}/${results.length} casos UI. Evidencia: ${output}`)
})
