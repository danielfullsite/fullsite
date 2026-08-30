// Agentes — exactitud numérica y honestidad del silencio.
//
// QUÉ SE PUEDE GARANTIZAR AL 100% Y QUÉ NO
// ----------------------------------------
// Un agente que infiere no puede tener 100% de acierto: decidir si una caída de ventas
// "importa" es un juicio. Lo que SÍ se puede garantizar al 100% es que **los números que
// reporta sean recalculables desde los datos de entrada**. Si el agente dice "-14.3%", ese
// -14.3% tiene que salir otra vez al hacer la cuenta a mano sobre el mismo fixture.
//
// Estas pruebas hacen la cuenta de forma INDEPENDIENTE del agente y comparan. Una prueba que
// llamara a la misma función que produce el número pasaría siempre y no probaría nada.
//
// Y prueban algo que no es aritmética: que **el silencio sea honesto**. Un agente que
// devuelve [] porque su fuente murió se ve igual que uno que devuelve [] porque todo está
// bien. Ésa fue la falla real medida el 2026-08-30: `wansoft_daily` llevaba 41 días sin
// filas y el agente de finanzas devolvía vacío en cada corrida, leyéndose como "sin hallazgos".

import { describe, it, expect } from 'vitest'
import { runFinanceAgent } from '@/lib/agents/finance'
import type { AgentEvent } from '@/lib/agents/types'

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Dia { fecha: string; ventas_dia: number; tickets_count: number; ticket_promedio_restaurant: number }

/** Genera `n` días consecutivos hacia atrás desde hoy, con ventas fijas. */
function historia(n: number, ventasPorDia = 10_000): Dia[] {
  const out: Dia[] = []
  for (let i = 1; i <= n; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push({
      fecha: d.toISOString().slice(0, 10),
      ventas_dia: ventasPorDia,
      tickets_count: 100,
      ticket_promedio_restaurant: ventasPorDia / 100,
    })
  }
  return out // orden desc, como lo devuelve la query real
}

/** sbGet falso: devuelve la historia y los KPIs que le pasemos. */
function fakeSbGet(dias: Dia[], kpis: Record<string, unknown> | null) {
  return async <T>(table: string): Promise<T[]> => {
    if (table === 'wansoft_daily') return dias as unknown as T[]
    if (table === 'wansoft_kpis') return (kpis ? [kpis] : []) as unknown as T[]
    return [] as T[]
  }
}

const find = (evs: AgentEvent[], type: string) => evs.find(e => e.type === type)

// ─── El silencio tiene que ser honesto ────────────────────────────────────────

describe('Agentes — un agente sin datos lo DICE, no se calla', () => {
  it('fuente vacía → emite fuente_sin_datos en vez de devolver []', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet([], null))
    expect(evs.length).toBeGreaterThan(0)
    const e = find(evs, 'fuente_sin_datos')
    expect(e).toBeDefined()
    expect(e!.severity).toBe('warning')
  })

  it('el hallazgo dice explícitamente que su silencio NO significa que todo esté bien', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet([], null))
    expect(find(evs, 'fuente_sin_datos')!.explanation).toMatch(/NO significa que las ventas estén bien/i)
  })

  it('reporta cuántos días tiene y cuántos necesita — números, no adjetivos', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(3), null))
    const ev = find(evs, 'fuente_sin_datos')!
    expect(ev.evidence.dias_disponibles).toBe(3)
    expect(ev.evidence.dias_requeridos).toBe(7)
  })

  it('cuenta los días de atraso de la fuente — el dato que delata una tubería muerta', async () => {
    // Un solo día, de hace 41 — el caso real de AMALAY el 2026-08-30.
    const d = new Date(); d.setDate(d.getDate() - 41)
    const dias = [{ fecha: d.toISOString().slice(0, 10), ventas_dia: 5000, tickets_count: 50, ticket_promedio_restaurant: 100 }]
    const ev = find(await runFinanceAgent('amalay', fakeSbGet(dias, null)), 'fuente_sin_datos')!
    expect(ev.evidence.dias_sin_datos).toBe(41)
    expect(ev.evidence.fecha_mas_reciente).toBe(dias[0].fecha)
  })

  it('no inventa un valor económico cuando el problema es que no hay datos', async () => {
    const ev = find(await runFinanceAgent('amalay', fakeSbGet([], null)), 'fuente_sin_datos')!
    expect(ev.estimated_value).toBeNull()
  })

  it('confidence = 1: que no haya filas es un hecho, no una inferencia', async () => {
    const ev = find(await runFinanceAgent('amalay', fakeSbGet([], null)), 'fuente_sin_datos')!
    expect(ev.confidence).toBe(1)
  })

  it('con historia suficiente NO emite fuente_sin_datos — no es ruido permanente', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(28), { ventas_dia: 10_000, tickets_count: 100, ticket_promedio_restaurant: 100, ordenes_abiertas: 0 }))
    expect(find(evs, 'fuente_sin_datos')).toBeUndefined()
  })
})

// ─── Los números tienen que ser recalculables ─────────────────────────────────

describe('Agentes — los números reportados se pueden recalcular a mano', () => {
  it('el hallazgo de ventas vs mismo día usa el promedio real del fixture', async () => {
    // 28 días planos a 10,000. Cualquier promedio del mismo DOW es 10,000 exacto.
    const dias = historia(28, 10_000)
    // Hoy vendió la mitad ⇒ la brecha es exactamente -50%.
    const evs = await runFinanceAgent('amalay', fakeSbGet(dias, {
      ventas_dia: 5_000, tickets_count: 50, ticket_promedio_restaurant: 100, ordenes_abiertas: 0,
    }))

    const ev = evs.find(e => typeof e.evidence?.avg_dow === 'number' || typeof e.evidence?.gap_pct === 'number')
    expect(ev, 'el agente debe emitir un hallazgo de ventas vs mismo DOW').toBeDefined()

    // Cálculo independiente: el fixture es plano, así que el promedio es 10,000.
    if (typeof ev!.evidence.avg_dow === 'number') {
      expect(ev!.evidence.avg_dow).toBe(10_000)
    }
    // Y la brecha porcentual es (5000-10000)/10000 = -50%.
    if (typeof ev!.evidence.gap_pct === 'number') {
      expect(Math.round(ev!.evidence.gap_pct as number)).toBe(-50)
    }
  })

  it('todo estimated_value es no-negativo — un "valor en juego" negativo no significa nada', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(28, 10_000), {
      ventas_dia: 3_000, tickets_count: 30, ticket_promedio_restaurant: 100, ordenes_abiertas: 0,
    }))
    for (const e of evs) {
      if (e.estimated_value != null) expect(e.estimated_value).toBeGreaterThanOrEqual(0)
    }
  })

  it('confidence siempre en [0,1] — fuera de rango no es una probabilidad', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(28, 10_000), {
      ventas_dia: 3_000, tickets_count: 30, ticket_promedio_restaurant: 100, ordenes_abiertas: 0,
    }))
    expect(evs.length).toBeGreaterThan(0)
    for (const e of evs) {
      expect(e.confidence).toBeGreaterThanOrEqual(0)
      expect(e.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('todo hallazgo va marcado con el client_id que se le pidió analizar', async () => {
    const evs = await runFinanceAgent('nomada', fakeSbGet(historia(28, 10_000), {
      ventas_dia: 3_000, tickets_count: 30, ticket_promedio_restaurant: 100, ordenes_abiertas: 0,
    }))
    expect(evs.length).toBeGreaterThan(0)
    for (const e of evs) expect(e.client_id).toBe('nomada')
  })

  it('ningún hallazgo sale sin explicación ni acción sugerida', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(28, 10_000), {
      ventas_dia: 3_000, tickets_count: 30, ticket_promedio_restaurant: 100, ordenes_abiertas: 0,
    }))
    for (const e of evs) {
      expect(e.explanation.trim().length).toBeGreaterThan(0)
      expect(e.suggested_action.trim().length).toBeGreaterThan(0)
    }
  })

  it('sin KPIs de hoy no inventa la comparación del día', async () => {
    const evs = await runFinanceAgent('amalay', fakeSbGet(historia(28, 10_000), null))
    // Puede emitir hallazgos de tendencia, pero ninguno que afirme las ventas de HOY.
    for (const e of evs) {
      expect(e.evidence.ventas_hoy ?? null).toBeNull()
    }
  })
})
