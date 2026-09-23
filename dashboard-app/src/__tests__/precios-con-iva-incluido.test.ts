// UN PRECIO QUE YA TRAE IVA NO SE LE VUELVE A SUMAR.
//
// Medido el 2026-09-14 contra los datos reales de AMALAY, comparando lo que
// Wansoft le cobra HOY al cliente contra el precio de la carta en Fullsite:
//
//     25 platillos con nombre coincidente
//     22 con razón entre 0.99 y 1.01   -> lo cobrado ES el precio de la carta
//      0 con razón ~1.16               -> nadie cobra carta + 16%
//      0 con razón ~0.86               -> nadie registra carta / 1.16
//     mediana de la razón: 1.000
//
// Y se descartó que Wansoft registre neto de impuesto: en `ocm_daily`, lo
// cobrado (efectivo+tarjeta) sobre `ventas_dia` da entre 0.92 y 1.00 todos los
// días, nunca 1.16.
//
// Conclusión: los precios de AMALAY YA INCLUYEN IVA. El cliente paga lo que dice
// la carta. Fullsite, con `iva_rate = 0.16` y sumando encima, cobraría un 16% de
// más en cada ticket — una ensalada de $92 saldría en $106.72.
//
// ── POR QUÉ NO SE ARREGLA PONIENDO LA TASA EN CERO ──────────────────────────
//
// Sería el arreglo obvio y el equivocado: el total quedaría bien y el TICKET
// declararía cero IVA sobre una venta que sí lo causa. Con RFC y facturación de
// por medio eso es peor que el problema. Lo correcto con precio inclusivo es
// EXTRAER el impuesto, no dejar de declararlo:
//
//     hoy (exclusivo):   $92.00 + $14.72  =  $106.72   <- el cliente paga de más
//     inclusivo:         $79.31 + $12.69  =  $92.00    <- paga el precio de carta
//
// ── POR QUÉ ES UNA BANDERA POR RESTAURANTE ─────────────────────────────────
//
// En México la carta con IVA incluido es lo normal, pero no lo es en todos lados
// ni para todos los tenants: dos de los tres restaurantes de la base tienen
// `iva_rate = 0`. El modo no se adivina: se declara. Y el valor por omisión es
// `false` — el comportamiento de hoy — para que nadie cambie de facturación sin
// encenderlo a propósito.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { calcOrderTotals } from '../lib/pos-calculations'
import { setIvaRate, setPreciosIncluyenIva, preciosIncluyenIva } from '../lib/pos-constants'

const SRC = resolve(__dirname, '..')
const renglon = (subtotal: number) => ({ subtotal })

beforeEach(() => {
  setIvaRate(0.16)
  setPreciosIncluyenIva(false)
})

describe('modo exclusivo — el precio NO trae impuesto (comportamiento de hoy)', () => {
  it('suma el IVA encima del precio', () => {
    const t = calcOrderTotals([renglon(92)])
    expect(t.subtotalAfterDiscount).toBeCloseTo(92, 2)
    expect(t.iva).toBeCloseTo(14.72, 2)
    expect(t.total).toBeCloseTo(106.72, 2)
  })

  it('es el valor por omisión: nadie cambia de facturación por accidente', () => {
    expect(preciosIncluyenIva()).toBe(false)
  })
})

describe('modo inclusivo — el precio de la carta YA trae el impuesto', () => {
  beforeEach(() => setPreciosIncluyenIva(true))

  it('REGRESION: el cliente paga el precio de la carta, ni un peso más', () => {
    // Éste es el caso de AMALAY: la ensalada de $92 se cobra $92.
    const t = calcOrderTotals([renglon(92)])
    expect(t.total).toBeCloseTo(92, 2)
  })

  it('el impuesto se EXTRAE y se sigue declarando', () => {
    // Poner la tasa en cero también daría total $92, y sería fiscalmente falso.
    const t = calcOrderTotals([renglon(92)])
    expect(t.subtotalAfterDiscount).toBeCloseTo(79.31, 2)
    expect(t.iva).toBeCloseTo(12.69, 2)
    expect(t.iva, 'un ticket con IVA en cero sobre una venta gravada es una factura falsa').toBeGreaterThan(0)
  })

  it('con varios renglones sigue cuadrando', () => {
    const t = calcOrderTotals([renglon(92), renglon(170), renglon(160)])
    expect(t.total).toBeCloseTo(422, 2)
    expect(t.subtotalAfterDiscount + t.iva).toBeCloseTo(422, 2)
  })

  it('el descuento se aplica sobre el precio de carta', () => {
    // Un descuento de $22 sobre $92 deja $70 a pagar — el cliente ve el descuento
    // en el precio que conoce, no sobre una base que nunca vio.
    const t = calcOrderTotals([renglon(92)], 22)
    expect(t.total).toBeCloseTo(70, 2)
    expect(t.subtotalAfterDiscount + t.iva).toBeCloseTo(70, 2)
  })
})

describe('L-02 se cumple en los DOS modos', () => {
  // La ley del catálogo (docs/pos/LEYES-DEL-SISTEMA.md): total = base + iva.
  // Si un modo la rompe, el corte de caja deja de cuadrar.
  for (const incluido of [false, true]) {
    it(`total = base + iva  (precios incluyen IVA: ${incluido})`, () => {
      setPreciosIncluyenIva(incluido)
      for (const precios of [[92], [1], [92, 170, 160], [0.99], [12345.67]]) {
        const t = calcOrderTotals(precios.map(renglon))
        expect(t.subtotalAfterDiscount + t.iva).toBeCloseTo(t.total, 2)
      }
    })
  }

  it('con tasa 0 los dos modos coinciden', () => {
    // Dos de los tres tenants de la base tienen iva_rate = 0. Para ellos la
    // bandera no debe cambiar ni un centavo.
    setIvaRate(0)
    setPreciosIncluyenIva(false)
    const sin = calcOrderTotals([renglon(92)])
    setPreciosIncluyenIva(true)
    const con = calcOrderTotals([renglon(92)])
    expect(con.total).toBeCloseTo(sin.total, 2)
    expect(con.iva).toBeCloseTo(0, 2)
  })
})

describe('el servidor tiene que saber lo mismo que el POS', () => {
  it('REGRESION: save-order conoce el modo inclusivo', () => {
    // `save-order` RECALCULA el total para que el cliente no pueda mentir. Si el
    // POS cobra en modo inclusivo y el servidor recalcula en exclusivo, rechaza
    // toda orden — o peor, la guarda con otro total.
    const ruta = readFileSync(join(SRC, 'app', 'api', 'pos', 'save-order', 'route.ts'), 'utf8')
    expect(ruta).toMatch(/precios_incluyen_iva|preciosIncluyenIva/)
  })

  it('REGRESION: la configuración del restaurante trae la bandera', () => {
    const cfg = readFileSync(join(SRC, 'lib', 'client-config.ts'), 'utf8')
    expect(cfg).toMatch(/precios_incluyen_iva/)
  })
})
