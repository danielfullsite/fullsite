'use strict'
// ─── Catalog Store (Fase 2 — modelo Pedro: SERVER1 como DB master) ─────────────
// SERVER1 baja el catálogo (menú, precios, modificadores, formas de pago) de
// Supabase cuando hay internet y lo persiste en disco. Las terminales, con
// local_ui + pos_server_ip, jalan el catálogo de SERVER1 (GET /catalog) en vez
// de Supabase directo. Así una terminal en frío sin internet NO truena, mientras
// SERVER1 esté vivo — a prueba de apagón.
//
// Dirección de datos: SOLO lectura (nube → SERVER1 → terminales). Sin conflictos.
// El write-back de órdenes (Outbox) es otra pieza (events.ndjson / sync_queue).
//
// Nota de seguridad: este catálogo NO incluye PINs ni credenciales. El login
// offline por staff se maneja aparte (pos_staff_cache / huella local).

const fs   = require('fs')
const path = require('path')

async function sbFetch(supabaseUrl, supabaseKey, query) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  })
  if (!res.ok) throw new Error(`${query.split('?')[0]} → HTTP ${res.status}`)
  return res.json()
}

class CatalogStore {
  /** @param {{ dataDir: string, logger?: object }} opts */
  constructor({ dataDir, logger }) {
    this.file       = path.join(dataDir, 'catalog.json')
    this.logger     = logger || console
    this.data       = null
    this.refreshing = false
  }

  /** Carga el catálogo persistido en disco (arranque en frío offline). */
  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        const n = this.data?.categories?.length ?? 0
        this.logger.log?.(`[catalog] cargado de disco: ${n} categorías (refreshed_at=${this.data?.refreshed_at})`)
      } else {
        this.logger.log?.('[catalog] sin cache en disco todavía — se llenará al primer refresh online')
      }
    } catch (e) {
      this.logger.warn?.(`[catalog] load falló: ${e.message}`)
    }
    return this.data
  }

  /** Snapshot en memoria (lo que sirve GET /catalog). null si nunca se ha llenado. */
  get() { return this.data }

  /** @param {number} maxAgeMs */
  isStale(maxAgeMs) {
    if (!this.data?.refreshed_at) return true
    return (Date.now() - new Date(this.data.refreshed_at).getTime()) > maxAgeMs
  }

  /**
   * Refresca de Supabase y persiste a disco (atómico). Si no hay red, conserva
   * el cache existente en disco/memoria — nunca lo borra.
   * @param {{ supabaseUrl: string, supabaseKey: string, restaurantId: string }} opts
   */
  async refresh({ supabaseUrl, supabaseKey, restaurantId }) {
    if (!supabaseUrl || !supabaseKey || !restaurantId) return this.data
    if (this.refreshing) return this.data
    this.refreshing = true
    const cid = encodeURIComponent(restaurantId)
    try {
      const [cats, items, mgroups, mods, itemLinks, catLinks, methods] = await Promise.all([
        sbFetch(supabaseUrl, supabaseKey, `pos_menu_categories?client_id=eq.${cid}&active=eq.true&order=sort_order.asc&select=id,name,color,sort_order`),
        sbFetch(supabaseUrl, supabaseKey, `pos_menu_items?client_id=eq.${cid}&active=eq.true&order=sort_order.asc&select=id,category_id,name,price,promo,barcode,sort_order`),
        sbFetch(supabaseUrl, supabaseKey, `pos_modifier_groups?client_id=eq.${cid}&active=eq.true&select=id,name,level,min_selections,max_selections,required,sort_order`),
        sbFetch(supabaseUrl, supabaseKey, `pos_modifiers?client_id=eq.${cid}&active=eq.true&select=id,group_id,name,price,sort_order`),
        sbFetch(supabaseUrl, supabaseKey, `pos_item_modifier_groups?client_id=eq.${cid}&select=item_id,group_id`),
        sbFetch(supabaseUrl, supabaseKey, `pos_category_modifiers?client_id=eq.${cid}&select=category_id,modifier_group_id`),
        sbFetch(supabaseUrl, supabaseKey, `pos_payment_methods?client_id=eq.${cid}&active=eq.true&order=name.asc&select=id,name,type,commission_pct`),
      ])

      const itemsByCat = new Map()
      for (const it of items) {
        const arr = itemsByCat.get(it.category_id) || []
        arr.push({ id: it.id, name: it.name, price: Number(it.price), promo: it.promo, barcode: it.barcode })
        itemsByCat.set(it.category_id, arr)
      }
      const categories = cats.map(c => ({
        id: c.id, name: c.name, color: c.color, items: itemsByCat.get(c.id) || [],
      }))

      const snapshot = {
        restaurant_id: restaurantId,
        refreshed_at:  new Date().toISOString(),
        categories,
        modifiers: { groups: mgroups, mods, item_links: itemLinks, category_links: catLinks },
        payment_methods: methods,
      }
      this._writeAtomic(snapshot)
      this.data = snapshot
      this.logger.log?.(`[catalog] refresh OK: ${categories.length} cat · ${items.length} items · ${methods.length} pagos`)
      return snapshot
    } catch (e) {
      // Sin red o error de Supabase — mantenemos el cache. Es exactamente el
      // comportamiento offline que queremos.
      this.logger.warn?.(`[catalog] refresh falló (se conserva el cache): ${e.message}`)
      return this.data
    } finally {
      this.refreshing = false
    }
  }

  _writeAtomic(obj) {
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(obj))
    fs.renameSync(tmp, this.file)
  }
}

module.exports = { CatalogStore, sbFetch }
