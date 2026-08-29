// Vertical presets — Control Plane domain module.
//
// Contract: this module is the SINGLE owner of "tipo de restaurante" semantics.
// A vertical preset maps a restaurant type (fast_food, fine_dining, bar…) to the
// bundle of configuration a new tenant should be born with:
//   - a patch over ClientFeatures (which modules are on)
//   - an OnboardingTemplate (seed menu / payment methods / roles)
//   - operational defaults (mesas, service model)
// Presets are a STARTING POINT, never a cage: everything remains editable per
// tenant afterwards. Domain invariants (see docs/archive/bibles/FULLSITE-DOMAIN-BIBLE.md)
// never vary by preset. Design doc: docs/strategy/BIBLE-SQUARE.md.
//
// Consumers: provisionTenant() (src/lib/provision-tenant.ts) resolves a preset at
// alta time; UI reads VERTICAL_PRESETS to render the type selector. Routes MUST NOT
// re-implement per-type defaults — extend this module instead.

import type { ClientFeatures } from './client-config'
import { DEFAULT_ONBOARDING_TEMPLATE, type OnboardingTemplate, type TemplateMenuCategory } from './onboarding-template'

export type VerticalId =
  | 'fast_food'
  | 'fast_casual'
  | 'casual_dining'
  | 'fine_dining'
  | 'bar_cantina'
  | 'cafeteria_panaderia'
  | 'hibrido_restaurante_tienda'
  | 'dark_kitchen'

/** How orders are born on this kind of floor. Consumed by the POS shell (Fase 2). */
export type ServiceModel = 'tables' | 'counter' | 'tabs' | 'channels'

/** Combo semilla — referencia items del template por idSuffix; provisionTenant
 *  resuelve los ids finales (`${clientId}-${itemIdSuffix}`) al sembrar pos_combos. */
export interface SeedCombo {
  idSuffix: string
  name: string
  price: number
  items: Array<{ itemIdSuffix: string; name: string; substitutions?: Array<{ itemIdSuffix: string; name: string }> }>
  upsell?: { label: string; price_add: number }
}

export interface VerticalPreset {
  id: VerticalId
  label: string
  description: string
  serviceModel: ServiceModel
  /** Patch merged over DEFAULT_FEATURES at provision time. */
  features: Partial<ClientFeatures>
  /** Seed skeleton; falls back to the generic template when omitted. */
  template?: OnboardingTemplate
  defaultMesas: number
  /** Combos semilla (pos_combos) — sin esto, el speed screen de un tenant
   *  counter nace vacío (gap Minute-0 #12, visto en campo con carls-jr). */
  combos?: SeedCombo[]
}

// ─── Seed menus per vertical ─────────────────────────────────────────────────
// Generic, client-agnostic starters (same contract as onboarding-template.ts).

const MENU_FAST_FOOD: TemplateMenuCategory[] = [
  {
    idSuffix: 'cat-combos', name: 'Combos', color: 'orange', sort_order: 1,
    items: [
      { idSuffix: 'item-combo-1', name: 'Combo Clásico',   price: 129, sort_order: 1 },
      { idSuffix: 'item-combo-2', name: 'Combo Doble',     price: 159, sort_order: 2 },
      { idSuffix: 'item-combo-3', name: 'Combo Infantil',  price: 99,  sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-individuales', name: 'Individuales', color: 'green', sort_order: 2,
    items: [
      { idSuffix: 'item-hamburguesa', name: 'Hamburguesa',   price: 89, sort_order: 1 },
      { idSuffix: 'item-papas',       name: 'Papas',         price: 45, sort_order: 2 },
      { idSuffix: 'item-nuggets',     name: 'Nuggets',       price: 69, sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-bebidas', name: 'Bebidas', color: 'blue', sort_order: 3,
    items: [
      { idSuffix: 'item-refresco-ch', name: 'Refresco Chico',  price: 29, sort_order: 1 },
      { idSuffix: 'item-refresco-gd', name: 'Refresco Grande', price: 39, sort_order: 2 },
      { idSuffix: 'item-malteada',    name: 'Malteada',        price: 59, sort_order: 3 },
    ],
  },
]

const MENU_BAR: TemplateMenuCategory[] = [
  {
    idSuffix: 'cat-cerveza', name: 'Cerveza', color: 'yellow', sort_order: 1,
    items: [
      { idSuffix: 'item-cerveza-nal', name: 'Cerveza Nacional',   price: 65, sort_order: 1 },
      { idSuffix: 'item-cerveza-imp', name: 'Cerveza Importada',  price: 95, sort_order: 2 },
    ],
  },
  {
    idSuffix: 'cat-cocteles', name: 'Coctelería', color: 'purple', sort_order: 2,
    items: [
      { idSuffix: 'item-margarita', name: 'Margarita', price: 145, sort_order: 1 },
      { idSuffix: 'item-mojito',    name: 'Mojito',    price: 135, sort_order: 2 },
      { idSuffix: 'item-carajillo', name: 'Carajillo', price: 155, sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-botanas', name: 'Botanas', color: 'green', sort_order: 3,
    items: [
      { idSuffix: 'item-boneless', name: 'Boneless',       price: 165, sort_order: 1 },
      { idSuffix: 'item-nachos',   name: 'Nachos',         price: 125, sort_order: 2 },
    ],
  },
]

const MENU_CAFETERIA: TemplateMenuCategory[] = [
  {
    idSuffix: 'cat-cafe', name: 'Café', color: 'brown', sort_order: 1,
    items: [
      { idSuffix: 'item-americano', name: 'Americano',  price: 45, sort_order: 1 },
      { idSuffix: 'item-latte',     name: 'Latte',      price: 65, sort_order: 2 },
      { idSuffix: 'item-capuchino', name: 'Capuchino',  price: 62, sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-pan', name: 'Panadería', color: 'orange', sort_order: 2,
    items: [
      { idSuffix: 'item-croissant', name: 'Croissant',       price: 48, sort_order: 1 },
      { idSuffix: 'item-concha',    name: 'Concha',          price: 28, sort_order: 2 },
      { idSuffix: 'item-panque',    name: 'Panqué',          price: 55, sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-bebidas-frias', name: 'Bebidas Frías', color: 'blue', sort_order: 3,
    items: [
      { idSuffix: 'item-frappe', name: 'Frappé',        price: 75, sort_order: 1 },
      { idSuffix: 'item-jugo',   name: 'Jugo Natural',  price: 55, sort_order: 2 },
    ],
  },
]

const MENU_FINE_DINING: TemplateMenuCategory[] = [
  {
    idSuffix: 'cat-entradas', name: 'Entradas', color: 'green', sort_order: 1,
    items: [
      { idSuffix: 'item-entrada-1', name: 'Entrada de la Casa', price: 185, sort_order: 1 },
      { idSuffix: 'item-carpaccio', name: 'Carpaccio',          price: 245, sort_order: 2 },
    ],
  },
  {
    idSuffix: 'cat-fuertes', name: 'Platos Fuertes', color: 'red', sort_order: 2,
    items: [
      { idSuffix: 'item-corte',   name: 'Corte de la Casa', price: 595, sort_order: 1 },
      { idSuffix: 'item-pescado', name: 'Pesca del Día',    price: 425, sort_order: 2 },
      { idSuffix: 'item-pasta',   name: 'Pasta Artesanal',  price: 295, sort_order: 3 },
    ],
  },
  {
    idSuffix: 'cat-vinos', name: 'Vinos y Bar', color: 'purple', sort_order: 3,
    items: [
      { idSuffix: 'item-vino-copa',    name: 'Vino por Copa',    price: 165, sort_order: 1 },
      { idSuffix: 'item-vino-botella', name: 'Vino por Botella', price: 850, sort_order: 2 },
    ],
  },
  {
    idSuffix: 'cat-postres', name: 'Postres', color: 'pink', sort_order: 4,
    items: [
      { idSuffix: 'item-postre-1', name: 'Postre del Chef', price: 145, sort_order: 1 },
    ],
  },
]

function withMenu(menu: TemplateMenuCategory[]): OnboardingTemplate {
  return { ...DEFAULT_ONBOARDING_TEMPLATE, menu }
}

// ─── Combos semilla ──────────────────────────────────────────────────────────
// Mismos combos que se validaron a mano en carls-jr (2026-08-29): el precio del
// combo < suma de los items para que el POS muestre el ahorro.

const COMBOS_FAST_FOOD: SeedCombo[] = [
  {
    idSuffix: 'combo-clasico', name: 'Combo Clásico', price: 129,
    items: [
      { itemIdSuffix: 'item-hamburguesa', name: 'Hamburguesa' },
      { itemIdSuffix: 'item-papas', name: 'Papas' },
      { itemIdSuffix: 'item-refresco-ch', name: 'Refresco Chico', substitutions: [{ itemIdSuffix: 'item-malteada', name: 'Malteada' }] },
    ],
    upsell: { label: 'Agrandar combo', price_add: 20 },
  },
  {
    idSuffix: 'combo-doble', name: 'Combo Doble', price: 199,
    items: [
      { itemIdSuffix: 'item-hamburguesa', name: 'Hamburguesa' },
      { itemIdSuffix: 'item-hamburguesa', name: 'Hamburguesa' },
      { itemIdSuffix: 'item-papas', name: 'Papas' },
      { itemIdSuffix: 'item-refresco-gd', name: 'Refresco Grande' },
    ],
  },
  {
    idSuffix: 'combo-nuggets', name: 'Combo Nuggets', price: 119,
    items: [
      { itemIdSuffix: 'item-nuggets', name: 'Nuggets' },
      { itemIdSuffix: 'item-papas', name: 'Papas' },
      { itemIdSuffix: 'item-refresco-ch', name: 'Refresco Chico' },
    ],
  },
]

const COMBOS_CAFETERIA: SeedCombo[] = [
  {
    idSuffix: 'combo-desayuno', name: 'Café + Pan', price: 65,
    items: [
      { itemIdSuffix: 'item-americano', name: 'Americano', substitutions: [{ itemIdSuffix: 'item-latte', name: 'Latte' }] },
      { itemIdSuffix: 'item-croissant', name: 'Croissant', substitutions: [{ itemIdSuffix: 'item-concha', name: 'Concha' }] },
    ],
  },
]

// ─── The preset library ──────────────────────────────────────────────────────

export const VERTICAL_PRESETS: Record<VerticalId, VerticalPreset> = {
  fast_food: {
    id: 'fast_food',
    label: 'Fast Food / QSR',
    description: 'Mostrador, combos, velocidad. Sin meseros ni mesas.',
    serviceModel: 'counter',
    features: { delivery: true, nomina: true, resenas: false, giftCards: false },
    template: withMenu(MENU_FAST_FOOD),
    defaultMesas: 0,
    combos: COMBOS_FAST_FOOD,
  },
  fast_casual: {
    id: 'fast_casual',
    label: 'Fast Casual',
    description: 'Ordenas en fila, comes en mesa. Builder de producto.',
    serviceModel: 'counter',
    features: { delivery: true, nomina: true, resenas: true },
    template: withMenu(MENU_FAST_FOOD),
    defaultMesas: 8,
    combos: COMBOS_FAST_FOOD,
  },
  casual_dining: {
    id: 'casual_dining',
    label: 'Casual Dining',
    description: 'Mesas, meseros, servicio completo. El default.',
    serviceModel: 'tables',
    features: {},
    defaultMesas: 12,
  },
  fine_dining: {
    id: 'fine_dining',
    label: 'Fine Dining / High-end',
    description: 'Cursos, reservas, vinos, ticket alto.',
    serviceModel: 'tables',
    features: { resenas: true, giftCards: true },
    template: withMenu(MENU_FINE_DINING),
    defaultMesas: 16,
  },
  bar_cantina: {
    id: 'bar_cantina',
    label: 'Bar / Cantina',
    description: 'Cuentas abiertas, barra como estación principal, control de licor.',
    serviceModel: 'tabs',
    features: { resenas: true },
    template: withMenu(MENU_BAR),
    defaultMesas: 10,
  },
  cafeteria_panaderia: {
    id: 'cafeteria_panaderia',
    label: 'Cafetería / Panadería',
    description: 'Mostrador, vitrina, producción propia.',
    serviceModel: 'counter',
    features: { posTienda: true, bakery_station: true, nomina: true },
    template: withMenu(MENU_CAFETERIA),
    defaultMesas: 6,
    combos: COMBOS_CAFETERIA,
  },
  hibrido_restaurante_tienda: {
    id: 'hibrido_restaurante_tienda',
    label: 'Híbrido Restaurante + Tienda',
    description: 'Mesas y meseros + market con venta directa (modelo AMALAY).',
    serviceModel: 'tables',
    features: { posTienda: true, resenas: true },
    defaultMesas: 14,
  },
  dark_kitchen: {
    id: 'dark_kitchen',
    label: 'Dark Kitchen / Delivery',
    description: 'Sin sala: las órdenes llegan de Rappi/Uber/web directo al KDS.',
    serviceModel: 'channels',
    features: { posRestaurant: false, delivery: true, ecommerce: true, resenas: true },
    defaultMesas: 0,
  },
}

export const VERTICAL_IDS = Object.keys(VERTICAL_PRESETS) as VerticalId[]

export function isVerticalId(value: unknown): value is VerticalId {
  return typeof value === 'string' && value in VERTICAL_PRESETS
}

export function resolveVerticalPreset(id: VerticalId): VerticalPreset {
  return VERTICAL_PRESETS[id]
}
