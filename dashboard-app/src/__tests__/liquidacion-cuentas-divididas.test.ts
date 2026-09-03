// Los diez escenarios de cuentas divididas. Es dinero: se prueban todos.
//
// CAMPO, 2026-09-02 (Eduardo Esquivel, AMALAY): «siguen apareciendo platillos en
// órdenes que están ya cerradas».
//
// El primer intento de arreglo emitía `ORDER_CLOSED` con el id del COBRO
// (`{orden}-C1`). Cocina guarda el id de la MADRE: no coincide, el tablero no se
// limpia. Y la corrección ingenua —emitir el id de la madre— es peor: el PRIMER
// pago parcial borraría de cocina la comida de los otros comensales.
//
// La causa de fondo era que no existía estado agregado en ningún lado durable:
// `splitPayingCuenta` vivía en React, en UNA terminal (page.tsx:3580).
//
// Estas pruebas fijan las tres cosas que no se pueden romper:
//   1. Cocina se limpia con el `order_id` de la MADRE, nunca con un sufijo.
//   2. NUNCA con el primer pago de un split; SÓLO con el último.
//   3. Exactamente UNA vez.

import { describe, it, expect } from 'vitest'
import {
  evaluarLiquidacion, puedeCobrar,
  cuentaCompleta, cuentaDeSplit, intentoDePago, ordenMadreDe, cuentasDe,
  type OrdenParaLiquidar, type Pago,
} from '@/lib/liquidacion-de-orden'

const ORD = 'ord-8'
const pagoOk = (account_id: string, monto: number, payment_id: string): Pago =>
  ({ payment_id, account_id, monto, estado: 'aceptado' })

// ── 1. Cuenta normal ────────────────────────────────────────────────────────
describe('1 · Cuenta normal, sin split', () => {
  const cuentas = cuentasDe(ORD, null, 1000)

  it('sin pagos no está liquidada y NO se cierra cocina', () => {
    const v = evaluarLiquidacion({ order_id: ORD, cuentas, pagos: [] })
    expect(v.liquidada).toBe(false)
    expect(v.debeEmitirCierre).toBe(false)
  })

  it('pagada completa: se liquida y se cierra UNA vez, con el id de la MADRE', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaCompleta(ORD), 1000, 'p1')],
    })
    expect(v.liquidada).toBe(true)
    expect(v.debeEmitirCierre).toBe(true)
    // Lo que se le manda a cocina. Si esto llevara sufijo, el tablero no se limpia.
    expect(v.order_id).toBe(ORD)
    expect(v.order_id).not.toContain(':')
    expect(v.order_id).not.toMatch(/-C\d/)
  })
})

// ── 2. Split en dos ─────────────────────────────────────────────────────────
describe('2 · Split en dos', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('REGRESION: el PRIMER pago NO cierra cocina', () => {
    // Es el corazón del hallazgo. Si esto falla, se le borra a la cocina la
    // comida de la otra mitad de la mesa, sin haber salido.
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1')],
    })
    expect(v.liquidada, 'falta la cuenta 2').toBe(false)
    expect(v.debeEmitirCierre).toBe(false)
    expect(v.cuentasPendientes).toEqual([cuentaDeSplit(ORD, 2)])
  })

  it('el ÚLTIMO pago sí cierra, con el id de la madre', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2')],
    })
    expect(v.liquidada).toBe(true)
    expect(v.debeEmitirCierre).toBe(true)
    expect(v.order_id).toBe(ORD)
  })

  it('el orden de cobro no importa: cuenta 2 primero y luego la 1', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2'), pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1')],
    })
    expect(v.debeEmitirCierre).toBe(true)
  })
})

// ── 3. Split por artículos ──────────────────────────────────────────────────
describe('3 · Split por artículos, con montos desiguales', () => {
  // Cuatro personas, consumos distintos. Es el caso real de una mesa grande.
  const cuentas = cuentasDe(ORD, [320.5, 180, 745.25, 99.99], 1345.74)

  it('con tres de cuatro cuentas pagadas NO cierra', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [
        pagoOk(cuentaDeSplit(ORD, 1), 320.5, 'p1'),
        pagoOk(cuentaDeSplit(ORD, 2), 180, 'p2'),
        pagoOk(cuentaDeSplit(ORD, 3), 745.25, 'p3'),
      ],
    })
    expect(v.debeEmitirCierre).toBe(false)
    expect(v.cuentasPendientes).toEqual([cuentaDeSplit(ORD, 4)])
  })

  it('con las cuatro, cierra — y los centavos no lo impiden', () => {
    // 320.5 + 180 + 745.25 + 99.99 en flotante no da exactamente 1345.74.
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [
        pagoOk(cuentaDeSplit(ORD, 1), 320.5, 'p1'),
        pagoOk(cuentaDeSplit(ORD, 2), 180, 'p2'),
        pagoOk(cuentaDeSplit(ORD, 3), 745.25, 'p3'),
        pagoOk(cuentaDeSplit(ORD, 4), 99.99, 'p4'),
      ],
    })
    expect(v.debeEmitirCierre, 'un centavo de flotante no puede dejar la mesa abierta').toBe(true)
  })
})

// ── 4. Pago parcial ─────────────────────────────────────────────────────────
describe('4 · Pago parcial dentro de una cuenta', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('un abono NO liquida la cuenta', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 200, 'p1')],
    })
    expect(v.cuentas[0].liquidada).toBe(false)
    expect(v.cuentas[0].restante).toBeCloseTo(300, 2)
    expect(v.debeEmitirCierre).toBe(false)
  })

  it('los abones se suman hasta cubrir', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [
        pagoOk(cuentaDeSplit(ORD, 1), 200, 'p1'),
        pagoOk(cuentaDeSplit(ORD, 1), 300, 'p2'),
        pagoOk(cuentaDeSplit(ORD, 2), 500, 'p3'),
      ],
    })
    expect(v.cuentas[0].liquidada).toBe(true)
    expect(v.debeEmitirCierre).toBe(true)
  })

  it('un abono deja la cuenta ABIERTA para el resto', () => {
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 200, 'p1')],
    }
    const v = puedeCobrar(orden, {
      payment_id: 'p2', account_id: cuentaDeSplit(ORD, 1), monto: 300,
    })
    expect(v.permitido, 'debe poder cobrarse el resto').toBe(true)
  })
})

// ── 5. Pago rechazado y reintento ───────────────────────────────────────────
describe('5 · Pago rechazado y reintento', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('REGRESION: un rechazo NO cubre nada', () => {
    // Si un rechazo contara, la mesa se cerraría sin haber cobrado.
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [
        { payment_id: 'p1', account_id: cuentaDeSplit(ORD, 1), monto: 500, estado: 'rechazado' },
        pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2'),
      ],
    })
    expect(v.cuentas[0].liquidada).toBe(false)
    expect(v.debeEmitirCierre).toBe(false)
  })

  it('un pago PENDIENTE tampoco cubre — no se sabe si entró', () => {
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [{ payment_id: 'p1', account_id: cuentaDeSplit(ORD, 1), monto: 500, estado: 'pendiente' }],
    })
    expect(v.cuentas[0].liquidada).toBe(false)
  })

  it('el reintento tras un rechazo SÍ se permite y sí liquida', () => {
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas,
      pagos: [{ payment_id: 'p1', account_id: cuentaDeSplit(ORD, 1), monto: 500, estado: 'rechazado' }],
    }
    expect(puedeCobrar(orden, { payment_id: 'p1-r2', account_id: cuentaDeSplit(ORD, 1), monto: 500 }).permitido).toBe(true)

    const v = evaluarLiquidacion({
      ...orden,
      pagos: [...orden.pagos, pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1-r2'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2')],
    })
    expect(v.debeEmitirCierre).toBe(true)
  })
})

// ── 6. Reinicio entre pagos ─────────────────────────────────────────────────
describe('6 · Reinicio de la terminal entre dos pagos', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('REGRESION: el veredicto NO depende de la memoria de la terminal', () => {
    // Éste es el bug de fondo: `splitPayingCuenta` vivía en React (page.tsx:3580),
    // así que un reinicio perdía "quién ya pagó". Aquí el estado se DERIVA de los
    // pagos: una terminal recién arrancada llega al mismo veredicto.
    const trasReinicio: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1')],
    }
    const v = evaluarLiquidacion(trasReinicio)
    expect(v.cuentas[0].liquidada, 'debe recordar que la 1 ya pagó').toBe(true)
    expect(v.cuentasPendientes).toEqual([cuentaDeSplit(ORD, 2)])
    expect(v.debeEmitirCierre).toBe(false)
  })

  it('y no vuelve a cobrar la cuenta que ya estaba pagada', () => {
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1')],
    }
    const v = puedeCobrar(orden, { payment_id: 'otro', account_id: cuentaDeSplit(ORD, 1), monto: 500 })
    expect(v.permitido).toBe(false)
    expect(v.motivo).toBe('cuenta_ya_liquidada')
  })
})

// ── 7. Dos terminales cobrando ──────────────────────────────────────────────
describe('7 · Dos terminales cobrando la misma cuenta', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('REGRESION: la segunda se RECHAZA — no se "cuadra después"', () => {
    // Un cobro de más ya salió de la tarjeta del cliente. Rechazar es lo correcto.
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'caja-1')],
    }
    const v = puedeCobrar(orden, { payment_id: 'caja-2', account_id: cuentaDeSplit(ORD, 1), monto: 500 })

    expect(v.permitido).toBe(false)
    expect(v.motivo).toBe('cuenta_ya_liquidada')
    expect(v.esRepeticion, 'NO es el mismo cobro: es otro intento').toBeFalsy()
    expect(v.mensaje).toMatch(/ya está pagada/i)
  })

  it('pero la otra cuenta sí se puede cobrar en paralelo', () => {
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'caja-1')],
    }
    expect(puedeCobrar(orden, { payment_id: 'caja-2', account_id: cuentaDeSplit(ORD, 2), monto: 500 }).permitido).toBe(true)
  })

  it('cobrar contra una cuenta inexistente se rechaza (falla cerrada)', () => {
    const orden: OrdenParaLiquidar = { order_id: ORD, cuentas, pagos: [] }
    const v = puedeCobrar(orden, { payment_id: 'x', account_id: `${ORD}:c9`, monto: 100 })
    expect(v.permitido).toBe(false)
    expect(v.motivo).toBe('cuenta_desconocida')
  })
})

// ── 8. Último pago duplicado ────────────────────────────────────────────────
describe('8 · El último pago llega dos veces', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)
  const pagos = [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2')]

  it('REGRESION: el mismo payment_id repetido NO se cuenta dos veces', () => {
    // Es el replay de la cola offline. Si contara doble, una cuenta a medio pagar
    // se daría por liquidada.
    const v = evaluarLiquidacion({
      order_id: ORD,
      cuentas: cuentasDe(ORD, [500, 500], 1000),
      pagos: [pagoOk(cuentaDeSplit(ORD, 1), 300, 'p1'), pagoOk(cuentaDeSplit(ORD, 1), 300, 'p1')],
    })
    expect(v.cuentas[0].pagado, 'un solo pago de 300, no 600').toBeCloseTo(300, 2)
    expect(v.cuentas[0].liquidada).toBe(false)
  })

  it('REGRESION: el cierre se emite EXACTAMENTE una vez', () => {
    const primera = evaluarLiquidacion({ order_id: ORD, cuentas, pagos })
    expect(primera.debeEmitirCierre).toBe(true)

    // Quien guardó el estado marca que ya lo emitió. Segunda evaluación: no.
    const segunda = evaluarLiquidacion({ order_id: ORD, cuentas, pagos, cierre_ya_emitido: true })
    expect(segunda.liquidada, 'sigue liquidada').toBe(true)
    expect(segunda.debeEmitirCierre, 'pero ya no se vuelve a avisar').toBe(false)
  })

  it('reenviar el MISMO cobro se detecta como repetición, no como doble cobro', () => {
    const orden: OrdenParaLiquidar = { order_id: ORD, cuentas, pagos }
    const v = puedeCobrar(orden, { payment_id: 'p2', account_id: cuentaDeSplit(ORD, 2), monto: 500 })
    expect(v.permitido).toBe(false)
    expect(v.esRepeticion, 'es el mismo intento: devuelve el resultado original').toBe(true)
    expect(v.motivo).toBe('pago_duplicado')
  })
})

// ── 9. Reconexión offline ───────────────────────────────────────────────────
describe('9 · Reconexión: la cola offline se vacía de golpe', () => {
  const cuentas = cuentasDe(ORD, [500, 500], 1000)

  it('REGRESION: pagos repetidos y desordenados llegan al mismo veredicto', () => {
    // La cola puede reproducir el mismo pago varias veces y fuera de orden — pasó
    // en producción el 2026-09-01 con operaciones de julio. El veredicto tiene que
    // ser función de los datos, no del orden de llegada.
    const desordenados: Pago[] = [
      pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2'),
      pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1'),
      pagoOk(cuentaDeSplit(ORD, 2), 500, 'p2'),   // duplicado
      pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1'),   // duplicado
    ]
    const v = evaluarLiquidacion({ order_id: ORD, cuentas, pagos: desordenados })

    expect(v.totalPagado, 'mil, no dos mil').toBeCloseTo(1000, 2)
    expect(v.liquidada).toBe(true)
    expect(v.debeEmitirCierre).toBe(true)
  })

  it('el veredicto es estable: dos evaluaciones dan lo mismo', () => {
    const orden: OrdenParaLiquidar = {
      order_id: ORD, cuentas, pagos: [pagoOk(cuentaDeSplit(ORD, 1), 500, 'p1')],
    }
    expect(evaluarLiquidacion(orden)).toEqual(evaluarLiquidacion(orden))
  })
})

// ── 10. Lo que ve el KDS ────────────────────────────────────────────────────
describe('10 · El KDS: no desaparece con el primer pago, sí con el último', () => {
  const cuentas = cuentasDe(ORD, [500, 500, 500, 500], 2000)
  const cerrarConQueId = (pagos: Pago[]): string | null => {
    const v = evaluarLiquidacion({ order_id: ORD, cuentas, pagos })
    return v.debeEmitirCierre ? v.order_id : null
  }

  it('REGRESION: mesa de cuatro, tres pagos — cocina NO recibe cierre', () => {
    expect(cerrarConQueId([pagoOk(cuentaDeSplit(ORD, 1), 500, 'a')])).toBeNull()
    expect(cerrarConQueId([pagoOk(cuentaDeSplit(ORD, 1), 500, 'a'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'b')])).toBeNull()
    expect(cerrarConQueId([
      pagoOk(cuentaDeSplit(ORD, 1), 500, 'a'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'b'),
      pagoOk(cuentaDeSplit(ORD, 3), 500, 'c'),
    ])).toBeNull()
  })

  it('REGRESION: con el CUARTO pago sí, y con el id que cocina reconoce', () => {
    const id = cerrarConQueId([
      pagoOk(cuentaDeSplit(ORD, 1), 500, 'a'), pagoOk(cuentaDeSplit(ORD, 2), 500, 'b'),
      pagoOk(cuentaDeSplit(ORD, 3), 500, 'c'), pagoOk(cuentaDeSplit(ORD, 4), 500, 'd'),
    ])
    // `useKdsWsClient` hace `ordersMap.delete(p.order_id)` con el id de la MADRE.
    // Cualquier sufijo aquí = el tablero no se limpia nunca.
    expect(id).toBe(ORD)
    expect(id).not.toMatch(/[:#]/)
    expect(id).not.toMatch(/-C\d/)
  })
})

// ── Los ids ─────────────────────────────────────────────────────────────────
describe('Los identificadores son estables y derivables', () => {
  it('la cuenta de una orden sin split es única y estable', () => {
    expect(cuentaCompleta(ORD)).toBe('ord-8:full')
    expect(cuentaCompleta(ORD)).toBe(cuentaCompleta(ORD))
  })

  it('REGRESION: de cualquier cuenta se recupera la orden MADRE, sin sufijo', () => {
    expect(ordenMadreDe(cuentaDeSplit(ORD, 3))).toBe(ORD)
    expect(ordenMadreDe(cuentaCompleta(ORD))).toBe(ORD)
  })

  it('un id de orden con guiones no se rompe', () => {
    const uuid = '2b4d1603-8c75-4ceb-bb4e-455d00e98f7d'
    expect(ordenMadreDe(cuentaDeSplit(uuid, 2))).toBe(uuid)
  })

  it('el intento hereda la idempotencia del opId: doble tap = mismo payment_id', () => {
    const a = intentoDePago(cuentaDeSplit(ORD, 1), 'op-abc')
    const b = intentoDePago(cuentaDeSplit(ORD, 1), 'op-abc')
    expect(a).toBe(b)
    expect(intentoDePago(cuentaDeSplit(ORD, 2), 'op-abc')).not.toBe(a)
  })
})

// ── Bordes que no deben tumbar una caja ─────────────────────────────────────
describe('Datos rotos no cierran cocina por accidente', () => {
  it('REGRESION: una orden SIN cuentas no se declara liquidada', () => {
    // "No falta nada" parece trivialmente cierto y es exactamente el bug de la
    // semana: un dato ausente leído como un hecho.
    const v = evaluarLiquidacion({ order_id: ORD, cuentas: [], pagos: [] })
    expect(v.liquidada).toBe(false)
    expect(v.debeEmitirCierre).toBe(false)
  })

  it('un monto corrupto no liquida', () => {
    const cuentas = cuentasDe(ORD, [500], 500)
    const v = evaluarLiquidacion({
      order_id: ORD, cuentas,
      pagos: [{ payment_id: 'p', account_id: cuentaDeSplit(ORD, 1), monto: NaN, estado: 'aceptado' }],
    })
    expect(v.liquidada).toBe(false)
  })

  it('un monto de cero o negativo se rechaza al cobrar', () => {
    const orden: OrdenParaLiquidar = { order_id: ORD, cuentas: cuentasDe(ORD, [500], 500), pagos: [] }
    for (const monto of [0, -100, NaN]) {
      expect(puedeCobrar(orden, { payment_id: 'x', account_id: cuentaDeSplit(ORD, 1), monto }).permitido).toBe(false)
    }
  })
})
