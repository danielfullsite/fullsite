/**
 * Plan/Tier system — controls which modules, pages, and agents each tenant can access.
 *
 * Plans:
 *   - "reporteador": IA layer on existing POS (no POS, no hardware)
 *   - "fullsite_software": full software suite (POS + IA + dashboard, no hardware)
 *   - "fullsite_completo": everything + hardware kit
 *
 * Pricing (per sucursal, MXN). El anual descuenta ~2 meses en los tres.
 *   - reporteador:        $1,999/mes · $19,999/año  (ahorra $3,989 vs 1,999×12)
 *   - fullsite_software:  $4,999/mes · $49,999/año  (ahorra $9,989 vs 4,999×12)
 *   - fullsite_completo:  $4,999/mes · $49,999/año  + hardware kit $45,000 (one-time)
 *
 * El encabezado anterior decía "reporteador $17,999/año, ahorra $0" mientras el
 * código cobraba 14999. Comentario y código llevaban meses en desacuerdo; ahora
 * cuadran y el descuento anual es el mismo ~17% en los tres planes.
 *
 * Competitor: el sistema anterior = $1,500/mes software + $130K hardware = $148K first year
 * Fullsite completo = $95K first year (36% cheaper)
 */

export type PlanId = 'reporteador' | 'fullsite_software' | 'fullsite_completo'

export const PLAN_DEFAULT: PlanId = 'fullsite_completo'

export interface PlanDefinition {
  id: PlanId
  name: string
  description: string
  priceMonthly: number    // MXN per sucursal
  priceAnnual: number     // MXN per sucursal (discounted)
  hardwareKit?: number    // MXN one-time (optional)
  pages: string[]
  agents: string[]
  features: {
    pos: boolean
    payments: boolean
    cfdi: boolean
    dashboard: boolean
    agents: boolean
    bot: boolean
    crm: boolean
    hardware: boolean
  }
}

const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  reporteador: {
    // El id se queda como 'reporteador' A PROPÓSITO: está guardado en la config de
    // clientes y en restaurant-manifest. Cambiarlo sería una migración de datos por
    // un tema de marca. Lo que el cliente ve es `name`.
    id: 'reporteador',
    name: 'Fullsite Inteligencia',
    description: 'El experto de IA sobre el POS que ya tienes — sin cambiar nada',
    priceMonthly: 1999,
    priceAnnual: 19999,
    pages: [
      '/',
      '/ventas', '/cortes', '/meseros', '/platillos', '/tendencias', '/propinas',
      '/ingresos', '/costos', '/reportes', '/reportes/ingresos',
      '/cancelaciones', '/caja', '/delivery', '/proveedores',
      '/agentes', '/coach', '/chat',
      '/login', '/onboarding',
    ],
    agents: ['*'],
    features: {
      pos: false,
      payments: false,
      cfdi: false,
      dashboard: true,
      agents: true,
      bot: true,
      crm: false,
      hardware: false,
    },
  },

  fullsite_software: {
    id: 'fullsite_software',
    name: 'Fullsite Software',
    description: 'POS completo + 30 agentes IA + dashboard + soporte — sin hardware',
    priceMonthly: 4999,
    priceAnnual: 49999,
    pages: ['*'],
    agents: ['*'],
    features: {
      pos: true,
      payments: true,
      cfdi: true,
      dashboard: true,
      agents: true,
      bot: true,
      crm: true,
      hardware: false,
    },
  },

  fullsite_completo: {
    id: 'fullsite_completo',
    name: 'Fullsite Completo',
    description: 'Todo incluido: POS + IA + hardware — llave en mano',
    priceMonthly: 4999,
    priceAnnual: 49999,
    hardwareKit: 45000,
    pages: ['*'],
    agents: ['*'],
    features: {
      pos: true,
      payments: true,
      cfdi: true,
      dashboard: true,
      agents: true,
      bot: true,
      crm: true,
      hardware: true,
    },
  },
}

/** Get plan definition by ID. Returns fullsite_completo if unknown. */
export function getPlan(planId: string | undefined | null): PlanDefinition {
  if (planId && planId in PLAN_DEFINITIONS) {
    return PLAN_DEFINITIONS[planId as PlanId]
  }
  return PLAN_DEFINITIONS[PLAN_DEFAULT]
}

/** Check if a plan can access a specific page path. */
export function canPlanAccessPage(planId: string | undefined | null, path: string): boolean {
  const plan = getPlan(planId)
  if (plan.pages[0] === '*') return true
  return plan.pages.some(p => path === p || path.startsWith(p + '/'))
}

/** Check if a plan can run a specific agent. */
export function canPlanRunAgent(planId: string | undefined | null, agentId: string): boolean {
  const plan = getPlan(planId)
  if (plan.agents[0] === '*') return true
  return plan.agents.includes(agentId)
}

/** Check if a plan has a specific feature. */
export function hasPlanFeature(planId: string | undefined | null, feature: keyof PlanDefinition['features']): boolean {
  const plan = getPlan(planId)
  return plan.features[feature]
}

/** Get all plan definitions (for admin UI, etc). */
export function getAllPlans(): PlanDefinition[] {
  return Object.values(PLAN_DEFINITIONS)
}
