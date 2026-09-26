import { describe, expect, it } from 'vitest'
import { JEV_SYSTEM_CONTEXT, JEV_SYSTEM_CONTEXT_VERSION, JEV_SYSTEM_DOMAINS } from '@/lib/jev/system-context'
import { buildJevQuestions, USE_CASE_SPECS } from '@/lib/jev/use-cases'

describe('contexto de sistema de Jev', () => {
  it('cubre los seis dominios y tiene versión explícita', () => {
    expect(JEV_SYSTEM_CONTEXT_VERSION).toBe('fullsite-system-map/0.1.0')
    expect(JEV_SYSTEM_DOMAINS.map((domain) => domain.id)).toEqual([
      'pos_offline', 'durable_authority', 'kds', 'platform', 'automation', 'release',
    ])
  })

  it('sólo entra en la pregunta de decisión y no abre una fuente dinámica', () => {
    const questions = buildJevQuestions(USE_CASE_SPECS.contradiction_check)
    expect(questions.decision.instructions).toContain(JEV_SYSTEM_CONTEXT)
    expect(questions.risk.instructions).not.toContain('Fullsite system map')
    expect(questions.needs_human_review.instructions).not.toContain('Fullsite system map')
    expect(JEV_SYSTEM_CONTEXT).not.toMatch(/https?:\/\/|secret|token|password|api.?key/i)
  })
})
