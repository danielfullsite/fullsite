'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { replaceFile } = require('../adapters/storage/durable-file')

const MAX_BYTES = 8 * 1024 * 1024
const copy = value => JSON.parse(JSON.stringify(value))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = message => Object.assign(new Error(message), { code: 'CATALOG_NOT_READY' })
const object = v => v && typeof v === 'object' && !Array.isArray(v)
function rows(value) {
  if (!Array.isArray(value) || value.length > 20000 || value.some(v => !object(v))) throw fail('Catálogo incompleto')
  return value
}
function ids(values) {
  const set = new Set()
  for (const row of rows(values)) {
    if (typeof row.id !== 'string' || !row.id || set.has(row.id) || typeof row.name !== 'string' || !row.name.trim()) throw fail('Identidad de catálogo inválida')
    set.add(row.id)
  }
  return set
}
function price(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw fail('Precio inválido')
}
/** Cloud menu is tenant-wide in the current schema. The durable envelope is
 * additionally bound to this installation's branch; no browser may upload it.
 * Readiness certifies these datasets, not prices/stock or the application shell.
 */
function validateCatalog(value, restaurantId) {
  if (!object(value) || value.schema_version !== 1 || value.complete !== true || value.restaurant_id !== restaurantId ||
      value.catalog_scope !== 'restaurant' || !Number.isFinite(Date.parse(value.refreshed_at))) throw fail('Catálogo de otro restaurante o incompleto')
  const categoryIds = ids(value.categories)
  const allItems = rows(value.categories).flatMap(c => rows(c.items))
  const itemIds = ids(allItems)
  allItems.forEach(item => price(item.price))
  if (!object(value.modifiers)) throw fail('Faltan modificadores')
  const groupIds = ids(value.modifiers.groups)
  ids(value.modifiers.mods)
  for (const group of value.modifiers.groups) {
    if (!Number.isInteger(group.level) || group.level < 1 || !Number.isInteger(group.min_selections) || group.min_selections < 0 ||
        typeof group.required !== 'boolean' || !(group.max_selections === null || Number.isInteger(group.max_selections) && group.max_selections >= group.min_selections)) throw fail('Reglas de modificadores inválidas')
  }
  for (const mod of value.modifiers.mods) {
    if (!groupIds.has(mod.group_id)) throw fail('Modificador sin grupo')
    price(mod.price)
  }
  for (const group of value.modifiers.groups) {
    const minimum = group.required ? Math.max(1, group.min_selections) : group.min_selections
    const options = value.modifiers.mods.filter(m => m.group_id === group.id)
    if (options.length < minimum || group.max_selections !== null && group.max_selections < minimum) throw fail('Grupo obligatorio sin opciones suficientes')
  }
  for (const link of rows(value.modifiers.item_links)) {
    if (!itemIds.has(link.item_id) || !groupIds.has(link.group_id)) throw fail('Asignación de producto incompleta')
  }
  for (const link of rows(value.modifiers.category_links)) {
    if (!categoryIds.has(link.category_id) || !groupIds.has(link.modifier_group_id)) throw fail('Asignación de categoría incompleta')
  }
  ids(value.payment_methods)
  for (const method of value.payment_methods) {
    if (typeof method.type !== 'string' || !method.type) throw fail('Forma de pago inválida')
    if (method.commission_pct != null && (!Number.isFinite(method.commission_pct) || method.commission_pct < 0 || method.commission_pct > 100)) throw fail('Comisión inválida')
  }
  const config = value.config
  if (!object(config) || config.id !== restaurantId || typeof config.display_name !== 'string' ||
      !Number.isFinite(config.iva_rate) || config.iva_rate < 0 || config.iva_rate > 1 ||
      !Number.isInteger(config.mesas) || config.mesas < 0 || typeof config.timezone !== 'string' || !object(value.settings)) throw fail('Configuración fiscal/operativa incompleta')
  try { new Intl.DateTimeFormat('es-MX', { timeZone: config.timezone }) } catch { throw fail('Zona horaria inválida') }
  return copy(value)
}

class CatalogStore {
  constructor({ directory, restaurantId, branchId = null, cloudOrigin = 'https://app.fullsite.mx', fetchImpl = fetch, write = replaceFile, now = Date.now }) {
    const url = new URL(cloudOrigin)
    if (url.protocol !== 'https:' || url.username || url.password) throw fail('El catálogo requiere origen HTTPS confiable')
    this.url = url.origin + '/api/pos/menu'
    this.file = path.join(directory, 'catalog.json')
    this.restaurantId = restaurantId; this.branchId = branchId || null
    this.fetch = fetchImpl; this.write = write; this.now = now; this.current = null; this.pending = null; this.storageFault = false
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (fs.existsSync(this.file)) {
      try {
        if (fs.statSync(this.file).size > MAX_BYTES) throw fail('Catálogo excesivo')
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        if (saved.location_id !== this.branchId || saved.checksum !== digest(saved.catalog)) throw fail('Catálogo corrupto o de otra sucursal')
        validateCatalog(saved.catalog, this.restaurantId)
        this.current = saved
      } catch { this.lastError = 'Catálogo guardado inválido; requiere preparación online' }
    }
  }
  status() {
    return { ready: !!this.current && !this.storageFault, restaurant_id: this.restaurantId, location_id: this.branchId,
      revision: this.current?.checksum || null, refreshed_at: this.current?.catalog.refreshed_at || null,
      saved_at: this.current?.saved_at || null, refreshing: !!this.pending, last_error: this.lastError || null }
  }
  read() {
    if (!this.status().ready) throw fail(this.lastError || 'Prepara el catálogo de Caja con internet antes del turno')
    return { ...this.status(), catalog: copy(this.current.catalog) }
  }
  refresh(shiftToken) {
    if (this.storageFault) return Promise.reject(fail('Reinicia Caja después del fallo de almacenamiento'))
    if (typeof shiftToken !== 'string' || !shiftToken) return Promise.reject(fail('Se requiere sesión online para preparar catálogo'))
    if (!this.pending) {
      this.pending = this._refresh(shiftToken).catch(error => {
        this.lastError = error.code === 'CATALOG_NOT_READY' ? error.message : 'No se pudo actualizar catálogo; se conserva la última versión completa'
        throw error
      }).finally(() => { this.pending = null })
    }
    return this.pending
  }
  async _refresh(shiftToken) {
    const response = await this.fetch(this.url, { headers: { Authorization: `Bearer ${shiftToken}`, 'x-fullsite-tenant': this.restaurantId },
      signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store' })
    if (!response.ok) throw fail(`Catálogo no disponible: HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw fail('Catálogo excesivo')
    const body = await response.text()
    if (Buffer.byteLength(body) > MAX_BYTES) throw fail('Catálogo excesivo')
    const catalog = validateCatalog(JSON.parse(body), this.restaurantId)
    const next = { location_id: this.branchId, saved_at: new Date(this.now()).toISOString(), checksum: digest(catalog), catalog }
    try { this.write(this.file, JSON.stringify(next)) }
    catch (error) { this.storageFault = true; throw fail('No se pudo conservar el catálogo en disco; reinicia Caja') }
    this.current = next; this.lastError = null
    return this.status()
  }
}
module.exports = { CatalogStore, validateCatalog }
