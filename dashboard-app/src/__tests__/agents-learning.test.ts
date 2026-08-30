// Agentes — el ciclo de aprendizaje.
//
// LO QUE FALTABA
// --------------
// La plomería para MEDIR precisión estaba completa desde hace meses: botones en /agentes,
// /api/agents/outcome, /metrics, y `outcome: 'correct' | 'false_positive'` en el esquema.
// Lo que no existía era lo otro: **ningún agente leía sus propios veredictos**. `outcome`
// aparecía en `lib/agents/` sólo dentro de `types.ts`. Aunque un restaurante marcara cien
// veces el mismo hallazgo como falso positivo, al día siguiente el agente lo repetía
// idéntico y con la misma confianza.
//
// Medir precisión no es aprender. Estas pruebas cubren la diferencia.

import { describe, it, expect } from 'vitest'
import {
  tallyVerdicts, decideWithHistory, applyLearning,
  MIN_VERDICTS, SUPPRESS_MIN_VERDICTS, verdictsQuery,
} from '@/lib/agents/learning'
import type { AgentEvent } from '@/lib/agents/types'

const ev = (type: string, confidence = 0.9): AgentEvent => ({
  client_id: 'amalay', agent_id: 'fraud', type, severity: 'warning',
  title: 't', explanation: 'razón original', evidence: { dato: 1 },
  suggested_action: 'a', confidence, status: 'new',
})

const rows = (type: string, correct: number, falsos: number) => [
  ...Array.from({ length: correct }, () => ({ type, outcome: 'correct' })),
  ...Array.from({ length: falsos }, () => ({ type, outcome: 'false_positive' })),
]

// ─── Conteo ───────────────────────────────────────────────────────────────────

describe('Aprendizaje — conteo de veredictos', () => {
  it('calcula precisión por tipo', () => {
    const t = tallyVerdicts(rows('descuadre', 3, 1))
    expect(t.get('descuadre')).toEqual({ correct: 3, false_positive: 1, precision: 0.75 })
  })

  it('IGNORA los hallazgos que nadie evaluó — el silencio no es un voto a favor', () => {
    // Éste es el punto fino: hoy hay 23 hallazgos y 0 evaluados. Si el silencio contara
    // como acierto, la precisión saldría 100% y el aprendizaje se apoyaría en aire.
    const t = tallyVerdicts([
      { type: 'x', outcome: null },
      { type: 'x', outcome: null },
      { type: 'x', outcome: 'false_positive' },
    ])
    expect(t.get('x')).toEqual({ correct: 0, false_positive: 1, precision: 0 })
  })

  it('separa tipos distintos — el historial de uno no contamina al otro', () => {
    const t = tallyVerdicts([...rows('a', 2, 0), ...rows('b', 0, 2)])
    expect(t.get('a')!.precision).toBe(1)
    expect(t.get('b')!.precision).toBe(0)
  })
})

// ─── Decisión ─────────────────────────────────────────────────────────────────

describe('Aprendizaje — qué hace con el hallazgo', () => {
  it('sin historial lo deja intacto', () => {
    const d = decideWithHistory(ev('nuevo'))
    expect(d.action).toBe('keep')
    expect(d.event.confidence).toBe(0.9)
  })

  it(`con menos de ${MIN_VERDICTS} veredictos no actúa — eso es anécdota, no señal`, () => {
    const t = tallyVerdicts(rows('x', 0, MIN_VERDICTS - 1))
    expect(decideWithHistory(ev('x'), t.get('x')).action).toBe('keep')
  })

  it('un tipo que siempre acertó NO sube de confianza', () => {
    // El historial sirve para desconfiar, no para envalentonarse: inflar confianza con una
    // racha corta es creerle a un pronóstico porque atinó tres veces seguidas.
    const t = tallyVerdicts(rows('bueno', 10, 0))
    const d = decideWithHistory(ev('bueno', 0.8), t.get('bueno'))
    expect(d.action).toBe('keep')
    expect(d.event.confidence).toBe(0.8)
  })

  it('degrada la confianza multiplicando por la precisión histórica', () => {
    const t = tallyVerdicts(rows('ruidoso', 1, 3))  // precisión 0.25
    const d = decideWithHistory(ev('ruidoso', 0.8), t.get('ruidoso'))
    expect(d.action).toBe('downgrade')
    expect(d.event.confidence).toBe(0.2)            // 0.8 × 0.25
  })

  it('degradar NO es callar: el hallazgo sigue apareciendo, con su historial explicado', () => {
    const t = tallyVerdicts(rows('ruidoso', 1, 3))
    const d = decideWithHistory(ev('ruidoso'), t.get('ruidoso'))
    expect(d.event.explanation).toContain('razón original')     // conserva lo suyo
    expect(d.event.explanation).toMatch(/falso positivo/i)      // y agrega el porqué
    expect(d.event.evidence.historial_aprendizaje).toBeDefined()
  })

  it(`suprime sólo si NUNCA acertó y hay al menos ${SUPPRESS_MIN_VERDICTS} veredictos`, () => {
    const casi = tallyVerdicts(rows('malo', 0, SUPPRESS_MIN_VERDICTS - 1))
    expect(decideWithHistory(ev('malo'), casi.get('malo')).action).toBe('downgrade')

    const ya = tallyVerdicts(rows('malo', 0, SUPPRESS_MIN_VERDICTS))
    expect(decideWithHistory(ev('malo'), ya.get('malo')).action).toBe('suppress')
  })

  it('un solo acierto salva al tipo de la supresión', () => {
    // Un tipo que acertó aunque sea una vez puede volver a acertar. Suprimirlo sería
    // decidir por el operador con evidencia de que a veces sí sirve.
    const t = tallyVerdicts(rows('mixto', 1, 20))
    expect(decideWithHistory(ev('mixto'), t.get('mixto')).action).toBe('downgrade')
  })
})

// ─── Tanda completa ───────────────────────────────────────────────────────────

describe('Aprendizaje — aplicado a la tanda del agente', () => {
  it('reporta qué degradó y qué suprimió, para que quede en la bitácora', () => {
    const verdicts = tallyVerdicts([
      ...rows('bueno', 5, 0),
      ...rows('ruidoso', 1, 3),
      ...rows('inservible', 0, 6),
    ])
    const r = applyLearning([ev('bueno'), ev('ruidoso'), ev('inservible'), ev('nuevo')], verdicts)

    expect(r.events.map(e => e.type)).toEqual(['bueno', 'ruidoso', 'nuevo'])
    expect(r.suppressed).toEqual(['inservible'])
    expect(r.downgraded).toBe(1)
  })

  it('sin ningún veredicto la tanda pasa intacta — hoy es el caso real: 0 de 23 evaluados', () => {
    const entrada = [ev('a'), ev('b')]
    const r = applyLearning(entrada, tallyVerdicts([]))
    expect(r.events).toHaveLength(2)
    expect(r.downgraded).toBe(0)
    expect(r.suppressed).toEqual([])
    expect(r.events[0].confidence).toBe(0.9)
  })

  it('la confianza ajustada nunca sale del rango [0,1]', () => {
    const verdicts = tallyVerdicts(rows('x', 1, 9))   // precisión 0.1
    const r = applyLearning([ev('x', 1)], verdicts)
    expect(r.events[0].confidence).toBeGreaterThanOrEqual(0)
    expect(r.events[0].confidence).toBeLessThanOrEqual(1)
  })
})

// ─── Query ────────────────────────────────────────────────────────────────────

describe('Aprendizaje — la consulta del historial', () => {
  it('filtra por restaurante Y por agente — el historial no se comparte entre tenants', () => {
    const q = verdictsQuery('amalay', 'fraud')
    expect(q).toContain('client_id=eq.amalay')
    expect(q).toContain('agent_id=eq.fraud')
  })

  it('pide sólo los evaluados: traer los no evaluados sería ruido', () => {
    expect(verdictsQuery('amalay', 'fraud')).toContain('outcome=not.is.null')
  })

  it('escapa el client_id — no se construye la query concatenando a lo bruto', () => {
    expect(verdictsQuery('a b&c', 'fraud')).toContain(encodeURIComponent('a b&c'))
  })
})
