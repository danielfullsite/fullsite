// Onboarding skeleton template — the DEFAULT shape every new tenant is cloned from.
//
// Contract: this is a config-driven, client-AGNOSTIC template. It contains ZERO
// hardcode tied to any specific restaurant. `provisionTenant()` reads it and tags
// every row with the new client_id, producing a full but generic tenant skeleton
// (menu + payment methods + roles) that the owner then customizes.
//
// FUTURE (Fase 2 infra exists): this template can be sourced at runtime from
// `platform_settings` key `onboarding_template` so ops can evolve the default
// skeleton without a deploy. For now the code constant below is the source of truth;
// provisionTenant should fall back to it if the platform_settings row is absent.
//
// Table/column shapes mirror seeds/_lib/seed-restaurant.ts exactly.

import type { DashboardRole } from './roles'

export interface TemplateMenuItem {
  // id suffix — final row id is `${clientId}-${idSuffix}`
  idSuffix: string
  name: string
  price: number // MXN
  sort_order: number
}

export interface TemplateMenuCategory {
  idSuffix: string
  name: string
  color: string
  sort_order: number
  items: TemplateMenuItem[]
}

export interface TemplatePaymentMethod {
  name: string
  type: 'cash' | 'card' | 'transfer' | 'digital'
  commission_pct: number
  fiscal_code: string
}

export interface OnboardingTemplate {
  menu: TemplateMenuCategory[]
  paymentMethods: TemplatePaymentMethod[]
  // Roles seeded as pos_staff placeholder rows (one per role) so the owner has a
  // starting role set. The owner (auth user) is created separately in the route.
  roles: DashboardRole[]
}

// ─── Default skeleton ────────────────────────────────────────────────────────

export const DEFAULT_ONBOARDING_TEMPLATE: OnboardingTemplate = {
  menu: [
    {
      idSuffix: 'cat-bebidas', name: 'Bebidas', color: 'blue', sort_order: 1,
      items: [
        { idSuffix: 'item-agua',      name: 'Agua Natural',     price: 25, sort_order: 1 },
        { idSuffix: 'item-refresco',  name: 'Refresco',         price: 35, sort_order: 2 },
        { idSuffix: 'item-cafe',      name: 'Café Americano',   price: 45, sort_order: 3 },
        { idSuffix: 'item-jugo',      name: 'Jugo Natural',     price: 55, sort_order: 4 },
      ],
    },
    {
      idSuffix: 'cat-alimentos', name: 'Alimentos', color: 'green', sort_order: 2,
      items: [
        { idSuffix: 'item-sopa',      name: 'Sopa del Día',     price: 75,  sort_order: 1 },
        { idSuffix: 'item-ensalada',  name: 'Ensalada',         price: 95,  sort_order: 2 },
        { idSuffix: 'item-plato',     name: 'Plato Fuerte',     price: 145, sort_order: 3 },
        { idSuffix: 'item-sandwich',  name: 'Sándwich',         price: 110, sort_order: 4 },
      ],
    },
    {
      idSuffix: 'cat-postres', name: 'Postres', color: 'pink', sort_order: 3,
      items: [
        { idSuffix: 'item-pastel',    name: 'Rebanada de Pastel', price: 65, sort_order: 1 },
        { idSuffix: 'item-helado',    name: 'Helado',             price: 55, sort_order: 2 },
        { idSuffix: 'item-flan',      name: 'Flan',               price: 60, sort_order: 3 },
      ],
    },
  ],

  // 4 default payment methods. Fiscal codes are SAT c_FormaPago catalog values.
  paymentMethods: [
    { name: 'Efectivo',         type: 'cash',     commission_pct: 0,   fiscal_code: '01' },
    { name: 'Tarjeta crédito',  type: 'card',     commission_pct: 2.5, fiscal_code: '04' },
    { name: 'Tarjeta débito',   type: 'card',     commission_pct: 1.5, fiscal_code: '28' },
    { name: 'Transferencia',    type: 'transfer', commission_pct: 0,   fiscal_code: '03' },
  ],

  // Full role set from src/lib/roles.ts (DashboardRole).
  roles: ['dueño', 'gerente', 'capitan', 'cajero', 'mesero', 'staff'],
}
