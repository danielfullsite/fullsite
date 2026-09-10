'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { turnReport } = require('../core/turn-report')
const turno = { id:'overnight', opening_cash_cents:50000 }
const order = (id, paid, reserved, payments) => ({ order_id:id,turno_id:turno.id,total_cents:10000,paid_cents:paid,
  reserved_cents:reserved,balance_cents:10000-paid,payments })
const payment = (id,status,amount,method='cash') => ({ payment_id:id,status,amount_cents:amount,method,provider:'fixture' })
test('X includes partial receipts and paid kitchen orders, excludes unknown and rejected amounts', () => {
  const report=turnReport(turno,[order('partial',4000,1000,[payment('a','accepted',4000),payment('b','unknown',1000),payment('c','rejected',5000)]),
    order('preparing',10000,0,[payment('d','accepted',10000,'external')]),
    {...order('other',9000,0,[]),turno_id:'yesterday'}])
  assert.equal(report.total_paid_cents,14000)
  assert.equal(report.expected_cash_cents,54000)
  assert.equal(report.balance_cents,6000)
  assert.equal(report.reserved_cents,1000)
  assert.equal(report.settled_orders,1)
  assert.equal(report.open_orders,1)
  assert.deepEqual(report.payments_by_method,{cash:4000,'external:fixture':10000})
})
test('missing, corrupt or duplicate payments cannot become an apparently zero report', () => {
  assert.throws(()=>turnReport(null,[]))
  assert.throws(()=>turnReport(turno,[order('bad',9000,0,[])]),/MISMATCH/)
  assert.throws(()=>turnReport(turno,[order('dup',10000,0,[payment('same','accepted',5000),payment('same','accepted',5000)])]),/DUPLICATE/)
  assert.throws(()=>turnReport({...turno,opening_cash_cents:NaN},[]),/AMOUNT/)
})
test('report is non-mutating and groups by turno even across midnight', () => {
  const orders=[order('cross-midnight',10000,0,[payment('a','accepted',10000)])]
  const before=JSON.stringify(orders)
  assert.equal(turnReport(turno,orders).total_paid_cents,10000)
  assert.equal(JSON.stringify(orders),before)
})
test('X also includes consumption not yet prepared for payment, without double counting partial accounts', () => {
  const report=turnReport(turno,[order('partial',4000,0,[payment('a','accepted',4000)])],
    [{order_id:'partial',turno_id:turno.id,total_cents:10000},{order_id:'unsent',turno_id:turno.id,total_cents:2500}])
  assert.equal(report.balance_cents,8500)
  assert.equal(report.open_orders,2)
  assert.equal(report.unprepared_orders,1)
})
