'use strict'
// Bloque POS, PR 03 — el almacén offline de la Caja, sellado por el SO.
//
// Lo que se cierra, con su ataque:
//   · CACHÉ ROBADA: antes bastaba copiar `actor-signing-key` + `actor-credentials.json` y
//     calcular HMAC(llave, 'pin:'+pin) para 10^4 PINs. Ahora los dos van sellados.
//   · SIN PROTECCIÓN: sin protector real la Caja no guarda credenciales (falla cerrado).
//   · REVOCACIÓN: un 401 o el roster de la nube dejan una revocación DURABLE que alcanza a la
//     entrada legacy de la misma persona y a sus sesiones.
//   · RECIBOS: aprobación offline firmada con la llave de la terminal, verificable en la nube.
// Todo sintético: nube falsa, PINs de relleno, protector de prueba.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { ActorAuthority } = require('../core/actor-authority')
const { protectorDePrueba, protectorDeElectron, protectorParaLaCaja, PROTECTOR_NO_DISPONIBLE } = require('../core/protector-so')

const R = 'lab', B = 'branch-A', CAJA = 'POS-CAJA', ENTRADA = 'POS-ENTRADA'
const GERENTE = { id: 'gerente-1', name: 'Gerente', role: 'gerente' }
const MESERO = { id: 'mesero-1', name: 'Mesero', role: 'mesero' }
const PIN_G = '4102', PIN_M = '4101'
let dir, now, nube
const protector = protectorDePrueba('sellado')

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-sellado-'))
  now = 1_800_000_000_000
  nube = {
    modo: 'ok', llamadas: [],
    staff: { [PIN_G]: GERENTE, [PIN_M]: MESERO },
    roster: null, // null = responde con todos los de `staff`
    rosterCid: R,
    llave: 'ab'.repeat(32),
  }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

function fetchFalso(url, init = {}) {
  nube.llamadas.push({ url, init })
  if (nube.modo === 'caida') return Promise.reject(new TypeError('fetch failed'))
  if (url.endsWith('/api/pos/pin')) {
    const b = JSON.parse(init.body)
    const s = nube.staff[b.pin]
    if (!s) return Promise.resolve(Response.json({ error: 'PIN incorrecto' }, { status: 401 }))
    return Promise.resolve(Response.json({ staff: s, shiftToken: 'sesion-' + s.id, ...(b.aprobacion ? { approvalToken: 'aprob-' + s.id } : {}) }))
  }
  if (url.endsWith('/api/pos/staff-roster')) {
    const lista = nube.roster ?? Object.values(nube.staff).map(s => ({ id: s.id, role: s.role }))
    return Promise.resolve(Response.json({ client_id: nube.rosterCid, staff: lista }))
  }
  if (url.endsWith('/api/pos/terminal-receipt-key')) {
    const b = JSON.parse(init.body)
    return Promise.resolve(Response.json({ kid: 'v1', key: nube.llave, device_id: b.device_id }))
  }
  return Promise.resolve(new Response('{}', { status: 404 }))
}

const crear = (o = {}) => new ActorAuthority({ directory: dir, restaurantId: R, branchId: B, now: () => now,
  fetchImpl: fetchFalso, protector, terminalId: CAJA, ...o })
const entrar = (a, pin, deviceId = CAJA, extra = {}) => a.login({ pin, deviceId, restaurantId: R, ...extra })

// ── Protector ─────────────────────────────────────────────────────────────────
test('protector de Electron: basic_text (Linux sin llavero) NO cuenta como protección', () => {
  const falso = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
  assert.equal(protectorDeElectron(falso).available, false)
  assert.equal(protectorDeElectron({ isEncryptionAvailable: () => false }).available, false)
  assert.equal(protectorDeElectron(undefined).available, false)
  const real = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'kwallet5', encryptString: s => Buffer.from('X' + s), decryptString: b => b.toString().slice(1) }
  assert.equal(protectorDeElectron(real).available, true)
})

test('el protector de laboratorio sólo existe con la app SIN empaquetar y la variable explícita', () => {
  const env = { FULLSITE_LAB_PROTECTOR: 'prueba' }
  assert.equal(protectorParaLaCaja({ safeStorage: undefined, empaquetada: true, env }).available, false, 'empaquetada: nunca el de prueba')
  assert.equal(protectorParaLaCaja({ safeStorage: undefined, empaquetada: false, env }).nombre, 'prueba')
  assert.equal(protectorParaLaCaja({ safeStorage: undefined, empaquetada: false, env: {} }).available, false)
})

// ── Sin protección: falla cerrado ─────────────────────────────────────────────
test('SIN protector: con red funciona; sin red NO valida PINs; nada queda en disco', async () => {
  const a = crear({ protector: PROTECTOR_NO_DISPONIBLE })
  const s = await entrar(a, PIN_G)
  assert.equal(s.offline, false)
  assert.equal(a.verify(s.actor_token, CAJA).id, GERENTE.id, 'la sesión de este arranque sí verifica')
  await a.idle()
  assert.deepEqual(fs.readdirSync(dir), [], 'ni credenciales ni llave en disco')
  nube.modo = 'caida'
  await assert.rejects(entrar(a, PIN_G), { status: 503, code: 'OFFLINE_SIN_PROTECCION' })
  assert.equal(a.status().offline_protegido, false)
})

test('SIN protector: los archivos planos de la versión anterior se BORRAN al arrancar', () => {
  fs.writeFileSync(path.join(dir, 'actor-signing-key'), 'cd'.repeat(32))
  fs.writeFileSync(path.join(dir, 'actor-credentials.json'), JSON.stringify({ credentials: {}, failures: {}, denied_devices: {}, last_seen: 0, restaurant_id: R, location_id: B }))
  crear({ protector: PROTECTOR_NO_DISPONIBLE })
  assert.deepEqual(fs.readdirSync(dir), [])
})

// ── Caché robada ──────────────────────────────────────────────────────────────
test('CACHÉ ROBADA: los archivos no traen la llave ni los verificadores legibles', async () => {
  const a = crear()
  await entrar(a, PIN_G)
  await a.idle()
  const archivos = fs.readdirSync(dir).sort()
  assert.deepEqual(archivos, ['actor-credentials.sealed', 'actor-signing-key.sealed'])
  const crudos = archivos.map(f => fs.readFileSync(path.join(dir, f)))
  for (const b of crudos) {
    assert.throws(() => JSON.parse(b.toString('utf8')), 'no es JSON legible')
    assert(!/[a-f0-9]{64}/.test(b.toString('latin1')), 'no hay llave hex a la vista')
    assert(!b.includes(GERENTE.id) && !b.includes(PIN_G), 'ni ids ni PIN')
  }
})

test('CACHÉ ROBADA: copiada a otra máquina (otro protector) no abre — falla cerrado', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  assert.throws(() => crear({ protector: protectorDePrueba('otra-maquina') }), /dañadas o pertenecientes a otra instalación/)
})

test('CACHÉ ROBADA: la fuerza bruta del esquema viejo ya no encuentra nada', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  // El ataque de antes: tomar la llave del archivo y probar los 10^4 PINs contra el índice.
  const llaveCruda = fs.readFileSync(path.join(dir, 'actor-signing-key.sealed'))
  const datosCrudos = fs.readFileSync(path.join(dir, 'actor-credentials.sealed')).toString('latin1')
  let aciertos = 0
  for (let i = 0; i < 10000; i++) {
    const pin = String(i).padStart(4, '0')
    const idx = crypto.createHmac('sha256', llaveCruda.toString('utf8').trim()).update('pin:' + pin).digest('hex')
    if (datosCrudos.includes(idx)) aciertos++
  }
  assert.equal(aciertos, 0)
})

// ── Con protector: el camino offline funciona ─────────────────────────────────
test('preparado con red, entra sin red después de reiniciar (almacén sellado)', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  const b = crear()
  const s = await entrar(b, PIN_G)
  assert.equal(s.offline, true)
  assert.equal(b.verify(s.actor_token, CAJA).id, GERENTE.id)
})

test('el índice nuevo incluye el restaurante: el mismo PIN en otro tenant no comparte índice', () => {
  const a = crear()
  const b = new ActorAuthority({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'fs-otro-')), restaurantId: 'otro', branchId: B, protector, fetchImpl: fetchFalso })
  assert.notEqual(a._index(PIN_G), b._index(PIN_G))
})

// ── Migración de lo plano ─────────────────────────────────────────────────────
function escribirLegacy(personas, { expira = now + 86400000 } = {}) {
  const llave = 'ef'.repeat(32)
  const credentials = {}
  for (const [pin, staff] of personas) {
    const salt = crypto.randomBytes(16).toString('hex')
    const idx = crypto.createHmac('sha256', llave).update('pin:' + pin).digest('hex')
    credentials[idx] = { staff, salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex'), expires_at: expira, revision: crypto.randomUUID(), devices: { [CAJA]: expira } }
  }
  fs.writeFileSync(path.join(dir, 'actor-signing-key'), llave)
  fs.writeFileSync(path.join(dir, 'actor-credentials.json'), JSON.stringify({ credentials, failures: {}, denied_devices: {}, last_seen: now - 1000, restaurant_id: R, location_id: B }))
}

test('MIGRACIÓN: lo plano pasa sellado como legacy y los archivos planos desaparecen', async () => {
  escribirLegacy([[PIN_G, GERENTE]])
  const a = crear()
  assert.deepEqual(fs.readdirSync(dir).sort(), ['actor-credentials.sealed', 'actor-signing-key.sealed'])
  nube.modo = 'caida'
  const s = await entrar(a, PIN_G)
  assert.equal(s.offline, true, 'la continuidad offline se conserva tras actualizar')
})

test('MIGRACIÓN: entrar con red re-prepara en v2 y la entrada legacy se descarta', async () => {
  escribirLegacy([[PIN_G, GERENTE]])
  const a = crear()
  await entrar(a, PIN_G); await a.idle()
  assert.equal(a.data.legacy, undefined, 'sin entradas legacy, no queda ni la llave vieja')
  nube.modo = 'caida'
  assert.equal((await entrar(crear(), PIN_G)).offline, true)
})

test('MIGRACIÓN: archivo plano dañado → la autoridad no se construye (Pedro degrada)', () => {
  fs.writeFileSync(path.join(dir, 'actor-credentials.json'), '{"credentials":{},"fail')
  assert.throws(() => crear())
})

// ── Revocación durable ────────────────────────────────────────────────────────
test('REVOCACIÓN: un 401 sobre una credencial conocida sobrevive al reinicio', async () => {
  const a = crear(); const sesion = await entrar(a, PIN_G); await a.idle()
  delete nube.staff[PIN_G] // dado de baja en la nube
  await assert.rejects(entrar(a, PIN_G), { status: 401 })
  assert.throws(() => a.verify(sesion.actor_token, CAJA), { status: 401 }, 'su sesión muere')
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_G), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('REVOCACIÓN: alcanza la entrada legacy de la misma persona con OTRO PIN (el viejo)', async () => {
  escribirLegacy([['7777', GERENTE]])       // PIN viejo, preparado antes de actualizar
  const a = crear()
  nube.staff = { [PIN_G]: GERENTE, [PIN_M]: MESERO }
  // La nube rechaza el PIN viejo: la persona quedó conocida por su credencial legacy.
  await assert.rejects(entrar(a, '7777'), { status: 401 })
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), '7777'), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('ROSTER: quien ya no está activo pierde su credencial offline aunque nunca teclee su PIN con red', async () => {
  const a = crear()
  await entrar(a, PIN_M, CAJA)                    // el mesero se prepara
  await a.idle()
  nube.roster = [{ id: GERENTE.id, role: 'gerente' }] // el mesero fue dado de baja
  await entrar(a, PIN_G, CAJA)                    // el gerente entra con red → roster
  await a.idle()
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_M, CAJA), { code: 'OFFLINE_USER_NOT_PREPARED' })
  assert.equal((await entrar(crear(), PIN_G, CAJA)).offline, true, 'el activo sigue entrando')
})

test('ROSTER: bajar de rol se aplica offline y mata las sesiones con el rol viejo', async () => {
  const a = crear()
  const s = await entrar(a, PIN_G, CAJA); await a.idle()
  nube.roster = [{ id: GERENTE.id, role: 'mesero' }, { id: MESERO.id, role: 'mesero' }]
  await entrar(a, PIN_M, ENTRADA); await a.idle()
  assert.throws(() => a.verify(s.actor_token, CAJA), { status: 401 })
  nube.modo = 'caida'
  const b = crear()
  const offline = await entrar(b, PIN_G, CAJA)
  assert.equal(offline.staff.role, 'mesero')
  await assert.rejects(entrar(b, PIN_G, CAJA, { minRole: 'gerente' }), { code: 'PERMISSION_DENIED' })
})

test('ROSTER de OTRO restaurante se ignora', async () => {
  const a = crear(); await entrar(a, PIN_M); await a.idle()
  nube.rosterCid = 'otro'; nube.roster = []
  await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  assert.equal((await entrar(crear(), PIN_M)).offline, true)
})

test('una nube lenta en el roster NO demora el siguiente PIN (corre fuera de la cola)', async () => {
  const pendientes = []
  const lenta = (url, init) => url.endsWith('/staff-roster')
    ? new Promise(r => { pendientes.push(() => r(Response.json({ client_id: R, staff: [] }))) })
    : fetchFalso(url, init)
  const a = crear({ fetchImpl: lenta })
  await entrar(a, PIN_G)
  const t0 = Date.now()
  await entrar(a, PIN_M, ENTRADA)
  assert(Date.now() - t0 < 1000)
  for (const soltar of pendientes) soltar()
  await a.idle()
})

// ── Aprobaciones y recibos ────────────────────────────────────────────────────
test('APROBACIÓN con red: pide `aprobacion` sin filtrar rol en la nube y devuelve el token de aprobación', async () => {
  const a = crear()
  const r = await entrar(a, PIN_G, ENTRADA, { aprobacion: true, minRole: 'gerente' })
  assert.equal(r.approvalToken, 'aprob-' + GERENTE.id)
  const cuerpo = JSON.parse(nube.llamadas.find(l => l.url.endsWith('/api/pos/pin')).init.body)
  assert.equal(cuerpo.aprobacion, true)
  assert.equal(cuerpo.min_role, undefined, 'sin filtro de rol: un 401 por rol no debe borrar a nadie')
})

test('un mesero en la pantalla de aprobación NO pierde su credencial (403 local, no 401 de la nube)', async () => {
  const a = crear()
  await assert.rejects(entrar(a, PIN_M, CAJA, { aprobacion: true, minRole: 'gerente' }), { code: 'PERMISSION_DENIED' })
  nube.modo = 'caida'
  assert.equal((await entrar(crear(), PIN_M, CAJA)).offline, true)
})

test('LLAVE DE RECIBOS: la obtiene una sesión de gerente, sellada; un mesero no la pide', async () => {
  const a = crear()
  await entrar(a, PIN_M); await a.idle()
  assert.equal(nube.llamadas.some(l => l.url.endsWith('/terminal-receipt-key')), false)
  await entrar(a, PIN_G); await a.idle()
  const pedido = nube.llamadas.find(l => l.url.endsWith('/terminal-receipt-key'))
  assert.equal(JSON.parse(pedido.init.body).device_id, CAJA, 'la llave es de ESTA terminal, no la que declara la página')
  assert.equal(a.status().recibos_offline, true)
  assert(!fs.readFileSync(path.join(dir, 'actor-credentials.sealed')).includes(nube.llave))
})

test('RECIBO offline: firmado con la llave de la terminal, con aprobador, rol y terminal que pidió', async () => {
  const a = crear()
  // La credencial es de la TERMINAL donde se preparó: el gerente se prepara en la Entrada.
  await entrar(a, PIN_G, ENTRADA); await a.idle()
  nube.modo = 'caida'
  const r = await entrar(crear(), PIN_G, ENTRADA, { aprobacion: true, minRole: 'gerente' })
  assert.equal(r.offline, true)
  const [pre, payload, firma] = r.recibo.split('.')
  assert.equal(pre, 'rcb1')
  const esperada = crypto.createHmac('sha256', Buffer.from(nube.llave, 'hex')).update('rcb1.' + payload).digest('base64url')
  assert.equal(firma, esperada)
  const c = JSON.parse(Buffer.from(payload, 'base64url').toString())
  assert.deepEqual({ cid: c.cid, tid: c.tid, req: c.req, sub: c.sub, rol: c.rol }, { cid: R, tid: CAJA, req: ENTRADA, sub: GERENTE.id, rol: 'gerente' })
  assert.equal(typeof c.non, 'string')
})

test('una credencial preparada en OTRA terminal no sirve offline aquí (contrato de terminal)', async () => {
  const a = crear(); await entrar(a, PIN_G, CAJA); await a.idle()
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_G, ENTRADA), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('sin llave de recibos la aprobación offline no inventa uno', async () => {
  const a = crear({ terminalId: null })
  await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  const r = await entrar(crear({ terminalId: null }), PIN_G, CAJA, { aprobacion: true, minRole: 'gerente' })
  assert.equal(r.recibo, undefined)
})

test('DOWNGRADE: una llave de recibos malformada o de otra terminal se descarta', async () => {
  nube.llave = 'no-hex'
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  assert.equal(a.status().recibos_offline, false)
})

test('RELOJ hacia atrás sigue fallando cerrado con el almacén sellado', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  now -= 10 * 60000
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_G), { code: 'ACTOR_CLOCK_INVALID' })
})
