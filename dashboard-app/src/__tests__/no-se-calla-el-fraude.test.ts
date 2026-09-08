import { describe, it, expect } from 'vitest'
import {
  decideWithHistory, puedeCallarse, tallyVerdicts,
  SUPPRESS_MIN_VERDICTS, MIN_VERDICTS, PISO_DE_CONFIANZA_PROTEGIDA,
} from '@/lib/agents/learning'
import type { AgentEvent, AgentId, Severity } from '@/lib/agents/types'

// Silenciar era el comportamiento por omisión: cinco veredictos de «falso
// positivo» sobre un tipo y dejaba de emitirse para ese restaurante, sin que
// nadie aprobara nada.
//
// Con una alerta de fraude eso es un problema distinto al de las demás, porque
// quien marca los veredictos es exactamente la persona a la que la alerta
// vigila. «Me molesta» y «ya no me cachan» producen el mismo clic, y desde el
// código se ven idénticos.
//
// Medido en la base el 2026-09-08: hay 4 veredictos de falso positivo
// registrados en toda la historia. Faltaba uno para que la puerta se abriera.

function evento(p: Partial<AgentEvent> = {}): AgentEvent {
  return {
    client_id: 'amalay', agent_id: 'operations' as AgentId, type: 'algo',
    severity: 'warning' as Severity, title: 'Un hallazgo', explanation: '',
    evidence: {}, suggested_action: '', confidence: 0.9, status: 'new', ...p,
  } as AgentEvent
}

/** Historial de un tipo que nunca acertó, con muestra suficiente para callarlo. */
const nuncaAcerto = { correct: 0, false_positive: SUPPRESS_MIN_VERDICTS, precision: 0 }

describe('lo que NUNCA se calla solo', () => {
  it('una alerta de fraude no se apaga por más falsos positivos que acumule', () => {
    const d = decideWithHistory(evento({ agent_id: 'fraud' }), nuncaAcerto)
    expect(d.action).not.toBe('suppress')
  })

  it('tampoco con veinte veredictos en contra', () => {
    const d = decideWithHistory(evento({ agent_id: 'fraud' }), { correct: 0, false_positive: 20, precision: 0 })
    expect(d.action).not.toBe('suppress')
  })

  it('nada crítico se apaga solo, venga del agente que venga', () => {
    for (const agente of ['operations', 'inventory', 'staff', 'finance', 'fraud'] as AgentId[]) {
      const d = decideWithHistory(evento({ agent_id: agente, severity: 'critical' }), nuncaAcerto)
      expect(d.action, `${agente} crítico no puede callarse`).not.toBe('suppress')
    }
  })

  it('el permiso se puede consultar directo, para que nadie tenga que adivinarlo', () => {
    expect(puedeCallarse({ agent_id: 'fraud', severity: 'info' })).toBe(false)
    expect(puedeCallarse({ agent_id: 'operations', severity: 'critical' })).toBe(false)
    expect(puedeCallarse({ agent_id: 'operations', severity: 'warning' })).toBe(true)
  })

  it('un agente nuevo NO puede callarse hasta que alguien lo autorice a mano', () => {
    // El permiso está invertido a propósito: callar exige estar en la lista.
    // Si mañana aparece un agente y nadie lo piensa, lo seguro es que hable.
    const d = decideWithHistory(evento({ agent_id: 'agente-que-no-existia' as AgentId }), nuncaAcerto)
    expect(d.action).not.toBe('suppress')
  })
})

describe('callar por la puerta de atrás tampoco', () => {
  it('un tipo protegido no cae a confianza cero', () => {
    // Sin piso, multiplicar por precisión 0 daría confianza 0, y el umbral de la
    // lista de pendientes lo escondería igual. Eso es callarlo con otro nombre.
    const d = decideWithHistory(evento({ agent_id: 'fraud', confidence: 0.9 }), nuncaAcerto)
    expect(d.action).toBe('downgrade')
    if (d.action === 'downgrade') {
      expect(d.to).toBeGreaterThan(0)
      expect(d.to).toBe(Math.round(0.9 * PISO_DE_CONFIANZA_PROTEGIDA * 100) / 100)
    }
  })

  it('y su historial queda escrito, no escondido', () => {
    const d = decideWithHistory(evento({ agent_id: 'fraud' }), nuncaAcerto)
    if (d.action === 'downgrade') {
      expect(d.event.explanation).toMatch(/falso positivo/)
      expect(d.event.explanation).toMatch(new RegExp(String(SUPPRESS_MIN_VERDICTS)))
    }
  })
})

describe('lo que sí se puede callar sigue callándose', () => {
  it('un tipo de operaciones que nunca acertó se apaga', () => {
    const d = decideWithHistory(evento({ agent_id: 'operations', severity: 'warning' }), nuncaAcerto)
    expect(d.action).toBe('suppress')
  })

  it('inventario, personal y finanzas también', () => {
    for (const agente of ['inventory', 'staff', 'finance'] as AgentId[]) {
      const d = decideWithHistory(evento({ agent_id: agente, severity: 'info' }), nuncaAcerto)
      expect(d.action, `${agente} sí puede callarse`).toBe('suppress')
    }
  })
})

describe('lo que no cambió', () => {
  it('con poca muestra no se toca nada: eso es anécdota, no señal', () => {
    const d = decideWithHistory(evento(), { correct: 0, false_positive: MIN_VERDICTS - 1, precision: 0 })
    expect(d.action).toBe('keep')
  })

  it('el historial nunca sube la confianza', () => {
    const d = decideWithHistory(evento({ confidence: 0.6 }), { correct: 10, false_positive: 0, precision: 1 })
    expect(d.action).toBe('keep')
  })

  it('un tipo a medias baja proporcional, como antes', () => {
    const d = decideWithHistory(evento({ confidence: 0.8 }), { correct: 2, false_positive: 2, precision: 0.5 })
    expect(d.action).toBe('downgrade')
    if (d.action === 'downgrade') expect(d.to).toBe(0.4)
  })

  it('el silencio no cuenta como veredicto', () => {
    const v = tallyVerdicts([
      { type: 'x', outcome: null }, { type: 'x', outcome: 'correct' }, { type: 'x', outcome: 'false_positive' },
    ])
    expect(v.get('x')).toEqual({ correct: 1, false_positive: 1, precision: 0.5 })
  })
})
