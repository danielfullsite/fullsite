import { describe, expect, it } from 'vitest'

/**
 * Caso Uber GTS 2026-08-26: concedieron eats.store.promotion.write y
 * eats.store.promotion.read al Test Client ID y piden confirmar si sigue habiendo
 * problemas — con 5 días antes de que el caso se auto-cierre.
 *
 * El scope_probe tenía 3 fases (USL, marketplace M2M, delivery M2M) y NINGUNA tocaba
 * promociones, porque Uber las concede fuera de MARKETPLACE_M2M_SCOPES. O sea: el probe
 * podía salir completamente limpio con las promociones sin permiso. No había forma de
 * responderle a Uber con evidencia.
 */

describe('Uber — scopes de promociones', () => {
  it('los scopes de promoción NO están en el set de marketplace (por eso hacía falta probarlos aparte)', async () => {
    const { MARKETPLACE_M2M_SCOPES, DELIVERY_M2M_SCOPES } = await import('@/lib/integrations/uber-eats/oauth')
    const cubiertos = [...MARKETPLACE_M2M_SCOPES, ...DELIVERY_M2M_SCOPES]
    expect(cubiertos).not.toContain('eats.store.promotion.write')
    expect(cubiertos).not.toContain('eats.store.promotion.read')
  })

  it('el set de prueba cubre los DOS scopes que Uber concedió, no sólo write', async () => {
    const { PROMOTIONS_M2M_SCOPES } = await import('@/lib/integrations/uber-eats/oauth')
    expect(PROMOTIONS_M2M_SCOPES).toContain('eats.store.promotion.write')
    expect(PROMOTIONS_M2M_SCOPES).toContain('eats.store.promotion.read')
  })

  it('el scope de runtime se puede leer para comparar contra lo concedido', async () => {
    const { promotionsScope } = await import('@/lib/integrations/uber-eats/promotions')
    expect(typeof promotionsScope).toBe('function')
    // Default histórico: sólo write. La fase 4 reporta esta diferencia en vez de asumirla.
    expect(promotionsScope()).toContain('eats.store.promotion.write')
  })
})

/**
 * Lo que Uber DEVUELVE puede ser más angosto que lo que se pidió, sin fallar la
 * petición de token. Ese es justo el modo de falla silencioso que hay que detectar:
 * token ok + scope incompleto = create_promotion truena después con 401/403.
 */
describe('Uber — lectura de lo concedido vs lo pedido', () => {
  const pedidos = ['eats.store.promotion.write', 'eats.store.promotion.read']

  // Misma lógica que la fase 4 del probe.
  const evaluar = (grantedScope: string) => {
    const granted = grantedScope.trim().split(/\s+/).filter(Boolean)
    const missing = pedidos.filter((s) => !granted.includes(s))
    return { granted, missing, completo: missing.length === 0 }
  }

  it('Uber concede los dos → sin faltantes', () => {
    const r = evaluar('eats.store.promotion.write eats.store.promotion.read')
    expect(r.missing).toEqual([])
    expect(r.completo).toBe(true)
  })

  it('EL CASO PELIGROSO: token ok pero Uber concede sólo write → lo reporta como faltante', () => {
    const r = evaluar('eats.store.promotion.write')
    expect(r.missing).toEqual(['eats.store.promotion.read'])
    expect(r.completo).toBe(false)
  })

  it('Uber devuelve scope vacío → todo faltante, no un falso verde', () => {
    const r = evaluar('')
    expect(r.missing).toEqual(pedidos)
    expect(r.completo).toBe(false)
  })

  it('scopes extra concedidos no rompen la evaluación', () => {
    const r = evaluar('eats.store eats.store.promotion.write eats.store.promotion.read eats.order')
    expect(r.missing).toEqual([])
    expect(r.completo).toBe(true)
  })

  it('tolera espacios raros en la respuesta de Uber', () => {
    const r = evaluar('  eats.store.promotion.write   eats.store.promotion.read  ')
    expect(r.missing).toEqual([])
  })
})

/** Guarda de cableado: la fase 4 tiene que seguir existiendo y entrando a blockers. */
describe('Uber — la fase 4 sigue cableada en el probe', () => {
  const leer = async () => {
    const fs = await import('fs')
    const path = await import('path')
    return fs.readFileSync(
      path.resolve(__dirname, '../app/api/integrations/uber-eats/sandbox/route.ts'),
      'utf-8',
    )
  }

  it('el probe prueba promociones y publica la fase', async () => {
    const src = await leer()
    expect(src).toContain('probeM2MToken(PROMOTIONS_M2M_SCOPES.join(\' \'))')
    expect(src).toContain('phase4_promotions')
  })

  it('el blocker de promociones entra al arreglo de blockers, no se queda mudo', async () => {
    const src = await leer()
    expect(src).toContain('phase4.blocker')
    expect(src).toMatch(/blockers:\s*\[[^\]]*phase4\.blocker/)
  })
})
