'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { FinancialDomain } = require('../core/financial-domain')
const owner = { id: 'waiter-owner', permissions: ['pos.accounts.manage'] }
const otherWaiter = { id: 'another-waiter', permissions: ['pos.accounts.manage'] }
const supervisor = { id: 'cashier', permissions: ['pos.accounts.manage', 'ver_todas_cuentas'] }
const order = { id: 'order', order_id: 'order', authority: 'caja', created_by: owner.id, turno_id: 'turn',
  order_revision: 3, status: 'enviada', total_cents: 11600, items: [{ id: 'line', cantidad: 2, sent_quantity: 2 }],
  kitchen_items: [{ id: 'kitchen-line', cantidad: 2, preparation_status: 'enviada' }] }
const opening = { command_type: 'FINANCIAL_OPEN', order_id: 'order', turno_id: 'turn', expected_revision: 0,
  expected_order_revision: 3, total_cents: 11600, currency: 'MXN' }
const context = (actor = owner, saved = order) => ({ actor, order: saved, turno: { id: 'turn' } })
const open = (domain, actor = owner) => { const result = domain.prepare(opening, context(actor)); domain.apply(result.financial_order); return result }

test('saving but not sending cannot create accounts or freeze consumption', () => {
  const domain = new FinancialDomain()
  assert.throws(() => domain.prepare(opening, context(owner, { ...order, status: 'abierta', items: [{ id: 'line', cantidad: 2, sent_quantity: 0 }] })), { code: 'ORDER_SEND_REQUIRED' })
  assert.equal(domain.getOrder('order'), null)
})
test('adding unsent units after an earlier round also blocks financial opening', () => {
  const domain = new FinancialDomain()
  assert.throws(() => domain.prepare(opening, context(owner, { ...order, items: JSON.stringify([{ id: 'line', cantidad: 2, sent_quantity: 1 }]) })), { code: 'ORDER_SEND_REQUIRED' })
  assert.equal(domain.getOrder('order'), null)
})
test('missing or malformed send quantities are not interpreted as a sent order', () => {
  for (const items of [undefined, [], 'broken json', [{ cantidad: 2 }], [{ cantidad: 2, sent_quantity: '2' }], [{ cantidad: 2, sent_quantity: 3 }]]) {
    const domain = new FinancialDomain()
    assert.throws(() => domain.prepare(opening, context(owner, { ...order, items })), { code: 'ORDER_SEND_REQUIRED' })
    assert.equal(domain.getOrder('order'), null)
  }
})
test('fully sent but unprepared food can be paid without modifying kitchen state', () => {
  const domain = new FinancialDomain(), before = JSON.stringify(order)
  open(domain)
  let result = domain.prepare({ command_type: 'FINANCIAL_PAYMENT_START', order_id: 'order', expected_revision: 1,
    account_id: 'order:full', payment_id: 'cash', amount_cents: 11600, method: 'cash' }, context(supervisor))
  domain.apply(result.financial_order)
  result = domain.prepare({ command_type: 'FINANCIAL_PAYMENT_RESULT', order_id: 'order', expected_revision: 2,
    payment_id: 'cash', status: 'accepted', evidence: { kind: 'cash_received', received_by: supervisor.id, received_cents: 11600 } }, context(supervisor))
  assert.equal(result.financial_order.status, 'settled')
  assert.equal(JSON.stringify(order), before)
  assert.equal(order.kitchen_items[0].preparation_status, 'enviada')
})
test('a waiter can prepare their own account but cannot prepare another waiter account', () => {
  const domain = new FinancialDomain()
  assert.throws(() => open(domain, otherWaiter), { code: 'PERMISSION_DENIED' })
  assert.equal(domain.getOrder('order'), null)
  assert.equal(open(domain).financial_order.opened_by, owner.id)
})
test('ownership is rechecked for split, new reservation and payment outcome, with no financial mutation', () => {
  const domain = new FinancialDomain(); open(domain)
  const before = domain.getOrder('order')
  for (const payload of [
    { command_type: 'FINANCIAL_SPLIT', accounts: [{ account_id: 'A', total_cents: 5800 }, { account_id: 'B', total_cents: 5800 }] },
    { command_type: 'FINANCIAL_PAYMENT_START', account_id: 'order:full', payment_id: 'cash', amount_cents: 11600, method: 'cash' },
    { command_type: 'FINANCIAL_PAYMENT_RESULT', payment_id: 'cash', status: 'accepted', evidence: { kind: 'cash_received', received_by: otherWaiter.id, received_cents: 11600 } },
  ]) assert.throws(() => domain.prepare({ order_id: 'order', expected_revision: 1, ...payload }, context(otherWaiter)), { code: 'PERMISSION_DENIED' })
  assert.deepEqual(domain.getOrder('order'), before)
})
test('canonical access to all accounts permits cashier preparation and splitting across employees', () => {
  const domain = new FinancialDomain(); open(domain, supervisor)
  const result = domain.prepare({ command_type: 'FINANCIAL_SPLIT', order_id: 'order', expected_revision: 1,
    accounts: [{ account_id: 'A', total_cents: 5800 }, { account_id: 'B', total_cents: 5800 }] }, context(supervisor))
  assert.equal(result.financial_order.accounts.length, 2)
  assert.equal(result.financial_order.total_cents, 11600)
})
