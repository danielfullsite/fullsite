import { describe, expect, it } from 'vitest'
import { dictaminarCandidataCoach } from '@/lib/chat-coaching'

const base = { evaluadas: 40, exactitud: 0.91, fallasSeguridad: 0, respuestasSinEvidencia: 0 }

describe('compuerta del coach', () => {
  it('no permite promover una candidata con evidencia insuficiente', () => {
    expect(dictaminarCandidataCoach(base, { ...base, evaluadas: 19 })).toMatchObject({ estado: 'pendiente' })
  })

  it('rechaza regresiones aunque provengan de feedback humano', () => {
    expect(dictaminarCandidataCoach(base, { ...base, exactitud: 0.9 })).toMatchObject({ estado: 'rechazada' })
    expect(dictaminarCandidataCoach(base, { ...base, fallasSeguridad: 1 })).toMatchObject({ estado: 'rechazada' })
    expect(dictaminarCandidataCoach(base, { ...base, respuestasSinEvidencia: 1 })).toMatchObject({ estado: 'rechazada' })
  })

  it('sólo la prepara para staging; nunca para producción automática', () => {
    expect(dictaminarCandidataCoach(base, { ...base, exactitud: 0.93 })).toEqual({
      estado: 'aprobada_para_staging',
      razones: ['supera la evaluación mínima sin regresión de exactitud, seguridad ni evidencia'],
    })
  })
})
