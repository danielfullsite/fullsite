'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { FinancialDomain } = require('../core/financial-domain')

function setup(orderId = 'order-1', total = 10000) {
  const domain = new FinancialDomain()
  const context = { order: { order_id: orderId, total_cents: total, turno_id: 'turno-1', order_revision: 4, status: 'enviada' }, turno: { id: 'turno-1' } }
  const execute = (type, payload = {}) => {
    const result = domain.prepare({ command_type: type, order_id: orderId, expected_revision: domain.getOrder(orderId)?.revision ?? 0, ...payload }, context)
    domain.apply(result.financial_order)
    return result
  }
  execute('FINANCIAL_OPEN', { turno_id: 'turno-1', expected_order_revision: 4, currency: 'MXN', total_cents: total })
  return { domain, execute, context }
}
const cash = amount => ({ kind: 'cash_received', received_by: 'cashier-1', received_cents: amount })
const provider = (status, reference, amount = 10000) => ({ kind: 'provider_result', provider: 'test-terminal', status, reference, amount_cents: amount, currency: 'MXN' })

test('accounts are fully defined before collection; partial payments and change use integer cents', () => {
  const { domain, execute } = setup()
  execute('FINANCIAL_SPLIT', { accounts: [{ account_id: 'A', total_cents: 5000 }, { account_id: 'B', total_cents: 5000 }] })
  execute('FINANCIAL_PAYMENT_START', { account_id: 'A', payment_id: 'pay-A-1', amount_cents: 2500, method: 'cash' })
  let order = domain.getOrder('order-1')
  assert.equal(order.accounts.length, 2)
  assert.equal(order.paid_cents, 0)
  assert.equal(order.reserved_cents, 2500)
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'pay-A-1', status: 'accepted', evidence: cash(5000) })
  order = domain.getOrder('order-1')
  assert.equal(order.paid_cents, 2500)
  assert.equal(order.balance_cents, 7500)
  assert.equal(order.payments[0].change_cents, 2500)
  assert.equal(order.accounts[0].balance_cents, 2500)
  assert.equal(order.accounts[1].balance_cents, 5000)
  assert.equal(order.status, 'open')
  assert.throws(() => execute('FINANCIAL_SPLIT', { accounts: [{ account_id: 'C', total_cents: 10000 }, { account_id: 'D', total_cents: 1 }] }), { code: 'SPLIT_HAS_PAYMENTS' })
})

test('unknown provider outcomes reserve balance, block another attempt and never count as paid', () => {
  const { domain, execute } = setup()
  execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'external-1', amount_cents: 10000, method: 'external', provider: 'test-terminal' })
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'external-1', status: 'unknown', evidence: provider('unknown', 'request-1') })
  assert.equal(domain.getOrder('order-1').paid_cents, 0)
  assert.equal(domain.getOrder('order-1').reserved_cents, 10000)
  assert.throws(() => execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'cash-2', amount_cents: 10000, method: 'cash' }), { code: 'OVERPAYMENT' })
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'external-1', status: 'accepted', evidence: provider('accepted', 'auth-1') })
  assert.equal(domain.getOrder('order-1').status, 'settled')
  assert.equal(domain.getOrder('order-1').balance_cents, 0)
})

test('rejection releases reservation; final results cannot reverse without a distinct refund operation', () => {
  const { domain, execute } = setup()
  execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'p1', amount_cents: 10000, method: 'external', provider: 'test-terminal' })
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', status: 'rejected', evidence: provider('rejected', 'decline-1') })
  assert.equal(domain.getOrder('order-1').reserved_cents, 0)
  assert.throws(() => execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', status: 'accepted', evidence: provider('accepted', 'auth-1') }), { code: 'PAYMENT_FINAL' })
  execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'p2', amount_cents: 10000, method: 'cash' })
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p2', status: 'accepted', evidence: cash(10000) })
  assert.equal(domain.getOrder('order-1').paid_cents, 10000)
})

test('repeated payment ID is the same attempt, but different amounts or outcomes conflict', () => {
  const { domain, execute } = setup()
  const start = { account_id: 'order-1:full', payment_id: 'p1', amount_cents: 10000, method: 'cash' }
  execute('FINANCIAL_PAYMENT_START', start)
  execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', status: 'accepted', evidence: cash(10000) })
  const before = domain.getOrder('order-1')
  assert.equal(execute('FINANCIAL_PAYMENT_START', { ...start, expected_revision: 1 }).repeated_payment, true)
  assert.equal(execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', expected_revision: 1, status: 'accepted', evidence: cash(10000) }).repeated_payment, true)
  assert.deepEqual(domain.getOrder('order-1'), before)
  assert.throws(() => execute('FINANCIAL_PAYMENT_START', { ...start, amount_cents: 9999 }), { code: 'PAYMENT_ID_REUSED' })
  assert.throws(() => execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', status: 'accepted', evidence: cash(10001) }), { code: 'PAYMENT_FINAL' })
})

test('safe cents, nonempty accounts, exact split totals and revisions reject malformed values', () => {
  for (const amount of [NaN, Infinity, -1, 0, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    const { execute } = setup()
    assert.throws(() => execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'bad', amount_cents: amount, method: 'cash' }), { code: 'INVALID_CENTS' })
  }
  const { execute } = setup()
  assert.throws(() => execute('FINANCIAL_SPLIT', { accounts: [{ account_id: 'A', total_cents: 5000 }, { account_id: 'B', total_cents: 4999 }] }), { code: 'ACCOUNT_TOTAL_MISMATCH' })
  assert.throws(() => execute('FINANCIAL_SPLIT', { accounts: [{ account_id: 'A', total_cents: 5000 }, { account_id: 'A', total_cents: 5000 }] }), { code: 'INVALID_SPLIT' })
  assert.throws(() => execute('FINANCIAL_PAYMENT_START', { expected_revision: 0, account_id: 'order-1:full', payment_id: 'p', amount_cents: 1, method: 'cash' }), { code: 'FINANCIAL_REVISION_CONFLICT' })
})

test('opening finance binds saved order amount, revision and current shift; never trusts a zero placeholder', () => {
  const { context } = setup()
  const open = { command_type: 'FINANCIAL_OPEN', order_id: 'order-1', expected_revision: 0, expected_order_revision: 4, total_cents: 10000, turno_id: 'turno-1', currency: 'MXN' }
  const domain = new FinancialDomain()
  assert.throws(() => domain.prepare({ ...open, total_cents: 0 }, context), { code: 'INVALID_CENTS' })
  assert.throws(() => domain.prepare({ ...open, total_cents: 9900 }, context), { code: 'ORDER_TOTAL_CONFLICT' })
  assert.throws(() => domain.prepare({ ...open, expected_order_revision: 3 }, context), { code: 'ORDER_REVISION_CONFLICT' })
  assert.throws(() => domain.prepare({ ...open, turno_id: 'old-shift' }, context), { code: 'TURNO_MISMATCH' })
  assert.throws(() => domain.prepare(open, { ...context, order: { ...context.order, total_cents: NaN } }), { code: 'INVALID_CENTS' })
})

test('provider outcomes require matching amount, currency, provider and a reference', () => {
  const { execute } = setup()
  execute('FINANCIAL_PAYMENT_START', { account_id: 'order-1:full', payment_id: 'p1', amount_cents: 10000, method: 'external', provider: 'test-terminal' })
  for (const evidence of [undefined, {}, { ...provider('accepted', 'ref'), provider: 'another' }, { ...provider('accepted', 'ref'), reference: '' }, { ...provider('accepted', 'ref'), amount_cents: 1 }, { ...provider('accepted', 'ref'), currency: 'USD' }]) {
    assert.throws(() => execute('FINANCIAL_PAYMENT_RESULT', { payment_id: 'p1', status: 'accepted', evidence }))
  }
})

test('snapshot reconstructs amounts from validated payments; malformed financial data cannot erase debt', () => {
  const { domain } = setup()
  const fake = domain.getOrder('order-1')
  fake.status = 'settled'; fake.balance_cents = 0; fake.paid_cents = 10000
  const restored = new FinancialDomain(); restored.hydrate([fake])
  assert.equal(restored.getOrder('order-1').balance_cents, 10000)
  assert.equal(restored.getOrder('order-1').status, 'open')
  assert.throws(() => restored.hydrate([{ ...fake, accounts: [] }]), { code: 'INVALID_FINANCIAL_SNAPSHOT' })
  assert.equal(restored.getOrder('order-1').balance_cents, 10000)
})

test('the same payment identity or provider authorization cannot settle two mother orders', () => {
  const domain = new FinancialDomain()
  function run(orderId, type, payload) {
    const result = domain.prepare({ command_type: type, order_id: orderId, expected_revision: domain.getOrder(orderId)?.revision ?? 0, ...payload }, {
      order: { order_id: orderId, total_cents: 10000, order_revision: 1, turno_id: 't1' }, turno: { id: 't1' },
    })
    domain.apply(result.financial_order)
  }
  for (const orderId of ['o1', 'o2']) run(orderId, 'FINANCIAL_OPEN', { expected_order_revision: 1, total_cents: 10000, turno_id: 't1', currency: 'MXN' })
  run('o1', 'FINANCIAL_PAYMENT_START', { account_id: 'o1:full', payment_id: 'payment-1', method: 'external', provider: 'test-terminal', amount_cents: 10000 })
  assert.throws(() => run('o2', 'FINANCIAL_PAYMENT_START', { account_id: 'o2:full', payment_id: 'payment-1', method: 'external', provider: 'test-terminal', amount_cents: 10000 }), { code: 'PAYMENT_ID_REUSED' })
  run('o1', 'FINANCIAL_PAYMENT_RESULT', { payment_id: 'payment-1', status: 'accepted', evidence: provider('accepted', 'unique-auth') })
  run('o2', 'FINANCIAL_PAYMENT_START', { account_id: 'o2:full', payment_id: 'payment-2', method: 'external', provider: 'test-terminal', amount_cents: 10000 })
  assert.throws(() => run('o2', 'FINANCIAL_PAYMENT_RESULT', { payment_id: 'payment-2', status: 'accepted', evidence: provider('accepted', 'unique-auth') }), { code: 'PROVIDER_REFERENCE_REUSED' })
  assert.equal(domain.getOrder('o2').paid_cents, 0)
})

test('missing operational revision cannot be invented as zero to authorize a payment', () => {
  const domain = new FinancialDomain()
  const payload = { command_type: 'FINANCIAL_OPEN', order_id: 'legacy', turno_id: 't1', expected_revision: 0, expected_order_revision: 0, total_cents: 10000, currency: 'MXN' }
  assert.throws(() => domain.prepare(payload, {
    order: { id: 'legacy', total: 100, turno_id: 't1' }, turno: { id: 't1' },
  }), { code: 'ORDER_REVISION_REQUIRED' })
})
