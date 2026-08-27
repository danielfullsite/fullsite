import { describe, it, expect } from 'vitest'
import { getPlan, canPlanAccessPage, canPlanRunAgent, hasPlanFeature, getAllPlans, PLAN_DEFAULT } from '../lib/plans'

describe('getPlan', () => {
  it('returns fullsite_completo for null/undefined', () => {
    expect(getPlan(null).id).toBe('fullsite_completo')
    expect(getPlan(undefined).id).toBe('fullsite_completo')
  })
  it('returns fullsite_completo for unknown plan', () => {
    expect(getPlan('nonexistent').id).toBe('fullsite_completo')
    expect(getPlan('').id).toBe('fullsite_completo')
  })
  it('returns correct plan for valid IDs', () => {
    expect(getPlan('reporteador').id).toBe('reporteador')
    expect(getPlan('fullsite_software').id).toBe('fullsite_software')
    expect(getPlan('fullsite_completo').id).toBe('fullsite_completo')
  })
  it('default is fullsite_completo', () => {
    expect(PLAN_DEFAULT).toBe('fullsite_completo')
  })
})

describe('canPlanAccessPage — reporteador', () => {
  const plan = 'reporteador'
  it('can access dashboard', () => expect(canPlanAccessPage(plan, '/')).toBe(true))
  it('can access agentes', () => expect(canPlanAccessPage(plan, '/agentes')).toBe(true))
  it('can access ventas', () => expect(canPlanAccessPage(plan, '/ventas')).toBe(true))
  it('can access cortes', () => expect(canPlanAccessPage(plan, '/cortes')).toBe(true))
  it('can access meseros', () => expect(canPlanAccessPage(plan, '/meseros')).toBe(true))
  it('can access coach', () => expect(canPlanAccessPage(plan, '/coach')).toBe(true))
  it('can access chat', () => expect(canPlanAccessPage(plan, '/chat')).toBe(true))
  it('CANNOT access POS', () => expect(canPlanAccessPage(plan, '/pos')).toBe(false))
  it('CANNOT access food-cost', () => expect(canPlanAccessPage(plan, '/food-cost')).toBe(false))
  it('CANNOT access inventario', () => expect(canPlanAccessPage(plan, '/inventario')).toBe(false))
  it('CANNOT access admin', () => expect(canPlanAccessPage(plan, '/admin/menu')).toBe(false))
  it('CANNOT access CRM', () => expect(canPlanAccessPage(plan, '/crm')).toBe(false))
})

describe('canPlanAccessPage — fullsite_software', () => {
  const plan = 'fullsite_software'
  it('can access EVERYTHING (wildcard)', () => {
    expect(canPlanAccessPage(plan, '/')).toBe(true)
    expect(canPlanAccessPage(plan, '/pos')).toBe(true)
    expect(canPlanAccessPage(plan, '/pos/mesas')).toBe(true)
    expect(canPlanAccessPage(plan, '/admin/menu')).toBe(true)
    expect(canPlanAccessPage(plan, '/agentes')).toBe(true)
    expect(canPlanAccessPage(plan, '/food-cost')).toBe(true)
    expect(canPlanAccessPage(plan, '/crm')).toBe(true)
    expect(canPlanAccessPage(plan, '/some-future-page')).toBe(true)
  })
})

describe('canPlanAccessPage — fullsite_completo', () => {
  const plan = 'fullsite_completo'
  it('can access EVERYTHING (wildcard)', () => {
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

describe('canPlanAccessPage — null/undefined defaults to fullsite_completo', () => {
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
  it('reporteador can run all agents (wildcard)', () => {
    expect(canPlanRunAgent('reporteador', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('reporteador', 'anomaly')).toBe(true)
    expect(canPlanRunAgent('reporteador', 'anything')).toBe(true)
  })
  it('fullsite_software can run all agents', () => {
    expect(canPlanRunAgent('fullsite_software', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('fullsite_software', 'anomaly')).toBe(true)
    expect(canPlanRunAgent('fullsite_software', 'anything')).toBe(true)
  })
  it('fullsite_completo can run all agents', () => {
    expect(canPlanRunAgent('fullsite_completo', 'antifraud')).toBe(true)
    expect(canPlanRunAgent('fullsite_completo', 'anything')).toBe(true)
  })
  it('null defaults to all agents', () => {
    expect(canPlanRunAgent(null, 'antifraud')).toBe(true)
    expect(canPlanRunAgent(null, 'anything')).toBe(true)
  })
})

describe('hasPlanFeature', () => {
  it('reporteador has dashboard + agents + bot, no pos/payments/cfdi/crm', () => {
    expect(hasPlanFeature('reporteador', 'dashboard')).toBe(true)
    expect(hasPlanFeature('reporteador', 'agents')).toBe(true)
    expect(hasPlanFeature('reporteador', 'bot')).toBe(true)
    expect(hasPlanFeature('reporteador', 'pos')).toBe(false)
    expect(hasPlanFeature('reporteador', 'payments')).toBe(false)
    expect(hasPlanFeature('reporteador', 'cfdi')).toBe(false)
    expect(hasPlanFeature('reporteador', 'crm')).toBe(false)
    expect(hasPlanFeature('reporteador', 'hardware')).toBe(false)
  })
  it('fullsite_software has everything except hardware', () => {
    expect(hasPlanFeature('fullsite_software', 'dashboard')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'agents')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'bot')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'crm')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'pos')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'payments')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'cfdi')).toBe(true)
    expect(hasPlanFeature('fullsite_software', 'hardware')).toBe(false)
  })
  it('fullsite_completo has everything including hardware', () => {
    expect(hasPlanFeature('fullsite_completo', 'pos')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'payments')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'cfdi')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'dashboard')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'agents')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'bot')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'crm')).toBe(true)
    expect(hasPlanFeature('fullsite_completo', 'hardware')).toBe(true)
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
  it('plans have pricing', () => {
    for (const plan of getAllPlans()) {
      expect(plan.priceMonthly).toBeGreaterThan(0)
      expect(plan.priceAnnual).toBeGreaterThan(0)
    }
  })

  // Los precios son un contrato comercial, no un detalle de implementación.
  // Antes sólo se afirmaba "> 0", y por eso el encabezado del archivo pudo decir
  // "$17,999/año, ahorra $0" mientras el código cobraba 14,999 sin que nada lo
  // detectara. Estos casos fijan los números de docs/strategy/PRICING.md para que
  // moverlos sea una decisión explícita y no una deriva silenciosa.
  it('los precios son exactamente los de PRICING.md', () => {
    const esperado: Record<string, { mes: number; anio: number; hardware?: number }> = {
      reporteador:       { mes: 1999, anio: 19999 },
      fullsite_software: { mes: 4999, anio: 49999 },
      fullsite_completo: { mes: 4999, anio: 49999, hardware: 45000 },
    }
    for (const plan of getAllPlans()) {
      const e = esperado[plan.id]
      expect(e, `plan ${plan.id} sin precio esperado — actualiza PRICING.md y esta prueba`).toBeDefined()
      expect(plan.priceMonthly, `${plan.id} mensual`).toBe(e.mes)
      expect(plan.priceAnnual, `${plan.id} anual`).toBe(e.anio)
      if (e.hardware) expect(plan.hardwareKit, `${plan.id} hardware`).toBe(e.hardware)
    }
  })

  it('el anual descuenta entre 15% y 20% en los tres planes', () => {
    for (const plan of getAllPlans()) {
      const descuento = 1 - plan.priceAnnual / (plan.priceMonthly * 12)
      expect(descuento, `${plan.id} descuenta ${(descuento * 100).toFixed(1)}%`).toBeGreaterThan(0.15)
      expect(descuento, `${plan.id} descuenta ${(descuento * 100).toFixed(1)}%`).toBeLessThan(0.20)
    }
  })

  // La escalera tiene que seguir siendo escalera: la cuña entra barato y el
  // producto completo cuesta más. Si se invierte, el movimiento de venta —entrar
  // con Inteligencia y subir a Fullsite— deja de tener sentido.
  it('la cuña cuesta menos que el producto completo', () => {
    const porId = Object.fromEntries(getAllPlans().map(p => [p.id, p]))
    expect(porId.reporteador.priceMonthly).toBeLessThan(porId.fullsite_software.priceMonthly)
    expect(porId.reporteador.priceAnnual).toBeLessThan(porId.fullsite_software.priceAnnual)
  })
})

describe('AMALAY backward compatibility', () => {
  // AMALAY has no plan field set → defaults to fullsite_completo
  it('AMALAY (no plan = fullsite_completo) can access all dashboard pages', () => {
    const plan = undefined
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
    expect(hasPlanFeature(undefined, 'hardware')).toBe(true)
  })
})
