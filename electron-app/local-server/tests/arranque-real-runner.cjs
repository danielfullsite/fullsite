'use strict'
// Corre la E2E del enlace ascendente con el ARRANQUE REAL de Pedro.
//
// Vive como script y no como `node --test` a proposito: `startLocalServer` deja
// timers vivos (mDNS, heartbeat, updater) y el runner de pruebas nunca termina —
// el propio repo ya lo documenta en forward-port.test.js. Aqui se controla el
// ciclo de vida y se sale con `process.exit`.
//
// Lo invoca `enlace-arranque-real.test.js` como proceso hijo, asi que sigue
// dentro de la suite: el resultado es el codigo de salida.

const fs = require('fs'), os = require('os'), path = require('path')
const WebSocket = require('ws')
const { startLocalServer } = require('../index.js')
const { PROTOCOL_VERSION } = require('../protocol')
const credLan = require('../core/credencial-lan')

const R = 'testtenant'
// El secreto de la instalacion. En un restaurante real lo genera la caja en su
// primer arranque y el asistente lo copia a las secundarias.
const SECRETO = credLan.generarSecreto()
const CRED = credLan.cabecerasDeCredencial({ secreto: SECRETO, restaurantId: R })
const esperar = (ms) => new Promise(r => setTimeout(r, ms))
const fallos = []
const ok = (cond, msg) => { if (!cond) fallos.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`) }

async function hasta(cond, ms = 6000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (cond()) return true; await esperar(30) }
  return false
}

const arrancar = (dir, port, extra = {}) => {
  fs.mkdirSync(dir, { recursive: true })
  return startLocalServer({ dataDir: dir, port,
    config: { restaurantId: R, instanceName: `pedro-${port}`, supabaseUrl: '', supabaseKey: '', printersConfig: null, lanSecret: SECRETO, ...extra } })
}

function tableroEn(port, nombre) {
  const recibidos = []
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: CRED })
  ws.on('open', () => ws.send(JSON.stringify({
    protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE',
    client_id: nombre, client_type: 'kds', restaurant_id: R })))
  ws.on('message', raw => { try {
    const m = JSON.parse(raw.toString())
    if (m.type === 'DELTA' && m.payload?.event) recibidos.push(m.payload.event)
    if (m.type === 'SNAPSHOT') for (const d of (m.payload?.deltas || [])) recibidos.push(d)
  } catch {} })
  return { ws, recibidos, cerrar: () => ws.close() }
}

const comanda = (port, id, mesa) => fetch(`http://127.0.0.1:${port}/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...CRED },
  body: JSON.stringify({ command_id: `cmd-${id}`, command_type: 'ORDER_SENT', order_id: id,
    mesa, mesero: 'test', status: 'enviada', items: [{ nombre: 'Prueba', station: 'cocina' }] }),
}).then(r => r.status)

const idDe = e => e?.payload?.order_id || e?.order_id

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arranque-real-'))
  const CAJA = 7871, POS2 = 7872, POS3 = 7873
  const sec = { terminalRole: 'pos', posServerIp: '127.0.0.1', posServerPort: CAJA }

  const caja = await arrancar(path.join(tmp, 'caja'), CAJA, { terminalRole: 'server_pos' })
  const dirPos2 = path.join(tmp, 'pos2')
  const pos2 = await arrancar(dirPos2, POS2, sec)
  const pos3 = await arrancar(path.join(tmp, 'pos3'), POS3, sec)
  const cocina = tableroEn(POS2, 'kds-pos2')
  const tabCaja = tableroEn(CAJA, 'kds-caja')
  await hasta(() => cocina.ws.readyState === 1 && tabCaja.ws.readyState === 1)
  await esperar(500)

  // 1. POS 3 -> Caja -> tablero de POS 2, sin cablear nada a mano.
  await comanda(POS3, 'de-pos3', 21)
  ok(await hasta(() => cocina.recibidos.some(e => idDe(e) === 'de-pos3')),
     'POS 3 -> Caja -> tablero de POS 2 (arranque real)')

  // 2. La caja NO se retransmite a si misma: el evento llega una sola vez.
  await esperar(400)
  const vecesEnCaja = tabCaja.recibidos.filter(e => idDe(e) === 'de-pos3').length
  ok(vecesEnCaja === 1, `la caja entrega el evento 1 vez (fueron ${vecesEnCaja}) — sin bucle`)

  // 3. Sin duplicados en el secundario.
  const vecesEnPos2 = cocina.recibidos.filter(e => idDe(e) === 'de-pos3').length
  ok(vecesEnPos2 === 1, `POS 2 lo recibe 1 vez (fueron ${vecesEnPos2})`)

  // 4. El cursor se persiste en el dataDir de la terminal.
  const archivoCursor = path.join(dirPos2, 'cursor-caja.json')
  ok(await hasta(() => fs.existsSync(archivoCursor)), 'el cursor se persiste en cursor-caja.json')
  if (fs.existsSync(archivoCursor)) {
    const g = JSON.parse(fs.readFileSync(archivoCursor, 'utf8'))
    ok(Number.isInteger(g.cursor) && g.cursor >= 0, `el cursor guardado es valido (${g.cursor})`)
  }

  // 5. El hub rechaza con motivo, no en silencio.
  const malo = new WebSocket(`ws://127.0.0.1:${CAJA}/ws`)
  let cierre = null
  malo.on('close', (code, m) => { cierre = { code, motivo: m.toString() } })
  await new Promise(r => malo.on('open', r))
  malo.send(JSON.stringify({ type: 'SUBSCRIBE', client_id: 'sin-version', restaurant_id: R }))
  ok(await hasta(() => cierre !== null, 2500), 'un SUBSCRIBE sin protocol_version se rechaza')
  ok(cierre && cierre.code === 1008 && /protocol_version/.test(cierre.motivo),
     `el rechazo dice por que (${cierre ? cierre.code + ' ' + cierre.motivo : 'sin cierre'})`)

  // 6. SEGURIDAD: sin credencial no se entra, con credencial si.
  const sinCred = await fetch(`http://127.0.0.1:${CAJA}/state`)
  ok(sinCred.status === 401, `sin credencial /state da 401 (dio ${sinCred.status})`)

  const conCred = await fetch(`http://127.0.0.1:${CAJA}/state`, { headers: CRED })
  ok(conCred.status === 200, `con credencial /state da 200 (dio ${conCred.status})`)

  // 7. El cajon de dinero es lo mas sensible de la lista.
  const cajonSinCred = await fetch(`http://127.0.0.1:${CAJA}/drawer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ok(cajonSinCred.status === 401, `sin credencial NO se abre el cajon (dio ${cajonSinCred.status})`)

  // 8. Una credencial de OTRA instalacion no sirve.
  const otra = credLan.cabecerasDeCredencial({ secreto: credLan.generarSecreto(), restaurantId: R })
  const conOtra = await fetch(`http://127.0.0.1:${CAJA}/state`, { headers: otra })
  ok(conOtra.status === 401, `una credencial ajena se rechaza (dio ${conOtra.status})`)

  // 9. /health sigue abierto: hace falta justo cuando la credencial es el problema.
  const salud = await fetch(`http://127.0.0.1:${CAJA}/health`)
  ok(salud.status === 200, `/health sigue accesible sin credencial (dio ${salud.status})`)

  cocina.cerrar(); tabCaja.cerrar()
  for (const p of [pos3, pos2, caja]) p.close()
  await esperar(200)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

  console.log(fallos.length === 0 ? 'TODO VERDE' : `FALLARON ${fallos.length}: ${fallos.join(' | ')}`)
  process.exit(fallos.length === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(2) })
