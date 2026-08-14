'use strict'
// Tests for CatalogStore (Fase 2 — SERVER1 como DB master del catálogo)
// Run: node --test electron-app/local-server/tests/catalog.test.js

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { CatalogStore } = require('../adapters/catalog')

const silent = { log() {}, warn() {} }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'))
}

// Mock de Supabase REST: mapea query → filas. Instala un fetch global temporal.
function installFetch(routes) {
  const original = global.fetch
  global.fetch = async (urlStr) => {
    const q = urlStr.split('/rest/v1/')[1] || ''
    const table = q.split('?')[0]
    if (routes.__fail) {
      return { ok: false, status: 500, async json() { return [] } }
    }
    const rows = routes[table] ?? []
    return { ok: true, status: 200, async json() { return rows } }
  }
  return () => { global.fetch = original }
}

const FIXTURE = {
  pos_menu_categories: [{ id: 'c1', name: 'Cafés', color: '#111', sort_order: 1 }],
  pos_menu_items: [
    { id: 'i1', category_id: 'c1', name: 'Americano', price: 45, promo: false, barcode: null, sort_order: 1 },
    { id: 'i2', category_id: 'c1', name: 'Latte',     price: 60, promo: false, barcode: null, sort_order: 2 },
  ],
  pos_modifier_groups: [{ id: 'g1', name: 'Leche', level: 1, min_selections: 0, max_selections: 1, required: false, sort_order: 1 }],
  pos_modifiers: [{ id: 'm1', group_id: 'g1', name: 'Deslactosada', price: 10, sort_order: 1 }],
  pos_item_modifier_groups: [{ item_id: 'i2', group_id: 'g1' }],
  pos_category_modifiers: [{ category_id: 'c1', modifier_group_id: 'g1' }],
  pos_payment_methods: [{ id: 'p1', name: 'Efectivo', type: 'cash', commission_pct: 0 }],
}

describe('CatalogStore', () => {
  let dir
  beforeEach(() => { dir = tmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  test('get() es null antes de cualquier refresh/load', () => {
    const cat = new CatalogStore({ dataDir: dir, logger: silent })
    assert.equal(cat.get(), null)
  })

  test('refresh() ensambla el catálogo y persiste a disco', async () => {
    const restore = installFetch(FIXTURE)
    try {
      const cat = new CatalogStore({ dataDir: dir, logger: silent })
      const snap = await cat.refresh({ supabaseUrl: 'https://x', supabaseKey: 'k', restaurantId: 'amalay' })
      assert.equal(snap.restaurant_id, 'amalay')
      assert.equal(snap.categories.length, 1)
      assert.equal(snap.categories[0].items.length, 2)
      assert.equal(snap.categories[0].items[0].name, 'Americano')
      assert.equal(snap.payment_methods.length, 1)
      assert.equal(snap.modifiers.groups.length, 1)
      assert.ok(snap.refreshed_at)
      // persistido en disco
      assert.ok(fs.existsSync(path.join(dir, 'catalog.json')))
    } finally { restore() }
  })

  test('load() recupera el catálogo de disco (arranque en frío)', async () => {
    const restore = installFetch(FIXTURE)
    try {
      const a = new CatalogStore({ dataDir: dir, logger: silent })
      await a.refresh({ supabaseUrl: 'https://x', supabaseKey: 'k', restaurantId: 'amalay' })
    } finally { restore() }
    // Nueva instancia, SIN red — debe cargar de disco.
    const b = new CatalogStore({ dataDir: dir, logger: silent })
    b.load()
    assert.equal(b.get().categories[0].items[1].name, 'Latte')
  })

  test('refresh() sin red NO borra el cache existente', async () => {
    // 1) primer refresh con red
    let restore = installFetch(FIXTURE)
    const cat = new CatalogStore({ dataDir: dir, logger: silent })
    await cat.refresh({ supabaseUrl: 'https://x', supabaseKey: 'k', restaurantId: 'amalay' })
    restore()
    const before = cat.get().refreshed_at

    // 2) segundo refresh que falla (sin red) — conserva el snapshot anterior
    restore = installFetch({ __fail: true })
    try {
      await cat.refresh({ supabaseUrl: 'https://x', supabaseKey: 'k', restaurantId: 'amalay' })
      assert.equal(cat.get().refreshed_at, before)
      assert.equal(cat.get().categories.length, 1)
    } finally { restore() }
  })

  test('isStale() true sin datos, false con refresh reciente', async () => {
    const cat = new CatalogStore({ dataDir: dir, logger: silent })
    assert.equal(cat.isStale(1000), true)
    const restore = installFetch(FIXTURE)
    try {
      await cat.refresh({ supabaseUrl: 'https://x', supabaseKey: 'k', restaurantId: 'amalay' })
      assert.equal(cat.isStale(60_000), false)
    } finally { restore() }
  })
})
