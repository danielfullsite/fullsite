'use strict'
// Revisión adversarial independiente del bloque POS (2026-09-24) — lado Caja.
//
// Cada prueba es la COPIA INVERTIDA de un ataque que el revisor reprodujo contra 917131c4
// (afirmaba el comportamiento inseguro; aquí se afirma la defensa). Se vieron fallar contra ese
// commit antes de los arreglos del PR 05. E2 (restaurar el archivo sellado viejo) queda como
// riesgo residual documentado: exige escribir en la carpeta de la Caja y no se cierra sin un
// contador monotónico fuera de ella.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { ActorAuthority } = require('../core/actor-authority')
const { protectorDePrueba } = require('../core/protector-so')

const R = 'lab', B = 'branch-A', CAJA = 'POS-CAJA'
const GERENTE = { id: 'gerente-1', name: 'Gerente', role: 'gerente' }
const MESERO = { id: 'mesero-1', name: 'Mesero', role: 'mesero' }
const PIN_G = '4102', PIN_M = '4101'
let dir, now, nube
const protector = protectorDePrueba('revision-adversarial')

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-rev-adv-'))
  now = 1_800_000_000_000
  nube = { modo: 'ok', staff: { [PIN_G]: GERENTE, [PIN_M]: MESERO }, roster: null, rosterDelay: null, asOf: 1000, revs: {}, hora: null }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const conHora = (body, init) => {
  const r = Response.json(body, init)
  r.headers.set('date', new Date(nube.hora ?? now).toUTCString())
  return r
}
function fetchFalso(url, init = {}) {
  if (nube.modo === 'caida') return Promise.reject(new TypeError('fetch failed'))
  if (url.endsWith('/api/pos/pin')) {
    const b = JSON.parse(init.body)
    const s = nube.staff[b.pin]
    if (!s) return Promise.resolve(conHora({ error: 'PIN incorrecto' }, { status: 401 }))
    const rev = nube.revs[s.id] ?? 'rev-' + b.pin
    // Como la nube real desde el PR 05: una aprobación NO trae shiftToken.
    return Promise.resolve(conHora({ staff: s, cred_rev: rev, ...(b.aprobacion ? { approvalToken: 'aprob-' + s.id } : { shiftToken: 'sesion8h-' + s.id }) }))
  }
  if (url.endsWith('/api/pos/staff-roster')) {
    const lista = nube.roster ?? Object.entries(nube.staff).map(([pin, s]) => ({ id: s.id, role: s.role, cred_rev: nube.revs[s.id] ?? 'rev-' + pin }))
    const snap = JSON.parse(JSON.stringify(lista))
    const asOf = ++nube.asOf
    const resp = () => Response.json({ client_id: R, staff: snap, as_of: asOf })
    return nube.rosterDelay ? nube.rosterDelay.then(resp) : Promise.resolve(resp())
  }
  if (url.endsWith('/api/pos/terminal-receipt-key')) {
    const b = JSON.parse(init.body)
    return Promise.resolve(Response.json({ kid: 'v1', key: 'ab'.repeat(32), device_id: b.device_id }))
  }
  return Promise.resolve(new Response('{}', { status: 404 }))
}
const crear = (o = {}) => new ActorAuthority({ directory: dir, restaurantId: R, branchId: B, now: () => now,
  fetchImpl: fetchFalso, protector, terminalId: CAJA, ...o })
const entrar = (a, pin, deviceId = CAJA, extra = {}) => a.login({ pin, deviceId, restaurantId: R, ...extra })

test('E1 · intercalar el propio PIN ya NO reinicia el presupuesto: la fuerza bruta offline se bloquea', async () => {
  const a = crear()
  await entrar(a, PIN_G); await entrar(a, PIN_M); await a.idle()
  nube.modo = 'caida'
  let intentos = 0, encontrado = null, bloqueos = 0
  for (let p = 0; p < 10000 && !encontrado && bloqueos < 50; p++) {
    const cand = String(p).padStart(4, '0')
    if (cand === PIN_M) continue
    try { const r = await entrar(a, cand); if (r.staff.role === 'gerente') encontrado = cand } catch (e) { if (e.status === 429) bloqueos++ }
    intentos++
    if (intentos % 9 === 0) await entrar(a, PIN_M).catch(() => {})
  }
  assert.equal(encontrado, null, 'no debe encontrar el PIN del gerente')
  assert(bloqueos > 0, 'debe bloquear')
})

test('E1 · el bloqueo ESCALA: cada reincidencia duplica la espera', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  const agotar = async () => { for (let i = 0; i < 10; i++) await entrar(a, String(5000 + i)).catch(() => {}) }
  await agotar()
  await assert.rejects(entrar(a, PIN_G), { status: 429 })
  now += 10 * 60000 + 1000
  assert.equal((await entrar(a, PIN_G)).offline, true, 'tras 10 min vuelve a entrar')
  await agotar()
  now += 10 * 60000 + 1000
  await assert.rejects(entrar(a, PIN_G), { status: 429 }, 'la segunda vez son 20 min, no 10')
  now += 10 * 60000
  assert.equal((await entrar(a, PIN_G)).offline, true)
})

// Segunda revisión adversarial (2026-09-25): el olvido de reincidencias se contaba desde el
// INICIO del último bloqueo; al llegar al tope de 24 h, vencerlo ya cumplía el olvido y la
// escalada volvía a 10 min. Atacante paciente sin red, en la terminal del gerente, durante
// toda la vigencia de la credencial (7 días), reiniciando Pedro de vez en cuando.
test('E1c · la escalada no se reinicia al tope: intentos offline acotados en 7 días', async () => {
  let a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  const fin = now + 7 * 86400000 - 60000
  let intentos = 0, p = 0
  while (now < fin) {
    try { await entrar(a, String(1000 + (p++ % 3000))); intentos++ } catch (e) {
      if (e.status === 429) {
        const b = [a.data.bloqueos[CAJA], a.data.bloqueos['*']].filter(x => x && x.hasta > now)[0]
        now = b.hasta + 1; continue
      }
      intentos++
    }
    if (intentos % 50 === 0) a = crear()
  }
  // 8 escalones (10 min … 21 h 20 min) + bloqueos de 24 h hasta completar 7 días ≈ 13 × 10.
  assert(intentos <= 150, `intentos offline en 7 días: ${intentos}`)
})

test('E1c · tras 24 h SIN bloqueo el historial sí se olvida', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  const agotar = async () => { for (let i = 0; i < 10; i++) await entrar(a, String(5000 + i)).catch(() => {}) }
  await agotar(); now += 10 * 60000 + 1000
  await agotar(); now += 20 * 60000 + 1000
  now += 24 * 3600000 + 1000
  await agotar()
  now += 10 * 60000 + 1000
  assert.equal((await entrar(a, PIN_G)).offline, true, 'vuelve a 10 min')
})

test('E1b · rotar la terminal declarada tampoco da intentos sin fin (bloqueo de instalación)', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  let rechazos = 0, bloqueos = 0
  for (let i = 0; i < 60; i++) {
    try { await entrar(a, String(5000 + i), 'T-' + i) } catch (e) { if (e.status === 429) bloqueos++; else rechazos++ }
  }
  assert(rechazos <= 30, `a lo más 30 rechazos antes de bloquear la instalación (${rechazos})`)
  assert(bloqueos >= 30)
})

test('E3 · un roster VIEJO que llega tarde no vuelve a subir a un gerente degradado', async () => {
  const a = crear()
  await entrar(a, PIN_G); await a.idle()
  let soltar; nube.rosterDelay = new Promise(r => { soltar = r })
  await entrar(a, PIN_M)
  nube.rosterDelay = null
  nube.staff[PIN_G] = { ...GERENTE, role: 'mesero' }
  now += 1000
  assert.equal((await entrar(a, PIN_G)).staff.role, 'mesero')
  await new Promise(r => setTimeout(r, 20))
  soltar(); await a.idle()
  nube.modo = 'caida'; now += 1000
  await assert.rejects(entrar(a, PIN_G, CAJA, { minRole: 'gerente' }), { code: 'PERMISSION_DENIED' })
})

test('E3 · el roster nunca SUBE un rol', async () => {
  const a = crear(); await entrar(a, PIN_M); await a.idle()
  nube.roster = [{ id: MESERO.id, role: 'admin', cred_rev: 'rev-' + PIN_M }, { id: GERENTE.id, role: 'gerente', cred_rev: 'rev-' + PIN_G }]
  now += 1000
  await entrar(a, PIN_G); await a.idle()
  nube.modo = 'caida'
  assert.equal((await entrar(crear(), PIN_M)).staff.role, 'mesero')
})

test('E4 · una APROBACIÓN no deja sesión: ni actor_token ni shiftToken', async () => {
  const a = crear()
  await entrar(a, PIN_G); await a.idle()
  const r = await entrar(a, PIN_G, 'POS-MESERO', { minRole: 'gerente', aprobacion: true })
  assert.equal(r.actor_token, undefined)
  assert.equal(r.shiftToken, undefined)
  assert.equal(r.approvalToken, 'aprob-' + GERENTE.id)
  nube.modo = 'caida'
  const off = await entrar(a, PIN_G, CAJA, { minRole: 'gerente', aprobacion: true })
  assert.equal(off.actor_token, undefined)
})

test('E5 · restablecer el PIN llega a la Caja: el PIN viejo deja de entrar offline', async () => {
  const a = crear()
  await entrar(a, PIN_G); await a.idle()
  delete nube.staff[PIN_G]; nube.staff['7777'] = GERENTE; nube.revs[GERENTE.id] = 'rev-7777'
  now += 60_000
  await entrar(a, PIN_M); await a.idle()   // el roster trae la revisión nueva
  nube.modo = 'caida'; now += 3 * 86400000
  await assert.rejects(entrar(a, PIN_G, CAJA, { minRole: 'gerente' }), { code: 'OFFLINE_USER_NOT_PREPARED' })
})

test('E6 · un roster VACÍO no borra a nadie', async () => {
  const a = crear()
  await entrar(a, PIN_G); await entrar(a, PIN_M); await a.idle()
  nube.roster = []
  now += 1000
  await entrar(a, PIN_G); await a.idle()
  assert.equal(a.status().prepared_users, 2)
})

test('E6 · un roster que borraría a la mayoría (≥ 4 preparados) se trata como roto', async () => {
  const personas = ['4201', '4202', '4203', '4204'].map((pin, i) => [pin, { id: 'p' + i, name: 'P' + i, role: 'mesero' }])
  for (const [pin, s] of personas) nube.staff[pin] = s
  const a = crear()
  for (const [pin] of personas) await entrar(a, pin)
  await entrar(a, PIN_G); await a.idle()
  nube.roster = [{ id: GERENTE.id, role: 'gerente', cred_rev: 'rev-' + PIN_G }, { id: 'p0', role: 'mesero', cred_rev: 'rev-4201' }]
  now += 1000
  await entrar(a, PIN_G); await a.idle()
  assert(a.status().prepared_users >= 5, 'no se aplica un roster que borra a 4 de 6')
})

test('E7 · reloj adelantado y luego corregido: con red y la hora de la nube, la Caja se re-ancla', async () => {
  const a = crear()
  await entrar(a, PIN_G); await a.idle()
  now += 5 * 86400000
  await entrar(a, PIN_G); await a.idle()
  now -= 5 * 86400000 - 60_000
  const r = await entrar(a, PIN_G)
  assert.equal(r.offline, false, 'con red y hora confirmada, entra')
  const b = crear()
  nube.modo = 'caida'
  assert.equal((await entrar(b, PIN_G)).offline, true, 'y tras reiniciar, también sin red')
})

test('E7 · con el reloj dudoso y SIN red no se autoriza nada', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  now += 5 * 86400000; await entrar(a, PIN_G); await a.idle()
  now -= 5 * 86400000 - 60_000
  nube.modo = 'caida'
  await assert.rejects(entrar(a, PIN_G), { code: 'ACTOR_CLOCK_INVALID' })
})

test('E7 · si la hora de la nube NO cuadra con la local, tampoco se re-ancla', async () => {
  const a = crear(); await entrar(a, PIN_G); await a.idle()
  now += 5 * 86400000; await entrar(a, PIN_G); await a.idle()
  now -= 5 * 86400000 - 60_000
  nube.hora = now + 2 * 86400000
  await assert.rejects(entrar(a, PIN_G), { code: 'ACTOR_CLOCK_INVALID' })
})

test('V2 · la Caja sólo pide la llave de recibos para SU terminal', async () => {
  const pedidos = []
  const a = crear({ fetchImpl: (u, i) => { if (u.endsWith('/terminal-receipt-key')) pedidos.push(JSON.parse(i.body)); return fetchFalso(u, i) } })
  await entrar(a, PIN_G, 'POS-ENTRADA'); await a.idle()
  assert.equal(pedidos.length, 0, 'un gerente en OTRA terminal no dispara el pedido')
  await entrar(a, PIN_G, CAJA); await a.idle()
  assert.deepEqual(pedidos, [{ device_id: CAJA }])
})
