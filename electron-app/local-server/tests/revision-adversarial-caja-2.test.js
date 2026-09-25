'use strict'
// Segunda revisión adversarial de la Caja (bloque POS, 2026-09-25), ejecutada sobre 3c4e9a46.
// Cada prueba es un ataque; todas son defensas que AGUANTAN y quedan como regresión. El único
// ataque que rompió (la escalada del bloqueo se reiniciaba al tope) está en
// revision-adversarial-caja.test.js como E1c, junto con su arreglo.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { ActorAuthority } = require('../core/actor-authority')
const { protectorDePrueba } = require('../core/protector-so')

const R = 'lab', CAJA = 'POS-CAJA'
const GERENTE = { id: 'g1', name: 'Gerente', role: 'gerente' }, MESERO = { id: 'm1', name: 'Mesero', role: 'mesero' }
const PIN_G = '4102', PIN_M = '4101'
let dir, now, nube
const protector = protectorDePrueba('ataques-caja')
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-atq-')); now = 1_800_000_000_000
  nube = { modo: 'ok', staff: { [PIN_G]: GERENTE, [PIN_M]: MESERO }, status: 200, roster: null } })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
function fetchFalso(url, init = {}) {
  if (nube.modo === 'caida') return Promise.reject(new TypeError('fetch failed'))
  const conHora = (b, i) => { const r = Response.json(b, i); r.headers.set('date', new Date(now).toUTCString()); return r }
  if (url.endsWith('/api/pos/pin')) {
    if (nube.status !== 200) return Promise.resolve(conHora({ error: 'x' }, { status: nube.status }))
    const b = JSON.parse(init.body); const s = nube.staff[b.pin]
    if (!s) return Promise.resolve(conHora({ error: 'PIN incorrecto' }, { status: 401 }))
    return Promise.resolve(conHora({ staff: s, cred_rev: 'rev-' + b.pin, ...(b.aprobacion ? { approvalToken: 'a' } : { shiftToken: 's' }) }))
  }
  if (url.endsWith('/api/pos/staff-roster')) {
    const lista = nube.roster ?? Object.entries(nube.staff).map(([pin, s]) => ({ id: s.id, role: s.role, cred_rev: 'rev-' + pin }))
    return Promise.resolve(Response.json({ client_id: nube.rosterCid ?? R, staff: lista, as_of: nube.asOf ?? now }))
  }
  return Promise.resolve(new Response('{}', { status: 404 }))
}
const crear = () => new ActorAuthority({ directory: dir, restaurantId: R, branchId: 'b', now: () => now, fetchImpl: fetchFalso, protector, terminalId: CAJA })
const entrar = (a, pin, dev = CAJA, extra = {}) => a.login({ pin, deviceId: dev, restaurantId: R, ...extra })

test('A2 · reiniciar Pedro no borra un bloqueo vigente', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle(); nube.modo = 'caida'
  for (let i = 0; i < 10; i++) await entrar(a, String(5000 + i)).catch(() => {})
  await assert.rejects(entrar(crear(), PIN_G), { status: 429 })
})

test('A3 · 401 conocido + reinicio sin red: no vuelve a entrar', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  delete nube.staff[PIN_G]; await assert.rejects(entrar(a, PIN_G), { status: 401 })
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_G), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

for (const st of [429, 500, 502, 503]) test(`A4 · ${st} de la nube no es PIN inválido ni bypass`, async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.status = st
  assert.equal((await entrar(a, PIN_G)).offline, true, 'preparado entra offline')
  await assert.rejects(entrar(a, '9999'), { code: 'OFFLINE_USER_NOT_PREPARED' })
  await assert.rejects(entrar(a, PIN_M), { code: 'OFFLINE_USER_NOT_PREPARED' }, 'no preparado no entra')
  nube.status = 200
  assert.equal((await entrar(a, PIN_G)).offline, false, 'la credencial sigue viva: 5xx no revoca')
})

test('A5 · roster de OTRO restaurante se ignora', async () => {
  const a = crear(); await entrar(a, PIN_G); await entrar(a, PIN_M); await a.idle()
  nube.rosterCid = 'otro'; nube.roster = [{ id: 'g1', role: 'mesero' }]; now += 1000
  await entrar(a, PIN_M); await a.idle()
  nube.modo = 'caida'
  assert.equal((await entrar(a, PIN_G, CAJA, { minRole: 'gerente' })).staff.role, 'gerente')
})

test('A6 · roster sin cred_rev conserva (servidor viejo), con ids duplicados no sube rol', async () => {
  const a = crear(); await entrar(a, PIN_G); await entrar(a, PIN_M); await a.idle()
  nube.roster = [{ id: 'g1', role: 'gerente' }, { id: 'm1', role: 'mesero' }, { id: 'm1', role: 'admin' }]; now += 1000
  await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  assert.equal((await entrar(a, PIN_M)).staff.role, 'mesero')
  assert.equal((await entrar(a, PIN_G)).staff.role, 'gerente')
})

test('A7 · aprobación con minRole mayor al rol preparado → PERMISSION_DENIED, sin recibo', async () => {
  const a = crear(); await entrar(a, PIN_M); await a.idle(); nube.modo = 'caida'
  await assert.rejects(entrar(a, PIN_M, CAJA, { minRole: 'gerente', aprobacion: true }), { code: 'PERMISSION_DENIED' })
})

test('A8 · PIN con restaurantId distinto → scope inválido', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle(); nube.modo = 'caida'
  await assert.rejects(a.login({ pin: PIN_G, deviceId: CAJA, restaurantId: 'otro' }), { code: 'ACTOR_SCOPE_INVALID' })
})

test('A9 · carrera: 401 y login offline en paralelo — la revocada no entra después', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  delete nube.staff[PIN_G]
  // El primer intento llega a la nube (401); el segundo, encolado, ya corre sin red.
  let llamadas = 0
  const original = fetchFalso
  a.fetch = (u, i) => { if (u.endsWith('/api/pos/pin') && ++llamadas > 1) return Promise.reject(new TypeError('fetch failed')); return original(u, i) }
  const r = await Promise.allSettled([entrar(a, PIN_G), entrar(a, PIN_G)])
  assert.equal(r[0].status, 'rejected'); assert.equal(r[0].reason.status, 401)
  assert.equal(r[1].status, 'rejected', 'la revocada no entra en la carrera')
  nube.modo = 'caida'
  await assert.rejects(entrar(crear(), PIN_G))
})

test('A10 · reloj adelantado para vencer bloqueos: al regresarlo, nada se autoriza sin red', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle(); nube.modo = 'caida'
  for (let i = 0; i < 10; i++) await entrar(a, String(5000 + i)).catch(() => {})
  now += 3 * 86400000; await entrar(a, '5999').catch(() => {})
  now -= 3 * 86400000
  await assert.rejects(entrar(a, PIN_G))
  now += 3 * 86400000 // ni con el reloj al frente otra vez se salta la revisión de hora
  await assert.rejects(crear().login({ pin: PIN_G, deviceId: 'POS-OTRA', restaurantId: R }))
})
