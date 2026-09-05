'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { CatalogStore } = require('../core/catalog-store')
const { buildHttpRouter } = require('../index')
const cred = require('../core/credencial-lan')

function fixture() {
  return { schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: 'lab', refreshed_at: '2026-09-05T01:00:00Z',
    categories: [{ id: 'drinks', name: 'Bebidas', items: [{ id: 'coffee', name: 'Café', price: 50 }] }],
    config: { id: 'lab', display_name: 'Laboratorio', timezone: 'America/Monterrey', mesas: 0, iva_rate: 0 }, settings: {},
    modifiers: { groups: [{ id: 'milk', name: 'Leche', level: 1, required: true, min_selections: 1, max_selections: 1 }],
      mods: [{ id: 'oat', group_id: 'milk', name: 'Avena', price: 15 }], item_links: [{ item_id: 'coffee', group_id: 'milk' }], category_links: [] },
    payment_methods: [{ id: 'cash', name: 'Efectivo', type: 'cash', commission_pct: 0 }] }
}
function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-catalog-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const opts = { directory, restaurantId: 'lab', branchId: 'A', fetchImpl: async () => Response.json(fixture()), ...options }
  return { opts, store: new CatalogStore(opts) }
}
test('complete catalog survives restart with zero tax and required modifier; token never persists', async t => {
  const { store, opts } = setup(t)
  assert.throws(() => store.read(), /Prepara/)
  await store.refresh('synthetic-cloud-session')
  const recovered = new CatalogStore(opts)
  assert.deepEqual(recovered.read().catalog, fixture())
  assert.equal(recovered.read().catalog.config.iva_rate, 0)
  assert(!fs.readFileSync(store.file, 'utf8').includes('synthetic-cloud-session'))
  const edited = recovered.read(); edited.catalog.categories[0].items[0].price = 1
  assert.equal(recovered.read().catalog.categories[0].items[0].price, 50)
})
test('bad scope, partial downloads and invalid amounts preserve last complete catalog', async t => {
  const { store } = setup(t)
  await store.refresh('session')
  const revision = store.read().revision
  for (const mutate of [c => { c.restaurant_id = 'other' }, c => { c.complete = false },
    c => { c.categories[0].items[0].price = 0.001 }, c => { c.config.iva_rate = null },
    c => { c.modifiers.item_links[0].item_id = 'missing' }, c => { c.categories[0].items.push(c.categories[0].items[0]) }]) {
    const bad = fixture(); mutate(bad); store.fetch = async () => Response.json(bad)
    await assert.rejects(store.refresh('session'))
    assert.equal(store.read().revision, revision)
  }
  store.fetch = async () => new Response('{', { status: 200 })
  await assert.rejects(store.refresh('session'))
  store.fetch = async () => Response.json({}, { status: 503 })
  await assert.rejects(store.refresh('session'))
  assert.equal(store.read().revision, revision)
})
test('disk failure never reports a newly prepared catalog and faults reads until restart', async t => {
  const { store, opts } = setup(t)
  await store.refresh('session')
  store.write = () => { throw new Error('ENOSPC') }
  await assert.rejects(store.refresh('session'), /disco/)
  assert.equal(store.status().ready, false)
  assert.throws(() => store.read())
  assert.equal(new CatalogStore(opts).status().ready, true)
})
test('copied branch catalog and corrupt bytes are not ready', async t => {
  const { store, opts } = setup(t)
  await store.refresh('session')
  assert.equal(new CatalogStore({ ...opts, branchId: 'B' }).status().ready, false)
  fs.writeFileSync(store.file, fs.readFileSync(store.file, 'utf8').replace('Café', 'Otra cosa'))
  assert.equal(new CatalogStore(opts).status().ready, false)
})
test('acquisition pins HTTPS endpoint, rejects redirects and coalesces concurrent logins', async t => {
  let calls = 0
  const { store, opts } = setup(t, { fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://app.fullsite.mx/api/pos/menu'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers['x-fullsite-tenant'], 'lab'); assert.equal(init.headers.Authorization, 'Bearer session')
    return Response.json(fixture())
  } })
  await Promise.all([store.refresh('session'), store.refresh('session')])
  assert.equal(calls, 1)
  assert.throws(() => new CatalogStore({ ...opts, cloudOrigin: 'http://untrusted.invalid' }), /HTTPS/)
})
test('secondary reads Caja catalog over authenticated LAN and cannot upload replacement prices', async t => {
  const { store } = setup(t); await store.refresh('session')
  const secret = cred.generarSecreto()
  const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'lab', branchId: 'A' })
  async function server(config = {}, catalogStore = null) {
    const s = http.createServer(buildHttpRouter({ restaurantId: 'lab', catalogStore, config: { lanSecret: secret, locationId: 'A', ...config } }))
    await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { s.closeAllConnections(); s.close(resolve) }))
    return s
  }
  const caja = await server({}, store)
  const secondary = await server({ posServerIp: '127.0.0.1', posServerPort: caja.address().port })
  const url = `http://127.0.0.1:${secondary.address().port}/catalog`
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, { headers: { ...headers, 'x-fullsite-sucursal': 'B' } })).status, 401)
  const response = await fetch(url, { headers })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await response.json()).catalog, fixture())
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(fixture()) })).status, 404)
  await new Promise(resolve => { caja.closeAllConnections(); caja.close(resolve) })
  assert.equal((await fetch(url, { headers })).status, 502, 'never claims its private catalog is current Caja')
})
test('online PIN success prepares catalog using the trusted login result, not request token or prices', async t => {
  let token
  const { store } = setup(t, { fetchImpl: async (_url, init) => { token = init.headers.Authorization; return Response.json(fixture()) } })
  const secret = cred.generarSecreto()
  const app = http.createServer(buildHttpRouter({ restaurantId: 'lab', config: { lanSecret: secret, locationId: 'A' }, catalogStore: store,
    actorAuthority: { login: async () => ({ staff: { id: 'one' }, offline: false, shiftToken: 'from-verified-cloud-login' }) } }))
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve) }))
  const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'lab', branchId: 'A', terminalId: 'POS-2' })
  const response = await fetch(`http://127.0.0.1:${app.address().port}/auth/pin`, { method: 'POST', headers,
    body: JSON.stringify({ pin: '1234', shiftToken: 'forged', categories: [] }) })
  assert.equal(response.status, 200)
  await store.pending
  assert.equal(token, 'Bearer from-verified-cloud-login')
  assert.equal(store.read().catalog.categories[0].items[0].price, 50)
})
