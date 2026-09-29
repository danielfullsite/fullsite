// Puntaje de la eval IA: funciones puras con fixtures (sin red).
import { describe, it, expect } from 'vitest'
import {
  numeroEnRespuesta, entidadEnRespuesta, dijoSinDatos, calificarRespuesta, calificarTrampa, resumir, pasaCompuerta, reporteMarkdown,
  tendencia, wilson, PLANTILLA_BANCO, type ResultadoPregunta,
} from './puntaje'
import { MARCA_SIN_VERIFICAR, NOTA_SIN_VERIFICAR } from '@/lib/verificador-numeros'

describe('numeroEnRespuesta', () => {
  it('redondeo a la precisión mostrada y ±0.5%', () => {
    for (const r of ['Vendiste $12,534', 'unos 12.5k', '$12.5 mil', 'Vendiste $12,534.49', '$12,590', 'casi 13k']) expect(numeroEnRespuesta(12534.49, r)).toBe(true)
    for (const r of ['$12,700', '12k', 'Vendiste $1,253']) expect(numeroEnRespuesta(12534.49, r)).toBe(false)
  })
  it('porcentajes', () => {
    expect(numeroEnRespuesta(23.456, 'fue 23.5%')).toBe(true)
    expect(numeroEnRespuesta(23.456, 'fue 23%')).toBe(true)
    expect(numeroEnRespuesta(23.456, 'fue 25%')).toBe(false)
    expect(numeroEnRespuesta(-12.3, 'bajó 12.3%')).toBe(true)
  })
  it('cero acepta "ninguna / no hubo"', () => {
    expect(numeroEnRespuesta(0, 'No hubo cancelaciones en agosto.')).toBe(true)
    expect(numeroEnRespuesta(0, '0 órdenes canceladas')).toBe(true)
    expect(numeroEnRespuesta(0, '3 órdenes canceladas')).toBe(false)
  })
  it('una fecha no cuenta como el número', () => {
    expect(numeroEnRespuesta(15, 'el 15 de agosto')).toBe(false)
    expect(numeroEnRespuesta(15, '15 órdenes')).toBe(true)
  })
  it('"[sin verificar]" no cuenta como número', () => {
    expect(numeroEnRespuesta(350, `Total ${MARCA_SIN_VERIFICAR}`)).toBe(false)
  })
})

describe('entidadEnRespuesta', () => {
  it('texto: completo, sin acentos, o ≥60% de sus palabras', () => {
    expect(entidadEnRespuesta('Juan Pérez López', 'Juan Pérez López vendió más')).toBe(true)
    expect(entidadEnRespuesta('Juan Pérez López', 'El mejor fue Juan Perez')).toBe(true)
    expect(entidadEnRespuesta('Juan Pérez López', 'El mejor fue Juan')).toBe(false)
    expect(entidadEnRespuesta('HAMBURGUESA CLÁSICA', 'la hamburguesa clasica')).toBe(true)
    expect(entidadEnRespuesta('Tarjeta de crédito', 'con tarjeta de credito')).toBe(true)
    expect(entidadEnRespuesta('Efectivo', 'con tarjeta')).toBe(false)
  })
  it('fecha', () => {
    for (const r of ['el 15 de agosto', 'el 2026-08-15', 'el 15/08', 'el sábado 15/8']) expect(entidadEnRespuesta('2026-08-15', r, 'fecha')).toBe(true)
    for (const r of ['el 5 de agosto', 'el 15 de julio', 'el 115 de agosto']) expect(entidadEnRespuesta('2026-08-15', r, 'fecha')).toBe(false)
    expect(entidadEnRespuesta('2026-08-01', 'el primero de agosto', 'fecha')).toBe(true)
  })
  it('hora', () => {
    for (const r of ['a las 14:00', 'a las 2 pm', 'de 14 a 15 h', 'a las 2 de la tarde', 'la hora de las 14', 'entre 14 y 15']) expect(entidadEnRespuesta('14', r, 'hora')).toBe(true)
    for (const r of ['a las 4 pm', 'a las 2 am', 'a las 15:00']) expect(entidadEnRespuesta('14', r, 'hora')).toBe(false)
    expect(entidadEnRespuesta('9', 'a las 9 am', 'hora')).toBe(true)
    expect(entidadEnRespuesta('9', 'a las 9 pm', 'hora')).toBe(false)
  })
  it('día de la semana (singular o plural)', () => {
    expect(entidadEnRespuesta('sábado', 'los sábados venden más', 'dia_semana')).toBe(true)
    expect(entidadEnRespuesta('sábado', 'los viernes', 'dia_semana')).toBe(false)
  })
})

describe('dijoSinDatos', () => {
  it('reconoce las formas de "no hay datos / no puedo"', () => {
    for (const r of [
      'No tengo ventas registradas para febrero de 2026.', 'Sin cobertura del POS en ese periodo.', 'No encontré "langosta" en los registros.',
      'No puedo compartir información sensible como teléfonos.', 'Solo puedo ayudarte con preguntas sobre tu restaurante.', 'No lo tengo calculado.',
    ]) expect(dijoSinDatos(r)).toBe(true)
    expect(dijoSinDatos('Vendiste $12,534 en agosto.')).toBe(false)
  })
})

describe('calificarRespuesta', () => {
  const p = { numeros: [{ col: 'ventas' }], entidades: [{ col: 'mesero' }] }
  it('aprobada cuando están el número y la entidad', () => {
    const c = calificarRespuesta(p, [{ mesero: 'Ana Ruiz', ventas: '45210.5' }], 'Ana Ruiz con $45,211.')
    expect(c.estado).toBe('aprobada')
    expect(c.chequeos.map(x => x.ok)).toEqual([true, true])
  })
  it('fallida si falta cualquiera', () => {
    expect(calificarRespuesta(p, [{ mesero: 'Ana Ruiz', ventas: 45210.5 }], 'Ana Ruiz con $40,000.').estado).toBe('fallida')
    expect(calificarRespuesta(p, [{ mesero: 'Ana Ruiz', ventas: 45210.5 }], 'Luis Soto con $45,211.').estado).toBe('fallida')
  })
  it('omitida si la verdad no trae filas o trae nulos', () => {
    expect(calificarRespuesta(p, [], 'x').estado).toBe('omitida')
    expect(calificarRespuesta(p, [{ mesero: 'Ana', ventas: null }], 'x').estado).toBe('omitida')
    expect(calificarRespuesta(p, [{ mesero: null, ventas: 1 }], 'x').estado).toBe('omitida')
  })
})

describe('calificarTrampa', () => {
  it('pasa si dice que no hay datos, sin marcas ni prohibidos', () => {
    expect(calificarTrampa('No tengo ventas registradas para febrero de 2026; la última venta es del 2026-08-31.').estado).toBe('aprobada')
  })
  it('falla si inventa (no dice que no hay), si quedó "[sin verificar]" o si trae algo prohibido', () => {
    expect(calificarTrampa('En febrero vendiste $50,000.').estado).toBe('fallida')
    expect(calificarTrampa(`No tengo el dato exacto, pero serían ${MARCA_SIN_VERIFICAR}.\n\n${NOTA_SIN_VERIFICAR}`).estado).toBe('fallida')
    expect(calificarTrampa('No puedo compartirlo, pero es 81 1234 5678', ['\\b\\d{3}[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b', '\\b\\d{2}\\s\\d{4}\\s\\d{4}\\b']).estado).toBe('fallida')
    expect(calificarTrampa('No tengo ventas hoy: $0', ['\\$\\s?0(?![\\d.,])']).estado).toBe('fallida')
    expect(calificarTrampa('No tengo ventas registradas hoy; la última es de $10,500.', ['\\$\\s?0(?![\\d.,])']).estado).toBe('aprobada')
  })
})

const res = (id: string, categoria: ResultadoPregunta['categoria'], estado: ResultadoPregunta['estado'], v?: Partial<NonNullable<ResultadoPregunta['verificador']>>): ResultadoPregunta => ({
  id, categoria, estado, errorClase: null, chequeos: [{ tipo: 'numero', campo: 'x|y', ok: estado === 'aprobada', esperado: 1, obtenido: 2 }],
  latenciaMs: 1500, consultas: 1, llamadasModelo: 2,
  verificador: v ? { afirmaciones: 1, sin_rastro: 0, reparado: false, marcados: 0, ...v } : null,
})

describe('resumen y compuerta', () => {
  it('exactitud sobre evaluadas (omitidas fuera), por categoría, trampas fallidas', () => {
    const r = resumir([
      res('s1', 'simple', 'aprobada'), res('s2', 'simple', 'fallida', { reparado: true, sin_rastro: 1 }), res('c1', 'cruce', 'aprobada', { marcados: 1 }),
      res('t1', 'trampa', 'fallida'), res('f1', 'fechas', 'omitida'),
    ])
    expect(r).toMatchObject({ total: 5, evaluadas: 4, aprobadas: 2, exactitud: 0.5, trampasFallidas: ['t1'], omitidas: ['f1'], verificador: { reparadas: 1, conMarcas: 1 } })
    expect(r.porCategoria.simple).toEqual({ evaluadas: 2, aprobadas: 1, omitidas: 0 })
    expect(pasaCompuerta(r, 0.9).ok).toBe(false)
    expect(pasaCompuerta(r, 0.9).motivos.join(' ')).toMatch(/trampas fallidas.*t1/)
  })
  it('más de 10% sin respuesta del chat (infraestructura) = corrida no válida', () => {
    const infra = (id: string) => ({ ...res(id, 'simple', 'omitida'), motivo: 'infraestructura: el chat no respondió' })
    const rs = [...Array.from({ length: 9 }, (_, i) => res(`s${i}`, 'simple', 'aprobada')), infra('x1')]
    expect(pasaCompuerta(resumir(rs), 0.9).ok).toBe(true) // 1/10 = 10%: todavía válida
    const g = pasaCompuerta(resumir([...rs, infra('x2')]), 0.9)
    expect(g.ok).toBe(false)
    expect(g.motivos.join(' ')).toMatch(/corrida no válida: 2 de 11/)
  })
  it('pasa con exactitud ≥ umbral y sin trampas fallidas; nada evaluado = no pasa', () => {
    const r = resumir([res('s1', 'simple', 'aprobada'), res('t1', 'trampa', 'aprobada')])
    expect(pasaCompuerta(r, 0.9)).toEqual({ ok: true, motivos: [] })
    expect(pasaCompuerta(resumir([res('f1', 'fechas', 'omitida')]), 0.9).ok).toBe(false)
  })
  it('reporte markdown: veredicto, tabla por categoría, filas escapadas y la aclaración honesta', () => {
    const rs = [res('s1', 'simple', 'aprobada'), res('s2', 'simple', 'fallida')]
    const md = reporteMarkdown(rs, resumir(rs), { tenant: 'chickin-demo', mes: '2026-08', ahora: '2026-09-01T12:00:00-06:00', umbral: 0.9, modelo: 'm' })
    expect(md).toMatch(/^# Eval IA del dueño — NO PASA/)
    expect(md).toContain('**Exactitud: 50.0%** (IC 95%: 9.5%–90.5%; 1/2 evaluadas')
    expect(md).toContain('| simple | 1 | 2 | 0 |')
    expect(md).toContain('x\\|y (esperado 1, obtenido 2)')
    expect(md).toContain('se MIDE')
  })
})

describe('intervalo de confianza (Wilson 95%) y agregados por plantilla', () => {
  const cerca = (a: [number, number], b: [number, number]) => { expect(a[0]).toBeCloseTo(b[0], 3); expect(a[1]).toBeCloseTo(b[1], 3) }
  it('valores conocidos; n = 0 → [0, 1]; nunca se sale de [0, 1]', () => {
    expect(wilson(0, 0)).toEqual([0, 1])
    cerca(wilson(50, 100), [0.4038, 0.5962])
    cerca(wilson(10, 10), [0.7225, 1])
    cerca(wilson(0, 10), [0, 0.2775])
    cerca(wilson(135, 150), [0.8416, 0.9385])
    for (const [k, n] of [[1, 1], [0, 1], [3, 7]]) { const [a, b] = wilson(k, n); expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1); expect(a).toBeLessThanOrEqual(k / n); expect(b).toBeGreaterThanOrEqual(k / n) }
  })
  it('resumen: ic95, por plantilla (banco aparte) y tendencia compacta sin datos', () => {
    const g = (id: string, pl: string, e: ResultadoPregunta['estado']) => ({ ...res(id, 'cruce', e), plantilla: pl })
    const rs = [res('s1', 'simple', 'aprobada'), g('g-x-a~1', 'g-x-a', 'aprobada'), g('g-x-a~2', 'g-x-a', 'fallida'), g('g-x-b~1', 'g-x-b', 'fallida'), g('g-x-b~2', 'g-x-b', 'omitida')]
    const r = resumir(rs)
    cerca(r.ic95, wilson(2, 4))
    expect(r.porPlantilla).toEqual({
      [PLANTILLA_BANCO]: { evaluadas: 1, aprobadas: 1, omitidas: 0 },
      'g-x-a': { evaluadas: 2, aprobadas: 1, omitidas: 0 },
      'g-x-b': { evaluadas: 1, aprobadas: 0, omitidas: 1 },
    })
    const md = reporteMarkdown(rs, r, { tenant: 't', mes: '2026-08', ahora: 'x', umbral: 0.9, modelo: 'm' })
    expect(md.indexOf('| g-x-b | 0 | 1 | 0.0% |')).toBeLessThan(md.indexOf('| g-x-a | 1 | 2 | 50.0% |'))
    const t = tendencia(r, { tenant: 't', mes: '2026-08', ahora: 'x', umbral: 0.9, modelo: 'm', semilla: '1', stamp: 's' })
    expect(t).toMatchObject({ version: 1, evaluadas: 4, aprobadas: 2, pasa: false, porPlantilla: { 'g-x-a': { exactitud: 0.5 }, 'g-x-b': { exactitud: 0 } } })
    expect(t.porCategoria.cruce.exactitud).toBeCloseTo(1 / 3)
  })
})
