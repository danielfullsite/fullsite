'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { permissionsFor } = require('../core/actor-authority')
const { summarizeCash } = require('../core/cash-movements')
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-cash-ledger-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let count = 0
  const actor = { id: 'cash-manager', permissions: permissionsFor('gerente'), expires_at: Date.now() + 600000 }
  const restart = async () => {
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
    await store.load()
    const state = new RestaurantState({ localAuthorityEnabled: true })
    for (const event of await store.readAfter(0)) state.apply(event)
    const handler = new CommandHandler({ eventStore: store, state, restaurantId: 'cash-lab', localAuthorityEnabled: true, wsHub: { async broadcast() {} } })
    const send = (type, fields = {}, employee = actor) => handler.handle({ restaurant_id: 'cash-lab', payload: {
      command_type: type, command_id: `cash-${++count}`, turno_id: 'shift', ...fields,
    } }, 'pos-lab', { actor: employee })
    const move = (id, type, amount, extra = {}, employee) => send('CASH_MOVEMENT', { movement_id: id, type, amount_cents: amount, reason: 'Operación sintética verificada', ...extra }, employee)
    return { actor, state, store, send, move, restart }
  }
  const stack = await restart()
  assert.ok((await stack.send('TURN_OPEN', { opening_cash_cents: 50000 })).event)
  return stack
}
test('deposit and withdrawal survive lost ACK, restart and replay; X/Z share the same ledger', async t => {
  let s = await setup(t)
  const deposit = await s.move('deposit', 'deposito', 10000, { command_id: 'stable-deposit' })
  assert.ok(deposit.event, JSON.stringify(deposit))
  assert.equal((await s.move('withdrawal', 'retiro', 15000)).result.cash_summary.expected_cash_cents, 45000)
  s = await s.restart()
  assert.equal((await s.move('deposit', 'deposito', 10000, { command_id: 'stable-deposit' })).duplicate, true)
  assert.equal(s.state.getCashMovements().length, 2)
  const replica = new RestaurantState()
  replica.hidratarDesdeSnapshot(s.state.toSnapshot())
  assert.deepEqual(replica.getCashMovements(), s.state.getCashMovements())
  const closed = await s.send('TURN_CLOSE', { counted_cash_cents: 44900, notes: 'Faltante contado de un peso' })
  assert.deepEqual([closed.result.closed_turno.expected_cash_cents, closed.result.closed_turno.difference_cents], [45000, -100])
  assert.equal(closed.result.closed_turno.cash_deposits_cents, 10000)
  assert.equal(closed.result.closed_turno.cash_withdrawals_cents, 15000)
  s = await s.restart()
  assert.equal(s.state.toSnapshot().turn_summaries[0].difference_cents, -100)
  assert.equal((await s.move('after-close', 'deposito', 100)).code, 'TURNO_MISMATCH')
})
test('concurrent withdrawals cannot overdraw the drawer; author and movement identity cannot be forged', async t => {
  const s = await setup(t)
  const results = await Promise.all([s.move('a', 'retiro', 30000), s.move('b', 'retiro', 30000)])
  assert.equal(results.filter(r => r.event).length, 1)
  assert.equal(results.filter(r => r.code === 'INSUFFICIENT_DRAWER_CASH').length, 1)
  const saved = s.state.getCashMovements()[0]
  assert.equal((await s.move(saved.movement_id, 'retiro', 1)).code, 'CASH_MOVEMENT_ID_CONFLICT')
  assert.equal((await s.move('forged', 'deposito', 100, { actor: 'someone-else' })).code, 'INVALID_CASH_MOVEMENT')
  const employee = { ...s.actor, id: 'waiter', permissions: permissionsFor('mesero') }
  assert.equal((await s.move('denied', 'deposito', 100, {}, employee)).code, 'PERMISSION_DENIED')
  assert.equal(s.state.getCashMovements().length, 1)
  assert.equal(saved.actor, s.actor.id)
})
test('cash summary separates tips, cards, unknown payments and other shifts from drawer money', () => {
  const rows = [{ turno_id: 'shift', payments: [
    { amount_cents: 3000, tip_cents: 300, method: 'cash', status: 'accepted' },
    { amount_cents: 4000, tip_cents: 400, method: 'manual', status: 'accepted' },
    { amount_cents: 5000, method: 'cash', status: 'unknown' },
  ] }, { turno_id: 'yesterday', payments: [{ amount_cents: 999, method: 'cash', status: 'accepted' }] }]
  const result = summarizeCash({ id: 'shift', opening_cash_cents: 50000 }, rows, [
    { movement_id: 'd', turno_id: 'shift', type: 'deposito', amount_cents: 1000 },
    { movement_id: 'r', turno_id: 'shift', type: 'retiro', amount_cents: 2000 },
  ])
  assert.equal(result.expected_cash_cents, 52300)
  assert.equal(result.cash_sales_cents, 3000); assert.equal(result.cash_tip_cents, 300)
})
