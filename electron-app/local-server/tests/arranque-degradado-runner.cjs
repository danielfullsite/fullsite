'use strict'
// Arranque REAL de Pedro con la autoridad de PIN rota.
//
// Vive como script y no como `node --test` por lo mismo que arranque-real-runner:
// `startLocalServer` deja timers vivos (mDNS, heartbeat, updater) y el runner de
// pruebas nunca terminaría. Lo invoca `arranque-degradado.test.js` como proceso
// hijo, así que el resultado es el código de salida.
const fs = require('fs'), os = require('os'), path = require('path')
const { startLocalServer } = require('../index.js')
const credLan = require('../core/credencial-lan')

const R = 'testtenant'
const SECRETO = credLan.generarSecreto()
const CRED = credLan.cabecerasDeCredencial({ secreto: SECRETO, restaurantId: R })
const fallos = []
const ok = (cond, msg) => { if (!cond) fallos.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`) }

const arrancar = (dir, port) => {
  fs.mkdirSync(dir, { recursive: true })
  return startLocalServer({ dataDir: dir, port,
    config: { restaurantId: R, instanceName: `pedro-${port}`, supabaseUrl: '', supabaseKey: '', printersConfig: null, lanSecret: SECRETO } })
}
const pedir = (port, ruta, init = {}) => fetch(`http://127.0.0.1:${port}${ruta}`, {
  ...init, headers: { 'Content-Type': 'application/json', ...CRED, ...init.headers }, signal: AbortSignal.timeout(4000) })

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-degradado-'))

  // Un apagón a media escritura deja el archivo de credenciales truncado. Es el
  // caso que hoy impedía arrancar a Pedro entero.
  const dir = path.join(base, 'caja')
  fs.mkdirSync(path.join(dir, 'actor-authority'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'actor-authority', 'actor-credentials.json'), '{"credentials":{},"fail')

  let servidor
  try {
    servidor = await arrancar(dir, 0)
  } catch (error) {
    ok(false, `Pedro no arrancó con el archivo de credenciales dañado: ${error.message}`)
    console.log(`\n${fallos.length ? 'HAY FALLOS' : 'TODO VERDE'}`)
    process.exit(1)
  }
  const port = servidor.httpServer.address().port
  ok(!!port, 'Pedro arrancó pese al archivo de credenciales dañado')

  // Lo que sostiene la operación mientras la autoridad está caída.
  const salud = await pedir(port, '/health')
  const cuerpo = await salud.json()
  ok(salud.ok, 'GET /health responde')
  ok(cuerpo.authority && cuerpo.authority.ready === false, '/health declara que la autoridad NO está lista')
  ok(typeof cuerpo.authority?.reason === 'string' && cuerpo.authority.reason.length > 0,
    `/health explica por qué (motivo: ${JSON.stringify(cuerpo.authority?.reason)})`)

  const estado = await pedir(port, '/state')
  ok(estado.ok, 'GET /state sigue sirviendo el salón: la venta no se detiene por el PIN')

  const pin = await pedir(port, '/auth/pin', { method: 'POST', body: JSON.stringify({ pin: '4321' }) })
  const rechazo = await pin.json()
  ok(pin.status === 503, `POST /auth/pin contesta 503 y no 500 (fue ${pin.status})`)
  ok(rechazo.code === 'ACTOR_AUTHORITY_UNAVAILABLE', 'el rechazo trae código para que la pantalla lo distinga')
  ok(typeof rechazo.reason === 'string' && rechazo.reason.length > 0, 'el rechazo trae el motivo para soporte')

  const authStatus = await pedir(port, '/auth/status')
  ok(authStatus.status === 503, 'GET /auth/status también contesta 503')

  await servidor.close()

  // Con el archivo sano, nada cambia.
  const sano = path.join(base, 'caja-sana')
  const servidorSano = await arrancar(sano, 0)
  const portSano = servidorSano.httpServer.address().port
  const saludSana = await (await pedir(portSano, '/health')).json()
  ok(saludSana.authority?.ready === true, 'una Caja sana declara su autoridad lista')
  ok(saludSana.authority?.reason === null, 'y sin motivo de degradación')
  await servidorSano.close()

  console.log(`\n${fallos.length ? `HAY FALLOS: ${fallos.length}` : 'TODO VERDE'}`)
  process.exit(fallos.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
