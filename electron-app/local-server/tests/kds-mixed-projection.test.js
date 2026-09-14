'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')

function loadAdapter() {
  // Git for Windows checks the fixture out with CRLF. Normalize before applying
  // the structural matcher so this regression test exercises adaptOrders on the
  // same source in macOS, Linux and the Windows packaging runner.
  const html = fs.readFileSync(path.join(__dirname, '../kds-ui.html'), 'utf8').replace(/\r\n/g, '\n')
  const source = html.match(/  function adaptOrders\(data\)\{[\s\S]*?\n  \}\n\n  function fetchState/)
  assert.ok(source, 'adaptOrders must remain extractable for the projection regression test')
  const fn = source[0].replace(/\n\n  function fetchState$/, '\nreturn adaptOrders')
  return vm.runInNewContext(`(function(){${fn}})()`)
}

test('KDS preserves untouched legacy tickets after the first authoritative kitchen update', () => {
  const adaptOrders = loadAdapter()
  const updated = {
    id: 'order-7', order_id: 'order-7', mesa: 7, authority: 'caja',
    status: 'preparando', kitchen_revision: 1, items: '[]',
  }
  const legacy = [
    { order_id: 'order-1', mesa: 1, items_sent: [{ id: 'guacamole' }], sent_at: 1 },
    { order_id: 'order-7', mesa: 7, items_sent: [{ id: 'panque' }], sent_at: 2 },
    { order_id: 'order-43', mesa: 43, items_sent: [{ id: 'chocolatin' }], sent_at: 3 },
  ]

  const visible = adaptOrders({ kds_orders: [updated], kds_queue: legacy })

  assert.deepEqual(Array.from(visible, order => order.id).sort(), ['order-1', 'order-43', 'order-7'])
  assert.equal(visible.filter(order => order.id === 'order-7').length, 1, 'updated order is deduplicated')
  assert.equal(visible.find(order => order.id === 'order-7').status, 'preparando', 'authoritative order wins')
})
