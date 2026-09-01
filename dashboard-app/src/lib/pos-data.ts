// POS Menu Data — AMALAY real menu (el POS legado)
//
// SQL for Supabase (run in SQL Editor):
//
// CREATE TABLE pos_orders (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   mesa INTEGER,
//   mesero TEXT,
//   personas INTEGER DEFAULT 1,
//   status TEXT DEFAULT 'abierta',
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   descuento NUMERIC DEFAULT 0,
//   metodo_pago TEXT,
//   notas TEXT,
//   items JSONB,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   closed_at TIMESTAMPTZ
// );
//
// -- 2026-06-12: pago mixto multi-forma + corte por turno (correr en SQL Editor):
// ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS pagos JSONB;
// ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS turno_id TEXT;
//
// -- BLINDAJE: Immutable audit log (nothing deleteable)
// CREATE TABLE pos_audit_log (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   order_id TEXT,
//   action TEXT NOT NULL,
//   actor TEXT NOT NULL,
//   mesa INTEGER,
//   details JSONB,
//   reason TEXT,
//   approved_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_audit_order ON pos_audit_log(order_id);
// CREATE INDEX idx_audit_action ON pos_audit_log(action);
// CREATE INDEX idx_audit_created ON pos_audit_log(created_at DESC);
//
// -- Actions: order_created, order_sent_kitchen, order_closed, order_cancelled,
// --          item_added, item_modified, item_cancelled, quantity_changed,
// --          discount_applied, discount_removed, status_changed, payment_processed
//
// -- INVENTARIO: Ingredients + Recipes + Stock
// CREATE TABLE pos_ingredients (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   name TEXT NOT NULL,
//   unit TEXT NOT NULL,            -- 'g', 'ml', 'pz', 'kg', 'lt'
//   cost_per_unit NUMERIC DEFAULT 0,
//   category TEXT,                 -- 'proteina', 'lacteo', 'vegetal', 'pan', 'bebida', 'condimento', 'otro'
//   active BOOLEAN DEFAULT true,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_recipes (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   menu_item_id TEXT NOT NULL,     -- references MENU_CATEGORIES item id
//   menu_item_name TEXT NOT NULL,
//   ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
//   quantity NUMERIC NOT NULL,      -- amount of ingredient per 1 unit of platillo
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(client_id, menu_item_id, ingredient_id)
// );
//
// CREATE TABLE pos_inventory (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
//   stock NUMERIC NOT NULL DEFAULT 0,
//   reorder_point NUMERIC DEFAULT 0,
//   reorder_quantity NUMERIC DEFAULT 0,
//   last_restock TIMESTAMPTZ,
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(client_id, ingredient_id)
// );
//
// CREATE TABLE pos_inventory_movements (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   product_id BIGINT REFERENCES pos_inventory_products(id),  -- target column (nullable during compat bridge)
//   ingredient_id TEXT,              -- COMPAT BRIDGE: temporary, maps to pos_ingredients.id
//   movement_type TEXT NOT NULL,     -- 'deduction', 'restock', 'adjustment', 'waste'
//   quantity NUMERIC NOT NULL,
//   order_id UUID,
//   actor TEXT,
//   notes TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_inv_mov_product ON pos_inventory_movements(product_id);
// CREATE INDEX idx_inv_mov_created ON pos_inventory_movements(created_at DESC);
// CREATE INDEX idx_inv_mov_type ON pos_inventory_movements(movement_type);
// -- See docs/INVENTORY-MIGRATION.md for migration plan
//
// -- COMPRAS: Purchase Orders + Facturas
// CREATE TABLE pos_purchase_orders (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   supplier TEXT NOT NULL,
//   status TEXT DEFAULT 'borrador',   -- borrador, enviada, recibida, facturada, pagada, cancelada
//   created_by TEXT NOT NULL,
//   approved_by TEXT,
//   notes TEXT,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   ai_suggested BOOLEAN DEFAULT false,
//   sent_at TIMESTAMPTZ,
//   received_at TIMESTAMPTZ,
//   received_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_purchase_order_items (
//   id BIGSERIAL PRIMARY KEY,
//   order_id TEXT NOT NULL REFERENCES pos_purchase_orders(id),
//   ingredient_id TEXT NOT NULL,
//   ingredient_name TEXT NOT NULL,
//   quantity_ordered NUMERIC NOT NULL,
//   quantity_received NUMERIC,
//   unit TEXT NOT NULL,
//   unit_cost NUMERIC DEFAULT 0,
//   total_cost NUMERIC DEFAULT 0,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_facturas (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   purchase_order_id TEXT REFERENCES pos_purchase_orders(id),
//   supplier TEXT NOT NULL,
//   folio TEXT,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   status TEXT DEFAULT 'capturada',  -- capturada, aprobada, pagada
//   captured_by TEXT NOT NULL,
//   approved_by TEXT,
//   paid_at TIMESTAMPTZ,
//   notes TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

export interface MenuItem {
  id: string
  name: string
  price: number
  promo?: boolean
  barcode?: string
}

export interface MenuCategory {
  id: string
  name: string
  color?: string  // Tailwind color for group tab
  items: MenuItem[]
}

export interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  modificadores: string[]  // ["Sin cebolla", "Extra queso +$25"]
  notas: string
  precioExtra: number      // sum of extra modifiers
  subtotal: number         // (precio + precioExtra) * cantidad
  silla?: number           // seat/person number (1, 2, 3...)
  station?: 'cocina' | 'barra' | 'caja'  // estación de ruteo, fijada al agregar (por categoría)
  courseId?: number         // 1=Tiempo 1, 2=Tiempo 2, etc. Assigned when tiempo separator is added
  courseStatus?: 'pending' | 'fired' | 'preparing' | 'ready' | 'served'
  comanda_batch_id?: string   // UUID of the send batch (Eduardo Jul 21: separate KDS cards per send)
  comanda_batch_seq?: number  // Sequential: 0 = first send, 1 = second send, etc.
  cancelled?: boolean         // H-4 fix: persisted cancellation flag
}

// Keep legacy alias for any other pages that import the old shape
export interface OrderItemLegacy {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: string
  status: 'pendiente' | 'preparando' | 'listo' | 'entregado'
  createdAt: Date
}

export interface ModificadorAgregar {
  name: string
  price: number
}

export const MODIFIERS_QUITAR = [
  'Sin cebolla', 'Sin chile', 'Sin crema', 'Sin queso',
  'Sin pan', 'Sin salsa', 'Sin jitomate', 'Sin aguacate'
]

// Extras by category type
export const MODIFIERS_AGREGAR_FOOD: ModificadorAgregar[] = [
  { name: 'Extra queso', price: 25 },
  { name: 'Extra aguacate', price: 35 },
  { name: 'Extra proteina', price: 45 },
  { name: 'Extra huevo', price: 20 },
  { name: 'Extra salsa', price: 0 },
]

export const MODIFIERS_AGREGAR_COFFEE: ModificadorAgregar[] = [
  { name: 'Shot extra', price: 20 },
  { name: 'Leche de almendra', price: 15 },
  { name: 'Leche de avena', price: 15 },
  { name: 'Leche deslactosada', price: 10 },
  { name: 'Jarabe de vainilla', price: 15 },
  { name: 'Crema batida', price: 10 },
]

export const MODIFIERS_AGREGAR_DRINKS: ModificadorAgregar[] = [
  { name: 'Leche de almendra', price: 15 },
  { name: 'Leche de avena', price: 15 },
  { name: 'Extra fruta', price: 20 },
  { name: 'Proteina whey', price: 25 },
]

export const MODIFIERS_AGREGAR_NONE: ModificadorAgregar[] = []

// Legacy export for compatibility
export const MODIFIERS_AGREGAR = MODIFIERS_AGREGAR_FOOD

// Beverage categories (no "quitar" options, drink-specific extras)
const BEVERAGE_CATEGORIES = ['coffee', 'tea', 'fresh', 'smoothies', 'frappes', 'signature', 'alcohol']
const COFFEE_CATEGORIES = ['coffee', 'tea']
// Items with no modifiers at all (no extras)
const NO_MODIFIER_CATEGORIES = ['sodas', 'cerveza', 'vinos', 'licores']
// Bakery/market — no food extras (no queso/aguacate on conchas)
const BAKERY_CATEGORIES = ['bakery', 'toast', 'postres', 'mkt-cafe', 'mkt-healthy', 'mkt-vitaminas', 'mkt-regalos']

// Category name → modifier type (for DB categories with UUID ids)
// Mapping validated against AMALAY categories (June 2026):
//   NONE:     Cerveza, Vinos, Licores 2oz, Sodas, Bebidas OH
//   COFFEE:   Coffee Hot/Ice, Tea & Tisanas
//   BEVERAGE: Jugos, Fresh Drinks, Frappes, Smoothies, Signature, Ice Cream
//   BAKERY:   Bakery, Toast & Bagels, Desserts, Market:*, Croissants Breakfast
//   FOOD:     Chilaquiles, Eggs & Keto, Bowls, Ceviche, Paninis, Pizzas & Pastas,
//             Pancakes & Waffles, Appetizers, Everyday Specials, Evento/Menu Temp
export function getModifierTypeFromCategoryName(catName: string): 'none' | 'coffee' | 'beverage' | 'bakery' | 'food' {
  const lower = catName.toLowerCase()
  // NO modifiers at all (packaged/bottled/canned — nothing to customize)
  if (['soda', 'cerveza', 'beer', 'vino', 'licor', '2oz', 'bebidas oh'].some(kw => lower.includes(kw))) return 'none'
  // Coffee modifiers (shots, leches, jarabes)
  if (['coffee', 'café', 'cafe', 'tea', 'tisana'].some(kw => lower.includes(kw))) return 'coffee'
  // Drink modifiers (leches, fruta, proteina)
  if (['jugo', 'fresh drink', 'smoothie', 'frappe', 'signature', 'ice cream', 'helado'].some(kw => lower.includes(kw))) return 'beverage'
  // No food modifiers (no queso/aguacate/proteina — these are bread/retail/sweets)
  if (['bakery', 'panadería', 'toast', 'bagel', 'dessert', 'postre', 'croissant',
       'market', 'healthy', 'vitamina', 'suplemento', 'regalo', 'detalle',
       'marca propia', 'semilla', 'dulce', 'abarrote'].some(kw => lower.includes(kw))) return 'bakery'
  // Food modifiers (extra queso, aguacate, proteina, huevo, salsa)
  // Applies to: Chilaquiles, Eggs, Bowls, Ceviche, Paninis, Pizzas, Pancakes, Appetizers, Specials
  return 'food'
}

// Cache of category id → name (populated by POS on menu load via setCategoryNameCache)
import { _categoryNameCache } from '@/lib/pos-constants'
import { getActiveClientSlug } from '@/lib/data'
import { inventoryPolicyService, logPolicyGateFailure } from '@/lib/inventory-policy'
import { mismoDiaDeVenta, inicioDiaConfigurado } from '@/lib/dia-de-venta'
import { esFalloDeRed, esFalloDeAutenticacion, ErrorDeSesion, ErrorDeContrato } from '@/lib/clasificar-fallo'

export function getModifiersForCategory(categoryId: string): {
  quitarOptions: string[]
  agregarOptions: ModificadorAgregar[]
} {
  // Static category ID match first
  if (NO_MODIFIER_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
  }
  if (BAKERY_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
  }
  if (COFFEE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_COFFEE }
  }
  if (BEVERAGE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_DRINKS }
  }
  // DB category name match (UUID ids)
  const catName = _categoryNameCache[categoryId]
  if (catName) {
    const type = getModifierTypeFromCategoryName(catName)
    if (type === 'none' || type === 'bakery') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
    if (type === 'coffee') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_COFFEE }
    if (type === 'beverage') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_DRINKS }
  }
  // Food items — use recipe ingredients for "quitar", food extras for "agregar"
  return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_FOOD }
}

// ── DB-backed menu loading (fallback to static MENU_CATEGORIES) ─────────────

const _SUPABASE_URL = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL || '' : ''
const _SUPABASE_KEY = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' : ''
const _SB_HEADERS = { apikey: _SUPABASE_KEY, Authorization: `Bearer ${_SUPABASE_KEY}` }

/** fetch() con timeout de 5s — evita que solicitudes colgadas a Supabase freezeen el UI cuando cae internet por cable. */
export function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

/** Get current client ID — delegates to canonical getActiveClientSlug(). */
function _getClientId(): string {
  return getActiveClientSlug()
}

/** Public accessor for pages that query Supabase directly (e.g. corte). */
export function getClientId(): string {
  return _getClientId()
}

/** Returns Authorization header with POS shift token, if one is stored. */
export function getPOSAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('pos_shift_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getMenuCategoriesFromDB(): Promise<MenuCategory[]> {
  try {
    const clientId = _getClientId()
    if (!clientId) return []

    const [catRes, itemsRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_menu_categories?client_id=eq.${clientId}&active=eq.true&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${clientId}&active=eq.true&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])
    if (!catRes.ok || !itemsRes.ok) {
      // DB error — try IDB cache before returning empty
      return _getMenuFromCache()
    }

    const cats = await catRes.json()
    const items = await itemsRes.json()
    if (!cats.length || !items.length) return []

    const itemsByCat = new Map<string, MenuItem[]>()
    for (const item of items) {
      const arr = itemsByCat.get(item.category_id) || []
      arr.push({ id: item.id, name: item.name, price: Number(item.price), promo: item.promo, barcode: item.barcode })
      itemsByCat.set(item.category_id, arr)
    }

    const categories = cats.map((cat: { id: string; name: string; color: string }) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      items: itemsByCat.get(cat.id) || [],
    }))

    // Cache for offline boot (fire-and-forget, never blocks the return)
    if (typeof window !== 'undefined') {
      import('@/lib/pos-offline-db').then(m => m.cacheMenu(categories as unknown as Record<string, unknown>[])).catch(() => {})
    }

    return categories
  } catch {
    // Network error — serve from IDB cache if available
    return _getMenuFromCache()
  }
}

async function _getMenuFromCache(): Promise<MenuCategory[]> {
  if (typeof window === 'undefined') return []
  try {
    const { getCachedMenu } = await import('@/lib/pos-offline-db')
    const cached = await getCachedMenu()
    if (cached.length > 0) return cached as unknown as MenuCategory[]
  } catch {}
  return []
}

/** Forma de pago custom (catálogo pos_payment_methods, estilo el POS legado: Rappi, Ubereats, Cortesía...) */
export interface PaymentMethodDB {
  id: string
  name: string
  /** 'cash' (cuenta para arqueo de efectivo) | 'card' (comisión) | 'other' */
  type: string
  commission_pct?: number
}

export async function getPaymentMethodsFromDB(): Promise<PaymentMethodDB[]> {
  try {
    const res = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_payment_methods?client_id=eq.${_getClientId()}&active=eq.true&select=id,name,type,commission_pct&order=name.asc`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!res.ok) {
      return _getPaymentMethodsFromCache()
    }
    const methods = await res.json() as PaymentMethodDB[]
    // Fire-and-forget cache for offline boot
    import('@/lib/pos-offline-db').then(m => m.cachePaymentMethods(methods as unknown as Record<string, unknown>[])).catch(() => {})
    return methods
  } catch { return _getPaymentMethodsFromCache() }
}

async function _getPaymentMethodsFromCache(): Promise<PaymentMethodDB[]> {
  try {
    const { getCachedPaymentMethods } = await import('@/lib/pos-offline-db')
    const cached = await getCachedPaymentMethods()
    if (cached.length > 0) return cached as unknown as PaymentMethodDB[]
  } catch {}
  return []
}

type ActiveTurnoRecord = { id: string; fondo_inicial: number; opened_by: string; opened_at: string }

/** Turnos activos (pos_turnos sin closed_at), del más reciente al más antiguo. */
export async function getActiveTurnos(): Promise<ActiveTurnoRecord[]> {
  /**
   * El cache de turno vence por DIA DE VENTA, no por reloj.
   *
   * Antes vencia con `Date.now() - ts < 24h`. Un turno abierto a las 19:55 seguia
   * sirviendose a las 22:00 del dia siguiente — 26 horas de vida util real, porque
   * lo que se medía era cuando se guardó, no a qué día pertenece. Eso produjo la
   * pantalla "Turno del dia anterior / Corte Z" en Entrada, sobre un turno que el
   * servidor ya tenia cerrado. TurnoGate SI tenia guarda de mismo dia en su propio
   * cache; este de aca abajo la puenteaba.
   */
  const fromCache = (): ActiveTurnoRecord[] => {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem('pos_turno_cache')
      if (!raw) return []
      const { turno, turnos, ts } = JSON.parse(raw)
      const filas: ActiveTurnoRecord[] = Array.isArray(turnos) ? turnos : turno ? [turno] : []
      if (filas.length === 0) return []
      const inicio = inicioDiaConfigurado()
      const ahora = Date.now()
      // El sello de guardado y la apertura del turno deben caer los DOS en el dia
      // de venta de hoy. El sello descarta un cache viejo; la apertura descarta un
      // turno de anoche que se re-guardo hace un rato.
      if (typeof ts === 'number' && !mismoDiaDeVenta(ts, ahora, inicio)) return []
      return filas.filter(f => f?.opened_at && mismoDiaDeVenta(f.opened_at, ahora, inicio))
    } catch {
      return []
    }
  }

  let res: Response
  try {
    res = await fetchWithTimeout(
      `${_SUPABASE_URL}/rest/v1/pos_turnos?client_id=eq.${_getClientId()}&closed_at=is.null&select=id,fondo_inicial,opened_by,opened_at&order=opened_at.desc&limit=10`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
  } catch {
    // No hubo respuesta: red caida o timeout. Aqui SI vale el cache.
    return fromCache()
  }

  if (!res.ok) {
    /**
     * Antes esta linea era `if (!res.ok) return fromCache()`, a secas.
     *
     * Se escribio para un caso legitimo: sin red, el Service Worker resuelve la
     * peticion como un 503 sintetico, asi que `fetch` NO lanza y el catch nunca
     * corria. Pero se aplico a TODOS los status. Un 401 de sesion vencida servia
     * un turno viejo en silencio; un 400 por columna inexistente, tambien.
     *
     * Un fallo de contrato tiene que SUBIR. Servir cache ante un 401 no es
     * tolerancia a fallos: es operar con datos viejos sin decirselo a nadie.
     */
    if (esFalloDeRed(res.status)) return fromCache()
    const detalle = await res.text().catch(() => '')
    if (esFalloDeAutenticacion(res.status)) throw new ErrorDeSesion(res.status, detalle.slice(0, 200))
    throw new ErrorDeContrato(res.status, detalle.slice(0, 200))
  }

  const rows = await res.json()
  if (typeof window !== 'undefined') {
    try { localStorage.setItem('pos_turno_cache', JSON.stringify({ turno: rows[0] || null, turnos: rows, ts: Date.now() })) } catch {}
  }
  return rows
}

/** Turno activo más reciente. Devuelve null si no hay turno abierto. */
export async function getActiveTurno(): Promise<ActiveTurnoRecord | null> {
  const turnos = await getActiveTurnos()
  return turnos[0] || null
}

/** Turno activo + detección de turno stale (>18h sin cerrar = probablemente del día anterior) */
/**
 * Version TOLERANTE para pantallas que solo necesitan etiquetar con el turno.
 *
 * `getActiveTurnos` lanza ante 400/401/403 — correcto para TurnoGate, cuyo trabajo
 * es decidir si se puede operar. Pero /pos y /pos/corte la llaman DENTRO de un
 * `Promise.all` junto al menu, recetas y formas de pago: si lanzara ahi, un 401
 * pasajero dejaria el POS entero sin cargar. Eso seria peor que el bug original.
 *
 * `determinado` distingue los dos "sin turno" que antes se confundian:
 *   - `{ turno: null, determinado: true }`  -> el servidor confirmo que no hay turno
 *   - `{ turno: null, determinado: false }` -> no se pudo saber (401, red, timeout)
 *
 * Quien limpie estado persistente DEBE exigir `determinado === true`. Borrar el
 * `pos_turno_id` cacheado ante un 401 pasajero deja la terminal sin turno con uno
 * abierto en el servidor.
 */
export async function getActiveTurnoTolerante(): Promise<{ turno: ActiveTurnoRecord | null; determinado: boolean }> {
  try {
    const turnos = await getActiveTurnos()
    return { turno: turnos[0] || null, determinado: true }
  } catch (err) {
    console.warn('[pos-data] No se pudo determinar el turno activo:', err)
    return { turno: null, determinado: false }
  }
}

export async function getActiveTurnoWithStaleCheck(): Promise<{ turno: ActiveTurnoRecord | null; isStale: boolean; activeCount: number }> {
  const turnos = await getActiveTurnos()
  const turno = turnos[0] || null
  if (!turno) return { turno: null, isStale: false, activeCount: 0 }
  const hoursSinceOpen = (Date.now() - new Date(turno.opened_at).getTime()) / (1000 * 60 * 60)
  return { turno, isStale: hoursSinceOpen > 18, activeCount: turnos.length }
}

/** Cerrar turno stale automáticamente (sin wizard de conteo) */
export async function autoCloseStaleTurno(turnoId: string, closedBy: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_turnos?id=eq.${encodeURIComponent(turnoId)}`,
      { method: 'PATCH', headers: { ..._SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ closed_at: new Date().toISOString(), closed_by: closedBy, notas: 'Auto-cerrado (turno del dia anterior)' }) }
    )
    return res.ok
  } catch { return false }
}

/** Abrir turno nuevo */
export async function openTurno(fondoInicial: number, openedBy: string): Promise<{ id: string; fondo_inicial: number; opened_by: string; opened_at: string } | null> {
  // Guard: verificar que no exista turno activo (race condition)
  const existing = await getActiveTurno()
  if (existing) return existing // Ya hay uno abierto, retornarlo

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const openedAt = new Date().toISOString()
  const localTurno = { id, fondo_inicial: fondoInicial, opened_by: openedBy, opened_at: openedAt }
  const body = { id, client_id: _getClientId(), opened_by: openedBy, fondo_inicial: fondoInicial, opened_at: openedAt }

  // Cachear el turno local para que getActiveTurno lo devuelva offline (mismo key/shape).
  const cacheLocal = () => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('pos_turno_cache', JSON.stringify({ turno: localTurno, ts: Date.now() })) } catch {}
    }
  }
  // Encolar el POST para sincronizar al reconectar. id client-side = idempotente:
  // al subir crea la MISMA fila, sin duplicar. turno_id en órdenes es TEXT (sin FK),
  // así que las comandas offline sincronizan aunque el turno suba después.
  const queueForSync = async () => {
    try { const { addToQueue } = await import('@/lib/offline-sync'); addToQueue('pos_turnos', body) } catch {}
  }

  // Offline: abrir turno LOCAL + encolar (el día arranca sin internet).
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await queueForSync()
    cacheLocal()
    return localTurno
  }

  try {
    const res = await fetch(`${_SUPABASE_URL}/rest/v1/pos_turnos`, {
      method: 'POST', headers: { ..._SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('post failed')
    const rows = await res.json()
    cacheLocal()
    return rows[0] || localTurno
  } catch {
    // "Online" pero el POST falló (LAN degradada / timeout) — abrir local + encolar
    // en vez de bloquear el día con "Error al abrir turno".
    await queueForSync()
    cacheLocal()
    return localTurno
  }
}

// ── Modificadores multinivel (estilo el POS legado: "NIVEL 1: PROTEINA, opcional, máx 2") ──

export interface ModifierGroupDef {
  id: string
  name: string
  /** Nivel del POS legado (1, 2, 3...) — define orden de render */
  level: number
  minSelections: number
  /** null = sin límite */
  maxSelections: number | null
  required: boolean
  options: ModificadorAgregar[]
}

// Modifier groups that should NEVER appear for certain category types
// "Término" (medio/bien cocido) only makes sense for food with meat
const MEAT_ONLY_KEYWORDS = ['término', 'termino', 'cocción', 'coccion', 'bien cocido', 'tres cuartos', 'medio']
function isGroupCompatible(groupName: string, categoryId: string): boolean {
  const catName = _categoryNameCache[categoryId] || ''
  const catType = catName ? getModifierTypeFromCategoryName(catName) : 'food'
  const lowerGroup = groupName.toLowerCase()
  // Meat cooking terms should only appear for food categories
  if (MEAT_ONLY_KEYWORDS.some(kw => lowerGroup.includes(kw))) {
    return catType === 'food'
  }
  // Coffee-specific groups (shots, leches) shouldn't appear for food
  if (['shot', 'leche', 'jarabe', 'syrup'].some(kw => lowerGroup.includes(kw))) {
    return catType === 'coffee' || catType === 'beverage'
  }
  return true
}

/**
 * Grupos de modificadores multinivel para un producto.
 * Asignación por item (pos_item_modifier_groups) + por categoría (pos_category_modifiers).
 * Devuelve [] si no hay grupos configurados — el modal cae al sistema legacy.
 */
export async function getModifierGroupsForItem(itemId: string, categoryId: string): Promise<ModifierGroupDef[]> {
  try {
    const cid = _getClientId()
    const [itemAssignRes, catAssignRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_item_modifier_groups?client_id=eq.${cid}&item_id=eq.${encodeURIComponent(itemId)}&select=group_id`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_category_modifiers?client_id=eq.${cid}&category_id=eq.${encodeURIComponent(categoryId)}&select=modifier_group_id`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])

    // OFFLINE: el Service Worker resuelve estas rutas con `new Response('Offline', {status:503})`
    // (catch-all staleWhileRevalidate — no están en API_CACHE_PATTERNS ni NEVER_CACHE_PATTERNS),
    // así que fetch() NO lanza y el catch del final NUNCA corre. Sin este guard, `.ok` es false,
    // groupIds queda vacío y se caía por `return []` — el platillo perdía sus grupos
    // OBLIGATORIOS (p.ej. "Término" en una arrachera) y la comanda salía a cocina sin ellos,
    // en silencio. Mismo patrón ya resuelto en getMenuCategoriesFromDB y getPaymentMethodsFromDB.
    if (!itemAssignRes.ok || !catAssignRes.ok) {
      return _getModifierGroupsFromCache(itemId, categoryId)
    }

    const groupIds = new Set<string>()
    for (const a of await itemAssignRes.json() as { group_id: string }[]) groupIds.add(a.group_id)
    for (const a of await catAssignRes.json() as { modifier_group_id: string }[]) groupIds.add(a.modifier_group_id)
    groupIds.delete('quitar') // legacy group, manejado aparte
    // Vacío CON respuestas buenas = el platillo de verdad no tiene grupos. No es fallo.
    if (groupIds.size === 0) return []

    const idList = [...groupIds].map(encodeURIComponent).join(',')
    const [groupsRes, optsRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifier_groups?client_id=eq.${cid}&active=eq.true&id=in.(${idList})&order=level.asc,sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifiers?client_id=eq.${cid}&active=eq.true&group_id=in.(${idList})&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])
    // Mismo caso: 503 del SW → no lanza → hay que caer al caché IDB explícitamente.
    if (!groupsRes.ok || !optsRes.ok) return _getModifierGroupsFromCache(itemId, categoryId)

    const groups: { id: string; name: string; level: number; min_selections: number; max_selections: number | null; required: boolean }[] = await groupsRes.json()
    const opts: { group_id: string; name: string; price: number }[] = await optsRes.json()

    const optsByGroup = new Map<string, ModificadorAgregar[]>()
    for (const o of opts) {
      const arr = optsByGroup.get(o.group_id) || []
      arr.push({ name: o.name, price: Number(o.price) })
      optsByGroup.set(o.group_id, arr)
    }

    return groups
      .map(g => ({
        id: g.id,
        name: g.name,
        level: Number(g.level) || 1,
        minSelections: Number(g.min_selections) || 0,
        maxSelections: g.max_selections === null ? null : Number(g.max_selections),
        required: Boolean(g.required),
        options: optsByGroup.get(g.id) || [],
      }))
      // Blindaje: descartar registros malformados (no son grupos de modificadores).
      // Un registro sin campo max_selections (ej. un mesero que se coló al cache por
      // IDB dañado) produce maxSelections=NaN → nunca debe renderizarse como modificador.
      .filter(g => g.maxSelections === null || Number.isFinite(g.maxSelections))
      .filter(g => g.options.length > 0)
      // Filter out incompatible groups (e.g. "Término" on coffee, "Shot" on food)
      .filter(g => isGroupCompatible(g.name, categoryId))
  } catch {
    // Offline — reconstruct from IDB cache
    return _getModifierGroupsFromCache(itemId, categoryId)
  }
}

async function _getModifierGroupsFromCache(itemId: string, categoryId: string): Promise<ModifierGroupDef[]> {
  try {
    const { getCachedModifierGroups, getCachedModifiers, getCachedItemModifierLinks } = await import('@/lib/pos-offline-db')
    const [allGroups, allMods, allLinks] = await Promise.all([
      getCachedModifierGroups(),
      getCachedModifiers(),
      getCachedItemModifierLinks(),
    ])
    const groupIds = new Set<string>()
    for (const l of allLinks) {
      if ((l as Record<string, unknown>).item_id === itemId) groupIds.add((l as Record<string, unknown>).group_id as string)
      if ((l as Record<string, unknown>).category_id === categoryId) groupIds.add((l as Record<string, unknown>).group_id as string)
    }
    groupIds.delete('quitar')
    if (groupIds.size === 0) return []

    const groups = allGroups.filter(g => groupIds.has((g as Record<string, unknown>).id as string)) as unknown as { id: string; name: string; level: number; min_selections: number; max_selections: number | null; required: boolean }[]
    const opts = allMods.filter(o => groupIds.has((o as Record<string, unknown>).group_id as string)) as unknown as { group_id: string; name: string; price: number }[]

    const optsByGroup = new Map<string, ModificadorAgregar[]>()
    for (const o of opts) {
      const arr = optsByGroup.get(o.group_id) || []
      arr.push({ name: o.name, price: Number(o.price) })
      optsByGroup.set(o.group_id, arr)
    }

    return groups
      .map(g => ({
        id: g.id,
        name: g.name,
        level: Number(g.level) || 1,
        minSelections: Number(g.min_selections) || 0,
        maxSelections: g.max_selections === null ? null : Number(g.max_selections),
        required: Boolean(g.required),
        options: optsByGroup.get(g.id) || [],
      }))
      // Blindaje (ver getModifierGroupsForItem): descartar registros malformados
      // (max_selections ausente → NaN). Evita que basura del cache (p.ej. meseros
      // por IDB dañado) se renderice como grupos de modificadores.
      .filter(g => g.maxSelections === null || Number.isFinite(g.maxSelections))
      .filter(g => g.options.length > 0)
      .filter(g => isGroupCompatible(g.name, categoryId))
  } catch {
    return []
  }
}

/**
 * Pre-fetches all data needed for offline operation and stores it in IndexedDB.
 * Call once on successful POS init (online session).
 * Covers: modifier groups, modifiers, item/category modifier links, payment methods, staff list.
 */
export async function prefetchOfflineData(): Promise<void> {
  const cid = _getClientId()
  try {
    const [groupsRes, modsRes, itemLinksRes, catLinksRes, methodsRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifier_groups?client_id=eq.${cid}&active=eq.true&select=id,name,level,min_selections,max_selections,required,sort_order`, { headers: _SB_HEADERS }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifiers?client_id=eq.${cid}&active=eq.true&select=id,group_id,name,price,sort_order`, { headers: _SB_HEADERS }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_item_modifier_groups?client_id=eq.${cid}&select=item_id,group_id`, { headers: _SB_HEADERS }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_category_modifiers?client_id=eq.${cid}&select=category_id,modifier_group_id`, { headers: _SB_HEADERS }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_payment_methods?client_id=eq.${cid}&active=eq.true&select=id,name,type,commission_pct&order=name.asc`, { headers: _SB_HEADERS }),
    ])

    const { cacheModifierData, cachePaymentMethods } = await import('@/lib/pos-offline-db')

    if (groupsRes.ok && modsRes.ok) {
      const groups = await groupsRes.json() as Record<string, unknown>[]
      const mods = await modsRes.json() as Record<string, unknown>[]
      const links: Record<string, unknown>[] = []
      if (itemLinksRes.ok) {
        const rows = await itemLinksRes.json() as { item_id: string; group_id: string }[]
        for (const r of rows) links.push({ id: `item:${r.item_id}:${r.group_id}`, item_id: r.item_id, group_id: r.group_id })
      }
      if (catLinksRes.ok) {
        const rows = await catLinksRes.json() as { category_id: string; modifier_group_id: string }[]
        for (const r of rows) links.push({ id: `cat:${r.category_id}:${r.modifier_group_id}`, category_id: r.category_id, group_id: r.modifier_group_id })
      }
      await cacheModifierData(groups, mods, links)
    }

    if (methodsRes.ok) {
      const methods = await methodsRes.json() as Record<string, unknown>[]
      await cachePaymentMethods(methods)
    }
  } catch {
    // Network error — already cached from previous session
  }
}

export async function getModifiersForCategoryFromDB(categoryId: string): Promise<{
  quitarOptions: string[]
  agregarOptions: ModificadorAgregar[]
}> {
  try {
    const assignRes = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_category_modifiers?client_id=eq.${_getClientId()}&category_id=eq.${categoryId}&select=modifier_group_id`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!assignRes.ok) return getModifiersForCategory(categoryId)

    const assignments: { modifier_group_id: string }[] = await assignRes.json()
    if (!assignments.length) return { quitarOptions: [], agregarOptions: [] }

    const groupIds = assignments.map(a => a.modifier_group_id)
    const modRes = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_modifiers?client_id=eq.${_getClientId()}&active=eq.true&group_id=in.(${groupIds.join(',')})&order=sort_order.asc`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!modRes.ok) return getModifiersForCategory(categoryId)

    const mods: { group_id: string; name: string; price: number }[] = await modRes.json()
    return {
      quitarOptions: mods.filter(m => m.group_id === 'quitar').map(m => m.name),
      agregarOptions: mods.filter(m => m.group_id !== 'quitar').map(m => ({ name: m.name, price: Number(m.price) })),
    }
  } catch {
    return getModifiersForCategory(categoryId)
  }
}

// Map POS menu item names → recipe names in database
// This connects every platillo to its recipe for dynamic modifiers + inventory deduction
export const RECIPE_ALIASES: Record<string, string[]> = {
  // Chilaquiles & Enchiladas
  'chilaquiles verdes': ['chilaquiles verdes'],
  'chilaquiles rojos': ['chilaquiles rojos'],
  'chilaquiles light': ['chilaquiles ligth', 'chilaquiles light'],
  'enchiladas suizas': ['enchiladas suizas'],
  // Eggs & Keto
  'machacado con huevo': ['machacado con huevo', 'machaca con huevo'],
  'half & half combo': ['half & half combo'],
  'garden omelet': ['garden omelet', 'garden omelette'],
  'combo fit': ['combo fit'],
  'egg and pancake combo': ['combo kids pancake & eggs'],
  'miss benedict': ['miss. benedict', 'miss benedict- salmon', 'miss benedict panela wallander'],
  // Coffee
  'cafe americano': ['cafe americano'],
  'capuchino caliente': ['capuchino'],
  'cafe latte caliente': ['cafe latte'],
  'latte frio': ['latte frio'],
  'matcha latte frio': ['matcha latte'],
  'chai latte frio': ['chai latte'],
  'mocca latte caliente': ['mocca latte'],
  // Toast & Bagels
  'avocado toast': ['avo toast'],
  'amalay salmon special toast': ['amalay smoked salmon & avocado toast'],
  'el mexicano toast': ['el mexicano toast', 'mexicano'],
  'salmon bagel': ['salmon bagel'],
  // Everyday Specials
  'combo amalay': ['combo amalay'],
  'french toast': ['french toast'],
  // Signature
  'mimosa clasica': ['mimosa clasica'],
  'chamoyada de mango': ['chamoyada de mango'],
  // Croissants
  'croque madame amalay': ['croque madame', 'mumma"s breakfast croissant', "mumy's breakfast croissant"],
  'croissant nutella': ['croissant nutella'],
  'turkey & swiss croissant': ['turkey & swiss croisaint', "nell's turkey & swiss"],
  'croissant almendra': ['croissant almendra'],
  // Jugos
  'jugo de naranja natural': ['jugo de naranja'],
  'jugo verde de la casa': ['jugo verde'],
  'jugo be inmune': ['jugo be inmune'],
  'jugo dr detox': ['jugo dr detox'],
  'jugo u glow': ['jugo u glow'],
  // Fresh Drinks
  'limonada natural': ['limonada natural'],
  'limonada de frutos rojos': ['limonada de frutos rojos'],
  // Smoothies
  'smoothie mango-matcha': ['smoothie mango matcha'],
  'smoothie pink flamingo': ['smoothie pink flamingo'],
  'smoothie tropical coconut': ['smoothie tropical coconut'],
  // Frappes
  'frapuccino': ['frapuccino'],
  'frappe matcha': ['frappe matcha'],
  'frappe mango-maracuya': ['frappe mango maracuya'],
  // Pancakes & Waffles
  'classic pancakes': ['classic buttermilk pancakes', 'classic butermilk pancakes'],
  // Paninis
  'chicken panini': ['turkey pannini', 'turkey panini'],
  // Pizzas & Pastas
  'pasta mamarosa': ['pasta pacceri al pesto'],
  'pasta bologese': ['pasta bologese'],
  'pizza pepperoni': ['pizza peperoni'],
  'pizza peperoni': ['pizza peperoni'],
  'pizza margarita': ['pizza margarita'],
  // Bowls
  'acai love bowl': ['acai love'],
  'fruit bowl': ['plato de berrys', 'plato granola con berries'],
  // Postres
  'cheesecake': ['cheesecake'],
  'carrot cake': ['carrot cake', 'coffe cake'],
  // Bakery
  'concha de mantequilla': ['concha de mantequilla'],
  'healthy crunchy mix': ['healthy & crunchy', 'healty munchies'],
  // Tea
  'te chai': ['te chai'],
  'te verde': ['te verde'],
}

// Phase-gate: when set to 'disabled', the fuzzy fallback (RECIPE_ALIASES + name matching)
// is skipped and only the DB recipe_ref is used. Flip via Vercel env var — no deploy needed.
// Retirement criteria: 0 fuzzy logs for AMALAY during 7 consecutive days.
const RECIPE_FALLBACK_ENABLED =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_RECIPE_FALLBACK : undefined) !== 'disabled'

/** Un pago dentro de una cuenta (pago mixto multi-forma, estilo el POS legado) */
export interface PagoForma {
  metodo: string
  monto: number
}

export interface Order {
  id: string
  mesa: number
  /** Cuenta por nombre (sin mesa, estilo el POS legado "#SR RAUL") — mesa queda en 0 */
  clienteNombre?: string
  mesero: string
  personas: number
  status: 'abierta' | 'enviada' | 'preparando' | 'lista' | 'entregada' | 'cerrada' | 'cancelada'
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  descuento: number
  propina?: number
  metodoPago?: string
  /** Desglose multi-forma del pago (suma = total + propina). Si es pago simple, 1 elemento. */
  pagos?: PagoForma[]
  /** Turno activo (pos_turnos.id) al momento de cerrar */
  turnoId?: string
  notas?: string
  createdAt: Date
  closedAt?: Date
  /** Server-authoritative monotonic order revision for optimistic concurrency */
  orderRevision?: number
  /** Per-batch status tracking for KDS (Eduardo Jul 21: separate comanda cards per send) */
  comandaBatches?: Record<string, { status: string; created_at: string; seq: number }>
  /** Sequential order number (auto-assigned by DB trigger, per client_id) */
  orderNumber?: number
}

export interface Mesa {
  number: number
  capacity: number
  status: 'disponible' | 'ocupada' | 'cuenta'
  orderId?: string
  mesero?: string
  personas?: number
  total?: number
}

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'chilaquiles', name: 'Chilaquiles', color: 'bg-rose-700', items: [
      { id: 'c1a', name: 'Chilaquiles Verdes', price: 292 },
      { id: 'c1b', name: 'Chilaquiles Rojos', price: 292 },
      { id: 'c2', name: 'Chilaquiles Light', price: 304 },
      { id: 'c3', name: 'Enchiladas Suizas', price: 261 },
      { id: 'c4', name: 'Taquitos Amalay', price: 279 },
    ]
  },
  {
    id: 'eggs', name: 'Huevos', color: 'bg-yellow-500', items: [
      { id: 'e1', name: 'Machacado con Huevo', price: 274 },
      { id: 'e2', name: 'Half & Half Combo', price: 287 },
      { id: 'e3', name: 'Garden Omelet', price: 264 },
      { id: 'e4', name: 'Combo Fit', price: 264 },
      { id: 'e5', name: 'Egg and Pancake Combo', price: 277 },
      { id: 'e6', name: 'Miss Benedict', price: 310 },
      { id: 'e7', name: 'Miss Benedict Keto-Panela Wallander', price: 389 },
      { id: 'e8', name: 'Mr. Benedict', price: 351 },
      { id: 'e9', name: 'Benedict Omelet', price: 283 },
    ]
  },
  {
    id: 'coffee', name: 'Café', color: 'bg-amber-700', items: [
      { id: 'cf1', name: 'Cafe Americano', price: 48 },
      { id: 'cf2', name: 'Capuchino Caliente', price: 89 },
      { id: 'cf3', name: 'Cafe Latte Caliente', price: 94 },
      { id: 'cf4', name: 'Latte Frio', price: 102 },
      { id: 'cf5', name: 'Matcha Latte Frio', price: 127 },
      { id: 'cf6', name: 'Chai Latte Frio', price: 122 },
      { id: 'cf7', name: 'Mocca Latte Caliente', price: 100 },
      { id: 'cf8', name: 'Chai Latte Caliente', price: 122 },
      { id: 'cf9', name: 'Mocca Latte Frio', price: 108 },
    ]
  },
  {
    id: 'toast', name: 'Pan & Toast', color: 'bg-orange-500', items: [
      { id: 't1', name: 'Avocado Toast', price: 252 },
      { id: 't2', name: 'Amalay Salmon Special Toast', price: 402 },
      { id: 't3', name: 'El Mexicano Toast', price: 183 },
      { id: 't4', name: 'Salmon Bagel', price: 350 },
    ]
  },
  {
    id: 'signature', name: 'Signature', color: 'bg-purple-600', items: [
      { id: 'sg1', name: 'Mimosa Clasica', price: 160 },
      { id: 'sg2', name: 'Chamoyada de Mango', price: 120 },
    ]
  },
  {
    id: 'croissants', name: 'Croissants', color: 'bg-yellow-600', items: [
      { id: 'cr1', name: 'Croque Madame Amalay', price: 308 },
      { id: 'cr2', name: 'Croissant Nutella', price: 99 },
      { id: 'cr3', name: 'Turkey & Swiss Croissant', price: 285 },
      { id: 'cr4', name: 'Croissant Almendra', price: 99 },
      { id: 'cr5', name: "Mumma's Breakfast Croissant", price: 268 },
    ]
  },
  {
    id: 'jugos', name: 'Jugos', color: 'bg-green-500', items: [
      { id: 'j1', name: 'Jugo de Naranja Natural', price: 78 },
      { id: 'j2', name: 'Jugo Verde de la Casa', price: 98 },
      { id: 'j3', name: 'Jugo Be Inmune', price: 115 },
      { id: 'j4', name: 'Jugo Dr Detox', price: 115 },
      { id: 'j5', name: 'Jugo U Glow', price: 115 },
    ]
  },
  {
    id: 'fresh', name: 'Frescos', color: 'bg-cyan-500', items: [
      { id: 'f1', name: 'Limonada Natural', price: 63 },
      { id: 'f2', name: 'Limonada de Frutos Rojos', price: 62 },
      { id: 'f3', name: 'Limonada de Pepino', price: 62 },
      { id: 'f4', name: 'Jamaica Natural', price: 49 },
      { id: 'f5', name: 'Horchata Natural', price: 49 },
    ]
  },
  {
    id: 'smoothies', name: 'Smoothies', color: 'bg-pink-500', items: [
      { id: 'sm1', name: 'Smoothie Mango-Matcha', price: 221 },
      { id: 'sm2', name: 'Smoothie Pink Flamingo', price: 152 },
      { id: 'sm3', name: 'Smoothie Tropical Coconut', price: 139 },
      { id: 'sm4', name: 'Smoothie Morning Blast', price: 207 },
      { id: 'sm5', name: 'Smoothie Choco-Peanut Butter', price: 175 },
    ]
  },
  {
    id: 'frappes', name: 'Frappes', color: 'bg-indigo-500', items: [
      { id: 'fr1', name: 'Frappe Matcha', price: 124 },
      { id: 'fr2', name: 'Frappe Mango-Maracuya', price: 120 },
      { id: 'fr3', name: 'Frapuccino', price: 135 },
      { id: 'fr4', name: 'Frappe Oreo', price: 132 },
    ]
  },
  {
    id: 'pancakes', name: 'Pancakes', color: 'bg-yellow-400', items: [
      { id: 'pw1', name: 'Classic Pancakes', price: 215 },
      { id: 'pw2', name: 'Paradise Buttermilk Blueberry Pancakes', price: 265 },
      { id: 'pw3', name: 'Red Velvet Pancakes', price: 250 },
    ]
  },
  {
    id: 'paninis', name: 'Paninis', color: 'bg-lime-600', items: [
      { id: 'pn1', name: 'Chicken Panini', price: 296 },
      { id: 'pn2', name: 'Caprese Panini', price: 275 },
    ]
  },
  {
    id: 'pizzas', name: 'Pizzas & Pastas', color: 'bg-rose-600', items: [
      { id: 'pz1', name: 'Pasta Mamarosa', price: 287 },
      { id: 'pz2', name: 'Pizza Pepperoni', price: 245 },
      { id: 'pz3', name: 'Pizza Margarita', price: 220 },
      { id: 'pz4', name: 'Pasta Bolognese', price: 232 },
      { id: 'pz5', name: 'Ribeye Smash Burger', price: 252 },
    ]
  },
  {
    id: 'bowls', name: 'Bowls', color: 'bg-emerald-600', items: [
      { id: 'bw1', name: 'Acai Love Bowl', price: 232 },
      { id: 'bw2', name: 'Fruit Bowl', price: 150 },
    ]
  },
  {
    id: 'postres', name: 'Postres', color: 'bg-fuchsia-500', items: [
      { id: 'ds1', name: 'New York Cheesecake', price: 130 },
      { id: 'ds2', name: 'Carrot Cake', price: 135 },
      { id: 'ds3', name: 'Dark Chocolate Brownie', price: 130 },
      { id: 'ds4', name: 'Tiramisú', price: 145 },
      { id: 'ds5', name: 'Pastel de Chocolate', price: 130 },
    ]
  },
  {
    id: 'ceviche', name: 'Ceviche', color: 'bg-sky-600', items: [
      { id: 'cv1', name: 'Ceviche de Salmon', price: 395 },
      { id: 'cv2', name: 'Ceviche Clasico', price: 320 },
    ]
  },
  {
    id: 'bakery', name: 'Panadería', color: 'bg-amber-500', items: [
      { id: 'bk1', name: 'Concha de Mantequilla', price: 37 },
      { id: 'bk2', name: 'Healthy Crunchy Mix', price: 170 },
    ]
  },
  {
    id: 'sodas', name: 'Sodas', color: 'bg-blue-500', items: [
      { id: 'sd1', name: 'Coca Cola Regular 355ml', price: 34 },
      { id: 'sd2', name: 'Coca Cola Sin Azucar 355ml', price: 60 },
      { id: 'sd3', name: 'Coca Cola Light 355ml', price: 60 },
      { id: 'sd4', name: 'Agua Amalay 500ml', price: 44 },
      { id: 'sd5', name: 'Agua de Piedra Mineral', price: 57 },
      { id: 'sd6', name: 'Agua de Piedra Natural', price: 57 },
    ]
  },
  {
    id: 'tea', name: 'Té', color: 'bg-green-700', items: [
      { id: 'te1', name: 'Te Chai', price: 75 },
      { id: 'te2', name: 'Te Verde', price: 65 },
    ]
  },
  {
    id: 'alcohol', name: 'Bebidas OH', color: 'bg-violet-700', items: [
      { id: 'al1', name: 'Cerveza Artesanal', price: 95 },
      { id: 'al2', name: 'Vino Copa Tinto', price: 150 },
    ]
  },
  {
    id: 'mkt-cafe', name: 'Mkt: Cafe', items: [
      { id: 'mk1', name: 'Cafe Grano 300g', price: 0 },
      { id: 'mk2', name: 'Cafe Grano 500g', price: 0 },
      { id: 'mk3', name: 'Cafe Molido 300g', price: 0 },
      { id: 'mk4', name: 'Cafe Molido 500g', price: 0 },
      { id: 'mk5', name: 'Vaso Cafe Refill', price: 0 },
      { id: 'mk6', name: 'Termo Chico Cafe', price: 0 },
    ]
  },
  {
    id: 'mkt-galletas', name: 'Mkt: Galletas', items: [
      { id: 'mk10', name: 'Galletas Bote Chico 20pz', price: 0 },
      { id: 'mk11', name: 'Galletas Bote 420g', price: 0 },
      { id: 'mk12', name: 'Galletas Bote Mediano 180g', price: 0 },
      { id: 'mk13', name: 'Galletas Paq 3pzs', price: 0 },
      { id: 'mk14', name: 'Galleta Sin Gluten', price: 0 },
      { id: 'mk15', name: 'Nucelli Brownie Vegan', price: 0 },
      { id: 'mk16', name: 'Nucelli Galleta Chocochips', price: 0 },
      { id: 'mk17', name: 'Brule Brownie Brittle', price: 0 },
      { id: 'mk18', name: 'Brule Galleta GF Chocolate', price: 0 },
      { id: 'mk19', name: 'Keto Cookie 120g', price: 0 },
    ]
  },
  {
    id: 'mkt-snacks', name: 'Mkt: Snacks', items: [
      { id: 'mk20', name: 'Healthy Crunch Mix 300g', price: 0 },
      { id: 'mk21', name: 'Healthy Crunch Mix 60g', price: 0 },
      { id: 'mk22', name: 'Mix Enchilado Chico', price: 0 },
      { id: 'mk23', name: 'Mix Enchilado Grande', price: 0 },
      { id: 'mk24', name: 'Mix Salud Omega 3 100g', price: 0 },
      { id: 'mk25', name: 'Pasa Chocolate Amargo 170g', price: 0 },
      { id: 'mk26', name: 'Manglo Mango Enchilado 120g', price: 0 },
      { id: 'mk27', name: 'Manglo Mango Enchilado 300g', price: 0 },
      { id: 'mk28', name: 'Mango Seco Natural 120g', price: 0 },
      { id: 'mk29', name: 'Mango Seco Natural 300g', price: 0 },
      { id: 'mk30', name: 'Chips Pepino Limon 200g', price: 0 },
      { id: 'mk31', name: 'Chips Pepino Salsa 200g', price: 0 },
      { id: 'mk32', name: 'Chips Jamaica 40g', price: 0 },
      { id: 'mk33', name: 'Granola Keto 125g', price: 0 },
      { id: 'mk34', name: 'Granola 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-amaranth', name: 'Mkt: Amaranth', items: [
      { id: 'mk40', name: 'Cacahuate Chipotle 142g', price: 0 },
      { id: 'mk41', name: 'Cacahuate Habanero 142g', price: 0 },
      { id: 'mk42', name: 'Cacahuate Limon 142g', price: 0 },
      { id: 'mk43', name: 'Cacahuate Sal Himalaya 142g', price: 0 },
      { id: 'mk44', name: 'Charris Chipotle 142g', price: 0 },
      { id: 'mk45', name: 'Charris Habanero 142g', price: 0 },
      { id: 'mk46', name: 'Charris Limon 142g', price: 0 },
      { id: 'mk47', name: 'Papas Desh Chipotle 100g', price: 0 },
      { id: 'mk48', name: 'Papas Desh Jalapeno 100g', price: 0 },
      { id: 'mk49', name: 'Obleas Dif Sabores 58g', price: 0 },
    ]
  },
  {
    id: 'mkt-smarty', name: 'Mkt: Smarty Chips', items: [
      { id: 'mk50', name: 'Jicama Adobada 170g', price: 0 },
      { id: 'mk51', name: 'Jicama Adobada 50g', price: 0 },
      { id: 'mk52', name: 'Jicama Habanero 170g', price: 0 },
      { id: 'mk53', name: 'Jicama Limon 170g', price: 0 },
      { id: 'mk54', name: 'Jicama Limon 50g', price: 0 },
      { id: 'mk55', name: 'Jicama Natural 170g', price: 0 },
      { id: 'mk56', name: 'Jicama Natural 50g', price: 0 },
      { id: 'mk57', name: 'Jicama Torito 170g', price: 0 },
      { id: 'mk58', name: 'Jicama Torito 50g', price: 0 },
    ]
  },
  {
    id: 'mkt-sanutri', name: 'Mkt: Sanutri', items: [
      { id: 'mk60', name: 'Churritos Chipotle 300g', price: 0 },
      { id: 'mk61', name: 'Churritos Fuego 300g', price: 0 },
      { id: 'mk62', name: 'Churritos Mix Crunch 300g', price: 0 },
      { id: 'mk63', name: 'Churritos Nopal 300g', price: 0 },
      { id: 'mk64', name: 'Churritos Sal y Limon 300g', price: 0 },
      { id: 'mk65', name: 'Churritos Chile Limon 300g', price: 0 },
      { id: 'mk66', name: 'Churritos Habanero 300g', price: 0 },
    ]
  },
  {
    id: 'mkt-dulces', name: 'Mkt: Dulces', items: [
      { id: 'mk70', name: 'Guayabate Guayaba 100g', price: 0 },
      { id: 'mk71', name: 'Guayabate Tabletas 100g', price: 0 },
      { id: 'mk72', name: 'Guayabate Tejocote 100g', price: 0 },
      { id: 'mk73', name: 'Nubits Tamarindo 30g', price: 0 },
      { id: 'mk74', name: 'Vamara Ciruela Enchilada 250g', price: 0 },
      { id: 'mk75', name: 'Vamara Datil Enchilado 220g', price: 0 },
      { id: 'mk76', name: 'Vamara Mix Enchilado 220g', price: 0 },
      { id: 'mk77', name: 'Vamara Manzana Enchilada 180g', price: 0 },
      { id: 'mk78', name: 'Duraznero Durazno/Chile 250g', price: 0 },
      { id: 'mk79', name: 'Duraznero Fresa/Chile 250g', price: 0 },
      { id: 'mk80', name: 'Duraznero Mango/Chile 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-proteina', name: 'Mkt: Proteina', items: [
      { id: 'mk90', name: 'Habits Cacao 488g', price: 0 },
      { id: 'mk91', name: 'Habits Vainilla 488g', price: 0 },
      { id: 'mk92', name: 'Habits Matcha-Vainilla 488g', price: 0 },
      { id: 'mk93', name: 'Habits Maca-Cacao 488g', price: 0 },
      { id: 'mk94', name: 'Habits Natural 488g', price: 0 },
      { id: 'mk95', name: 'Habits High Perf Cacao 578g', price: 0 },
      { id: 'mk96', name: 'Habits High Perf Vainilla 578g', price: 0 },
      { id: 'mk97', name: 'Habits Creatina 300g', price: 0 },
      { id: 'mk98', name: 'Habits Colageno 250g', price: 0 },
      { id: 'mk99', name: 'Birdman Falcon Chocolate 510g', price: 0 },
      { id: 'mk100', name: 'Birdman Falcon Vainilla 510g', price: 0 },
      { id: 'mk101', name: 'Birdman Fitmingo Moka 510g', price: 0 },
      { id: 'mk102', name: 'Birdman Creatina 450g', price: 0 },
      { id: 'mk103', name: 'Vital Proteins Collagen 567g', price: 0 },
    ]
  },
  {
    id: 'mkt-suplementos', name: 'Mkt: Suplementos', items: [
      { id: 'mk110', name: 'Olly Sleep 50 Gummies', price: 0 },
      { id: 'mk111', name: 'Olly Sleep Extra 70 Gummies', price: 0 },
      { id: 'mk112', name: 'Olly Kids Sleep 50 Gummies', price: 0 },
      { id: 'mk113', name: 'Olly Womens Multi 90pz', price: 0 },
      { id: 'mk114', name: 'Olly Glowing Skin 50 Gummies', price: 0 },
      { id: 'mk115', name: 'Olly Beauty 60 Gummies', price: 0 },
      { id: 'mk116', name: 'Calm Magnesium Raspberry 60pz', price: 0 },
      { id: 'mk117', name: 'Calm Magnesium Orange 453g', price: 0 },
      { id: 'mk118', name: 'Calm Sleep Gummies 240', price: 0 },
      { id: 'mk119', name: 'Force Factor Mushrooms 60pz', price: 0 },
      { id: 'mk120', name: 'Natrol Melatonine 150 Tab', price: 0 },
    ]
  },
  {
    id: 'mkt-te', name: 'Mkt: Te & Infusiones', items: [
      { id: 'mk130', name: 'Te Jengibre Limon 100g', price: 0 },
      { id: 'mk131', name: 'Te Mora de la Selva 220g', price: 0 },
      { id: 'mk132', name: 'Te Petalo Mio 100g', price: 0 },
      { id: 'mk133', name: 'Te Ponche Guayaba 150g', price: 0 },
      { id: 'mk134', name: 'Raices Matcha Mix 125g', price: 0 },
      { id: 'mk135', name: 'Raices Golden Mane 250g', price: 0 },
      { id: 'mk136', name: 'Raices Reishi Cacao 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-lanona', name: 'Mkt: La Nona', items: [
      { id: 'mk140', name: 'Doraditas Keto/Almendras 120g', price: 0 },
      { id: 'mk141', name: 'Doraditas Vegana/Platano 130g', price: 0 },
      { id: 'mk142', name: 'Doraditas Avena/Stevia 130g', price: 0 },
      { id: 'mk143', name: 'Doraditas Chocolate/Avena 130g', price: 0 },
      { id: 'mk144', name: 'Gorditas Avena/Stevia 270g', price: 0 },
      { id: 'mk145', name: 'Gorditas Chocolate/Avena 270g', price: 0 },
    ]
  },
  {
    id: 'mkt-rojamaica', name: 'Mkt: Rojamaica', items: [
      { id: 'mk150', name: 'Chips de Rojamaica 40g', price: 0 },
      { id: 'mk151', name: 'Dip de Rojamaica 320g', price: 0 },
      { id: 'mk152', name: 'Jamaica Enchilada 50g', price: 0 },
      { id: 'mk153', name: 'Salsa Rojamaica 250g', price: 0 },
      { id: 'mk154', name: 'Salsa Rojamaica 520g', price: 0 },
    ]
  },
  {
    id: 'mkt-belleza', name: 'Mkt: Belleza', items: [
      { id: 'mk160', name: 'Hand & Body Lotion 500ml', price: 0 },
      { id: 'mk161', name: 'Hand Wash 500ml', price: 0 },
      { id: 'mk162', name: 'Mali Bronceador Cacao 100ml', price: 0 },
      { id: 'mk163', name: 'Mali Bronceador Carrot 100ml', price: 0 },
      { id: 'mk164', name: 'Mali Bronceador Sun 100ml', price: 0 },
      { id: 'mk165', name: 'Mali Tanning Foam 200ml', price: 0 },
      { id: 'mk166', name: 'Renew Jabon Corporal 355ml', price: 0 },
      { id: 'mk167', name: 'Renew Locion 237ml', price: 0 },
      { id: 'mk168', name: 'Melaleuca Gel', price: 0 },
      { id: 'mk169', name: 'Aceite Melaleuca 15ml', price: 0 },
    ]
  },
  {
    id: 'mkt-accesorios', name: 'Mkt: Accesorios', items: [
      { id: 'mk170', name: 'Taza Ceramica Blanca', price: 0 },
      { id: 'mk171', name: 'Taza Ceramica Verde', price: 0 },
      { id: 'mk172', name: 'Taza Termica', price: 0 },
      { id: 'mk173', name: 'Termo Grande 1.2L', price: 0 },
      { id: 'mk174', name: 'Totebag', price: 0 },
      { id: 'mk175', name: 'Libreta c/ Pluma', price: 0 },
      { id: 'mk176', name: 'Velita Decoracion', price: 0 },
      { id: 'mk177', name: 'Gift Card', price: 0 },
      { id: 'mk178', name: 'Tarjeta de Regalo', price: 0 },
      { id: 'mk179', name: 'Ramekin Corazon', price: 0 },
      { id: 'mk180', name: 'Jarra Infusora', price: 0 },
      { id: 'mk181', name: 'Planta Chica', price: 0 },
      { id: 'mk182', name: 'Planta Grande', price: 0 },
    ]
  },
  {
    id: 'mkt-libros', name: 'Mkt: Libros', items: [
      { id: 'mk190', name: 'Como Hacer Que Te Pasen Cosas Buenas', price: 0 },
      { id: 'mk191', name: 'Encuentra Tu Persona Vitamina', price: 0 },
      { id: 'mk192', name: 'Human Kind', price: 0 },
      { id: 'mk193', name: 'Kidness', price: 0 },
      { id: 'mk194', name: 'Las Cosas Que No Nos Dijeron', price: 0 },
      { id: 'mk195', name: 'Recupera Tu Mente', price: 0 },
      { id: 'mk196', name: 'The Hidden Power', price: 0 },
      { id: 'mk197', name: 'The War For Kidness', price: 0 },
    ]
  },
]

// MESEROS — fetched dynamically from pos_staff table
// Fallback used only when DB is unreachable (offline mode)
// Empty fallback — staff comes from DB. No hardcoded names from any client.
const MESEROS_FALLBACK: string[] = []

// Dynamic meseros — populated by fetchMeseros(), falls back to hardcoded if offline
export let MESEROS: string[] = [...MESEROS_FALLBACK]

// Fetch active meseros from pos_staff (roles: mesero, cajero, barra, supervisor)
// Call this on POS init — updates the module-level MESEROS array
export async function fetchMeseros(clientId?: string): Promise<string[]> {
  const cid = clientId || getClientId()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return MESEROS

  try {
    const res = await fetch(
      `${url}/rest/v1/pos_staff?client_id=eq.${cid}&active=eq.true&role=in.(mesero,cajero,barra,supervisor)&select=name&order=name.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows: { name: string }[] = await res.json()
      if (rows.length > 0) {
        MESEROS = rows.map(r => r.name)
        // NOTE: key is pos_meseros_cache (NOT pos_staff_cache) — pos_staff_cache is
        // owned by the offline PIN auth object {id,pin_hash,exp} in pos/layout.tsx.
        // Sharing the key clobbered the auth object → offline PIN login broke.
        try { localStorage.setItem('pos_meseros_cache', JSON.stringify(MESEROS)) } catch {}
        return MESEROS
      }
    }
  } catch {
    // Network error — try localStorage cache (own key, see note above)
    try {
      const cached = localStorage.getItem('pos_meseros_cache')
      if (cached) {
        const parsed: string[] = JSON.parse(cached)
        if (parsed.length > 0) { MESEROS = parsed; return MESEROS }
      }
    } catch {}
  }

  return MESEROS
}

// IVA_RATE lives in pos-constants.ts (single source of truth)

// El plano de salón de CADA restaurante, cacheado localmente.
//
// Antes aquí vivía el plano físico de AMALAY —33 mesas con sus capacidades— compilado
// dentro del bundle. Funcionaba, pero le daba a AMALAY una capacidad que ningún otro
// restaurante podía tener: cuando `fetchPosMesas` no responde (arranque en frío sin
// internet, o sin configuración), AMALAY recuperaba sus 33 mesas y cualquier otro se
// quedaba con 16 genéricas de capacidad 4. Y /pos/qr, que sólo usa este camino, imprimía
// QR para mesas 1..16 sin importar cómo fuera el salón de verdad.
//
// Ahora el respaldo es el plano del propio restaurante: `fetchPosMesas` guarda lo que
// leyó y `getMesasConfig` lo recupera. Mismo comportamiento para AMALAY —sus 33 mesas
// salen de su caché en vez del bundle— y por fin el mismo comportamiento para todos.
//
// localStorage y no IndexedDB a propósito: `getMesasConfig` es SÍNCRONA y se llama en el
// inicializador de un useState. IndexedDB es asíncrona y obligaría a cambiar la firma y
// todos los llamadores, incluidos archivos que otra sesión está tocando.
//
// La llave empieza con `pos_` para que la barra el guard de cambio de tenant de
// pos-offline-db.ts, que limpia todo `pos_*` cuando el dispositivo cambia de restaurante.
const LLAVE_PLANO = (clientId: string) => `pos_plano_${clientId}`

interface MesaCacheada { number: number; capacity: number }

/** Guarda el plano leído de la base para que sobreviva un arranque sin internet. */
export function cachearPlano(clientId: string, mesas: MesaCacheada[]): void {
  if (typeof window === 'undefined' || !clientId || mesas.length === 0) return
  try {
    const minimo = mesas.map(m => ({ number: m.number, capacity: m.capacity ?? 4 }))
    localStorage.setItem(LLAVE_PLANO(clientId), JSON.stringify(minimo))
  } catch { /* cuota llena o modo privado — no es fatal, se cae al genérico */ }
}

function leerPlanoCacheado(clientId: string): Mesa[] | null {
  if (typeof window === 'undefined' || !clientId) return null
  try {
    const crudo = localStorage.getItem(LLAVE_PLANO(clientId))
    if (!crudo) return null
    const filas = JSON.parse(crudo) as MesaCacheada[]
    if (!Array.isArray(filas) || filas.length === 0) return null
    return filas
      .filter(f => Number.isFinite(f?.number))
      .map(f => ({
        number: Number(f.number),
        capacity: Number.isFinite(f?.capacity) ? Number(f.capacity) : 4,
        status: 'disponible' as const,
      }))
  } catch { return null }
}

/**
 * Plano de salón de respaldo, para cuando la base no responde.
 *
 * Orden: el plano cacheado del propio restaurante → mesas secuenciales 1..count.
 *
 * Ya no hay un caso especial por slug. El plano de AMALAY sale de su caché igual que
 * el de cualquier otro, así que un restaurante nuevo puede tener el suyo — que era
 * justo lo que no se podía antes.
 *
 * Se exige que el tenant venga de una sesión real y no del valor por omisión: la caché
 * está indexada por clientId, así que un slug equivocado no encuentra nada y cae al
 * genérico, en vez de montar el salón de otro restaurante.
 */
export function getMesasConfig(clientId: string, count: number): Mesa[] {
  const cacheado = leerPlanoCacheado(clientId)
  if (cacheado) return cacheado

  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    capacity: 4,
    status: 'disponible' as const,
  }))
}

export function formatMXN(amount: number): string {
  const safe = typeof amount === 'number' && !isNaN(amount) ? Math.round(amount * 100) / 100 : 0
  return `$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

// ─── Supabase persistence ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Result from revision-aware save */
export interface SaveOrderResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  error?: string
  expected_revision?: number
  current_revision?: number
  first_execution?: boolean
  idempotent_replay?: boolean
  inventory_status?: 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
}

/** Result from append-only item add (r1_add_items) */
export interface AddItemsResult {
  ok: boolean
  revision?: number
  added?: number
  error?: string
}

export async function addOrderItems(orderId: string, items: OrderItem[]): Promise<AddItemsResult> {
  try {
    const res = await fetch('/api/pos/add-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
      body: JSON.stringify({ order_id: orderId, items }),
    })
    if (!res.ok) {
      console.error('[addOrderItems] API error:', res.status)
      return { ok: false, error: 'API_ERROR' }
    }
    return await res.json()
  } catch (err) {
    console.error('[addOrderItems] network error:', err)
    return { ok: false, error: 'NETWORK_ERROR' }
  }
}

export async function saveOrder(order: Order, saveOperationId?: string): Promise<SaveOrderResult> {
  // ── Turno enforcement: orders MUST have a turno_id ──
  if (!order.turnoId) {
    console.error('[saveOrder] BLOCKED: turno_id is required. No active turno.')
    return { ok: false, error: 'NO_TURNO' }
  }

  // Payment reconciliation: sum(pagos.monto) must equal total + propina exactly (in cents)
  if (order.status === 'cerrada' && order.pagos && order.pagos.length > 0) {
    const toCents = (n: number) => Math.round((n || 0) * 100)
    const pagosSum = order.pagos.reduce((s: number, p: { monto?: number }) => s + toCents(p.monto || 0), 0)
    const expected = toCents(order.total) + toCents(order.propina || 0)
    if (pagosSum !== expected) {
      console.error(`[saveOrder] Payment reconciliation failed: pagos=${pagosSum}¢ vs expected=${expected}¢`)
      return { ok: false, error: 'PAYMENT_MISMATCH' }
    }
  }

  const expectedRevision = order.orderRevision ?? 0
  const payload: Record<string, unknown> = {
    order_id: order.id,
    // Generated once for the create operation, before any network attempt, and then
    // preserved unchanged in the queue. Later edits must not rewrite capture time.
    ...(expectedRevision === 0 ? { captured_at: new Date().toISOString() } : {}),
    expected_revision: expectedRevision,
    mesa: order.mesa,
    customer_name: order.clienteNombre ?? null,
    mesero: order.mesero,
    personas: order.personas,
    status: order.status,
    subtotal: order.subtotal,
    iva: order.iva,
    total: order.total,
    descuento: order.descuento,
    propina: order.propina ?? 0,
    metodo_pago: order.metodoPago ?? null,
    pagos: order.pagos && order.pagos.length > 0 ? order.pagos : null,
    turno_id: order.turnoId,
    notas: order.notas ?? null,
    items: order.items,
    closed_at: order.closedAt ? order.closedAt.toISOString() : null,
    comanda_batches: order.comandaBatches ?? null,
  }
  // R2D: save_operation_id for exactly-once idempotency.
  // Generated ONCE per logical save action. Same ID survives catch → queue → replay.
  if (saveOperationId) {
    payload.save_operation_id = saveOperationId
  }

  // Encola el save para replay idempotente (save_operation_id dedup server-side).
  // Sobrevive catch offline -> cola -> replay con token fresco. Usado tanto por el
  // path offline (catch) como por el 401 (sesion expirada) para NUNCA perder la orden/cobro.
  const queueForReplay = async () => {
    if (typeof window === 'undefined') return
    try {
      const { queueOperation, cacheOrder } = await import('@/lib/pos-offline-db')
      await queueOperation('pos_orders', 'POST', payload, '/api/pos/save-order',
        (order.orderRevision ?? 0).toString(), 'APP_API')
      await cacheOrder({
        id: order.id,
        created_at: new Date().toISOString(),
        client_id: _getClientId(),
        ...payload,
        items: JSON.stringify(order.items),
      })
    } catch {
      const queue = JSON.parse(localStorage.getItem('fullsite_offline_queue') || '[]')
      queue.push({ table: 'pos_orders', data: payload, endpoint: '/api/pos/save-order', transport: 'APP_API', timestamp: Date.now(), synced: false })
      localStorage.setItem('fullsite_offline_queue', JSON.stringify(queue))
    }
    console.log('[offline] Order saved to queue — will sync when online')
  }

  // OFFLINE GUARD (root-cause fix): the POS runs under a Service Worker that
  // intercepts /api/* (network-first). When there is no internet the SW can RETURN a
  // non-ok Response instead of letting fetch throw — which used to fall through to
  // API_ERROR, so the send flow showed "Error al guardar orden — NO se imprimió" and
  // never took the offline branch that prints via the local bridge. Detecting offline
  // up front guarantees the OFFLINE_QUEUED path (queue for idempotent replay + print).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await queueForReplay()
    return { ok: false, error: 'OFFLINE_QUEUED' }
  }

  try {
    // Hard timeout on the save request. Without it, "connected to the LAN but no
    // internet" (navigator.onLine stays true, so the guard above doesn't fire) makes
    // this fetch hang forever and FREEZES the POS. On timeout we abort → the catch
    // below queues for replay and returns OFFLINE_QUEUED (prints via the local bridge).
    const controller = new AbortController()
    // The operator may still be connected to the restaurant LAN while the WAN is
    // down, so navigator.onLine can remain true. Fall back quickly to the durable,
    // idempotent offline queue so local KDS/printer delivery is not held for 7s.
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    const res = await fetch('/api/pos/save-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      console.warn(`[saveOrder] API error: ${res.status}`)
      // 401/403 = shift token expirado (withPOSAuth rechaza; algunos paths dan 403).
      // NO perder la orden/cobro: encolar para replay idempotente (save_operation_id
      // dedup) y señalar re-login. (P0 dinero)
      if (res.status === 401 || res.status === 403) {
        await queueForReplay()
        return { ok: false, error: 'SESSION_EXPIRED' }
      }
      // status 0 (SW/network offline fallback) or a transient 5xx must NOT lose the
      // order or skip printing: queue for idempotent replay and take the offline path
      // (prints via the local bridge). Real client errors (4xx) still surface.
      if (res.status === 0 || res.status >= 500) {
        await queueForReplay()
        return { ok: false, error: 'OFFLINE_QUEUED' }
      }
      return { ok: false, error: 'API_ERROR' }
    }

    const result: SaveOrderResult = await res.json()

    if (result.conflict) {
      console.warn(`[saveOrder] STALE_WRITE_REJECTED: expected rev ${result.expected_revision}, server at ${result.current_revision}`)
    }

    return result
  } catch (err) {
    // Offline — queue the revision-aware save for later replay
    console.warn('[saveOrder] Network error — queuing offline:', err)
    await queueForReplay()
    return { ok: false, error: 'OFFLINE_QUEUED' }
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'cerrada') body.closed_at = new Date().toISOString()

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    )
    return res.ok
  } catch {
    // Offline — queue the update for sync
    if (typeof window !== 'undefined') {
      try {
        const { queueOperation, getCachedOrders, cacheOrder } = await import('@/lib/pos-offline-db')
        await queueOperation('pos_orders', 'PATCH', body, `pos_orders?id=eq.${orderId}`)
        // Reflejar el cambio en la caché local para que el KDS offline lo muestre
        const cached = (await getCachedOrders()).find(o => o.id === orderId)
        if (cached) await cacheOrder({ ...cached, ...body })
      } catch {
        const queue = JSON.parse(localStorage.getItem('fullsite_offline_queue') || '[]')
        queue.push({ table: 'pos_orders', method: 'PATCH', endpoint: `pos_orders?id=eq.${orderId}`, data: body, timestamp: Date.now(), synced: false })
        localStorage.setItem('fullsite_offline_queue', JSON.stringify(queue))
      }
      console.log(`[offline] Order ${orderId} status=${status} queued for sync`)
    }
    return true
  }
}

export interface ComandaBatch {
  status: string      // 'enviada' | 'preparando' | 'lista'
  created_at: string  // ISO timestamp of when this batch was sent
  seq: number         // 0 = first send, 1 = second, etc.
}

export interface KitchenOrderFromDB {
  id: string
  mesa: number
  mesero: string
  status: string
  items: string // JSON string of OrderItem[]
  kds_item_status: string | null // JSON string of Record<string, boolean> — separate from items to avoid race condition
  comanda_batches: string | null // JSON string of Record<string, ComandaBatch> — per-batch status
  created_at: string
  updated_at?: string // last activity — used to keep long-running tables on the KDS
  notas: string | null
  order_revision?: number
  order_number?: number
  personas?: number
}

export async function getKitchenOrders(): Promise<KitchenOrderFromDB[]> {
  // Only fetch today's orders (not ancient ones stuck in "enviada")
  const today = new Date()
  today.setHours(today.getHours() - 12) // Last 12 hours
  const cutoff = today.toISOString()

  let orders: KitchenOrderFromDB[]
  try {
    // KDS displays read via the same-origin /api/pos/kitchen endpoint (server-side
    // service key, tenant-scoped, kitchen-only fields). A login-less KDS cannot read
    // pos_orders directly — the anon key hits RLS and sees 0 rows — and a KDS on a
    // separate machine cannot hold the LAN ws:// bridge from an https page (mixed
    // content). This endpoint is the reliable online path; offline still falls back
    // to the IndexedDB cache in the catch block below. `cutoff` is applied server-side.
    // Token de cocina por-tenant (provisionado a la terminal; el Electron KDS lo
    // inyecta desde su config). Si no está presente, el endpoint opera abierto.
    const _kt = typeof window !== 'undefined' ? localStorage.getItem('pos_kitchen_token') : null
    const res = await fetchWithTimeout(
      `/api/pos/kitchen?client_id=${encodeURIComponent(_getClientId())}`,
      { cache: 'no-store', headers: _kt ? { 'x-kitchen-token': _kt } : undefined }
    )
    // Un error del servidor NO puede devolver lista vacía.
    //
    // Con `return []`, un 400 —por ejemplo un client_id que la terminal no supo
    // resolver— dejaba el tablero de cocina VACÍO Y EN SILENCIO: sin comandas,
    // sin aviso, y sin caer al caché de IndexedDB, porque una respuesta 400
    // RESUELVE y el `catch` de abajo nunca se alcanzaba. La cocina se quedaba
    // ciega y nadie se enteraba.
    //
    // Lanzando, el catch hace lo que ya sabe hacer: mostrar las comandas
    // cacheadas en el dispositivo. Para una pantalla de cocina, ver las últimas
    // comandas conocidas siempre es mejor que ver la nada.
    if (!res.ok) throw new Error(`kitchen_http_${res.status}`)
    orders = await res.json()
    // Cache para offline — fire and forget, no bloquea
    if (typeof window !== 'undefined') {
      import('@/lib/pos-offline-db').then(({ cacheOrder }) =>
        Promise.all(orders.map(o => cacheOrder(o as unknown as Record<string, unknown>)))
      ).catch(() => {})
    }
    // Anti-clobber: en el KDS, una comanda enviada offline llega por el bridge (WS)
    // y se cachea en IndexedDB marcada _bridge_unsynced. Aún no está en Supabase, así
    // que el poll online la borraría de la vista (la cocina la ve aparecer y
    // desaparecer). Mergeamos las cacheadas marcadas que NO estén ya en el resultado
    // de Supabase. Cuando la orden sincroniza y aparece en el poll, se re-cachea SIN
    // la marca (put la sobrescribe), así deja de mergearse y no se duplica. No resucita
    // cerradas: al cerrarse también sale del resultado activo y ya no trae la marca.
    // Ventana corta: solo mergeamos comandas del bridge recibidas en los últimos
    // minutos. Al reconectar, la cola del POS sincroniza en segundos y la orden
    // aparece en Supabase (se re-cachea sin marca). La ventana evita que órdenes
    // marcadas que NUNCA sincronizaron (p.ej. sesión caída) se resuciten para
    // siempre y llenen el KDS. El created_at cacheado = hora en que llegó por WS.
    const bridgeMergeCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    if (typeof window !== 'undefined') {
      try {
        const { getCachedOrders } = await import('@/lib/pos-offline-db')
        const existing = new Set(orders.map(o => String(o.id)))
        const cached = await getCachedOrders()
        for (const c of cached) {
          if (
            c._bridge_unsynced === true && !existing.has(String(c.id)) &&
            ['enviada', 'preparando', 'lista'].includes(String(c.status)) &&
            String(c.created_at || c.updated_at || '') >= bridgeMergeCutoff
          ) {
            orders.push({
              ...c,
              items: typeof c.items === 'string'
                ? (() => { try { return JSON.parse(c.items as string) } catch { return [] } })()
                : (c.items ?? []),
            } as unknown as KitchenOrderFromDB)
          }
        }
      } catch { /* IndexedDB unavailable — online result stands */ }
    }
  } catch {
    // Offline — mostrar las órdenes cacheadas en este dispositivo (IndexedDB)
    if (typeof window === 'undefined') return []
    try {
      const { getCachedOrders } = await import('@/lib/pos-offline-db')
      const cached = await getCachedOrders()
      orders = cached
        .filter(o =>
          ['enviada', 'preparando', 'lista'].includes(String(o.status)) &&
          String(o.created_at || o.updated_at || '') >= cutoff
        )
        .map(o => ({
          ...o,
          // IndexedDB stores items as JSON string; KDS expects parsed array
          items: typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items as string) } catch { return [] } })() : (o.items ?? []),
        })) as unknown as KitchenOrderFromDB[]
    } catch {
      return []
    }
  }

  // QW3: deduplicar por id. Antes la key era mesa+mesero+items -> dos ordenes
  // distintas identicas colapsaban (se perdia un platillo del KDS) y diferencias
  // de serializacion online/offline duplicaban cards.
  const seen = new Set<string>()
  return orders.filter(o => {
    const key = String(o.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── BLINDAJE: Audit Trail (nothing deleteable) ────────────────────────────

export type AuditAction =
  | 'order_created'
  | 'order_sent_kitchen'
  | 'order_closed'
  | 'order_cancelled'
  | 'item_added'
  | 'item_modified'
  | 'item_cancelled'
  | 'quantity_changed'
  | 'discount_applied'
  | 'discount_removed'
  | 'status_changed'
  | 'payment_processed'
  | 'preticket_printed'
  | 'merma_registered'
  | 'inventory_adjusted'
  | 'tiempo_fired'
  | 'silla_changed'
  | 'delivery_created'
  | 'delivery_assigned'
  | 'delivery_status_changed'
  | 'delivery_closed'
  | 'comandas_print_off'
  | 'comandas_print_on'
  | 'mesa_transferred'
  | 'item_transferred'
  | 'cash_retiro'
  | 'cash_deposito'
  | 'item_voided'
  | 'combo_added'
  | 'ticket_reprinted'
  | 'kitchen_item_updated'
  | 'cerrar_app'
  | 'reprint_comanda'
  | 'mp_payment_recovery_required'
  | 'mp_payment_marked_manual_review'
  | 'mesero_reassigned'

export interface AuditEvent {
  client_id?: string
  order_id?: string
  action: AuditAction
  actor: string
  mesa?: number
  details?: Record<string, unknown>
  reason?: string
  approved_by?: string
}

export async function logAudit(event: AuditEvent): Promise<boolean> {
  const payload = {
    client_id: event.client_id || _getClientId(),
    order_id: event.order_id || null,
    action: event.action,
    actor: typeof event.actor === 'string' && event.actor.trim() ? event.actor.trim() : 'POS Offline',
    mesa: event.mesa ?? null,
    details: event.details ? JSON.stringify(event.details) : null,
    reason: event.reason || null,
    approved_by: event.approved_by || null,
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_audit_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })
    if (res.ok) return true
    // HTTP error — queue for offline sync
    throw new Error(`${res.status}`)
  } catch {
    // Network error or HTTP error — queue for sync so audit events are never lost
    if (typeof window !== 'undefined') {
      try {
        const { queueOperation } = await import('@/lib/pos-offline-db')
        await queueOperation('pos_audit_log', 'POST', payload)
        console.log(`[audit] Queued for offline sync: ${event.action}`)
        return true
      } catch { /* IndexedDB unavailable */ }
    }
    return false
  }
}

export interface AuditLogEntry {
  id: number
  client_id: string
  order_id: string | null
  action: string
  actor: string
  mesa: number | null
  details: string | null
  reason: string | null
  approved_by: string | null
  created_at: string
}

export async function getAuditLog(limit = 100, offset = 0): Promise<AuditLogEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_audit_log?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}&offset=${offset}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getAuditLogForOrder(orderId: string): Promise<AuditLogEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_audit_log?client_id=eq.${_getClientId()}&order_id=eq.${orderId}&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  return res.json()
}

// Simple hash for PIN cache keys — keeps plaintext out of localStorage.
// Uses btoa(pin) as a deterministic, non-reversible-enough obfuscation for cache keying.
// (Not cryptographic — purpose is to avoid storing raw PINs, not to resist an attacker
//  with full localStorage access; that threat is out of scope for an in-person POS.)
async function _pinCacheKey(pin: string): Promise<string> {
  // Hash NO reversible (SHA-256 con sal de la app) — antes era btoa() reversible,
  // lo que dejaba recuperar el PIN del gerente leyendo localStorage. Ya no.
  try {
    const data = new TextEncoder().encode(`fs-pin-v2:${pin}`)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `len:${pin.length}` // fallback improbable; nunca guarda el PIN crudo
  }
}

// Fallback offline de auth de gerente: si el usuario LOGUEADO es admin/gerente,
// su propio PIN lo autoriza validando contra pos_staff_cache (mismo hash que el
// login: SHA-256 de `${pin}:${id}`, valido 8h). Cubre "el dueño/manager opera la
// terminal" durante un corte de internet, sin depender de una verificacion online
// reciente (la cache de 30min quedaba vacia -> "PIN invalido" offline).
const _ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }
async function _managerFromStaffCache(pin: string, minLevel = 4): Promise<{ name: string; role: string } | null> {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem('pos_staff_cache')
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || Array.isArray(s) || !s.pin_hash || !(s.exp > Date.now())) return null
    if ((_ROLE_LVL[s.role] || 0) < minLevel) return null
    const data = new TextEncoder().encode(`${pin}:${s.id}`)
    const buf = await crypto.subtle.digest('SHA-256', data)
    const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    return h === s.pin_hash ? { name: s.name as string, role: s.role as string } : null
  } catch { return null }
}

// Aprobación de gerente SERVER-VERIFICABLE: cuando el PIN se valida online, /api/pos/pin
// emite un shiftToken firmado del gerente. Lo guardamos aquí un instante para que la ruta
// de cancelar/descuento valide el ROL server-side (infalsificable), en vez de confiar en
// el string `manager`. De un solo uso, vida 2 min. Offline no hay token → device-trust
// (ver cancel-item/route.ts, decisión "como Wansoft").
let _lastManagerApproval: { token: string; name: string; at: number } | null = null
export function consumeManagerApproval(name: string): string | null {
  const a = _lastManagerApproval
  _lastManagerApproval = null // un solo uso
  if (a && a.name === name && Date.now() - a.at < 120_000) return a.token
  return null
}

/**
 * Autorizacion de gerente POR HUELLA — misma exigencia de rol que el PIN.
 *
 * Pedido por Daniel el 2026-08-31: "para ingresar pin en corte de caja tmb deberia
 * de ser con huella" y "tambien para cierre de caja".
 *
 * Reutiliza el mismo endpoint y el mismo `manager: true` que `verifyManagerPin`, asi
 * que el servidor aplica la jerarquia de roles y emite el mismo shiftToken. Antes eso
 * NO pasaba: la rama de huella de /api/pos/pin devolvia antes de calcular el filtro
 * de rol, y cualquier empleado obtenia token de gerente. Se tapo primero, aparte,
 * porque montar esta funcion encima habria llevado el bypass a la caja.
 *
 * FACTOR DE SEGURIDAD, con honestidad: el servidor sigue SIN verificar la firma
 * WebAuthn — el id es una afirmacion del cliente. En la practica esto no es peor que
 * el PIN de 4 digitos que hoy se teclea a la vista de todos (el de AMALAY es 1234, y
 * un PIN observable se copia; una huella exige presencia fisica). Pero tampoco es una
 * garantia criptografica, y hasta que se verifique la assertion en el servidor la
 * huella NO debe ser el unico factor para mover dinero.
 *
 * Devuelve null si no hay huellas dadas de alta, si el usuario cancela, o si el
 * empleado no alcanza el rol. Nunca lanza: la pantalla debe poder ofrecer el PIN.
 */
export async function verifyManagerHuella(minRole = 'gerente'): Promise<{ name: string; role: string } | null> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return null
  try {
    const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
    const credIds = Object.keys(stored)
    if (credIds.length === 0) return null

    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: credIds.map(id => ({
          id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
          type: 'public-key' as const,
        })),
        userVerification: 'required',
        timeout: 30_000,
      },
    })
    if (!assertion) return null

    const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
    const staffId = (stored[credId] as { id?: string } | undefined)?.id
    if (!staffId) return null

    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `min_role` es lo que el servidor ignoraba en la rama de huella hasta hoy.
      body: JSON.stringify({ fingerprint_id: staffId, client_id: _getClientId(), min_role: minRole }),
    })
    if (!res.ok) return null
    const { staff, shiftToken } = await res.json()
    if (!staff?.name) return null
    if (shiftToken) _lastManagerApproval = { token: shiftToken as string, name: staff.name as string, at: Date.now() }
    return { name: staff.name as string, role: (staff.role as string) || minRole }
  } catch {
    // Huella cancelada, no reconocida, o sin red. La pantalla ofrece el PIN.
    return null
  }
}

/** ¿Vale la pena ofrecer el boton de huella en esta terminal? */
export async function hayHuellasDadasDeAlta(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
    if (Object.keys(stored).length === 0) return false
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// Validación server-side de PIN de gerente (cancelaciones, descuentos, cortes).
// Antes venía de NEXT_PUBLIC_MANAGER_PINS (expuesto en el bundle) — ahora valida
// contra /api/pos/pin con manager=true (pos_staff admin/gerente + env server-only).
// Cachea éxitos en localStorage para fallback offline.
export async function verifyManagerPin(pin: string): Promise<string | null> {
  if (!pin) return null
  try {
    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: _getClientId(), manager: true }),
    })
    if (res.ok) {
      const { staff, shiftToken } = await res.json()
      if (staff?.name) {
        try {
          const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
          cached[await _pinCacheKey(pin)] = { name: staff.name, role: staff.role || 'gerente', cached_at: Date.now() }
          localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
        } catch { /* ignore */ }
        // Token firmado del gerente = aprobación server-verificable para la ruta.
        if (shiftToken) _lastManagerApproval = { token: shiftToken as string, name: staff.name as string, at: Date.now() }
        return staff.name as string
      }
      return null
    }
    if (res.status === 401 || res.status === 400) return null
  } catch { /* offline → fallback al cache */ }
  // Fallback offline: PINs validados en los últimos 30 min (re-verificación frecuente
  // = menos ventana de robo si alguien opera la terminal de otro).
  try {
    const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    const entry = cached[await _pinCacheKey(pin)]
    if (entry?.name && Date.now() - (entry.cached_at || 0) < 30 * 60 * 1000) {
      return entry.name as string
    }
  } catch { /* ignore */ }
  // Fallback offline #2: el propio PIN del admin/gerente logueado (pos_staff_cache, 8h)
  const fromStaff = await _managerFromStaffCache(pin)
  if (fromStaff) return fromStaff.name
  return null
}

/** Like verifyManagerPin but also returns the role — used for permission checks */
export async function verifyManagerPinWithRole(pin: string): Promise<{ name: string; role: string } | null> {
  if (!pin) return null
  try {
    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: _getClientId(), manager: true }),
    })
    if (res.ok) {
      const { staff } = await res.json()
      if (staff?.name) {
        const role = staff.role || 'gerente'
        try {
          const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
          cached[await _pinCacheKey(pin)] = { name: staff.name, role, cached_at: Date.now() }
          localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
        } catch { /* ignore */ }
        return { name: staff.name, role }
      }
      return null
    }
    if (res.status === 401 || res.status === 400) return null
  } catch { /* offline → fallback al cache */ }
  // Fallback offline (máx 8 horas — un turno)
  try {
    const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    const entry = cached[await _pinCacheKey(pin)]
    if (entry?.name && Date.now() - (entry.cached_at || 0) < 30 * 60 * 1000) {
      return { name: entry.name, role: entry.role || 'gerente' }
    }
  } catch { /* ignore */ }
  // Fallback offline #2: el propio PIN del admin/gerente logueado (pos_staff_cache, 8h)
  const fromStaff = await _managerFromStaffCache(pin)
  if (fromStaff) return fromStaff
  return null
}

/**
 * Verify PIN with minimum role level (Eduardo Jul 21 — permission hierarchy).
 * Role hierarchy: mesero < cajero < capitan < gerente < admin
 *
 * Usage:
 *   verifyPinWithMinRole(pin, 'capitan')  → accepts capitan, gerente, admin
 *   verifyPinWithMinRole(pin, 'gerente')  → accepts gerente, admin
 *   verifyPinWithMinRole(pin, 'admin')    → accepts admin only
 */
export async function verifyPinWithMinRole(pin: string, minRole: string): Promise<{ name: string; role: string } | null> {
  if (!pin) return null
  try {
    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: _getClientId(), min_role: minRole }),
    })
    if (res.ok) {
      const { staff } = await res.json()
      if (staff?.name) {
        const role = staff.role || minRole
        try {
          const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
          cached[await _pinCacheKey(pin)] = { name: staff.name, role, cached_at: Date.now() }
          localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
        } catch { /* ignore */ }
        return { name: staff.name, role }
      }
      return null
    }
    if (res.status === 401 || res.status === 400) return null
  } catch { /* offline → fallback */ }
  try {
    const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    const entry = cached[await _pinCacheKey(pin)]
    if (entry?.name && Date.now() - (entry.cached_at || 0) < 30 * 60 * 1000) {
      return { name: entry.name, role: entry.role || minRole }
    }
  } catch { /* ignore */ }
  // Fallback offline #2: el propio PIN del usuario logueado si cumple el min_role (pos_staff_cache, 8h)
  const fromStaff = await _managerFromStaffCache(pin, _ROLE_LVL[minRole] || 99)
  if (fromStaff) return fromStaff
  return null
}

// ─── INVENTORY & RECIPES ────────────────────────────────────────────────────

export interface Ingredient {
  id: string
  client_id: string
  name: string
  unit: string
  cost_per_unit: number
  category: string
  supplier: string
  yield_factor: number
  active: boolean
}

export interface RecipeRow {
  id: number
  menu_item_id: string
  menu_item_name: string
  ingredient_id: string
  quantity: number
  unit: string
  // joined
  ingredient_name?: string
  ingredient_unit?: string
}

export interface InventoryItem {
  id: number
  ingredient_id: string
  stock: number
  reorder_point: number
  reorder_quantity: number
  last_restock: string | null
  updated_at: string
  // joined
  ingredient_name?: string
  ingredient_unit?: string
  ingredient_category?: string
  ingredient_cost?: number
}

export interface InventoryMovement {
  id: number
  ingredient_id: string
  movement_type: string
  quantity: number
  order_id: string | null
  actor: string | null
  notes: string | null
  created_at: string
}

// ─── Ingredients CRUD ───────────────────────────────────────────────────────

export async function getIngredients(): Promise<Ingredient[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&order=name.asc&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── Recipes CRUD ───────────────────────────────────────────────────────────

export async function getRecipes(): Promise<RecipeRow[]> {
  // Supabase has a 1000-row default limit. Use Range header to get all rows.
  // pos_recipes_old has 4000+ rows for AMALAY.
  const all: RecipeRow[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_getClientId()}&order=menu_item_name.asc&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Range: `${offset}-${offset + pageSize - 1}` }, cache: 'no-store' }
    )
    if (!res.ok) break
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

export async function getRecipeForItem(menuItemId: string): Promise<RecipeRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_getClientId()}&menu_item_id=eq.${encodeURIComponent(menuItemId)}&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

/**
 * Batch-fetch recipe_ref for a set of menu item IDs.
 * Returns a Map<menuItemId, recipe_ref> containing only items that have a non-null recipe_ref.
 * One DB call for the entire order — does not touch pos_recipes_old.
 */
async function fetchRecipeRefs(
  clientId: string,
  menuItemIds: string[],
): Promise<Map<string, string>> {
  if (menuItemIds.length === 0) return new Map()
  const ids = menuItemIds.map(id => encodeURIComponent(id)).join(',')
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${clientId}&id=in.(${ids})&select=id,recipe_ref`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return new Map()
    const rows: { id: string; recipe_ref: string | null }[] = await res.json()
    return new Map(
      rows
        .filter(r => r.recipe_ref != null)
        .map(r => [r.id, r.recipe_ref!])
    )
  } catch {
    return new Map()
  }
}

/**
 * Returns recipe_ref coverage stats for a client.
 * Used to decide when to retire the fuzzy fallback.
 */
export async function fetchRecipeRefCoverage(clientId: string): Promise<{
  totalItems: number
  withRef: number
  withoutRef: number
  coveragePct: number
}> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${clientId}&active=eq.true&select=id,recipe_ref`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return { totalItems: 0, withRef: 0, withoutRef: 0, coveragePct: 0 }
    const rows: { id: string; recipe_ref: string | null }[] = await res.json()
    const withRef = rows.filter(r => r.recipe_ref != null).length
    const total = rows.length
    return {
      totalItems: total,
      withRef,
      withoutRef: total - withRef,
      coveragePct: total > 0 ? Math.round((withRef / total) * 100) : 0,
    }
  } catch {
    return { totalItems: 0, withRef: 0, withoutRef: 0, coveragePct: 0 }
  }
}

/**
 * A1.2 — Recipe unification. Tras editar una receta en la UI (pos_recipes_old, el
 * sistema flat que lee food-cost), proyecta la receta al sistema normalizado R1
 * (pos_recipe_versions + pos_recipe_lines) que la deducción de stock realmente lee.
 * Sin esto, capturar una receta NO descuenta (los dos sistemas estaban desconectados).
 *
 * Best-effort: nunca lanza (no rompe la edición). Same-origin manda la cookie fs-at
 * (dashboard); si hay shift token (POS) lo manda como bearer. La ruta server
 * (/api/pos/recipe-sync) resuelve client_id server-side y aplica las guardas
 * (subrecetas → skip; policy flip solo desde unclassified/non_inventory).
 * Devuelve el resultado por si el caller quiere avisar al usuario.
 */
export async function syncRecipeToR1(
  menuItemId: string, actor?: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  try {
    let shift: string | null = null
    try { shift = localStorage.getItem('pos_shift_token') } catch { /* ssr/private */ }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (shift) headers.Authorization = `Bearer ${shift}`
    const res = await fetch('/api/pos/recipe-sync', {
      method: 'POST', headers, credentials: 'same-origin',
      body: JSON.stringify({ menu_item_id: menuItemId, actor: actor || 'ui_sync' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok) {
      console.warn('[recipe-sync] R1 projection failed', { menuItemId, status: res.status, data })
      return { ok: false, error: data?.error || `HTTP ${res.status}` }
    }
    return { ok: true, skipped: data.skipped }
  } catch (e) {
    console.warn('[recipe-sync] R1 projection threw', e)
    return { ok: false, error: e instanceof Error ? e.message : 'threw' }
  }
}

export async function saveRecipeRow(row: { menu_item_id: string; menu_item_name: string; ingredient_id: string; quantity: number; unit: string }): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ client_id: _getClientId(), ...row }),
  })
  return res.ok
}

export async function deleteRecipeRow(id: number): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes_old?id=eq.${id}`,
    { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  return res.ok
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
  // Get inventory + join ingredient info client-side
  const [invRes, ingRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_getClientId()}&order=ingredient_id.asc&limit=2000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&limit=2000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    ),
  ])
  if (!invRes.ok || !ingRes.ok) return []
  const inv: InventoryItem[] = await invRes.json()
  const ing: Ingredient[] = await ingRes.json()
  const ingMap = new Map(ing.map(i => [i.id, i]))
  return inv.map(item => {
    const ingredient = ingMap.get(item.ingredient_id)
    return {
      ...item,
      ingredient_name: ingredient?.name ?? item.ingredient_id,
      ingredient_unit: ingredient?.unit ?? '',
      ingredient_category: ingredient?.category ?? '',
      ingredient_cost: ingredient ? (ingredient.cost_per_unit / (ingredient.yield_factor || 1)) : 0,
      ingredient_yield: ingredient?.yield_factor ?? 1,
      ingredient_raw_cost: ingredient?.cost_per_unit ?? 0,
    }
  })
}

export async function updateInventoryStock(ingredientId: string, newStock: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_getClientId()}&ingredient_id=eq.${ingredientId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ stock: newStock, updated_at: new Date().toISOString() }),
      }
    )
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation(
        `pos_inventory?client_id=eq.${_getClientId()}&ingredient_id=eq.${ingredientId}`,
        'PATCH',
        { stock: newStock, updated_at: new Date().toISOString() },
      )
      console.warn(`[inventory] Offline: queued stock update for ${ingredientId} → ${newStock}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

// COMPAT BRIDGE: ingredient_id (TEXT) is a temporary compatibility column.
// pos_inventory_movements was migrated to product_id (BIGINT → pos_inventory_products),
// but all POS code still operates on the legacy pos_ingredients model.
// When the full inventory migration is complete, replace ingredient_id with product_id.
// See docs/INVENTORY-MIGRATION.md for the migration plan.
export async function logInventoryMovement(movement: {
  ingredient_id: string; movement_type: string; quantity: number;
  order_id?: string; actor?: string; notes?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ client_id: _getClientId(), ...movement }),
    })
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue movement for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_inventory_movements', 'POST', {
        client_id: _getClientId(), ...movement,
      })
      console.warn(`[inventory] Offline: queued movement for ${movement.ingredient_id}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

// ─── Auto-deduction: deduct recipe ingredients when order sent to kitchen ───

// Tracks orderIds that have already emitted policy_gate_failure to prevent duplicate events
// when deductIngredientsForOrder is retried for the same order within a session.
const _gateFailureOrderIds = new Set<string>()

// Tracks orderIds for which ingredient deduction has already fired in this process.
// Prevents double-deduction caused by fire-and-forget timing (handlePayment releases
// operationLock before the deduction Promise resolves) or rapid double-tap on "Cobrar".
//
// GROWTH: one 36-byte UUID per paid order. At 200 orders/day ≈ 7 KB/day, ≈ 2.6 MB/year
// without restart. Lifecycle is bounded by the page/process session. Negligible at
// current scale. If the process runs weeks without reload, LRU eviction could be added.
//
// ERROR BEHAVIOR: if deductIngredientsForOrder() fails after adding orderId here,
// the catch block removes orderId from this Set so a subsequent retry can proceed.
// An orderId is only kept permanently after a confirmed successful deduction.
//
// SCOPE LIMITS — this Set does NOT protect against:
//   - Process/tab restart: Set is cleared on page reload.
//   - Multiple browser tabs or POS terminals on the same order (no shared state).
//   - Multiple Local Server instances.
// Distributed idempotency (DB-level check on pos_inventory_movements) is tracked
// separately as a follow-up after this P0 containment is stable.
const _deductedOrderIds = new Set<string>()

function _recordGateFailure(orderId: string, items: OrderItem[], actor: string): void {
  if (_gateFailureOrderIds.has(orderId)) return
  _gateFailureOrderIds.add(orderId)
  const policyState = inventoryPolicyService.stats().state
  console.error('[policy:gate] policy_gate_failure', { orderId, itemCount: items.length, policyState })
  console.info('[policy:event] policy_gate_failure', {
    orderId, itemCount: items.length, items: items.map(i => i.nombre), policyState,
  })
  logPolicyGateFailure(_getClientId(), orderId, policyState, actor)
}

export async function deductIngredientsForOrder(
  items: OrderItem[],
  orderId: string,
  actor: string,
  batchId?: string,
): Promise<{ success: boolean; deductions: { ingredient: string; amount: number; unit: string; newStock: number }[]; alerts: string[]; resolution: { DB_MAPPING: string[]; FUZZY_FALLBACK: string[]; R1_OWNED: string[]; GATE_FAILED: string[]; UNRESOLVED: string[] } }> {
  try {
  // Policy must be READY before Sistema A runs.
  // If policy is UNINITIALIZED/LOADING/FAILED we cannot distinguish recipe items from
  // unclassified. Skip Sistema A entirely — R1 already fired at Kitchen Send.
  if (!inventoryPolicyService.isReady()) {
    _recordGateFailure(orderId, items, actor)
    console.info(
      `[deduct:summary] order=${orderId} items=${items.length} gate=FAILED_NO_POLICY ` +
      `policyState=${inventoryPolicyService.stats().state}`
    )
    return {
      success: true,
      deductions: [],
      alerts: [],
      resolution: { DB_MAPPING: [], FUZZY_FALLBACK: [], R1_OWNED: [], GATE_FAILED: items.map(i => i.nombre), UNRESOLVED: [] },
    }
  }

  // Idempotency guard — key is orderId:batchId when batchId is provided (kitchen send)
  // so that additional items sent in a second batch are not skipped.
  const deductKey = batchId ? `${orderId}:${batchId}` : orderId
  if (_deductedOrderIds.has(deductKey)) {
    console.info(`[deduct:idempotent] key=${deductKey} already deducted this session — skip`)
    return {
      success: true,
      deductions: [],
      alerts: [],
      resolution: { DB_MAPPING: [], FUZZY_FALLBACK: [], R1_OWNED: [], GATE_FAILED: [], UNRESOLVED: [] },
    }
  }
  _deductedOrderIds.add(deductKey)

  // 1. Get all recipes and inventory
  const recipes = await getRecipes()
  const inventory = await getInventory()
  const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

  const deductions: { ingredient: string; amount: number; unit: string; newStock: number }[] = []
  const alerts: string[] = []
  const resolution = { DB_MAPPING: [] as string[], FUZZY_FALLBACK: [] as string[], R1_OWNED: [] as string[], GATE_FAILED: [] as string[], UNRESOLVED: [] as string[] }

  // 2. Fetch recipe_ref from pos_menu_items for all items in this order (1 DB call)
  const menuItemIds = [...new Set(items.map(i => i.menuItemId))]
  const recipeRefMap = await fetchRecipeRefs(_getClientId(), menuItemIds)

  // Observability counters — flushed to console at end of loop
  const obs = {
    total: 0, r1Skipped: 0, viaDb: 0, viaFuzzy: 0, miss: 0,
    fuzzyItems: [] as string[], missItems: [] as string[],
  }

  // 3. For each order item, find matching recipe and deduct
  // Normalize: strip prefixes, size suffixes, temperature variants
  const normalizeRecipeName = (n: string) => n.toLowerCase()
    .replace(/^sprw\s*-\s*/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*(14oz|16oz|12oz|360\s*ml|240\s*ml|180\s*ml|450\s*ml)\s*/gi, ' ')
    .replace(/\s*(caliente|frio|fría|helado|servido)\s*/gi, ' ')
    .replace(/\s*(media porción|para compartir|1\/2)\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim()

  const recipesByName = new Map<string, typeof recipes>()
  const recipesByNorm = new Map<string, typeof recipes>()
  for (const r of recipes) {
    const key = r.menu_item_name.toLowerCase()
    if (!recipesByName.has(key)) recipesByName.set(key, [])
    recipesByName.get(key)!.push(r)
    const norm = normalizeRecipeName(r.menu_item_name)
    if (!recipesByNorm.has(norm)) recipesByNorm.set(norm, [])
    recipesByNorm.get(norm)!.push(r)
  }

  for (const item of items) {
    // R1 gate: skip items owned by R1 — deduction handled by r1_reconcile_item.
    // Defaults to Alternativa A from §8: only 'recipe' items are gated; 'unclassified'
    // continue through Sistema A unchanged until §8 decision is made.
    const mode = inventoryPolicyService.getMode(item.menuItemId)
    if (mode === 'recipe') {
      obs.r1Skipped++
      resolution.R1_OWNED.push(item.nombre)
      continue
    }

    obs.total++
    const itemName = item.nombre.toLowerCase()
    const itemNorm = normalizeRecipeName(item.nombre)
    let recipeRows: typeof recipes = []
    let resolvedVia: 'db' | 'fuzzy' | 'miss' = 'miss'

    // Path 1: DB recipe_ref — direct lookup, no text matching
    const recipeRef = recipeRefMap.get(item.menuItemId)
    if (recipeRef) {
      const rows = recipesByName.get(recipeRef)
      if (rows && rows.length > 0) {
        recipeRows = rows
        resolvedVia = 'db'
      }
    }

    // Path 2: Fuzzy fallback (RECIPE_ALIASES + name matching)
    // Active while NEXT_PUBLIC_RECIPE_FALLBACK !== 'disabled'
    if (recipeRows.length === 0 && RECIPE_FALLBACK_ENABLED) {
      // Priority 1: alias map
      const aliases = RECIPE_ALIASES[itemName]
      if (aliases) {
        for (const alias of aliases) {
          const rows = recipesByName.get(alias.toLowerCase())
          if (rows && rows.length > 0) { recipeRows = rows; break }
        }
      }
      // Priority 2: exact match on recipe name
      if (recipeRows.length === 0) recipeRows = recipesByName.get(itemName) ?? []
      // Priority 3: normalized match (strips prefixes, sizes, temperature)
      if (recipeRows.length === 0) recipeRows = recipesByNorm.get(itemNorm) ?? []
      // Priority 4: best partial match (normalized)
      if (recipeRows.length === 0) {
        let bestMatch: { name: string; rows: typeof recipes } | null = null
        let bestScore = 0
        for (const [name, rows] of recipesByNorm) {
          if (name.length < 3 || itemNorm.length < 3) continue
          if (name.includes(itemNorm) || itemNorm.includes(name)) {
            const score = Math.min(name.length, itemNorm.length) / Math.max(name.length, itemNorm.length)
            if (score > bestScore && score > 0.5) { bestScore = score; bestMatch = { name, rows } }
          }
        }
        if (bestMatch) recipeRows = bestMatch.rows
      }
      if (recipeRows.length > 0) resolvedVia = 'fuzzy'
    }

    // Record resolution path — never skip silently
    if (resolvedVia === 'db') {
      obs.viaDb++
      resolution.DB_MAPPING.push(item.nombre)
    } else if (resolvedVia === 'fuzzy') {
      obs.viaFuzzy++
      obs.fuzzyItems.push(item.nombre)
      resolution.FUZZY_FALLBACK.push(item.nombre)
      console.warn(`[deduct:fuzzy] "${item.nombre}" — sin recipe_ref en DB, usando fallback`)
    } else {
      obs.miss++
      obs.missItems.push(item.nombre)
      resolution.UNRESOLVED.push(item.nombre)
      console.warn(`[deduct:miss] "${item.nombre}" (id=${item.menuItemId}) — sin receta en DB ni fuzzy`)
      continue
    }

    for (const row of recipeRows) {
      const deductAmount = row.quantity * item.cantidad
      const inv = invMap.get(row.ingredient_id)
      if (!inv) continue

      // Skip sub-recipes — they don't carry physical stock
      if (row.ingredient_id.startsWith('sub_') || inv.ingredient_category === 'subreceta' || inv.ingredient_category === 'SUBRECETA') continue

      const actualDeduction = Math.min(deductAmount, inv.stock) // never deduct more than available
      const newStock = Math.max(0, inv.stock - deductAmount)

      // Update stock
      await updateInventoryStock(row.ingredient_id, newStock)

      // Log movement (log actual amount deducted, not requested)
      await logInventoryMovement({
        ingredient_id: row.ingredient_id,
        movement_type: 'deduction',
        quantity: -actualDeduction,
        order_id: orderId,
        actor,
        notes: `${item.cantidad}x ${item.nombre}${actualDeduction < deductAmount ? ' (stock insuficiente)' : ''}`,
      })

      deductions.push({
        ingredient: inv.ingredient_name ?? row.ingredient_id,
        amount: actualDeduction,
        unit: row.unit || inv.ingredient_unit || '',
        newStock,
      })

      // Check reorder point
      if (newStock <= inv.reorder_point) {
        alerts.push(`${inv.ingredient_name}: ${newStock.toFixed(2)} ${inv.ingredient_unit} (punto de reorden: ${inv.reorder_point})`)
      }

      // Update local map
      inv.stock = newStock
    }
  }

  // Observability summary — one line per order in server logs
  if (obs.total > 0) {
    const pDb    = Math.round(obs.viaDb    / obs.total * 100)
    const pFuzzy = Math.round(obs.viaFuzzy / obs.total * 100)
    const pMiss  = Math.round(obs.miss     / obs.total * 100)
    console.info(
      `[deduct:summary] order=${orderId} items=${obs.total + obs.r1Skipped} gate=ACTIVE r1=${obs.r1Skipped} ` +
      `db=${obs.viaDb}(${pDb}%) fuzzy=${obs.viaFuzzy}(${pFuzzy}%) miss=${obs.miss}(${pMiss}%)`
    )
    if (obs.fuzzyItems.length > 0) console.warn(`[deduct:fuzzy-items] ${obs.fuzzyItems.join(', ')}`)
    if (obs.missItems.length  > 0) console.warn(`[deduct:miss-items]  ${obs.missItems.join(', ')}`)
  }

  return { success: true, deductions, alerts, resolution }
  } catch (err) {
    // Remove orderId so a subsequent retry is not silently blocked by the idempotency guard.
    // The guard is meant to prevent double-deduction on success, not to block retries after failure.
    _deductedOrderIds.delete(orderId)
    console.warn('[deductIngredientsForOrder] Failed:', err)
    return { success: false, deductions: [], alerts: ['Error al descontar inventario'], resolution: { DB_MAPPING: [], FUZZY_FALLBACK: [], R1_OWNED: [], GATE_FAILED: [], UNRESOLVED: [] } }
  }
}

/** Reverse ingredient deduction for a cancelled item (return stock) */
export async function reverseIngredientDeduction(
  item: OrderItem,
  orderId: string,
  actor: string,
  reason: string,
): Promise<void> {
  try {
    const recipes = await getRecipes()
    const inventory = await getInventory()
    const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

    const normalizeRecipeName = (n: string) => n.toLowerCase()
      .replace(/^sprw\s*-\s*/i, '').replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s*(14oz|16oz|12oz|360\s*ml|240\s*ml|180\s*ml|450\s*ml)\s*/gi, ' ')
      .replace(/\s*(caliente|frio|fría|helado|servido)\s*/gi, ' ')
      .replace(/\s+/g, ' ').trim()

    const recipesByName = new Map<string, typeof recipes>()
    for (const r of recipes) {
      const key = r.menu_item_name.toLowerCase()
      if (!recipesByName.has(key)) recipesByName.set(key, [])
      recipesByName.get(key)!.push(r)
      const norm = normalizeRecipeName(r.menu_item_name)
      if (!recipesByName.has(norm)) recipesByName.set(norm, [])
      recipesByName.get(norm)!.push(r)
    }

    const itemName = item.nombre.toLowerCase()
    const aliases = RECIPE_ALIASES[itemName]
    let recipeRows: typeof recipes = []
    if (aliases) {
      for (const alias of aliases) {
        const rows = recipesByName.get(alias.toLowerCase())
        if (rows && rows.length > 0) { recipeRows = rows; break }
      }
    }
    if (recipeRows.length === 0) recipeRows = recipesByName.get(itemName) ?? []
    if (recipeRows.length === 0) recipeRows = recipesByName.get(normalizeRecipeName(item.nombre)) ?? []

    for (const row of recipeRows) {
      const qty = row.quantity * (item.cantidad || 1)
      const inv = invMap.get(row.ingredient_id)
      if (inv) {
        await updateInventoryStock(row.ingredient_id, inv.stock + qty)
        await logInventoryMovement({
          ingredient_id: row.ingredient_id,
          movement_type: 'adjustment',
          quantity: qty,
          order_id: orderId,
          actor,
          notes: `Cancelacion: ${item.nombre} — ${reason}`,
        })
      }
    }
  } catch (err) {
    console.warn('[reverseIngredientDeduction] Failed:', err)
  }
}

export async function getInventoryMovements(limit = 50): Promise<InventoryMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_inventory_movements?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── MARKET INVENTORY (retail 1:1 — categorías mkt-*) ───────────────────────
// El Market no usa recetas: vender 1 unidad descuenta 1 unidad de stock.
// Tablas: pos_market_stock (por menu_item_id) + pos_market_movements (audit).

export const MARKET_CATEGORY_PREFIX = 'mkt-'
// Categories that deduct 1:1 from pos_market_stock (no recipe needed — bottled/packaged)
// Categories that deduct 1:1 from pos_market_stock (no recipe needed — bottled/packaged/retail)
// Bebidas preparadas (coffee, frappes, jugos, smoothies, tea, fresh, alcohol) SÍ necesitan receta
// para descontar ingredientes — pero si no tienen receta, al menos deducen de market stock.
export const DIRECT_STOCK_CATEGORIES = [
  'mkt-healthy', 'mkt-vitaminas', 'mkt-regalos', 'mkt-amalay', // Market retail
  'cerveza', 'vinos', 'licores', 'sodas', 'icecream', 'bakery', // Embotellados/empacados
  'postres', // Postres pre-hechos
]

export interface MarketStockRow {
  id: number
  menu_item_id: string
  stock: number
  reorder_point: number
  reorder_quantity: number
  last_restock: string | null
  updated_at: string
  // joined desde pos_menu_items
  item_name?: string
  item_price?: number
  item_barcode?: string
  category_id?: string
}

export interface MarketMovement {
  id: number
  menu_item_id: string
  movement_type: string  // 'venta' | 'entrada' | 'merma' | 'ajuste'
  quantity: number
  order_id: string | null
  actor: string | null
  notes: string | null
  created_at: string
  item_name?: string
}

export interface MarketMenuItemLite {
  id: string
  name: string
  price: number
  barcode: string | null
  category_id: string
}

/** Lógica pura de descuento Market (testeable): agrega cantidades por item,
 *  floor en 0 (nunca stock negativo), alerta si cae al punto de reorden. */
export function computeMarketDeductions(
  items: { menuItemId: string; cantidad: number }[],
  marketIds: Set<string>,
  stockMap: Map<string, { stock: number; reorder_point: number }>,
): { menu_item_id: string; cantidad: number; newStock: number; alert: boolean; faltante: number }[] {
  const totals = new Map<string, number>()
  for (const it of items) {
    if (!marketIds.has(it.menuItemId)) continue
    totals.set(it.menuItemId, (totals.get(it.menuItemId) ?? 0) + it.cantidad)
  }
  const out: { menu_item_id: string; cantidad: number; newStock: number; alert: boolean; faltante: number }[] = []
  for (const [id, cantidad] of totals) {
    const row = stockMap.get(id) ?? { stock: 0, reorder_point: 0 }
    const newStock = Math.max(0, row.stock - cantidad)
    out.push({
      menu_item_id: id,
      cantidad,
      newStock,
      alert: newStock <= row.reorder_point,
      faltante: Math.max(0, cantidad - row.stock),
    })
  }
  return out
}

export async function getMarketMenuItems(): Promise<MarketMenuItemLite[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${_getClientId()}&category_id=like.${MARKET_CATEGORY_PREFIX}*&active=eq.true&select=id,name,price,barcode,category_id&order=name.asc&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map((r: { id: string; name: string; price: number; barcode: string | null; category_id: string }) => ({
    ...r, price: Number(r.price),
  }))
}

export async function getMarketStock(): Promise<MarketStockRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_market_stock?client_id=eq.${_getClientId()}&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

/** Upsert de stock por menu item (crea la fila si no existe). */
export async function upsertMarketStock(
  menuItemId: string,
  fields: { stock?: number; reorder_point?: number; reorder_quantity?: number; last_restock?: string },
): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_market_stock?on_conflict=client_id,menu_item_id`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          client_id: _getClientId(), menu_item_id: menuItemId,
          ...fields, updated_at: new Date().toISOString(),
        }),
      }
    )
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_market_stock?on_conflict=client_id,menu_item_id', 'POST', {
        client_id: _getClientId(), menu_item_id: menuItemId,
        ...fields, updated_at: new Date().toISOString(),
      })
      console.warn(`[market] Offline: queued stock update for ${menuItemId}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

export async function logMarketMovement(movement: {
  menu_item_id: string; movement_type: string; quantity: number;
  order_id?: string; actor?: string; notes?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_market_movements`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ client_id: _getClientId(), ...movement }),
    })
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue movement for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_market_movements', 'POST', {
        client_id: _getClientId(), ...movement,
      })
      console.warn(`[market] Offline: queued movement for ${movement.menu_item_id}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

export async function getMarketMovements(limit = 50): Promise<MarketMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_market_movements?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

/** Entrada / merma / ajuste manual via constrained server-side RPC.
 *  Conservation: no GREATEST(0,...) clamp. Negative stock visible.
 *  Actor is REPORTED_ACTOR (browser-supplied, not server-verified). */
export async function registerMarketMovement(
  menuItemId: string,
  type: 'entrada' | 'merma' | 'ajuste',
  quantity: number,
  actor: string,
  notes?: string,
): Promise<{ ok: boolean; newStock: number }> {
  try {
    const adjustType = type === 'ajuste' ? 'ajuste_absoluto' : type
    const res = await fetch('/api/pos/adjust-market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
      body: JSON.stringify({
        menu_item_id: menuItemId,
        adjustment_type: adjustType,
        quantity: Math.abs(quantity),
        actor,
        notes,
      }),
    })
    if (!res.ok) return { ok: false, newStock: 0 }
    const result = await res.json()
    return { ok: result.ok ?? false, newStock: result.new_stock ?? 0 }
  } catch {
    return { ok: false, newStock: 0 }
  }
}

/** Descuento automático al vender items Market — via serialized authority boundary. */
export async function deductMarketStockForOrder(
  items: OrderItem[],
  orderId: string,
  actor: string,
): Promise<{ success: boolean; deductions: { item: string; cantidad: number; newStock: number }[]; alerts: string[] }> {
  try {
    const ids = [...new Set(items.map(i => i.menuItemId).filter(Boolean))]
    if (ids.length === 0) return { success: true, deductions: [], alerts: [] }

    // 1. Identify direct-stock items by category
    const catFilter = DIRECT_STOCK_CATEGORIES.map(c => `category_id.eq.${c}`).join(',')
    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${_getClientId()}&id=in.(${ids.join(',')})&or=(${catFilter})&select=id,name`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!itemsRes.ok) return { success: false, deductions: [], alerts: [] }
    const marketItems: { id: string; name: string }[] = await itemsRes.json()
    if (marketItems.length === 0) return { success: true, deductions: [], alerts: [] }
    const nameById = new Map(marketItems.map(m => [m.id, m.name]))
    const marketIdSet = new Set(marketItems.map(m => m.id))

    // 2. Aggregate quantities per menu_item_id
    const qtyByItem = new Map<string, number>()
    for (const item of items) {
      if (!marketIdSet.has(item.menuItemId)) continue
      qtyByItem.set(item.menuItemId, (qtyByItem.get(item.menuItemId) || 0) + item.cantidad)
    }

    const rpcItems = Array.from(qtyByItem.entries()).map(([mid, qty]) => ({
      menu_item_id: mid, cantidad: qty,
    }))

    // 3. Deduct via serialized authority-aware server RPC
    const res = await fetch('/api/pos/deduct-market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
      body: JSON.stringify({ order_id: orderId, actor, items: rpcItems }),
    })

    if (!res.ok) return { success: false, deductions: [], alerts: [] }
    const result = await res.json()
    if (!result.ok) {
      console.warn('[deductMarketStockForOrder] RPC rejected:', result.error)
      return { success: false, deductions: [], alerts: [] }
    }

    const deductions = (result.deductions || []).map((d: { menu_item_id: string; cantidad: number; new_stock: number }) => ({
      item: nameById.get(d.menu_item_id) ?? d.menu_item_id,
      cantidad: d.cantidad,
      newStock: d.new_stock,
    }))

    return { success: true, deductions, alerts: [] }
  } catch (err) {
    console.warn('[deductMarketStockForOrder] Failed:', err)
    return { success: false, deductions: [], alerts: [] }
  }
}

// ─── PURCHASE ORDERS & FACTURAS ─────────────────────────────────────────────

export interface PurchaseOrder {
  id: string
  client_id: string
  supplier: string
  status: string
  created_by: string
  approved_by: string | null
  notes: string | null
  subtotal: number
  iva: number
  total: number
  ai_suggested: boolean
  sent_at: string | null
  received_at: string | null
  received_by: string | null
  created_at: string
  items?: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
  id: number
  order_id: string
  ingredient_id: string
  ingredient_name: string
  quantity_ordered: number
  quantity_received: number | null
  unit: string
  unit_cost: number
  total_cost: number
}

export interface Factura {
  id: string
  client_id: string
  purchase_order_id: string | null
  supplier: string
  folio: string | null
  subtotal: number
  iva: number
  total: number
  status: string
  captured_by: string
  approved_by: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
}

// Get unique suppliers from ingredients
export async function getSuppliers(): Promise<string[]> {
  const ingredients = await getIngredients()
  const suppliers = new Set(ingredients.map(i => i.supplier).filter(Boolean))
  return Array.from(suppliers).sort()
}

// AI-suggested OC: items below reorder point
export async function getSuggestedPurchaseItems(): Promise<{
  supplier: string
  items: { ingredient_id: string; name: string; unit: string; current_stock: number; reorder_point: number; suggested_qty: number; unit_cost: number }[]
}[]> {
  const inventory = await getInventory()
  const ingredients = await getIngredients()
  const ingMap = new Map(ingredients.map(i => [i.id, i]))

  const lowStock = inventory.filter(i => i.stock <= i.reorder_point)
  const bySupplier = new Map<string, typeof lowStock>()

  for (const item of lowStock) {
    const ing = ingMap.get(item.ingredient_id)
    const supplier = ing?.supplier || 'Sin proveedor'
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, [])
    bySupplier.get(supplier)!.push(item)
  }

  return Array.from(bySupplier.entries()).map(([supplier, items]) => ({
    supplier,
    items: items.map(item => ({
      ingredient_id: item.ingredient_id,
      name: item.ingredient_name ?? item.ingredient_id,
      unit: item.ingredient_unit ?? '',
      current_stock: item.stock,
      reorder_point: item.reorder_point,
      suggested_qty: item.reorder_quantity || item.reorder_point * 2,
      unit_cost: item.ingredient_cost ?? 0,
    })),
  }))
}

// CRUD for Purchase Orders
export async function createPurchaseOrder(po: {
  id: string; supplier: string; created_by: string; notes?: string;
  subtotal: number; iva: number; total: number; ai_suggested?: boolean;
  items: { ingredient_id: string; ingredient_name: string; quantity_ordered: number; unit: string; unit_cost: number; total_cost: number }[]
}): Promise<boolean> {
  // Insert order
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_orders`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: po.id, client_id: _getClientId(), supplier: po.supplier, status: 'borrador',
      created_by: po.created_by, notes: po.notes || null,
      subtotal: po.subtotal, iva: po.iva, total: po.total,
      ai_suggested: po.ai_suggested || false,
    }),
  })
  if (!res.ok) return false

  // Insert items
  const itemRows = po.items.map(item => ({
    order_id: po.id, ingredient_id: item.ingredient_id, ingredient_name: item.ingredient_name,
    quantity_ordered: item.quantity_ordered, unit: item.unit,
    unit_cost: item.unit_cost, total_cost: item.total_cost,
  }))
  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_order_items`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(itemRows),
  })
  return res2.ok
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_orders?client_id=eq.${_getClientId()}&order=created_at.desc&limit=100`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getPurchaseOrderItems(orderId: string): Promise<PurchaseOrderItem[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_order_items?order_id=eq.${orderId}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function updatePurchaseOrderStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'enviada') body.sent_at = new Date().toISOString()
  if (status === 'recibida') body.received_at = new Date().toISOString()

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_orders?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

// Receive items at almacén (update quantity_received)
export async function receiveOrderItems(
  orderId: string, received: { item_id: number; quantity_received: number }[]
): Promise<boolean> {
  for (const r of received) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/pos_purchase_order_items?id=eq.${r.item_id}`,
      {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ quantity_received: r.quantity_received }),
      }
    )
  }
  return true
}

// Restock inventory when OC is received
export async function restockFromPurchaseOrder(
  orderId: string, items: PurchaseOrderItem[], actor: string
): Promise<void> {
  const inventory = await getInventory()
  const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

  for (const item of items) {
    const qty = item.quantity_received ?? item.quantity_ordered
    const inv = invMap.get(item.ingredient_id)
    if (inv) {
      const newStock = inv.stock + qty
      await updateInventoryStock(item.ingredient_id, newStock)
      await logInventoryMovement({
        ingredient_id: item.ingredient_id,
        movement_type: 'restock',
        quantity: qty,
        order_id: orderId,
        actor,
        notes: `OC ${orderId} - ${item.ingredient_name}`,
      })
    }
  }
}

// CRUD for Facturas
export async function createFactura(factura: {
  id: string; purchase_order_id?: string; supplier: string; folio?: string;
  subtotal: number; iva: number; total: number; captured_by: string; notes?: string;
}): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_facturas`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: factura.id, client_id: _getClientId(), purchase_order_id: factura.purchase_order_id || null,
      supplier: factura.supplier, folio: factura.folio || null,
      subtotal: factura.subtotal, iva: factura.iva, total: factura.total,
      status: 'capturada', captured_by: factura.captured_by, notes: factura.notes || null,
    }),
  })
  return res.ok
}

export async function getFacturas(): Promise<Factura[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_facturas?client_id=eq.${_getClientId()}&order=created_at.desc&limit=100`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── Recipe Details (presentation, elaboration, allergens) ──────────────────

export interface RecipeDetail {
  id: string
  name: string
  category: string | null
  portion_size: string | null
  prep_time: string | null
  cook_time: string | null
  serving_temp: string | null
  plate: string | null
  presentation: string | null
  elaboration: string | null
  equipment: string | null
  allergens: string[] | null
}

export async function getRecipeDetail(name: string): Promise<RecipeDetail | null> {
  // Search by name (partial match)
  const encoded = encodeURIComponent(name)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipe_details?name=ilike.*${encoded}*&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json()
  if (rows.length === 0) {
    // Try by id
    const id = name.toLowerCase().replace(/ /g, '_').replace(/'/g, '').slice(0, 40)
    const res2 = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_recipe_details?id=ilike.*${encodeURIComponent(id)}*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res2.ok) return null
    const rows2 = await res2.json()
    return rows2[0] || null
  }
  return rows[0]
}

export async function getClosedOrders(date: string): Promise<{ id: string; mesa: number; mesero: string; total: number; metodo_pago: string; closed_at: string; items: string }[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_getClientId()}&status=eq.cerrada&created_at=gte.${date}T00:00:00&created_at=lte.${date}T23:59:59&order=closed_at.desc&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function reopenOrder(orderId: string, manager?: string, approvalToken?: string | null): Promise<boolean> {
  // Reabrir una cuenta PAGADA es sensible (fraude: reabrir → modificar → re-cerrar menor).
  // Ya NO es un PATCH directo con anon-key: va por /api/pos/reopen-order, que VERIFICA la
  // aprobación de gerente server-side (token firmado online, o offline_approved device-trust).
  const res = await fetch('/api/pos/reopen-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
    body: JSON.stringify({
      order_id: orderId,
      manager: manager || undefined,
      approval_token: approvalToken || undefined,
      offline_approved: approvalToken ? undefined : true,
    }),
  })
  return res.ok
}

export async function updateFacturaStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'pagada') body.paid_at = new Date().toISOString()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_facturas?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

// ─── CFDI — Facturación electrónica SAT ─────────────────────────────────────
//
// CREATE TABLE pos_cfdi_requests (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   order_id TEXT,                    -- optional: link to POS order
//   rfc TEXT NOT NULL,
//   razon_social TEXT NOT NULL,
//   regimen_fiscal TEXT NOT NULL,     -- clave SAT e.g. '601', '612', '616'
//   uso_cfdi TEXT NOT NULL,           -- e.g. 'G03', 'D10', 'S01'
//   codigo_postal TEXT NOT NULL,
//   email TEXT NOT NULL,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   status TEXT DEFAULT 'pendiente',  -- pendiente, procesando, emitida, cancelada, error
//   folio_fiscal TEXT,               -- UUID SAT once emitted
//   pdf_url TEXT,
//   xml_url TEXT,
//   error_msg TEXT,
//   requested_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_cfdi_rfc ON pos_cfdi_requests(rfc);
// CREATE INDEX idx_cfdi_status ON pos_cfdi_requests(status);
// CREATE INDEX idx_cfdi_created ON pos_cfdi_requests(created_at DESC);

export interface CFDIRequest {
  id: string
  client_id: string
  order_id?: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  subtotal: number
  iva: number
  total: number
  status: 'pendiente' | 'procesando' | 'emitida' | 'cancelada' | 'error'
  folio_fiscal?: string
  pdf_url?: string
  xml_url?: string
  error_msg?: string
  requested_by?: string
  created_at: string
  updated_at: string
}

export const REGIMENES_FISCALES = [
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', nombre: 'Sueldos y Salarios' },
  { clave: '606', nombre: 'Arrendamiento' },
  { clave: '608', nombre: 'Demás ingresos' },
  { clave: '610', nombre: 'Residentes en el Extranjero' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', nombre: 'Ingresos por intereses' },
  { clave: '616', nombre: 'Sin obligaciones fiscales' },
  { clave: '620', nombre: 'Sociedades Cooperativas de Producción' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '622', nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '625', nombre: 'Régimen de las Actividades Empresariales (Plataformas)' },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza' },
]

export const USOS_CFDI = [
  { clave: 'G01', nombre: 'Adquisición de mercancías' },
  { clave: 'G03', nombre: 'Gastos en general' },
  { clave: 'D10', nombre: 'Pagos por servicios educativos' },
  { clave: 'I01', nombre: 'Construcciones' },
  { clave: 'P01', nombre: 'Por definir' },
  { clave: 'S01', nombre: 'Sin efectos fiscales' },
]

export async function createCFDIRequest(req: {
  order_id?: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  subtotal: number
  iva: number
  total: number
  requested_by?: string
}): Promise<{ ok: boolean; id?: string }> {
  const id = `CFDI-${generateId()}`
  const body = {
    id,
    client_id: _getClientId(),
    ...req,
    status: 'pendiente',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests`,
    {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return { ok: res.ok, id: res.ok ? id : undefined }
}

export async function getCFDIRequests(limit = 50): Promise<CFDIRequest[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!res.ok) return []
  return res.json()
}

export async function updateCFDIStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, updated_at: new Date().toISOString(), ...extra }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

// ─── Floor plan ───────────────────────────────────────────────────────────────

export interface PosMesa {
  number: number
  capacity: number
  zone: string | null
  x_pct: number
  y_pct: number
  shape: string
  sort_order: number
}

/**
 * Lee el plano de salón de pos_mesas, ordenado por sort_order.
 *
 * Devuelve [] ante cualquier error; el llamador cae a getMesasConfig().
 *
 * La petición sale con la anon key, pero NO viaja así: supabase-fetch-patch.ts está
 * instalado en el layout raíz e intercepta todo /rest/v1/ — si hay sesión de Supabase
 * la sube al JWT del usuario, y si hay shift token del POS la rutea al proxy
 * autenticado /api/pos/db. Sin ese parche esto daría 401, porque `anon` ni siquiera
 * tiene GRANT sobre pos_mesas.
 *
 * Lo que sí lee se guarda en caché, para que el plano sobreviva un arranque en frío
 * sin internet. Antes sólo AMALAY sobrevivía, porque su plano venía compilado.
 */
export async function fetchPosMesas(clientId: string): Promise<PosMesa[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_mesas?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&order=sort_order.asc&select=number,capacity,zone,x_pct,y_pct,shape,sort_order`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return []
    const filas: PosMesa[] = await res.json()
    if (Array.isArray(filas) && filas.length > 0) cachearPlano(clientId, filas)
    return filas
  } catch { return [] }
}
