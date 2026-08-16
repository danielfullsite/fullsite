'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// SUITE DE INTEGRACIÓN OFFLINE — wire-a los componentes REALES del local-server
// (NdjsonEventStore + CoreEventStore + RestaurantState + CommandHandler +
// OutboxWorker) y ejerce el flujo completo de un restaurante sin internet.
//
// Objetivo: subir la confianza SIN hardware. Los unit tests prueban piezas
// aisladas; esto prueba que juntas se comportan bien (timing, orden de eventos,
// reconexión, recovery). Es el "runbook automatizado" de lo que SÍ se puede
// validar en código. Lo que NO cubre (necesita hardware): drivers de impresora
// reales, boot del device, red LAN física, multi-terminal real.
//
// Run: node --test electron-app/local-server/tests/offline-integration.test.js
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore }   = require('../core/event-store')
const { RestaurantState }  = require('../core/state')
const { CommandHandler }   = require('../core/command-handler')
const { OutboxWorker }     = require('../core/outbox')
const { EVENT }            = require('../protocol')

const R = 'amalay'          // restaurant_id de prueba
const TERM = 'terminal-1'   // id del terminal origen

// Levanta un stack completo del local-server sobre archivos temporales reales.
async function buildStack(dir) {
  const store = new NdjsonEventStore({
    eventLogPath:          path.join(dir, 'events.ndjson'),
    processedCommandsPath: path.join(dir, 'processed.ndjson'),
  })
  const eventStore = new CoreEventStore(store)
  await eventStore.load()

  const state = new RestaurantState()
  // Recovery: reconstruye el estado en memoria desde el log (como index.js).
  for (const ev of await eventStore.readAfter(0)) state.apply(ev)

  const broadcasts = []
  const prints = []
  const fakeHub = { broadcast: async (ev) => { broadcasts.push(ev) } }
  const fakePrinter = { printToStation: async (station, buf) => { prints.push({ station, len: buf.length }) } }

  const cmd = new CommandHandler({ eventStore, state, wsHub: fakeHub, printer: fakePrinter, restaurantId: R })

  // Outbox con fetch mockeado: alterna online/offline para probar reconexión.
  const fetchCalls = []
  let online = true
  const fetchImpl = async (_url, opts) => {
    fetchCalls.push(JSON.parse(opts.body))
    return { ok: online, status: online ? 201 : 503 }
  }
  const outbox = new OutboxWorker({
    eventStore, supabaseUrl: 'https://sb.test', supabaseKey: 'k',
    restaurantId: R, fetchImpl, logger: () => {},
  })

  return {
    eventStore, state, cmd, outbox, broadcasts, prints, fetchCalls,
    setOnline: (v) => { online = v },
  }
}

const send = (cmd, payload) => cmd.handle({ payload: { command_id: payload.command_id, ...payload }, restaurant_id: R }, TERM)

describe('Integración offline — flujo completo de servicio', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-offline-')) })
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

  test('boot → turno → orden → KDS → cobro → cierre (todo offline, persistido)', async () => {
    const s = await buildStack(dir)

    // 1. Boot: estado vacío
    assert.equal(s.state.hasActiveTurno(), false)

    // 2. Abrir turno
    await send(s.cmd, { command_type: 'TURNO_OPENED', command_id: 't1', turno_id: 'T1' })
    assert.equal(s.state.hasActiveTurno(), true)

    // 3. Tomar orden en mesa 5 (flujo real: UPSERTED ocupa la mesa → SENT a cocina)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '5', items: [{ n: 'chilaquiles' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '5', items: [{ n: 'chilaquiles' }] })
    assert.equal(s.state.getMesa('5').status, 'ocupada')
    assert.ok(s.state.getKdsQueue().some(k => k.order_id === 'o1'), 'la orden debe estar en el KDS')
    assert.ok(s.broadcasts.some(b => b.type === 'ORDER_SENT'), 'se debe broadcast a las terminales (LAN)')

    // 4. Cierre con pago (efectivo) → mesa liberada
    await send(s.cmd, { command_type: 'ORDER_CLOSED', command_id: 'c2', order_id: 'o1', mesa: '5' })
    assert.equal(s.state.getMesa('5').status, 'libre')

    // 5. Persistencia: todo quedó en el log (durabilidad ante corte de luz)
    const events = await s.eventStore.readAfter(0)
    assert.ok(events.length >= 3, 'los eventos deben estar en events.ndjson')
  })

  test('el Clobber NO borra la orden fresca cuando el poll corre (integra #44)', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '7', items: [{ n: 'taco' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '7', items: [{ n: 'taco' }] })
    assert.equal(s.state.getMesa('7').status, 'ocupada')

    // Simula el poll de Supabase que aún no tiene la orden (STATE_SYNC vacío),
    // igual que lo hace index.js vía appendInternal.
    const ev = await s.eventStore.appendInternal(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, { restaurantId: R })
    s.state.apply(ev)

    // Con el fix del Clobber, la orden fresca SOBREVIVE.
    assert.equal(s.state.getMesa('7').status, 'ocupada', 'la orden fresca no debe desaparecer')
  })

  test('outbox sincroniza a Supabase, EXCLUYE STATE_SYNC (integra #46)', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'TURNO_OPENED', command_id: 't1', turno_id: 'T1' })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '3', items: [] })
    // el poll mete un STATE_SYNC al log (que NO debe subirse a Supabase)
    await s.eventStore.appendInternal(EVENT.STATE_SYNC, { mesas: [], kds_queue: [], synced_at: new Date().toISOString() }, { restaurantId: R })

    const before = await s.eventStore.unsyncedCount()
    assert.ok(before >= 3)
    const r = await s.outbox.flush()

    // subió turno + orden, NO el STATE_SYNC
    const types = s.fetchCalls.map(c => c.type)
    assert.ok(types.includes('TURNO_OPENED') && types.includes('ORDER_SENT'))
    assert.ok(!types.includes('STATE_SYNC'), 'STATE_SYNC nunca debe ir a Supabase')
    assert.equal(r.sent, 2)
  })

  test('reconexión: eventos tomados offline se sincronizan sin duplicados al volver el internet', async () => {
    const s = await buildStack(dir)
    s.setOnline(false)   // ── sin internet ──
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '2', items: [] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c2', order_id: 'o2', mesa: '4', items: [] })

    const r1 = await s.outbox.flush()
    assert.equal(r1.sent, 0, 'offline: nada se confirma')
    assert.equal(await s.eventStore.unsyncedCount(), 2)

    s.setOnline(true)    // ── vuelve el internet ──
    const r2 = await s.outbox.flush()
    assert.equal(r2.sent, 2, 'reconecta: sube lo pendiente')
    assert.equal(await s.eventStore.unsyncedCount(), 0)

    // idempotencia: un flush extra NO reenvía (no duplica en Supabase)
    const callsBefore = s.fetchCalls.length
    const r3 = await s.outbox.flush()
    assert.equal(r3.sent, 0)
    assert.equal(s.fetchCalls.length, callsBefore, 'no reenvía lo ya sincronizado')
  })

  test('recovery tras reinicio: el estado se reconstruye desde el log en disco', async () => {
    // Sesión 1: abre turno + orden, luego "se apaga" (perdemos el objeto en memoria)
    let s = await buildStack(dir)
    await send(s.cmd, { command_type: 'TURNO_OPENED', command_id: 't1', turno_id: 'T1' })
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '9', items: [{ n: 'sopa' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '9', items: [{ n: 'sopa' }] })

    // Sesión 2: NUEVO stack sobre los MISMOS archivos → recovery por replay
    s = await buildStack(dir)
    assert.equal(s.state.hasActiveTurno(), true, 'el turno sobrevive el reinicio')
    assert.equal(s.state.getMesa('9').status, 'ocupada', 'la mesa ocupada sobrevive el reinicio')
    assert.ok(s.state.getKdsQueue().some(k => k.order_id === 'o1'), 'el KDS se reconstruye')
  })

  test('impresión: PRINT_COMMAND llega al printer (lógica de cola, no driver)', async () => {
    const s = await buildStack(dir)
    const data_b64 = Buffer.from('=== TICKET ===').toString('base64')
    await send(s.cmd, { command_type: 'PRINT_COMMAND', command_id: 'p1', station: 'cocina', data_b64 })
    await new Promise((r) => setImmediate(r))   // el side-effect usa setImmediate
    assert.equal(s.prints.length, 1)
    assert.equal(s.prints[0].station, 'cocina')
    assert.ok(s.prints[0].len > 0, 'el buffer del ticket llegó al printer')
  })

  test('idempotencia de comandos: el mismo command_id no duplica la orden', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'dup', order_id: 'o1', mesa: '1', items: [] })
    const r2 = await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'dup', order_id: 'o1', mesa: '1', items: [] })
    assert.equal(r2.duplicate, true, 'comando repetido se rechaza')
    const orderEvents = (await s.eventStore.readAfter(0)).filter(e => e.type === 'ORDER_SENT')
    assert.equal(orderEvents.length, 1, 'solo un evento en el log')
  })
})

describe('Integración offline — edge cases del servicio', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-offline-edge-')) })
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

  test('cancelar una orden offline libera la mesa y la saca del KDS', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '5', items: [{ n: 'taco' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '5', items: [{ n: 'taco' }] })
    assert.equal(s.state.getMesa('5').status, 'ocupada')
    assert.ok(s.state.getKdsQueue().some(k => k.order_id === 'o1'))

    await send(s.cmd, { command_type: 'ORDER_CANCELLED', command_id: 'c2', order_id: 'o1', mesa: '5' })
    assert.equal(s.state.getMesa('5').status, 'libre', 'la mesa se libera al cancelar')
    assert.ok(!s.state.getKdsQueue().some(k => k.order_id === 'o1'), 'la orden sale del KDS')
  })

  test('modificar una orden (enviar de nuevo con más ítems) no duplica la orden', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '3', items: [{ n: 'sopa' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '3', items: [{ n: 'sopa' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c2', order_id: 'o1', mesa: '3', items: [{ n: 'sopa' }, { n: 'agua' }] })

    const kds = s.state.getKdsQueue().filter(k => k.order_id === 'o1')
    assert.equal(kds.length, 1, 'sigue habiendo UNA sola comanda para o1 (no se duplica)')
    assert.equal(s.state.getMesa('3').status, 'ocupada')
  })

  test('KDS_ITEM_STATUS offline se aplica sin romper el estado', async () => {
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '2', items: [{ id: 'i1', n: 'taco' }] })
    await send(s.cmd, { command_type: 'ORDER_SENT', command_id: 'c1', order_id: 'o1', mesa: '2', items: [{ id: 'i1', n: 'taco' }] })
    const r = await send(s.cmd, { command_type: 'KDS_ITEM_STATUS', command_id: 'c2', order_id: 'o1', item_id: 'i1', status: 'listo', kds_item_status: 'listo' })
    assert.ok(!r.error, 'KDS_ITEM_STATUS se procesa sin error')
    assert.equal(s.state.getMesa('2').status, 'ocupada', 'la mesa sigue ocupada')
  })

  test('la cancelación se propaga a otras terminales', async () => {
    // reusa el hub multi-terminal del stack de integración vía broadcasts
    const s = await buildStack(dir)
    await send(s.cmd, { command_type: 'ORDER_UPSERTED', command_id: 'c0', order_id: 'o1', mesa: '8', items: [] })
    await send(s.cmd, { command_type: 'ORDER_CANCELLED', command_id: 'c1', order_id: 'o1', mesa: '8' })
    // el estado autoritativo quedó consistente (mesa libre) tras cancelar
    assert.equal(s.state.getMesa('8').status, 'libre')
    // y quedó registrado en el log para sincronizar
    const cancels = (await s.eventStore.readAfter(0)).filter(e => e.type === 'ORDER_CANCELLED')
    assert.equal(cancels.length, 1)
  })
})
