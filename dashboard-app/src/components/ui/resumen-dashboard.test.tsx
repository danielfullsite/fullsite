// Las tres piezas del dashboard rediseñado.
//
// Lo que se prueba aquí no es que se vean bien: es que NO MIENTAN. Cada caso
// corresponde a un defecto real, verificado en el código de producción antes de
// escribir el rediseño:
//
//   · el aviso de frescura salía tres veces y ninguna decía cuántos días
//   · "vs prom. Viernes" podía ser el promedio de UN solo viernes
//   · la barra del ranking medía contra el primer lugar, no contra el total
//   · "Brutas" era "Ventas del día" otra vez, con otro nombre
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EstadoOperacion, { diasEntre } from '@/components/dashboard/EstadoOperacion'
import ResumenDia, { type ResumenDiaProps } from '@/components/dashboard/ResumenDia'
import QuienVendio from '@/components/dashboard/QuienVendio'
import RitmoSemana from '@/components/dashboard/RitmoSemana'

afterEach(cleanup)

// ════════════════════════════════════════════════════════════════════════════
describe('diasEntre', () => {
  it('cuenta días completos', () => {
    expect(diasEntre('2026-07-24', '2026-08-25')).toBe(32)
    expect(diasEntre('2026-08-25', '2026-08-25')).toBe(0)
  })

  it('no se corre un día con el cambio de horario', () => {
    // Si se parseara a medianoche, la hora que el reloj repite o se salta movería
    // la resta. Por eso el componente ancla a mediodía.
    expect(diasEntre('2026-10-24', '2026-11-05')).toBe(12)
    expect(diasEntre('2026-03-28', '2026-04-10')).toBe(13)
  })

  it('sin fecha previa devuelve null, no cero', () => {
    // Un 0 significaría "está al día", que es justo lo contrario de "nunca mandó".
    expect(diasEntre(null, '2026-08-25')).toBeNull()
  })

  it('una fecha basura devuelve null y no NaN', () => {
    expect(diasEntre('no-es-fecha', '2026-08-25')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('EstadoOperacion', () => {
  const hoy = '2026-08-25'

  it('dice cuántos días lleva el POS callado — el dato que faltaba', () => {
    render(<EstadoOperacion turno={null} ultimaFecha="2026-07-24" hoy={hoy} />)
    expect(screen.getByText(/32 días sin mandar datos/)).toBeTruthy()
  })

  it('nombra el último día cerrado y avisa que TODO lo de abajo es de ahí', () => {
    render(<EstadoOperacion turno={null} ultimaFecha="2026-07-24" hoy={hoy} />)
    expect(screen.getByText(/24 de julio/)).toBeTruthy()
    expect(screen.getByText(/cifras de abajo son de ese día/)).toBeTruthy()
  })

  it('un solo día de retraso no se anuncia igual que un mes', () => {
    // Misma alerta para 1 día y para 32 enseña a ignorarla.
    render(<EstadoOperacion turno={null} ultimaFecha="2026-08-24" hoy={hoy} />)
    expect(screen.getByText(/no ha mandado datos de hoy/)).toBeTruthy()
    expect(screen.queryByText(/días sin mandar/)).toBeNull()
  })

  it('con datos de hoy no alarma', () => {
    render(<EstadoOperacion turno={null} ultimaFecha={hoy} hoy={hoy} />)
    expect(screen.getByText('Sin turno abierto')).toBeTruthy()
    expect(screen.queryByText(/sin mandar datos/)).toBeNull()
  })

  it('con turno abierto muestra quién y desde cuándo, y no alarma', () => {
    render(
      <EstadoOperacion
        turno={{ numero: 3, abiertoPor: 'Valeria', abiertoAt: '2026-08-25T14:30:00Z' }}
        ultimaFecha="2026-07-24"
        hoy={hoy}
      />
    )
    expect(screen.getByText('Turno 3 abierto')).toBeTruthy()
    expect(screen.getByText(/Valeria/)).toBeTruthy()
    expect(screen.queryByText(/sin mandar datos/)).toBeNull()
  })

  it('sin ninguna venta histórica no inventa un conteo de días', () => {
    render(<EstadoOperacion turno={null} ultimaFecha={null} hoy={hoy} />)
    expect(screen.getByText(/Todavía no hay ventas registradas/)).toBeTruthy()
    expect(screen.queryByText(/0 días/)).toBeNull()
  })

  it('una hora inválida no imprime "Invalid Date"', () => {
    render(
      <EstadoOperacion
        turno={{ numero: 1, abiertoPor: 'Ana', abiertoAt: 'no-es-fecha' }}
        ultimaFecha="2026-08-25"
        hoy={hoy}
      />
    )
    expect(screen.queryByText(/Invalid/)).toBeNull()
  })

  it('mientras carga no renderiza nada', () => {
    const { container } = render(
      <EstadoOperacion turno={null} ultimaFecha="2026-07-24" hoy={hoy} cargando />
    )
    expect(container.firstChild).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
const base: ResumenDiaProps = {
  fecha: '2026-07-24',
  esUltimoCierre: true,
  periodo: 'dia',
  ventas: 2070,
  ordenes: 5,
  personas: 14,
  ticketPersona: 148,
  ticketOrden: 414,
  propinas: 86,
  descuentos: 0,
  promedioMismoDia: 6436,
  muestraMismoDia: 4,
  tipoComparacion: 'promedio',
  etiquetaComparacion: 'los viernes',
}

describe('ResumenDia — la comparación no puede mentir', () => {
  it('escribe de cuántos días es el promedio', () => {
    render(<ResumenDia {...base} />)
    expect(screen.getByText(/4 días/)).toBeTruthy()
    expect(screen.getByText(/-68%/)).toBeTruthy()
  })

  it('con UN solo día igual NO compara: dice que no alcanza', () => {
    // El defecto original: con un viernes previo la pantalla igual escribía
    // "vs prom. Viernes", como si promediara varios.
    render(<ResumenDia {...base} muestraMismoDia={1} />)
    expect(screen.queryByText(/-68%/)).toBeNull()
    expect(screen.getByText(/hacen falta al menos 2/)).toBeTruthy()
  })

  it('sin base de comparación no fabrica un "+0%" en verde', () => {
    // percentChange() devuelve 0 cuando no hay base y formatPercent lo pinta
    // como '+0.0%' con flecha hacia arriba. Aquí no se compara y punto.
    render(<ResumenDia {...base} promedioMismoDia={0} />)
    expect(screen.queryByText(/\+0%/)).toBeNull()
    expect(screen.queryByText(/0%/)).toBeNull()
  })

  it('contra el periodo anterior SÍ compara con n=1: es un periodo, no una media', () => {
    render(
      <ResumenDia
        {...base}
        periodo="semana"
        tipoComparacion="periodo"
        muestraMismoDia={1}
        etiquetaComparacion="la semana anterior"
      />
    )
    expect(screen.getByText(/-68%/)).toBeTruthy()
    expect(screen.queryByText(/1 día/)).toBeNull()
  })
})

describe('ResumenDia — el dinero cuadra', () => {
  it('el desglose suma: bruto − descuentos = neto, + propinas = entró a caja', () => {
    render(<ResumenDia {...base} ventas={2000} descuentos={150} propinas={86} />)
    expect(screen.getByText('$2,150')).toBeTruthy() // bruto  = 2000 + 150
    expect(screen.getByText('$2,086')).toBeTruthy() // entró  = 2000 + 86
    expect(screen.getByText('$150')).toBeTruthy()   // descuentos
  })

  it('cero descuentos NO se pinta como alarma', () => {
    const { container } = render(<ResumenDia {...base} descuentos={0} />)
    const rojos = container.querySelectorAll('.text-\\[var\\(--crit-ink\\)\\]')
    // el único rojo admisible es el delta negativo de la comparación
    expect(rojos.length).toBeLessThanOrEqual(1)
  })

  it('un dato ausente sale como guion, nunca como $0', () => {
    render(<ResumenDia {...base} ventas={null} ordenes={null} propinas={null} descuentos={null} />)
    expect(screen.queryByText('$0')).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('el desglose se puede apagar, como el widget que sustituye', () => {
    render(<ResumenDia {...base} mostrarDinero={false} />)
    expect(screen.queryByText('Entró a caja')).toBeNull()
    expect(screen.getByTestId('resumen-venta')).toBeTruthy()
  })

  it('sin descuentos NO repite el mismo número como bruto y como neto', () => {
    // ventas_brutas = ventas + descuentos. Con descuentos en 0 los tres son el
    // mismo número; imprimirlo tres veces sería peor que el defecto original.
    render(<ResumenDia {...base} ventas={2070} descuentos={0} propinas={86} />)
    expect(screen.getAllByText('$2,070')).toHaveLength(2) // cifra grande + 'Venta'
    expect(screen.queryByText('Venta bruta')).toBeNull()
    expect(screen.queryByText('Descuentos')).toBeNull()
    expect(screen.getByText('Venta')).toBeTruthy()
    expect(screen.getByText('$2,156')).toBeTruthy() // entró a caja
  })

  it('con descuentos sí aparece el desglose completo', () => {
    render(<ResumenDia {...base} ventas={2000} descuentos={150} propinas={86} />)
    expect(screen.getByText('Venta bruta')).toBeTruthy()
    expect(screen.getByText('Descuentos')).toBeTruthy()
    expect(screen.getByText('Venta neta')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('QuienVendio — la barra mide contra el total', () => {
  function anchos(container: HTMLElement): number[] {
    return [...container.querySelectorAll('li div > div')].map(d =>
      parseFloat((d as HTMLElement).style.width) || 0
    )
  }

  it('un reparto 51/49 NO se dibuja como 100/96', () => {
    // El defecto original: width = total / max, así que el primer lugar SIEMPRE
    // llenaba la barra y el segundo casi. La barra dejaba de informar.
    const { container } = render(
      <QuienVendio filas={[{ nombre: 'Ana', total: 510 }, { nombre: 'Beto', total: 490 }]} totalPeriodo={1000} />
    )
    const w = anchos(container)
    expect(w[0]).toBeCloseTo(51, 0)
    expect(w[1]).toBeCloseTo(49, 0)
  })

  it('un reparto 95/5 sí se ve como 95/5', () => {
    const { container } = render(
      <QuienVendio filas={[{ nombre: 'Ana', total: 950 }, { nombre: 'Beto', total: 50 }]} totalPeriodo={1000} />
    )
    const w = anchos(container)
    expect(w[0]).toBeCloseTo(95, 0)
    expect(w[1]).toBeCloseTo(5, 0)
  })

  it('el porcentaje va en CADA renglón, no sólo en un banner aparte', () => {
    render(
      <QuienVendio filas={[{ nombre: 'Valeria', total: 1450 }, { nombre: 'Emilio', total: 620 }]} totalPeriodo={2070} />
    )
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it('la venta sin mesero asignado se declara en vez de desaparecer', () => {
    render(
      <QuienVendio filas={[{ nombre: 'Ana', total: 800 }]} totalPeriodo={1000} />
    )
    expect(screen.getByText(/\$200 de la venta no tiene mesero asignado/)).toBeTruthy()
  })

  it('sin denominador real no divide entre cero', () => {
    const { container } = render(<QuienVendio filas={[{ nombre: 'Ana', total: 0 }]} totalPeriodo={0} />)
    expect(anchos(container)[0]).toBe(0)
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('la concentración se dice una vez, y sólo cuando es real', () => {
    const { rerender } = render(
      <QuienVendio filas={[{ nombre: 'Valeria', total: 1450 }, { nombre: 'Emilio', total: 620 }]} totalPeriodo={2070} />
    )
    expect(screen.getByText(/cargó el 70%/)).toBeTruthy()
    // 51/49 no es concentración; no debe narrarse
    rerender(
      <QuienVendio filas={[{ nombre: 'Ana', total: 510 }, { nombre: 'Beto', total: 490 }]} totalPeriodo={1000} />
    )
    expect(screen.queryByText(/cargó el/)).toBeNull()
  })

  it('sin nadie asignado no dibuja barras vacías', () => {
    render(<QuienVendio filas={[]} />)
    expect(screen.getByText(/Ninguna orden del día trae mesero asignado/)).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// RitmoSemana usa las cifras REALES de Espresso Lab, medidas contra pos_orders
// (627 órdenes cerradas, 24-jun a 24-jul de 2026, excluyendo el día parcial).
const RITMO = [
  { dow: 1, nombre: 'Lunes', ventaProm: 7514, cuentasProm: 20.8, peor: 5540, mejor: 8815, n: 4 },
  { dow: 2, nombre: 'Martes', ventaProm: 6021, cuentasProm: 16.8, peor: 4945, mejor: 8275, n: 4 },
  { dow: 3, nombre: 'Miércoles', ventaProm: 5880, cuentasProm: 16.8, peor: 4505, mejor: 7825, n: 5 },
  { dow: 4, nombre: 'Jueves', ventaProm: 7451, cuentasProm: 20.0, peor: 6270, mejor: 10230, n: 5 },
  { dow: 5, nombre: 'Viernes', ventaProm: 6444, cuentasProm: 17.8, peor: 4100, mejor: 8485, n: 4 },
  { dow: 6, nombre: 'Sábado', ventaProm: 9663, cuentasProm: 25.5, peor: 8370, mejor: 11730, n: 4 },
  { dow: 7, nombre: 'Domingo', ventaProm: 10679, cuentasProm: 28.8, peor: 8125, mejor: 12780, n: 4 },
]

describe('RitmoSemana — la decisión sin un clic', () => {
  it('dice qué esperar HOY, con la muestra y el rango', () => {
    render(<RitmoSemana filas={RITMO} hoyDow={2} />)
    expect(screen.getByText(/Un martes normal son/)).toBeTruthy()
    // Sale dos veces a propósito: en la frase (la conclusión) y en su barra
    // (la comparación contra los otros días). No es el defecto de repetir el
    // mismo aviso en tres estilos distintos — son dos trabajos distintos.
    expect(screen.getAllByText(/\$6,021/)).toHaveLength(2)
    expect(screen.getByText(/4 martess? de historia/)).toBeTruthy()
    expect(screen.getByText(/de \$4,945 a \$8,275/)).toBeTruthy()
  })

  it('nombra el día fuerte y cuántas veces vale el más flojo', () => {
    render(<RitmoSemana filas={RITMO} hoyDow={2} />)
    // 10,679 / 5,880 = 1.8
    expect(screen.getByText(/domingo.*1\.8 veces un miércoles/)).toBeTruthy()
  })

  it('con un solo día igual NO promedia: lo dice', () => {
    const flaco = RITMO.map(f => (f.dow === 2 ? { ...f, n: 1 } : f))
    render(<RitmoSemana filas={flaco} hoyDow={2} />)
    expect(screen.queryByText(/Un martes normal son/)).toBeNull()
    expect(screen.getByText(/Todavía no hay 2 martess/)).toBeTruthy()
  })

  it('sin historia suficiente no renderiza nada', () => {
    const { container } = render(
      <RitmoSemana filas={RITMO.map((f, i) => (i < 2 ? f : { ...f, n: 0, ventaProm: 0 }))} hoyDow={2} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('un día sin historia no aparece como una barra en cero', () => {
    const sinDomingo = RITMO.map(f => (f.dow === 7 ? { ...f, n: 0, ventaProm: 0, cuentasProm: 0 } : f))
    render(<RitmoSemana filas={sinDomingo} hoyDow={2} />)
    expect(screen.queryByText('Dom')).toBeNull()
    expect(screen.getByText('Mar')).toBeTruthy()
  })

  it('las barras se miden contra el día más fuerte', () => {
    const { container } = render(<RitmoSemana filas={RITMO} hoyDow={2} />)
    const w = [...container.querySelectorAll('li span > span')].map(
      e => parseFloat((e as HTMLElement).style.width) || 0
    )
    expect(Math.max(...w)).toBeCloseTo(100, 0)          // el domingo llena
    expect(w[2]).toBeCloseTo((5880 / 10679) * 100, 0)   // miércoles proporcional
  })

  it('no divide entre cero cuando todo está en cero', () => {
    const ceros = RITMO.map(f => ({ ...f, ventaProm: 0, peor: 0, mejor: 0, n: 3 }))
    const { container } = render(<RitmoSemana filas={ceros} hoyDow={2} />)
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
  })
})
