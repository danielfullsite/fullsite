// Las detecciones de los agentes.
//
// Lo que se prueba aquí es que NO INVENTEN. Un agente que se equivoca dos veces
// deja de leerse, y a partir de ahí da igual lo bien que esté el diseño.
//
// Los datos de los casos son los reales de Espresso Lab, medidos contra
// pos_orders: 627 órdenes cerradas entre el 24-jun y el 24-jul de 2026.
import { describe, it, expect } from 'vitest'
import { detectar, saludo, MUESTRA_MINIMA } from '@/lib/agentes/detectar'
import type { WansoftDaily } from '@/lib/types'

function dia(o: Partial<WansoftDaily> & { fecha: string }): WansoftDaily {
  return {
    fecha: o.fecha,
    ventas_dia: o.ventas_dia ?? 0,
    ventas_brutas: o.ventas_brutas ?? o.ventas_dia ?? 0,
    descuentos: o.descuentos ?? 0,
    devoluciones: 0,
    tickets_count: o.tickets_count ?? 0,
    personas_restaurant: o.personas_restaurant ?? 0,
    ticket_promedio_restaurant: 0,
    efectivo: 0,
    tarjeta: 0,
    mesas_atendidas: 0,
    ordenes_llevar: 0,
    propinas_total: o.propinas_total ?? 0,
    meseros: o.meseros ?? [],
    platillos_top: [],
    ventas_por_grupo: [],
    pago_métodos: [],
  } as WansoftDaily
}

// Los cuatro viernes reales previos al 24-jul, más el día parcial del 24.
const VIERNES = [
  dia({ fecha: '2026-06-26', ventas_dia: 9185, tickets_count: 22, personas_restaurant: 52, propinas_total: 800 }),
  dia({ fecha: '2026-07-03', ventas_dia: 6215, tickets_count: 18, personas_restaurant: 44, propinas_total: 560 }),
  dia({ fecha: '2026-07-10', ventas_dia: 4100, tickets_count: 13, personas_restaurant: 31, propinas_total: 380 }),
  dia({ fecha: '2026-07-17', ventas_dia: 6975, tickets_count: 19, personas_restaurant: 47, propinas_total: 640 }),
]
const EL_24 = dia({
  fecha: '2026-07-24', ventas_dia: 2070, tickets_count: 5, personas_restaurant: 14, propinas_total: 86,
  meseros: [{ nombre: 'Valeria Moreno', total: 1450 }, { nombre: 'Emilio Castro', total: 620 }],
})

describe('detectar — no dispara sin muestra', () => {
  it('sin historial no devuelve nada', () => {
    expect(detectar([], EL_24)).toEqual([])
  })

  it('sin día que analizar no devuelve nada', () => {
    expect(detectar(VIERNES, null)).toEqual([])
  })

  it(`con menos de ${MUESTRA_MINIMA} días iguales NO compara la venta`, () => {
    // Un solo viernes previo no es un promedio de viernes.
    const uno = [VIERNES[0], EL_24]
    const ids = detectar(uno, EL_24).map(d => d.id)
    expect(ids.some(i => i.startsWith('venta-vs-dia'))).toBe(false)
  })

  it(`con ${MUESTRA_MINIMA} días iguales ya compara`, () => {
    const dos = [VIERNES[0], VIERNES[1], EL_24]
    const ids = detectar(dos, EL_24).map(d => d.id)
    expect(ids.some(i => i.startsWith('venta-vs-dia'))).toBe(true)
  })
})

describe('detectar — la venta contra sus mismos días', () => {
  const todas = detectar([...VIERNES, EL_24], EL_24)
  const venta = todas.find(d => d.id.startsWith('venta-vs-dia'))!

  it('detecta el día parcial de Espresso Lab', () => {
    // promedio de los 4 viernes = 6,618.75 · el 24 fueron 2,070 → -69%
    expect(venta).toBeTruthy()
    expect(venta.linea).toMatch(/69% abajo/)
    expect(venta.linea).toMatch(/viernes/)
  })

  it('el impacto es la diferencia REAL en pesos, no una estimación', () => {
    const esperado = (9185 + 6215 + 4100 + 6975) / 4
    expect(venta.impacto).toBe(Math.round(2070 - esperado))
    expect(venta.impacto).toBeLessThan(0)
  })

  it('dice cuántos días entran en el promedio', () => {
    expect(venta.queAnalizo.join(' ')).toMatch(/4 viernes/)
  })

  it('la evidencia trae los días comparados y marca el analizado', () => {
    expect(venta.evidencia).toHaveLength(5)
    expect(venta.evidencia.filter(p => p.foco)).toHaveLength(1)
    expect(venta.evidencia[venta.evidencia.length - 1].valor).toBe(2070)
  })

  it('una caída del 69% se marca como grave', () => {
    expect(venta.severidad).toBe('alta')
  })

  it('un día normal NO dispara nada: 15% es el piso', () => {
    const normal = dia({ fecha: '2026-07-24', ventas_dia: 6300, tickets_count: 18, personas_restaurant: 45 })
    const ids = detectar([...VIERNES, normal], normal).map(d => d.id)
    expect(ids.some(i => i.startsWith('venta-vs-dia'))).toBe(false)
  })

  it('un día MUY bueno también se avisa, pero no como alarma', () => {
    const bueno = dia({ fecha: '2026-07-24', ventas_dia: 11000, tickets_count: 30, personas_restaurant: 70 })
    const d = detectar([...VIERNES, bueno], bueno).find(x => x.id.startsWith('venta-vs-dia'))!
    expect(d.verbo).toBe('Captúralo')
    expect(d.severidad).toBe('info')
    expect(d.impacto).toBeGreaterThan(0)
  })
})

describe('detectar — concentración en una persona', () => {
  it('marca que Valeria cargó el 70%', () => {
    const d = detectar([...VIERNES, EL_24], EL_24).find(x => x.id.startsWith('concentracion'))!
    expect(d).toBeTruthy()
    expect(d.linea).toMatch(/Valeria cargó 70%/)
  })

  it('NO le pone precio: no hay forma honesta de calcularlo', () => {
    const d = detectar([...VIERNES, EL_24], EL_24).find(x => x.id.startsWith('concentracion'))!
    expect(d.impacto).toBeNull()
  })

  it('un reparto parejo no dispara nada', () => {
    const parejo = dia({
      fecha: '2026-07-24', ventas_dia: 2000, tickets_count: 5, personas_restaurant: 14,
      meseros: [{ nombre: 'Ana', total: 1020 }, { nombre: 'Beto', total: 980 }],
    })
    const ids = detectar([...VIERNES, parejo], parejo).map(d => d.id)
    expect(ids.some(i => i.startsWith('concentracion'))).toBe(false)
  })

  it('con una sola persona no hay concentración que reportar', () => {
    const solo = dia({
      fecha: '2026-07-24', ventas_dia: 2000, tickets_count: 5,
      meseros: [{ nombre: 'Ana', total: 2000 }],
    })
    const ids = detectar([...VIERNES, solo], solo).map(d => d.id)
    expect(ids.some(i => i.startsWith('concentracion'))).toBe(false)
  })
})

describe('detectar — orden y forma', () => {
  const todas = detectar([...VIERNES, EL_24], EL_24)

  it('lo grave va primero', () => {
    const orden = { alta: 0, media: 1, info: 2 }
    const s = todas.map(d => orden[d.severidad])
    expect(s).toEqual([...s].sort((a, b) => a - b))
  })

  it('cada detección trae verbo, evidencia y recomendación', () => {
    const VERBOS = ['Arréglalo', 'Captúralo', 'Pídelo', 'Revísalo', 'Ajústalo', 'Cuídalo']
    for (const d of todas) {
      expect(VERBOS).toContain(d.verbo)
      expect(d.evidencia.length).toBeGreaterThan(0)
      expect(d.recomendacion.length).toBeGreaterThan(20)
      expect(d.queAnalizo.length).toBeGreaterThanOrEqual(2)
      // la línea NO termina en punto: la UI arma la oración con el verbo
      expect(d.linea.endsWith('.')).toBe(false)
    }
  })

  it('ninguna línea grita ni habla en inglés', () => {
    for (const d of todas) {
      expect(d.linea).not.toMatch(/ALERTAS|issues|critical|high/)
      expect(d.linea).not.toMatch(/^[A-ZÁÉÍÓÚÑ\s]{8,}/)
    }
  })

  it('no hay ids repetidos: cada renglón tiene su llave', () => {
    const ids = todas.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('saludo', () => {
  it('nunca dice "0 cosas" ni "1 cosas"', () => {
    expect(saludo(0, new Date('2026-08-25T09:00:00'))).toMatch(/nada que atender/)
    expect(saludo(1, new Date('2026-08-25T09:00:00'))).toMatch(/1 cosa para hoy/)
    expect(saludo(1, new Date('2026-08-25T09:00:00'))).not.toMatch(/1 cosas/)
    expect(saludo(3, new Date('2026-08-25T09:00:00'))).toMatch(/3 cosas para hoy/)
  })

  it('cambia con la hora', () => {
    expect(saludo(1, new Date('2026-08-25T08:00:00'))).toMatch(/Buenos días/)
    expect(saludo(1, new Date('2026-08-25T15:00:00'))).toMatch(/Buenas tardes/)
    expect(saludo(1, new Date('2026-08-25T21:00:00'))).toMatch(/Buenas noches/)
  })
})
