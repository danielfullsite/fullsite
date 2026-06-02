import { describe, it, expect } from 'vitest'
import { getPlan, canPlanAccessPage, canPlanRunAgent, hasPlanFeature, getAllPlans, PLAN_DEFAULT } from '../lib/plans'

describe('getPlan', () => {
  it('returns fullsite_pos for null/undefined', () => {
    expect(getPlan(null).id).toBe('fullsite_pos')
    expect(getPlan(undefined).id).toBe('fullsite_pos')
  })
  it('returns fullsite_pos for unknown plan', () => {
    expect(getPlan('nonexistent').id).toBe('fullsite_pos')
    expect(getPlan('').id).toBe('fullsite_pos')
  })
  it('returns correct plan for valid IDs', () => {
    expect(getPlan('antifraude').id).toBe('antifraude')
    expect(getPlan('fullsite_os').id).toBe('fullsite_os')
    expect(getPlan('fullsite_pos').id).toBe('fullsite_pos')
  })
  it('default is fullsite_pos', () => {
    expect(PLAN_DEFAULT).toBe('fullsite_pos')
  })
})

describe('canPlanAccessPage — antifraude', () => {
  const plan = 'antifraude'
  it('can access dashboard', () => expect(canPlanAccessPage(plan, '/')).toBe(true))
  it('can access agentes', () => expect(canPlanAccessPage(plan, '/agentes')).toBe(true))
  it('can access antifraude detail', () => expect(canPlanAccessPage(plan, '/agentes/antifraude')).toBe(true))
  it('can access ventas', () => expect(canPlanAccessPage(plan, '/ventas')).toBe(true))
  it('can access cortes', () => expect(canPlanAccessPage(plan, '/cortes')).toBe(true))
  it('CANNOT access POS', () => expect(canPlanAccessPage(plan, '/pos')).toBe(false))
  it('CANNOT access food-cost', () => expect(canPlanAccessPage(plan, '/food-cost')).toBe(false))
  it('CANNOT access inventario', () => expect(canPlanAccessPage(plan, '/inventario')).toBe(false))
  it('CANNOT access coach', () => expect(canPlanAccessPage(plan, '/coach')).toBe(false))
  it('CANNOT access chat', () => expect(canPlanAccessPage(plan, '/chat')).toBe(false))
  it('CANNOT access admin', () => expect(canPlanAccessPage(plan, '/admin/menu')).toBe(false))
  it('CANNOT access meseros', () => expect(canPlanAccessPage(plan, '/meseros')).toBe(false))
  it('CANNOT access roi', () => expect(canPlanAccessPage(plan, '/roi')).toBe(false))
  it('CANNOT access CRM', () => expect(canPlanAccessPage(plan, '/crm')).toBe(false))
})

describe('canPlanAccessPage — fullsite_os', () => {
  const plan = 'fullsite_os'
  it('can access dashboard', () => expect(canPlanAccessPage(plan, '/')).toBe(true))
  it('can access all reportes', () => {
    expect(canPlanAccessPage(plan, '/ventas')).toBe(true)
    expect(canPlanAccessPage(plan, '/meseros')).toBe(true)
    expect(canPlanAccessPage(plan, '/platillos')).toBe(true)
    expect(canPlanAccessPage(plan, '/tendencias')).toBe(true)
    expect(canPlanAccessPage(plan, '/propinas')).toBe(true)
  })
  it('can access all agents', () => {
    expect(canPlanAccessPage(plan, '/agentes')).toBe(true)
    expect(canPlanAccessPage(plan, '/coach')).toBe(true)
    expect(canPlanAccessPage(plan, '/chat')).toBe(true)
    expect(canPlanAccessPage(plan, '/voice')).toBe(true)
    expect(canPlanAccessPage(plan, '/mission-control')).toBe(true)
  })
  it('can access financials', () => {
    expect(canPlanAccessPage(plan, '/ingresos')).toBe(true)
    expect(canPlanAccessPage(plan, '/estado-resultados')).toBe(true)
    expect(canPlanAccessPage(plan, '/roi')).toBe(true)
  })
  it('can access operations', () => {
    expect(canPlanAccessPage(plan, '/inventario')).toBe(true)
    expect(canPlanAccessPage(plan, '/food-cost')).toBe(true)
    expect(canPlanAccessPage(plan, '/auto86')).toBe(true)
  })
  it('CANNOT access POS', () => expect(canPlanAccessPage(plan, '/pos')).toBe(false))
  it('CANNOT access POS subpages', () => {
    expect(canPlanAccessPage(plan, '/pos/mesas')).toBe(false)
    expect(canPlanAccessPage(plan, '/pos/cocina')).toBe(false)
    expect(canPlanAccessPage(plan, '/pos/corte')).toBe(false)
  })
  it('CANNOT access admin', () => {
    expect(canPlanAccessPage(plan, '/admin/menu')).toBe(false)
    expect(canPlanAccessPage(plan, '/admin/grupos')).toBe(false)
  })
})

describe('canPlanAccessPage — fullsite_pos', () => {
  const plan = 'fullsite_pos'
  it('can access EVERYTHING', () => {
    expect(canPlanAccessPage(plan, '/')).toBe(true)
    expect(canPlanAccessPage(plan, '/pos')).toBe(true)
    expect(canPlanAccessPage(plan, '/pos/mesas')).toBe(true)
    expect(canPlanAccessPage(plan, '/admin/menu')).toBe(true)
    expect(canPlanAccessPage(plan, '/pos/facturacion')).toBe(true)
    expect(canPlanAccessPage(plan, '/agentes')).toBe(true)
    expect(canPlanAccessPage(plan, '/coach')).toBe(true)
    expect(canPlanAccessPage(plan, '/food-cost')).toBe(true)
    expect(canPlanAccessPage(plan, '/crm')).toBe(true)
    expect(canPlanAccessPage(plan, '/some-future-page')).toBe(true)
  })
})

describe('canPlanAccessPage — null/undefined defaults to fullsite_pos', () => {
  it('null plan can access everything', () => {
    expect(canPlanAccessPage(null, '/pos')).toBe(true)
    expect(canPlanAccessPage(null, '/admin/menu')).toBe(true)
  })
  it('undefined plan can access everything', () => {
    expect(canPlanAccessPage(undefined, '/pos')).toBe(true)
    expect(canPlanAccessPage(undefined, '/agentes')).toBe(true)
  })
})

describe('canPlanRunAgent', () => {
  it('antifraude can only run antifraud + config-validator + hermes', () => {
    expect(canPlanRunAgent('antifraude', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('antifraude', 'config-validator')).toBe(true)
    expect(canPlanRunAgent('antifraude', 'hermes')).toBe(true)
    expect(canPlanRunAgent('antifraude', 'anomaly')).toBe(false)
    expect(canPlanRunAgent('antifraude', 'upselling')).toBe(false)
    expect(canPlanRunAgent('antifraude', 'staffing')).toBe(false)
  })
  it('fullsite_os can run all agents', () => {
    expect(canPlanRunAgent('fullsite_os', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('fullsite_os', 'anomaly')).toBe(true)
    expect(canPlanRunAgent('fullsite_os', 'upselling')).toBe(true)
    expect(canPlanRunAgent('fullsite_os', 'anything')).toBe(true)
  })
  it('fullsite_pos can run all agents', () => {
    expect(canPlanRunAgent('fullsite_pos', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('fullsite_pos', 'anything')).toBe(true)
  })
  it('null defaults to all agents', () => {
    expect(canPlanRunAgent(null, 'antifraud')).toBe(true)
    expect(canPlanRunAgent(null, 'anything')).toBe(true)
  })
})

describe('hasPlanFeature', () => {
  it('antifraude has only dashboard + agents', () => {
    expect(hasPlanFeature('antifraude', 'dashboard')).toBe(true)
    expect(hasPlanFeature('antifraude', 'agents')).toBe(true)
    expect(hasPlanFeature('antifraude', 'pos')).toBe(false)
    expect(hasPlanFeature('antifraude', 'payments')).toBe(false)
    expect(hasPlanFeature('antifraude', 'cfdi')).toBe(false)
    expect(hasPlanFeature('antifraude', 'bot')).toBe(false)
    expect(hasPlanFeature('antifraude', 'crm')).toBe(false)
  })
  it('fullsite_os has everything except pos/payments/cfdi', () => {
    expect(hasPlanFeature('fullsite_os', 'dashboard')).toBe(true)
    expect(hasPlanFeature('fullsite_os', 'agents')).toBe(true)
    expect(hasPlanFeature('fullsite_os', 'bot')).toBe(true)
    expect(hasPlanFeature('fullsite_os', 'crm')).toBe(true)
    expect(hasPlanFeature('fullsite_os', 'pos')).toBe(false)
    expect(hasPlanFeature('fullsite_os', 'payments')).toBe(false)
    expect(hasPlanFeature('fullsite_os', 'cfdi')).toBe(false)
  })
  it('fullsite_pos has everything', () => {
    expect(hasPlanFeature('fullsite_pos', 'pos')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'payments')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'cfdi')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'dashboard')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'agents')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'bot')).toBe(true)
    expect(hasPlanFeature('fullsite_pos', 'crm')).toBe(true)
  })
})

describe('getAllPlans', () => {
  it('returns 3 plans', () => {
    expect(getAllPlans()).toHaveLength(3)
  })
  it('all plans have required fields', () => {
    for (const plan of getAllPlans()) {
      expect(plan.id).toBeTruthy()
      expect(plan.name).toBeTruthy()
      expect(plan.pages).toBeInstanceOf(Array)
      expect(plan.agents).toBeInstanceOf(Array)
      expect(plan.features).toBeDefined()
    }
  })
})

describe('AMALAY backward compatibility', () => {
  // AMALAY has no plan field set → defaults to fullsite_pos
  // This must preserve EXACTLY the access they have today
  it('AMALAY (no plan = fullsite_pos) can access all dashboard pages', () => {
    const plan = undefined // AMALAY has no plan field
    expect(canPlanAccessPage(plan, '/')).toBe(true)
    expect(canPlanAccessPage(plan, '/ventas')).toBe(true)
    expect(canPlanAccessPage(plan, '/meseros')).toBe(true)
    expect(canPlanAccessPage(plan, '/food-cost')).toBe(true)
    expect(canPlanAccessPage(plan, '/agentes')).toBe(true)
    expect(canPlanAccessPage(plan, '/coach')).toBe(true)
    expect(canPlanAccessPage(plan, '/chat')).toBe(true)
  })
  it('AMALAY can access POS', () => {
    expect(canPlanAccessPage(undefined, '/pos')).toBe(true)
    expect(canPlanAccessPage(undefined, '/pos/mesas')).toBe(true)
    expect(canPlanAccessPage(undefined, '/pos/cocina')).toBe(true)
    expect(canPlanAccessPage(undefined, '/admin/menu')).toBe(true)
  })
  it('AMALAY can run all agents', () => {
    expect(canPlanRunAgent(undefined, 'antifraud')).toBe(true)
    expect(canPlanRunAgent(undefined, 'anomaly')).toBe(true)
    expect(canPlanRunAgent(undefined, 'upselling')).toBe(true)
  })
  it('AMALAY has all features', () => {
    expect(hasPlanFeature(undefined, 'pos')).toBe(true)
    expect(hasPlanFeature(undefined, 'payments')).toBe(true)
    expect(hasPlanFeature(undefined, 'cfdi')).toBe(true)
  })
})
