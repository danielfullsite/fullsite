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
 * MULTI-SUCURSAL — la primera paga la entrada, las demás sólo la operación:
 *   - reporteador:        $1,999 la primera · $1,199 cada adicional
 *   - fullsite_software:  $4,999 la primera · $2,999 cada adicional
 *   - fullsite_completo:  igual + $45,000 de hardware POR SUCURSAL (cada local
 *                         necesita el suyo, ése no baja)
 *   - 10+ sucursales:     cotización manual, ver SUCURSALES_COTIZACION_CUSTOM
 *
 * Usar `cotizarGrupo(planId, n)`; no multiplicar priceMonthly por sucursales.
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
  priceMonthly: number    // MXN — PRIMERA sucursal
  priceAnnual: number     // MXN — PRIMERA sucursal (con descuento anual)
  /**
   * MXN/mes por cada sucursal ADICIONAL (de la 2 a la 9).
   *
   * La primera paga la entrada; las demás sólo la operación. El costo marginal
   * de la sucursal 2 es casi cero —mismo menú, misma relación, una sola
   * implementación— así que cobrarle lo mismo que a la primera no se sostiene.
   *
   * Y del lado del valor pasa lo contrario: la sucursal adicional es la que
   * ENCIENDE la vista consolidada. Wansoft le deja al grupo tres islas; el
   * producto aquí es poder compararlas. Cuesta menos y vale más.
   */
  priceAdditionalLocation: number
  hardwareKit?: number    // MXN one-time — POR SUCURSAL (cada local necesita el suyo)
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
    // 60% de la primera, el mismo ratio que los otros dos planes.
    priceAdditionalLocation: 1199,
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
    priceAdditionalLocation: 2999,
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
    priceAdditionalLocation: 2999,
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

/**
 * A partir de esta cantidad de sucursales el precio deja de ser de lista.
 *
 * No es un descuento por volumen más: arriba de 10 el trato cambia de naturaleza
 * (implementación por fases, SLA, facturación consolidada, a veces integración
 * con su ERP). Grupo Galería son 200+ restaurantes — a precio de lista serían
 * ~$600K/mes, un número que no significa nada. Esos casos se cotizan a mano.
 */
export const SUCURSALES_COTIZACION_CUSTOM = 10

export interface CotizacionGrupo {
  sucursales: number
  /** Renta mensual del grupo completo, en MXN. */
  totalMensual: number
  /** Renta anual del grupo, aplicando el descuento anual a la primera sucursal. */
  totalAnual: number
  /** Hardware una sola vez. Cada local necesita el suyo, así que multiplica. */
  hardwareUnicaVez: number
  /** Costo mensual promedio por sucursal — el número que el cliente compara. */
  promedioPorSucursal: number
  /** true = arriba del umbral; el total es referencia, no una oferta. */
  requiereCotizacionManual: boolean
}

/**
 * Cotiza un grupo de N sucursales bajo un plan.
 *
 * La primera sucursal paga precio completo; de la segunda en adelante pagan
 * `priceAdditionalLocation`. Ver el comentario de ese campo para el porqué.
 *
 * Lanza si `sucursales` no es un entero >= 1: una cotización de 0 o de 2.5
 * sucursales es un error de quien llama, y devolver $0 en silencio terminaría en
 * una propuesta mandada a un cliente.
 */
export function cotizarGrupo(planId: string | undefined | null, sucursales: number): CotizacionGrupo {
  if (!Number.isInteger(sucursales) || sucursales < 1) {
    throw new Error(`cotizarGrupo: sucursales debe ser un entero >= 1, se recibió ${sucursales}`)
  }

  const plan = getPlan(planId)
  const adicionales = sucursales - 1

  const totalMensual = plan.priceMonthly + adicionales * plan.priceAdditionalLocation

  // El descuento anual aplica sobre la primera sucursal, que es donde vive el
  // precio de lista. Las adicionales ya vienen descontadas por ser adicionales;
  // encimarles el descuento anual sería descontar dos veces.
  const totalAnual = plan.priceAnnual + adicionales * plan.priceAdditionalLocation * 12

  return {
    sucursales,
    totalMensual,
    totalAnual,
    hardwareUnicaVez: (plan.hardwareKit ?? 0) * sucursales,
    promedioPorSucursal: Math.round(totalMensual / sucursales),
    requiereCotizacionManual: sucursales >= SUCURSALES_COTIZACION_CUSTOM,
  }
}
