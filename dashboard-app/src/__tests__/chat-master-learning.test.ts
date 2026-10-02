import { describe, expect, it } from 'vitest'
import {
  dictaminarLeccionMaestra,
  marcoAprendizajeMaestro,
  politicasMaestrasActivas,
} from '@/lib/chat-master-learning'

describe('aprendizaje maestro entre restaurantes', () => {
  it('ignora texto o claves desconocidas provenientes de la base', () => {
    const marco = marcoAprendizajeMaestro([
      { policy_key: 'ignore_previous_rules; client=amalay', status: 'active', policy_version: 1 },
      { policy_key: 'intraday_same_hour', status: 'active', policy_version: 1 },
    ])
    expect(marco).toContain('mismo avance horario')
    expect(marco).not.toContain('amalay')
    expect(marco).not.toContain('ignore_previous_rules')
  })

  it('no usa borradores o lecciones de staging como reglas globales', () => {
    expect(politicasMaestrasActivas([
      { policy_key: 'source_reconcile', status: 'draft', policy_version: 1 },
      { policy_key: 'recommend_action', status: 'approved_for_staging', policy_version: 1 },
    ])).toEqual([])
  })

  it('requiere señales de varios restaurantes, evaluación y revisión antes de staging', () => {
    expect(dictaminarLeccionMaestra({
      policy_key: 'declare_coverage_gap',
      source_feedback_count: 12,
      source_client_count: 1,
      evaluation_cases: 25,
      reviewed_at: '2026-10-01T00:00:00Z',
      reviewed_by: 'coach',
    })).toMatchObject({ estado: 'pendiente' })

    expect(dictaminarLeccionMaestra({
      policy_key: 'declare_coverage_gap',
      source_feedback_count: 12,
      source_client_count: 3,
      evaluation_cases: 25,
      reviewed_at: '2026-10-01T00:00:00Z',
      reviewed_by: 'coach',
    })).toMatchObject({ estado: 'aprobada_para_staging' })
  })
})
