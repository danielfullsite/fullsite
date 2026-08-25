// La lista de atención abre el dashboard, así que su lógica decide si la
// pantalla ayuda o estorba.
//
// El riesgo no es que falle: es que muestre pendientes que no existen. Este
// dashboard venía enseñando "Venta por mesa $39,505" porque dividía entre un
// dato ausente. Una lista de pendientes inventados es peor que no tener lista.
import { describe, it, expect } from 'vitest'
import { desdeEventos, valorEnJuego, UMBRAL_CONFIANZA, type EventoAgente } from '@/lib/atencion'

const AHORA = new Date('2026-08-25T12:00:00Z')

function ev(over: Partial<EventoAgente> = {}): EventoAgente {
  return {
    id: 'e1',
    severity: 'warning',
    title: 'Algo pasó',
    explanation: 'porque sí',
    suggested_action: 'haz esto',
    estimated_value: 1000,
    confidence: 0.9,
    status: 'new',
    created_at: '2026-08-25T10:00:00Z',
    expires_at: null,
    type: 'low_stock',
    ...over,
  }
}

describe('qué entra a la lista', () => {
  it('un evento normal entra', () => {
    expect(desdeEventos([ev()], AHORA)).toHaveLength(1)
  })

  it('sin título NO entra — un renglón sin texto no es un pendiente', () => {
    expect(desdeEventos([ev({ title: null })], AHORA)).toHaveLength(0)
  })

  it('resuelto, descartado o cerrado NO entra', () => {
    for (const status of ['resolved', 'dismissed', 'closed', 'ignored', 'acted']) {
      expect(desdeEventos([ev({ status })], AHORA), status).toHaveLength(0)
    }
  })

  it('el estado "new" SÍ entra — es el único que usan los agentes hoy', () => {
    // El panel de plataforma filtraba por status=eq.open, que no existe en la
    // base: por eso reportaba 0 detecciones habiendo 12.
    expect(desdeEventos([ev({ status: 'new' })], AHORA)).toHaveLength(1)
  })

  it('vencido NO entra — una detección expirada es historia, no pendiente', () => {
    expect(desdeEventos([ev({ expires_at: '2026-08-24T00:00:00Z' })], AHORA)).toHaveLength(0)
  })

  it('con vencimiento futuro sí entra', () => {
    expect(desdeEventos([ev({ expires_at: '2026-08-26T00:00:00Z' })], AHORA)).toHaveLength(1)
  })

  it('confianza bajo el umbral NO entra', () => {
    expect(desdeEventos([ev({ confidence: UMBRAL_CONFIANZA - 0.01 })], AHORA)).toHaveLength(0)
  })

  it('confianza justo en el umbral sí entra', () => {
    expect(desdeEventos([ev({ confidence: UMBRAL_CONFIANZA })], AHORA)).toHaveLength(1)
  })

  it('sin confianza declarada sí entra — no reportarla no es reportarla baja', () => {
    expect(desdeEventos([ev({ confidence: null })], AHORA)).toHaveLength(1)
  })
})

describe('orden: primero lo grave, luego lo caro', () => {
  it('crítico va antes que advertencia, y advertencia antes que info', () => {
    const r = desdeEventos(
      [
        ev({ id: 'i', severity: 'info', estimated_value: 9999 }),
        ev({ id: 'c', severity: 'critical', estimated_value: 1 }),
        ev({ id: 'w', severity: 'warning', estimated_value: 500 }),
      ],
      AHORA,
    )
    expect(r.map(x => x.id)).toEqual(['c', 'w', 'i'])
  })

  it('a igual gravedad, manda el dinero en juego', () => {
    const r = desdeEventos(
      [
        ev({ id: 'barato', severity: 'critical', estimated_value: 100 }),
        ev({ id: 'caro', severity: 'critical', estimated_value: 5000 }),
      ],
      AHORA,
    )
    expect(r.map(x => x.id)).toEqual(['caro', 'barato'])
  })

  it('una severidad desconocida cae a info, NO se promueve a crítica', () => {
    // Inflar la severidad es la forma más rápida de que la lista pierda
    // credibilidad y la gente deje de mirarla.
    const r = desdeEventos([ev({ severity: 'inventada' })], AHORA)
    expect(r[0].severidad).toBe('info')
  })

  it('sin severidad también cae a info', () => {
    expect(desdeEventos([ev({ severity: null })], AHORA)[0].severidad).toBe('info')
  })
})

describe('contenido del renglón', () => {
  it('prefiere la acción sugerida sobre la explicación', () => {
    const r = desdeEventos([ev({ suggested_action: 'Pide más', explanation: 'se acabó' })], AHORA)
    expect(r[0].detalle).toBe('Pide más')
  })

  it('si no hay acción sugerida, usa la explicación', () => {
    const r = desdeEventos([ev({ suggested_action: null, explanation: 'se acabó' })], AHORA)
    expect(r[0].detalle).toBe('se acabó')
  })

  it('sin ninguna de las dos, el detalle queda vacío en vez de inventar texto', () => {
    const r = desdeEventos([ev({ suggested_action: null, explanation: null })], AHORA)
    expect(r[0].detalle).toBe('')
  })

  it('un valor de cero se trata como ausente, no como "$0 en juego"', () => {
    expect(desdeEventos([ev({ estimated_value: 0 })], AHORA)[0].valor).toBeNull()
  })

  it('un valor negativo también se descarta', () => {
    expect(desdeEventos([ev({ estimated_value: -50 })], AHORA)[0].valor).toBeNull()
  })

  it('los tipos conocidos llevan destino; los desconocidos no llevan botón', () => {
    expect(desdeEventos([ev({ type: 'out_of_stock' })], AHORA)[0].href).toBe('/inventario')
    expect(desdeEventos([ev({ type: 'tipo_que_no_existe' })], AHORA)[0].href).toBeUndefined()
    expect(desdeEventos([ev({ type: null })], AHORA)[0].href).toBeUndefined()
  })
})

describe('la lista vacía es información', () => {
  it('sin eventos devuelve lista vacía, no un renglón de relleno', () => {
    expect(desdeEventos([], AHORA)).toEqual([])
  })

  it('si todo está resuelto, la lista queda vacía', () => {
    const r = desdeEventos([ev({ status: 'resolved' }), ev({ id: 'e2', status: 'dismissed' })], AHORA)
    expect(r).toEqual([])
  })
})

describe('valor en juego', () => {
  it('suma sólo los valores presentes', () => {
    const items = desdeEventos(
      [ev({ id: 'a', estimated_value: 1000 }), ev({ id: 'b', estimated_value: null }), ev({ id: 'c', estimated_value: 500 })],
      AHORA,
    )
    expect(valorEnJuego(items)).toBe(1500)
  })

  it('una lista vacía vale cero', () => {
    expect(valorEnJuego([])).toBe(0)
  })
})

describe('con la forma real de los datos de producción', () => {
  it('las 12 detecciones actuales pasan el umbral y se ordenan bien', () => {
    // Confianzas y valores reales, leídos de agent_events el 2026-08-25.
    const reales: EventoAgente[] = [
      ev({ id: '1', type: 'out_of_stock', severity: 'critical', confidence: 0.93, estimated_value: 3400 }),
      ev({ id: '2', type: 'cancel_concentration', severity: 'critical', confidence: 0.88, estimated_value: 1850 }),
      ev({ id: '3', type: 'low_stock', severity: 'warning', confidence: 0.85, estimated_value: 900 }),
      ev({ id: '4', type: 'understaffed', severity: 'warning', confidence: 0.8, estimated_value: 1500 }),
      ev({ id: '5', type: 'peak_load', severity: 'warning', confidence: 0.81, estimated_value: 1200 }),
      ev({ id: '6', type: 'top_performer', severity: 'info', confidence: 0.9, estimated_value: 0 }),
      ev({ id: '7', type: 'low_ticket', severity: 'info', confidence: 0.74, estimated_value: 2100 }),
    ]
    const r = desdeEventos(reales, AHORA)
    expect(r).toHaveLength(7)
    // críticos por valor, luego warnings por valor, luego info por valor
    expect(r.map(x => x.id)).toEqual(['1', '2', '4', '5', '3', '7', '6'])
    expect(valorEnJuego(r)).toBe(10950)
  })
})
