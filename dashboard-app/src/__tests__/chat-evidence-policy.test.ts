import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marcoEvidenciaOperativa } from '@/lib/chat-evidence-policy'

describe('contrato de evidencia del copiloto', () => {
  const policy = marcoEvidenciaOperativa()

  it('no depende de una lista de palabras para admitir preguntas amplias', () => {
    expect(policy).toContain('no la reduzcas a una coincidencia de palabras')
    expect(policy).toContain('Nunca rechaces una pregunta amplia')
  })

  it('resuelve referencias de la conversación sin inventar un referente ambiguo', () => {
    expect(policy).toContain('referencias conversacionales')
    expect(policy).toContain('pide UNA aclaración corta')
  })

  it('separa hechos, inferencias, datos faltantes y una acción', () => {
    for (const etiqueta of ['**Hecho:**', '**Lectura:**', '**Falta para confirmarlo:**', '**Siguiente paso:**']) {
      expect(policy).toContain(etiqueta)
    }
  })

  it('preserva límites de tenant y de calidad de fuente', () => {
    expect(policy).toContain('el servidor fija el restaurante')
    expect(policy).toContain('lectura fallida, una fuente desactualizada y una tabla vacía')
    expect(policy).toContain('operación viva más reciente')
  })

  it('trata campañas como hipótesis y conserva ventanas horarias literales', () => {
    expect(policy).toContain('hipótesis causales')
    expect(policy).toContain('7pm a 10pm')
    expect(policy).toContain('no lo sustituyas por una franja genérica')
  })

  it('mantiene separadas las métricas y no inventa evidencia de inventario o turnos', () => {
    expect(policy).toContain('personas, tickets, órdenes, pagos y mesas son distintos')
    expect(policy).toContain('Inventario requiere evidencia propia y vigente')
    expect(policy).toContain('cobertura de asistencia/turno')
  })

  it('investiga las partes cubiertas de una pregunta compuesta antes de declarar una laguna', () => {
    expect(policy).toContain('Resuelve automáticamente cada parte que sí tenga cobertura')
    expect(policy).toContain('usa la fuente autorizada más detallada disponible')
    expect(policy).toContain('Nunca abras con "No puedo responder"')
  })

  it('se incorpora al chat que usan texto y voz, no queda como documentación suelta', () => {
    const ruta = readFileSync(join(process.cwd(), 'src/app/api/chat/route.ts'), 'utf8')
    expect(ruta).toContain("import { marcoEvidenciaOperativa } from '@/lib/chat-evidence-policy'")
    expect(ruta).toContain('${marcoEvidenciaOperativa()}')
    expect(ruta).toContain('PREGUNTAS COMPUESTAS')
  })
})
