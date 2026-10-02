import { describe, expect, it } from 'vitest'
import { intencionOperativa, marcoRazonamientoOperativo } from '@/lib/chat-operating-intent'

describe('intencionOperativa', () => {
  it('trata un saludo como una entrada válida a la conversación operativa', () => {
    const r = intencionOperativa('Hola')
    expect(r.modo).toBe('saludo')
    expect(r.instruccion).toMatch(/nunca respondas con una negativa genérica/i)
  })

  it('reconoce preguntas de diagnóstico sin afirmar una causa', () => {
    const r = intencionOperativa('¿Por qué bajó el ticket hoy?')
    expect(r.modo).toBe('diagnostico')
    expect(r.instruccion).toMatch(/hipótesis/i)
  })

  it('trata decisiones como recomendaciones con riesgos y no como predicciones', () => {
    const r = intencionOperativa('¿Me conviene subir el precio del ribeye?')
    expect(r.modo).toBe('decision')
    expect(r.instruccion).toMatch(/riesgo/i)
    expect(r.instruccion).toMatch(/no es un hecho/i)
  })

  it('da pasos para una solicitud de acción inmediata', () => {
    expect(intencionOperativa('¿Qué hago ahorita?').modo).toBe('accion')
  })

  it('no rechaza una formulación nueva: cae a exploración', () => {
    expect(intencionOperativa('¿Cómo se siente el negocio esta semana?').modo).toBe('exploracion')
  })

  it('el marco obliga a separar hechos de inferencias', () => {
    expect(marcoRazonamientoOperativo('¿Qué pasa?')).toMatch(/hecho, qué es inferencia/i)
  })
})
