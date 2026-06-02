/**
 * Plan/Tier system — controls which modules, pages, and agents each tenant can access.
 *
 * Plans:
 *   - "antifraude": only anti-fraud agent + its report page
 *   - "fullsite_os": all agents + full dashboard + WhatsApp bot. No POS/payments/CFDI.
 *   - "fullsite_pos": everything (POS, payments, CFDI, all agents, full dashboard)
 *
 * Default: "fullsite_pos" (preserves AMALAY's current access exactly)
 */

export type PlanId = 'antifraude' | 'fullsite_os' | 'fullsite_pos'

export const PLAN_DEFAULT: PlanId = 'fullsite_pos'

export interface PlanDefinition {
  id: PlanId
  name: string
  description: string
  pages: string[]       // page paths the plan can access (prefix match)
  agents: string[]      // agent IDs that run for this plan ('*' = all)
  features: {
    pos: boolean
    payments: boolean
    cfdi: boolean
    dashboard: boolean
    agents: boolean
    bot: boolean
    crm: boolean
  }
}

const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  antifraude: {
    id: 'antifraude',
    name: 'Anti-Fraude',
    description: 'Solo agente de anti-fraude + reporte',
    pages: [
      '/',                    // dashboard (limited view)
      '/agentes',             // agents list
      '/agentes/antifraude',  // anti-fraud detail
      '/ventas',              // ventas (needed for fraud context)
      '/cortes',              // cortes (needed for fraud context)
      '/login',
    ],
    agents: ['antifraud', 'config-validator', 'hermes'],
    features: {
      pos: false,
      payments: false,
      cfdi: false,
      dashboard: true,
      agents: true,
      bot: false,
      crm: false,
    },
  },

  fullsite_os: {
    id: 'fullsite_os',
    name: 'Fullsite OS',
    description: 'Todos los agentes + dashboard + bot. Sin POS.',
    pages: [
      '/',
      '/roi', '/sucursales', '/ventas', '/cortes',
      '/meseros', '/platillos', '/tendencias', '/propinas',
      '/ingresos', '/estado-resultados', '/nomina',
      '/inventario', '/auto86', '/food-cost', '/compras',
      '/proveedores', '/ecommerce', '/reportes',
      '/crm', '/mission-control', '/agentes',
      '/coach', '/chat', '/voice',
      '/login', '/onboarding',
    ],
    agents: ['*'], // all agents
    features: {
      pos: false,
      payments: false,
      cfdi: false,
      dashboard: true,
      agents: true,
      bot: true,
      crm: true,
    },
  },

  fullsite_pos: {
    id: 'fullsite_pos',
    name: 'Fullsite POS',
    description: 'Todo incluido: POS + agentes + dashboard + pagos + CFDI',
    pages: ['*'], // all pages
    agents: ['*'], // all agents
    features: {
      pos: true,
      payments: true,
      cfdi: true,
      dashboard: true,
      agents: true,
      bot: true,
      crm: true,
    },
  },
}

/** Get plan definition by ID. Returns fullsite_pos if unknown. */
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
