'use strict'

// Read-only reproductions against the frozen candidate. No network, browser,
// credentials, or candidate files are written. Fetch is always a stub.
// Run: node /Users/danielrg/fullsite/.codex/worktrees/architecture-closure-20260904/docs/audit/evidence-20260904/pos-projection-repro.cjs
const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const path = require('node:path')
const SOURCE = '/Users/danielrg/fullsite/.codex/worktrees/architecture-source-de904d71'
if (require('node:child_process').execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== 'de904d71ed0288375bd3a752579d2e2929df61c0') throw new Error('Candidate SHA changed; revalidate before running this diagnostic.')
const ts = require(path.join(SOURCE, 'dashboard-app/node_modules/typescript'))
const { RestaurantState } = require(path.join(SOURCE, 'electron-app/local-server/core/state'))
const { EVENT } = require(path.join(SOURCE, 'electron-app/local-server/protocol'))

function loadTs(relativeFile, mocks, globals) {
  const file = path.join(SOURCE, relativeFile)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const sandbox = { ...globals, exports: {}, require: id => {
    if (id in mocks) return mocks[id]
    throw new Error('Unexpected dependency: ' + id)
  } }
  vm.runInNewContext(code, sandbox, { filename: file })
  return sandbox.exports
}

function report(scenario, evidence) {
  console.log(JSON.stringify({ scenario, evidence }))
}

async function main() {
  const stored = new Map([
    ['FULLSITE_LAN_SECRET', 'test-only-secret'],
    ['fullsite_client_id', 'sandbox-lab'],
    ['FULLSITE_TERMINAL_ID', 'POS-B'],
  ])
  const fetchCalls = []
  const network = loadTs('dashboard-app/src/lib/local-network-fetch.ts', {}, {
    URL, Request, TypeError, console,
    localStorage: { getItem: key => stored.get(key) || null },
    fetch: async (input, init) => {
      fetchCalls.push(init)
      if (fetchCalls.length === 1) {
        throw new TypeError('loopback is not a valid value for targetAddressSpace')
      }
      return { status: init.headers?.['x-fullsite-lan'] ? 200 : 401 }
    },
  })
  const result = await network.localNetworkFetch('http://127.0.0.1:7717/state')
  assert.ok(fetchCalls[0].headers['x-fullsite-lan'])
  assert.equal(fetchCalls[1].headers?.['x-fullsite-lan'], undefined)
  assert.equal(result.status, 401)
  report('Electron enum fallback drops injected LAN authentication', {
    firstCallHasLanSecret: true,
    retryHasLanSecret: false,
    simulatedProtectedServerStatus: result.status,
  })

  const pedro = loadTs('dashboard-app/src/lib/pedro-cliente.ts', {
    './bridge-url': { getBridgeUrl: () => '' },
    './local-network-fetch': {},
  }, { console })
  const orderA = {
    id: 'order-from-A', order_id: 'order-from-A', mesa: 7, mesero: 'Ana',
    status: 'enviada', total: 713,
    items: [{ id: 'dish-1', nombre: 'Test dish', cantidad: 1, subtotal: 713 }],
  }
  const salon = pedro.aOrdenesDelSalon([orderA])
  const page = fs.readFileSync(path.join(SOURCE, 'dashboard-app/src/app/pos/page.tsx'), 'utf8')
  const start = page.indexOf('const loadMesaOrder = async () => {')
  const end = page.indexOf('// Safety: ensure loadingMesa', start)
  assert.ok(start >= 0 && end > start, 'Expected actual production closure boundaries')
  const isolated = page.slice(start, end) + '\nloadMesaOrder();'
  const stateB = { orderItems: [], orderId: 'new-order-B', loadedOrderId: null, loadingMesa: true }
  const globals = {
    navigator: { onLine: false }, cancelled: false, mesa: 7, clienteNombre: '',
    console: { warn() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => { throw new Error('Unexpected network') },
    setLoadingMesa: value => { stateB.loadingMesa = value },
  }
  for (const field of ['OrderItems', 'OrderId', 'LoadedOrderId', 'Mesero', 'Personas', 'Discount',
    'OrderNotes', 'OrderRevision', 'LoadedUpdatedAt', 'SentItemIds', 'SentItemSnapshots']) {
    globals['set' + field] = value => { stateB[field[0].toLowerCase() + field.slice(1)] = value }
  }
  await vm.runInNewContext(ts.transpileModule(isolated, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, globals)
  assert.equal(salon[0].id, 'order-from-A')
  assert.equal(stateB.orderItems.length, 0)
  assert.equal(stateB.loadedOrderId, null)
  assert.equal(stateB.loadingMesa, false)
  report('POS B offline with empty localStorage: occupied salon but empty editor', { salon, stateB })

  const named = pedro.aOrdenesDelSalon([
    { id: 'counter-order', mesa: 0, customer_name: 'SR RAUL', personas: 3, total: 120, status: 'enviada' },
  ])
  const uiNamed = named.map(o => ({
    id: o.id, mesa: o.mesa ?? 0, customer_name: null, order_number: null,
    mesero: o.mesero ?? '', personas: 0, total: o.total,
  }))
  assert.equal(uiNamed.filter(o => o.customer_name && (!o.mesa || o.mesa === 0)).length, 0)
  report('H3 drops fields required to discover named accounts', { adapted: named, visibleNamedAccounts: 0 })

  const restaurant = new RestaurantState()
  restaurant.apply({ type: EVENT.ORDER_SENT, payload: orderA })
  assert.equal(restaurant.toSnapshot().kds_orders.length, 1)
  restaurant.apply({ type: EVENT.ORDER_UPSERTED,
    payload: { order_id: orderA.id, mesa: 7, status: 'entregada' } })
  const deliveredSnapshot = restaurant.toSnapshot()
  const deliveredSalon = pedro.aOrdenesDelSalon(deliveredSnapshot.kds_orders)
  assert.equal(deliveredSnapshot.mesas['7'].status, 'ocupada')
  assert.equal(deliveredSalon.length, 0)
  report('Unpaid delivered order disappears from H3 salon because KDS hides it', {
    mesaState: deliveredSnapshot.mesas['7'],
    kds_orders: deliveredSnapshot.kds_orders,
    salon: deliveredSalon,
  })

  const freshPedro = new RestaurantState()
  freshPedro.apply({ type: EVENT.STATE_SYNC, payload: {
    mesas: [{ mesa: 7, status: 'ocupada', order_id: orderA.id }],
    kds_queue: [{ order_id: orderA.id, mesa: 7, items_sent: orderA.items, turno_id: 'shift-A' }],
    turno: { id: 'shift-A', opened_at: new Date().toISOString() },
    synced_at: new Date().toISOString(),
  } })
  const cloudSnapshot = freshPedro.toSnapshot()
  assert.equal(cloudSnapshot.mesas['7'].status, 'ocupada')
  assert.equal(cloudSnapshot.kds_queue.length, 1)
  assert.equal(cloudSnapshot.kds_orders.length, 0)
  report('Fresh Pedro cloud STATE_SYNC populates mesas and kds_queue but H3 reads only empty kds_orders', {
    mesas: cloudSnapshot.mesas,
    kitchenQueueCount: cloudSnapshot.kds_queue.length,
    salon: pedro.aOrdenesDelSalon(cloudSnapshot.kds_orders),
  })
  console.log('5 deterministic defects reproduced using candidate logic; not a browser/Electron UI certification.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
