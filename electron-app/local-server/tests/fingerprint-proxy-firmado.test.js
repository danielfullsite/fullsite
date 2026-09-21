'use strict'
/**
 * EL PROXY /fp FIRMA, Y SI NO PUEDE FIRMAR NO REENVÍA (Path A).
 *
 * Por qué existe este archivo. El 2026-09-13 en AMALAY se reemplazó a mano el
 * `fingerprint-service.exe` de la Caja por la versión que EXIGE HMAC en toda
 * ruta. El Pedro de `main` reenviaba en crudo, así que con ese binario la huella
 * queda muerta — y el operador sólo ve «lector no disponible».
 *
 * Path A conserva la arquitectura de `main` (`/fp/*` hacia 7718, el navegador
 * pide `/fp/identify`) y añade UNA cosa: la firma. Estas pruebas ejercen esa
 * firma DE VERDAD contra un servicio falso que la verifica, en vez de simular el
 * transporte — un doble que devuelve 200 no probaría nada.
 *
 * Lo que este archivo NO debe tocar, por decisión explícita de Path A:
 *   · `/auth/fingerprint/*`      · `actorAuthority.loginBiometric`
 *   · identidad Ed25519          · transferencia de plantillas
 *   · `/api/pos/staff-cache`     · cualquier camino anónimo hacia la LAN
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildHttpRouter, requestFingerprintService } = require('../index')
const cred = require('../core/credencial-lan')
const {
  prepareFingerprintIpcSecret,
  resolveFingerprintIpcDirectory,
  createFingerprintIpcResponseAuth,
  canonicalRequest,
  hashBody,
  HEADER_TIMESTAMP,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_RESPONSE_SIGNATURE,
} = require('../core/fingerprint-ipc-secret')
const crypto = require('node:crypto')

const restaurantId = 'fp-lab'
const branchId = 'sucursal-1'
const SECRETO_LAN = cred.generarSecreto()

/** Servicio de huella FALSO que se comporta como el binario instalado en campo:
 *  exige firma válida y firma su propia respuesta. */
function servicioDeHuella({ secreto, cuerpoPorRuta = {}, firmarRespuesta = true, alRecibir = () => {} }) {
  const recibidas = []
  const server = http.createServer((req, res) => {
    const trozos = []
    req.on('data', c => trozos.push(c))
    req.on('end', () => {
      const cuerpo = Buffer.concat(trozos).toString('utf8')
      recibidas.push({ method: req.method, path: req.url, body: cuerpo, headers: req.headers })
      alRecibir({ method: req.method, path: req.url, body: cuerpo })

      const ts = req.headers[HEADER_TIMESTAMP]
      const nonce = req.headers[HEADER_NONCE]
      const firma = req.headers[HEADER_SIGNATURE]
      if (!ts || !nonce || !firma) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'sin firma' }))
        return
      }
      // Recalcula la firma como lo hace el servicio real: sobre método, ruta y cuerpo.
      const esperada = crypto.createHmac('sha256', Buffer.from(secreto, 'hex'))
        .update(canonicalRequest({ timestamp: Number(ts), nonce, method: req.method, requestPath: req.url, body: cuerpo }), 'utf8')
        .digest('hex')
      if (esperada !== firma) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'firma invalida' }))
        return
      }

      const ruta = req.url.split('?')[0]
      const payload = JSON.stringify(cuerpoPorRuta[ruta] ?? { ok: true, ruta })
      const cabeceras = { 'Content-Type': 'application/json' }
      if (firmarRespuesta) {
        Object.assign(cabeceras, createFingerprintIpcResponseAuth({
          secret: secreto,
          context: { timestamp: Number(ts), nonce, method: req.method, path: req.url },
          statusCode: 200,
          body: payload,
        }))
      }
      res.writeHead(200, cabeceras)
      res.end(payload)
    })
  })
  return { server, recibidas }
}

/** Pedro mínimo: sólo lo que el router necesita para atender `/fp`. */
async function pedro(t, { secretoIpc, puertoHuella, transporte }) {
  const router = buildHttpRouter({
    state: {}, eventStore: {}, wsHub: { broadcast: async () => {} }, cmdHandler: {},
    printer: {}, version: 'test', serverId: 'srv-test',
    restaurantId, branchId,
    config: { lanSecret: SECRETO_LAN, terminalId: 'caja', terminalRole: 'server_pos' },
    fingerprintIpcSecret: secretoIpc,
    fingerprintRequest: transporte
      ?? (({ method, path: ruta, ipcSecret, body }) =>
            requestFingerprintService({ method, path: ruta, ipcSecret, body, port: puertoHuella })),
  })
  const app = http.createServer(router)
  await new Promise(r => app.listen(0, '127.0.0.1', r))
  t.after(() => new Promise(r => { app.closeAllConnections(); app.close(r) }))
  return app.address().port
}

async function arrancarServicio(t, opciones) {
  const { server, recibidas } = servicioDeHuella(opciones)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  return { puerto: server.address().port, recibidas }
}

const credenciales = () => cred.cabecerasDeCredencial({
  secreto: SECRETO_LAN, restaurantId, branchId, terminalId: 'caja',
})

// `...init` va PRIMERO a propósito: si se esparce al final, un `headers` del
// llamador pisa la credencial de LAN y la petición muere en 401 por la puerta
// equivocada — que es exactamente lo que le pasó a la primera versión de estas
// pruebas y costó un rato entender.
const pedir = (puerto, ruta, init = {}) => fetch(`http://127.0.0.1:${puerto}${ruta}`, {
  signal: AbortSignal.timeout(4000),
  ...init,
  headers: { ...credenciales(), ...(init.headers || {}) },
})

// ─── 1..5 · las cinco rutas que el binario de campo sirve ────────────────────

test('las cinco rutas de huella pasan firmadas y devuelven el cuerpo del servicio', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const cuerpoPorRuta = {
    '/health':   { ok: true, ipc_auth_required: true, ipc_auth_scheme: 'hmac-sha256-v1', enrolled: 3 },
    '/identify': { ok: true, staffId: 'mesero-7' },
    '/enroll':   { ok: true, enrolled: 4 },
    '/list':     { ok: true, ids: ['mesero-7', 'cajero-1'] },
    '/delete':   { ok: true, deleted: 'mesero-7' },
  }
  const { puerto, recibidas } = await arrancarServicio(t, { secreto: secretoIpc, cuerpoPorRuta })
  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: puerto })

  for (const [ruta, esperado] of Object.entries(cuerpoPorRuta)) {
    const res = await pedir(puertoPedro, `/fp${ruta}`)
    assert.equal(res.status, 200, `${ruta} debió pasar`)
    assert.deepEqual(await res.json(), esperado, `${ruta} debió devolver el cuerpo del servicio`)
  }

  // La prueba de que SE FIRMÓ: el servicio falso rechaza lo no firmado, así que
  // llegar a 200 cinco veces ya lo demuestra. Se afirma explícito de todos modos.
  assert.equal(recibidas.length, 5)
  for (const r of recibidas) {
    assert.ok(r.headers[HEADER_SIGNATURE], `${r.path} llegó sin firma`)
    assert.ok(r.headers[HEADER_NONCE], `${r.path} llegó sin nonce`)
  }
  // Cada petición usa un nonce distinto: una firma capturada no se puede reusar.
  const nonces = new Set(recibidas.map(r => r.headers[HEADER_NONCE]))
  assert.equal(nonces.size, 5, 'el nonce debe ser único por petición')
})

test('el cuerpo y la cadena de consulta viajan íntegros hasta el servicio', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { puerto, recibidas } = await arrancarServicio(t, { secreto: secretoIpc })
  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: puerto })

  const res = await pedir(puertoPedro, '/fp/enroll?id=mesero-7', {
    method: 'POST', body: JSON.stringify({ plantilla: 'abc' }),
    headers: { 'Content-Type': 'application/json' },
  })
  assert.equal(res.status, 200)
  assert.equal(recibidas[0].path, '/enroll?id=mesero-7', 'la query debe llegar intacta')
  assert.equal(recibidas[0].body, JSON.stringify({ plantilla: 'abc' }), 'el cuerpo debe llegar intacto')
})

// ─── 6 · sin secreto: falla cerrado y NO reenvía ─────────────────────────────

test('sin secreto IPC el proxy falla cerrado y no manda nada al lector', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { puerto, recibidas } = await arrancarServicio(t, { secreto: secretoIpc })
  const puertoPedro = await pedro(t, { secretoIpc: null, puertoHuella: puerto })

  const res = await pedir(puertoPedro, '/fp/identify')
  assert.equal(res.status, 503)
  const cuerpo = await res.json()
  assert.equal(cuerpo.code, 'FINGERPRINT_IPC_NOT_READY')
  assert.equal(cuerpo.ok, false)
  // Lo que de verdad importa: no se reenvió SIN FIRMAR «por si acaso».
  assert.equal(recibidas.length, 0, 'no debió llegar ninguna petición al servicio')
})

// ─── 7 · secreto equivocado: el servicio rechaza y el proxy no lo disfraza ───

test('con un secreto que no es el del lector, la petición se rechaza', async t => {
  const secretoDelServicio = crypto.randomBytes(32).toString('hex')
  const secretoDePedro = crypto.randomBytes(32).toString('hex')
  const { puerto, recibidas } = await arrancarServicio(t, { secreto: secretoDelServicio })
  const puertoPedro = await pedro(t, { secretoIpc: secretoDePedro, puertoHuella: puerto })

  const res = await pedir(puertoPedro, '/fp/identify')
  assert.notEqual(res.status, 200, 'una firma ajena NUNCA debe resolver en éxito')
  assert.equal(recibidas.length, 1, 'la petición llegó, y el servicio la rechazó')
  assert.equal(JSON.parse(recibidas[0].body || '{}').ok, undefined)
})

// ─── 8 · cuerpo alterado en tránsito: la firma deja de cuadrar ───────────────

test('si alguien altera el cuerpo después de firmar, el servicio lo rechaza', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { puerto } = await arrancarServicio(t, { secreto: secretoIpc })

  // Transporte hostil: firma un cuerpo y manda otro. Es el ataque que la firma existe para parar.
  const transporteQueAltera = async ({ method, path: ruta, ipcSecret }) => {
    const ts = Date.now(), nonce = crypto.randomBytes(32).toString('hex')
    const firmado = JSON.stringify({ monto: 1 })
    const enviado = JSON.stringify({ monto: 999999 })
    const firma = crypto.createHmac('sha256', Buffer.from(ipcSecret, 'hex'))
      .update(canonicalRequest({ timestamp: ts, nonce, method, requestPath: ruta, body: firmado }), 'utf8')
      .digest('hex')
    const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
      method, body: enviado,
      headers: { [HEADER_TIMESTAMP]: String(ts), [HEADER_NONCE]: nonce, [HEADER_SIGNATURE]: firma },
      signal: AbortSignal.timeout(4000),
    })
    return { statusCode: res.status, contentType: 'application/json', body: await res.text() }
  }

  const puertoPedro = await pedro(t, { secretoIpc, transporte: transporteQueAltera })
  const res = await pedir(puertoPedro, '/fp/enroll', { method: 'POST', body: '{}' })
  assert.equal(res.status, 401, 'un cuerpo alterado debe caer con 401, no ejecutarse')
})

// ─── 9 · la respuesta también se verifica ───────────────────────────────────

test('una respuesta sin firmar del lector NO se entrega al navegador', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { puerto } = await arrancarServicio(t, {
    secreto: secretoIpc,
    cuerpoPorRuta: { '/identify': { ok: true, staffId: 'suplantado' } },
    firmarRespuesta: false,          // ← el servicio contesta, pero no firma
  })
  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: puerto })

  const res = await pedir(puertoPedro, '/fp/identify')
  assert.notEqual(res.status, 200, 'sin firma de respuesta no puede haber éxito')
  const texto = await res.text()
  assert.ok(!texto.includes('suplantado'), 'el cuerpo no firmado no debe llegar al navegador')
})

test('una firma de respuesta que no corresponde se rechaza', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { server } = servicioDeHuella({ secreto: secretoIpc })
  // Servicio que firma con OTRO secreto: es el escenario del proceso okupa.
  const otro = crypto.randomBytes(32).toString('hex')
  const impostor = http.createServer((req, res) => {
    const trozos = []
    req.on('data', c => trozos.push(c))
    req.on('end', () => {
      const ts = req.headers[HEADER_TIMESTAMP], nonce = req.headers[HEADER_NONCE]
      const payload = JSON.stringify({ ok: true, staffId: 'impostor' })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...createFingerprintIpcResponseAuth({
          secret: otro,
          context: { timestamp: Number(ts), nonce, method: req.method, path: req.url },
          statusCode: 200, body: payload,
        }),
      })
      res.end(payload)
    })
  })
  server.close()
  await new Promise(r => impostor.listen(0, '127.0.0.1', r))
  t.after(() => new Promise(r => { impostor.closeAllConnections(); impostor.close(r) }))

  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: impostor.address().port })
  const res = await pedir(puertoPedro, '/fp/identify')
  assert.notEqual(res.status, 200)
  assert.ok(!(await res.text()).includes('impostor'))
})

// ─── 10 · el secreto sobrevive a un reinicio ────────────────────────────────

test('reiniciar la terminal recupera el MISMO secreto, no genera otro', async t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-fp-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: raiz })

  const primero = prepareFingerprintIpcSecret({ directory: directorio })
  const segundo = prepareFingerprintIpcSecret({ directory: directorio })   // «reinicio»
  assert.equal(segundo, primero, 'un reinicio NO debe rotar el secreto: el servicio dejaría de hablar')
  assert.match(primero, /^[a-f0-9]{64}$/)

  // Y el secreto recuperado sirve de verdad contra el lector.
  const { puerto } = await arrancarServicio(t, { secreto: segundo })
  const puertoPedro = await pedro(t, { secretoIpc: segundo, puertoHuella: puerto })
  assert.equal((await pedir(puertoPedro, '/fp/health')).status, 200)
})

// ─── 11 · el okupa del 7718 no se hace pasar por el lector ──────────────────

test('un proceso que ocupa 7718 sin el secreto no puede suplantar al lector', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  // Okupa: responde 200 alegremente y no sabe firmar nada.
  const okupa = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ipc_auth_required: true, staffId: 'gerente' }))
  })
  await new Promise(r => okupa.listen(0, '127.0.0.1', r))
  t.after(() => new Promise(r => { okupa.closeAllConnections(); okupa.close(r) }))

  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: okupa.address().port })
  const res = await pedir(puertoPedro, '/fp/identify')
  assert.notEqual(res.status, 200, 'un 200 sin firma no es un lector')
  assert.ok(!(await res.text()).includes('gerente'), 'no debe entregarse una identidad no firmada')
})

// ─── Fronteras de Path A: lo que este camino NO debe tener ──────────────────

test('Path A no expone /auth/fingerprint/* ni acepta huella sin credencial de LAN', async t => {
  const secretoIpc = crypto.randomBytes(32).toString('hex')
  const { puerto, recibidas } = await arrancarServicio(t, { secreto: secretoIpc })
  const puertoPedro = await pedro(t, { secretoIpc, puertoHuella: puerto })

  for (const ruta of ['/auth/fingerprint/status', '/auth/fingerprint/assertion', '/auth/fingerprint']) {
    const res = await pedir(puertoPedro, ruta, { method: 'POST', body: '{}' })
    assert.equal(res.status, 404, `${ruta} pertenece a Path B y no debe existir`)
  }

  // Sin credencial de LAN, /fp no es anónima: es la puerta que evita que
  // cualquier equipo del WiFi le pida al lector que identifique a alguien.
  const anonima = await fetch(`http://127.0.0.1:${puertoPedro}/fp/identify`, { signal: AbortSignal.timeout(4000) })
  assert.equal(anonima.status, 401)
  // Con secreto configurado el motivo es «falta la credencial»; sin secreto sería
  // «terminal sin emparejar». Los dos son 401 y los dos cortan antes del lector:
  // lo que se afirma aquí es que NINGUNA de las dos puertas deja pasar.
  assert.match((await anonima.json()).error, /credencial|emparejar/)
  assert.equal(recibidas.length, 0, 'una petición anónima no debe alcanzar al lector')
})
