// Alerta de cancelación externa — el caso que Uber preguntó y no teníamos.
//
// Uber, cuestionario de certificación: *"When an order is marked as cancelled by Uber
// (e.g. orders.failure webhook), how is this surfaced to merchant on location?"*
// La respuesta era: se quita de la cola activa, sin aviso. Si la cocina ya la estaba
// preparando, nadie se entera.
//
// La regla que estas pruebas protegen: alarmar SÓLO por cancelaciones de la plataforma.
// Sonar por la cancelación que hizo el propio operador entrena a ignorar la alarma.

import { describe, it, expect } from 'vitest'
import {
  detectarCancelacionesExternas,
  mensajeCancelacion,
  type CancelWatchOrder,
} from '@/lib/integrations/delivery-cancel-alert'

const orden = (over: Partial<CancelWatchOrder> = {}): CancelWatchOrder => ({
  id: 'o1',
  status: 'preparando',
  platform: 'ubereats',
  platform_order_id: 'uber-1',
  customer_name: 'Ana',
  total: 250,
  ...over,
})

describe('Detección — lo que SÍ debe alarmar', () => {
  it('la plataforma cancela una orden que la cocina estaba preparando', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'preparando' })],
      [orden({ status: 'cancelada' })],
    )
    expect(r).toHaveLength(1)
    expect(r[0].estadoPrevio).toBe('preparando')
    expect(r[0].cocinaEnCurso).toBe(true)
  })

  it('también alarma si estaba sólo aceptada — la cocina pudo ya haberla visto', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'aceptada' })],
      [orden({ status: 'cancelada' })],
    )
    expect(r[0].cocinaEnCurso).toBe(true)
  })

  it('alarma por varias a la vez sin perder ninguna', () => {
    const previas = [orden({ id: 'a' }), orden({ id: 'b' }), orden({ id: 'c' })]
    const ahora = [
      orden({ id: 'a', status: 'cancelada' }),
      orden({ id: 'b' }),
      orden({ id: 'c', status: 'cancelada' }),
    ]
    expect(detectarCancelacionesExternas(previas, ahora).map(x => x.id)).toEqual(['a', 'c'])
  })
})

describe('Detección — lo que NO debe alarmar', () => {
  it('REGLA CLAVE: no alarma si la canceló el operador desde esta terminal', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'preparando' })],
      [orden({ status: 'cancelada' })],
      new Set(['o1']),
    )
    expect(r).toHaveLength(0)
  })

  it('no repite el aviso en cada poll de 10s', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'preparando' })],
      [orden({ status: 'cancelada' })],
      new Set(),
      new Set(['o1']),
    )
    expect(r).toHaveLength(0)
  })

  it('no alarma en la primera carga — no hay "antes" contra qué comparar', () => {
    expect(detectarCancelacionesExternas([], [orden({ status: 'cancelada' })])).toHaveLength(0)
  })

  it('no alarma por una orden que ya venía cancelada', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'cancelada' })],
      [orden({ status: 'cancelada' })],
    )
    expect(r).toHaveLength(0)
  })

  it('no alarma por una orden que apareció ya cancelada (histórico)', () => {
    const r = detectarCancelacionesExternas(
      [orden({ id: 'otra' })],
      [orden({ id: 'otra' }), orden({ id: 'nueva', status: 'cancelada' })],
    )
    expect(r).toHaveLength(0)
  })

  it('no alarma por transiciones normales', () => {
    const r = detectarCancelacionesExternas(
      [orden({ status: 'preparando' })],
      [orden({ status: 'entregada' })],
    )
    expect(r).toHaveLength(0)
  })
})

describe('El mensaje al operador', () => {
  it('si la cocina estaba en curso, lo PRIMERO que dice es que avise a cocina', () => {
    const [c] = detectarCancelacionesExternas(
      [orden({ status: 'preparando' })],
      [orden({ status: 'cancelada' })],
    )
    const m = mensajeCancelacion(c)
    expect(m).toMatch(/CANCELÓ/)
    expect(m).toMatch(/avisa a cocina/i)
    expect(m).toMatch(/Uber Eats/)
  })

  it('si no estaba en curso, informa sin urgencia falsa', () => {
    const [c] = detectarCancelacionesExternas(
      [orden({ status: 'nueva_sin_aceptar' })],
      [orden({ status: 'cancelada' })],
    )
    expect(mensajeCancelacion(c)).not.toMatch(/avisa a cocina/i)
  })

  it('nombra bien la plataforma', () => {
    const [c] = detectarCancelacionesExternas(
      [orden({ platform: 'rappi' })],
      [orden({ platform: 'rappi', status: 'cancelada' })],
    )
    expect(mensajeCancelacion(c)).toMatch(/Rappi/)
  })

  it('omite el nombre cuando es el placeholder de Uber', () => {
    const [c] = detectarCancelacionesExternas(
      [orden({ customer_name: 'Cliente Uber' })],
      [orden({ customer_name: 'Cliente Uber', status: 'cancelada' })],
    )
    expect(mensajeCancelacion(c)).not.toMatch(/Cliente Uber/)
  })
})
