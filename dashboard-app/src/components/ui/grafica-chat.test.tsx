// Gráficas del chat (components/chat/GraficaChat.tsx): cada tipo se dibuja, la tabla
// gemela se abre/cierra, el aria-label resume con datos reales, y un spec inválido
// (incluido el formato viejo que escribía el modelo) NO dibuja nada ni truena.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import GraficaChat, { etiquetasColumnas, resumenAccesible, truncarEnMedio } from '@/components/chat/GraficaChat'
import type { GraficaSpec } from '@/lib/grafica-spec'
import { separarGraficas, bloqueDeSpec } from '@/lib/grafica-spec'

afterEach(cleanup)

const base = { v: 2 as const, rango: '2026-09-22 a 2026-09-28', fuente: 'POS Fullsite', datosHasta: '2026-09-28', unidad: 'MXN' as const }

const barra: GraficaSpec = {
  ...base, id: 'ventas_diarias_30d', tipo: 'barra', titulo: 'Ventas por día', ejeX: 'fecha',
  series: [{ clave: 'ventas', nombre: 'Ventas', rol: 'principal' }],
  filas: [
    { x: '2026-09-25', v: { ventas: 12534 } },
    { x: '2026-09-26', v: { ventas: null }, nota: 'sin datos' },
    { x: '2026-09-27', v: { ventas: 18000 } },
    { x: '2026-09-28', v: { ventas: 4000 }, parcial: true, nota: 'en curso' },
  ],
  huecos: 1,
}

const comparacion: GraficaSpec = {
  ...base, id: 'hoy_vs_semana_pasada', tipo: 'comparacion', titulo: 'Hoy vs dom pasado', ejeX: 'hora',
  series: [{ clave: 'hoy', nombre: 'Hoy', rol: 'principal' }, { clave: 'semana_pasada', nombre: 'dom 2026-09-21', rol: 'contexto' }],
  filas: [
    { x: '09:00', v: { hoy: 500, semana_pasada: 700 } },
    { x: '10:00', v: { hoy: 1500, semana_pasada: 1600 } },
    { x: '10:20', v: { hoy: 2100, semana_pasada: 1900 }, parcial: true },
  ],
}

const agrupada: GraficaSpec = {
  ...base, id: 'semana_vs_anterior', tipo: 'barra_agrupada', titulo: '7 vs 7', ejeX: 'fecha',
  series: [{ clave: 'reciente', nombre: 'Reciente', rol: 'principal' }, { clave: 'anterior', nombre: 'Anterior', rol: 'contexto' }],
  filas: [{ x: '2026-09-21', v: { reciente: 100, anterior: 90 } }, { x: '2026-09-22', v: { reciente: null, anterior: 80 } }],
}

const apilada: GraficaSpec = {
  ...base, id: 'franjas', tipo: 'barra_apilada', titulo: 'Franjas', ejeX: 'categoria',
  series: [{ clave: 'comida', nombre: 'Comida' }, { clave: 'bebida', nombre: 'Bebida' }],
  filas: [{ x: 'Desayuno', v: { comida: 800, bebida: 200 } }, { x: 'Comida', v: { comida: 1200, bebida: 500 } }],
}

const ranking: GraficaSpec = {
  ...base, id: 'meseros', tipo: 'ranking', titulo: 'Venta por mesero', ejeX: 'categoria',
  series: [{ clave: 'venta', nombre: 'Venta' }],
  filas: [{ x: 'Mesero A', v: { venta: 9000 } }, { x: 'Mesero B', v: { venta: 7000 } }, { x: 'Mesero C', v: { venta: 3000 } }],
}

const dona: GraficaSpec = {
  ...base, id: 'metodos_pago', tipo: 'dona', titulo: 'Cobro por método', ejeX: 'categoria',
  series: [{ clave: 'monto', nombre: 'Monto' }],
  filas: [{ x: 'Tarjeta', v: { monto: 7000 } }, { x: 'Efectivo', v: { monto: 3000 } }],
}

const area: GraficaSpec = { ...barra, tipo: 'area' }
const linea: GraficaSpec = { ...barra, tipo: 'linea' }

describe('GraficaChat — dibuja cada tipo', () => {
  it.each([
    ['barra', barra], ['comparacion', comparacion], ['barra_agrupada', agrupada], ['barra_apilada', apilada],
    ['ranking', ranking], ['dona', dona], ['area', area], ['linea', linea],
  ] as const)('%s', (tipo, spec) => {
    const { container } = render(<GraficaChat spec={spec} />)
    const fig = container.querySelector('figure')!
    expect(fig.getAttribute('data-tipo')).toBe(tipo)
    // El ranking en la burbuja (angosta) es HTML: nombre arriba de su barra.
    if (tipo === 'ranking') expect(container.querySelector('[data-ranking="apilado"]')).not.toBeNull()
    else expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.getByText(spec.titulo)).toBeTruthy()
    expect(screen.getByText(/Fuente: POS Fullsite · datos hasta 2026-09-28/)).toBeTruthy()
  })

  it('barras: una columna por día CON dato; el hueco no se dibuja como barra de cero', () => {
    const { container } = render(<GraficaChat spec={barra} />)
    expect(container.querySelectorAll('g.grafica-columna path')).toHaveLength(3)
    expect(screen.getByText(/1 sin datos \(hueco, no cero\)/)).toBeTruthy()
    expect(screen.getByText(/barra tenue = en curso/)).toBeTruthy()
  })

  it('leyenda sólo con 2+ series', () => {
    const uno = render(<GraficaChat spec={barra} />)
    expect(uno.queryByLabelText('Leyenda')).toBeNull()
    cleanup()
    const dos = render(<GraficaChat spec={comparacion} />)
    expect(dos.getByLabelText('Leyenda').textContent).toContain('dom 2026-09-21')
  })
})

describe('GraficaChat — accesible', () => {
  it('role="img" con aria-label que resume con cifras y fechas reales', () => {
    render(<GraficaChat spec={barra} />)
    const img = screen.getByRole('img')
    const label = img.getAttribute('aria-label') || ''
    expect(label).toContain('Ventas por día')
    expect(label).toContain('$18,000.00')
    expect(label).toContain('2026-09-27')
    expect(label).toContain('en curso')
    expect(label).toContain('1 sin datos')
  })

  it('comparación: el resumen da las dos series en el último punto', () => {
    expect(resumenAccesible(comparacion)).toMatch(/Hoy: \$2,100\.00; dom 2026-09-21: \$1,900\.00/)
  })

  it('"Ver tabla" abre y cierra la tabla con todos los valores (sin datos ≠ $0)', () => {
    render(<GraficaChat spec={barra} />)
    const btn = screen.getByRole('button', { name: 'Ver tabla' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    const tabla = screen.getByRole('table')
    expect(tabla.textContent).toContain('$12,534.00')
    expect(tabla.textContent).toContain('sin datos')
    expect(tabla.textContent).not.toContain('$0.00')
    expect(tabla.textContent).toContain('2026-09-28')
    expect(tabla.textContent).toContain('parcial')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar tabla' }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('GraficaChat — spec inválido no dibuja nada', () => {
  it.each([
    ['null', null],
    ['texto', 'hola'],
    ['formato viejo del modelo', { type: 'bar', title: 'x', data: [{ label: 'a', value: 1 }] }],
    ['id desconocido', { ...barra, id: 'inventada' }],
    ['sin versión', { ...barra, v: 1 }],
    ['valor no numérico', { ...barra, filas: [{ x: '2026-09-25', v: { ventas: '12534' } }] }],
    ['todo null', { ...barra, filas: [{ x: '2026-09-25', v: { ventas: null } }] }],
    ['dona con 6 partes', { ...dona, filas: Array.from({ length: 6 }, (_, i) => ({ x: `p${i}`, v: { monto: 1 } })) }],
  ])('%s', (_n, spec) => {
    const { container } = render(<GraficaChat spec={spec} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('separarGraficas (lo que usa el widget)', () => {
  it('dibuja el bloque del servidor y descarta el bloque viejo escrito por el modelo', () => {
    const viejo = '<!--chart\n{"type":"bar","title":"x","data":[{"label":"a","value":999999}]}\nchart-->'
    const partes = separarGraficas(`Vas bien.\n${bloqueDeSpec(barra)}\nY algo más.\n${viejo}`)
    expect(partes.map(p => p.tipo)).toEqual(['texto', 'grafica', 'texto'])
    expect(JSON.stringify(partes)).not.toContain('999999')
  })

  it('un bloque a medias (máquina de escribir) no se muestra como JSON crudo', () => {
    const partes = separarGraficas('Vas bien.\n<!--chart\n{"v":2,"id":"ven')
    expect(partes).toEqual([{ tipo: 'texto', texto: 'Vas bien.' }])
  })
})

describe('etiquetas directas de columnas (con huecos)', () => {
  it('"en curso" va sobre la barra de HOY y el máximo sobre SU barra, aunque haya días sin datos', () => {
    const { container } = render(<GraficaChat spec={barra} />)
    const grupos = [...container.querySelectorAll('g.grafica-columna')]
    const conTexto = (t: string) => grupos.find(g => [...g.querySelectorAll('text')].some(x => x.textContent === t))
    const hoy = conTexto('en curso')!
    expect(hoy.querySelector('path')!.getAttribute('fill-opacity')).toBe('0.4') // la barra parcial
    // El máximo ($18k, el 27) es la barra más alta: su path empieza más arriba que todas.
    const max = conTexto('$18k')!
    const yDe = (g: Element) => Number(/L[\d.]+,([\d.]+)/.exec(g.querySelector('path')!.getAttribute('d')!)![1])
    expect(Math.min(...grupos.map(yDe))).toBe(yDe(max))
    // Hueco: 3 barras dibujadas, 4 días en el eje.
    expect(grupos).toHaveLength(3)
  })

  it('el máximo nunca es el periodo en curso, y se esconde si choca con "en curso"', () => {
    const meses: GraficaSpec = {
      ...base, id: 'ventas_por_mes', tipo: 'barra', titulo: 'Ventas por mes', ejeX: 'mes',
      series: [{ clave: 'ventas', nombre: 'Ventas' }],
      filas: Array.from({ length: 14 }, (_, i) => ({ x: `2025-${String((i % 12) + 1).padStart(2, '0')}${i >= 12 ? 'b' : ''}`, v: { ventas: i === 12 ? 1_300_000 : 1_200_000 } }))
        .concat([{ x: '2026-09', v: { ventas: 1_500_000 }, parcial: true } as never]),
    }
    const angosto = etiquetasColumnas(meses, 250, { left: 0, right: 8 })
    expect(angosto.parcialX).toBe('2026-09')
    expect(angosto.maxX).toBe(meses.filas[12].x) // no el parcial, aunque sea más alto
    expect(angosto.mostrarMax).toBe(false) // vecino de "en curso" a 250px: chocaría
    const lejos = etiquetasColumnas({ ...meses, filas: meses.filas.map((f, i) => ({ ...f, v: { ventas: i === 0 ? 2e6 : f.v.ventas } })) }, 250, { left: 0, right: 8 })
    expect(lejos.maxX).toBe(meses.filas[0].x)
    expect(lejos.mostrarMax).toBe(true)
  })
})

describe('anchos reales de la burbuja (250–300px)', () => {
  it('dona angosta: leyenda abajo con los nombres COMPLETOS (crédito vs débito)', () => {
    const tarjetas: GraficaSpec = { ...dona, filas: [{ x: 'Tarjeta de crédito', v: { monto: 5 } }, { x: 'Tarjeta de débito', v: { monto: 3 } }, { x: 'Efectivo', v: { monto: 2 } }] }
    const { container } = render(<GraficaChat spec={tarjetas} />)
    expect(container.querySelector('[data-leyenda="abajo"]')).not.toBeNull()
    const ley = screen.getByLabelText('Leyenda').textContent || ''
    expect(ley).toContain('Tarjeta de crédito')
    expect(ley).toContain('Tarjeta de débito')
  })

  it('ranking angosto: nombre completo arriba de la barra, valor al final', () => {
    const largo: GraficaSpec = { ...ranking, filas: [{ x: 'Hector Enrique Rodriguez Lopez', v: { venta: 9000 } }, { x: 'Mariana Carolina Salas Alva', v: { venta: 7000 } }] }
    render(<GraficaChat spec={largo} />)
    expect(screen.getByText('Hector Enrique Rodriguez Lopez')).toBeTruthy()
    expect(screen.getByText('Mariana Carolina Salas Alva')).toBeTruthy()
    expect(screen.getByText('$9k')).toBeTruthy()
  })

  it('truncarEnMedio conserva el final que distingue', () => {
    expect(truncarEnMedio('Tarjeta de crédito', 14)).toBe('Tarjet…crédito')
    expect(truncarEnMedio('Tarjeta de débito', 14)).toBe('Tarjet…débito')
    expect(truncarEnMedio('Efectivo', 12)).toBe('Efectivo')
  })
})

describe('rendimiento: mismo bloque → mismo spec', () => {
  it('separarGraficas devuelve el MISMO objeto para el mismo bloque (la gráfica memoizada no se re-dibuja)', () => {
    const t = `Hola\n${bloqueDeSpec(barra)}`
    const a = separarGraficas(t).find(p => p.tipo === 'grafica')
    const b = separarGraficas(`${t}\nmás texto`).find(p => p.tipo === 'grafica')
    expect(a && a.tipo === 'grafica' && a.spec).toBe(b && b.tipo === 'grafica' && b.spec)
  })
})
