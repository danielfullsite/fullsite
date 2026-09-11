import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeOrderSummary, summaryToArqueoInput, calcEfectivoEsperado } from '@/lib/pos-arqueo'

// LA PANTALLA QUE CIERRA LA CAJA ADIVINABA LAS FORMAS DE PAGO POR EL NOMBRE.
//
// `CierreCajaWizard` llamaba a `computeOrderSummary(orders, movimientos)` sin el
// tercer argumento -- el mapa de tipos de `pos_payment_methods` -- con un comentario
// que decia "same logic as Corte page". No lo era: la pagina de Corte SI construye
// el mapa desde el catalogo. Sin mapa quedan tres reglas por nombre: contiene
// "efectivo"/"cash" -> efectivo; contiene "transferencia" -> transferencia; todo lo
// demas -> TARJETA.
//
// AMALAY tiene 18 formas activas heredadas de Wansoft. Quince no se parecen a nada:
// Dolares, Cortesia, Vale Amalay, Claudia Sada, Mercadotecnia, Influencer, Venta
// Terceros, Rappi, Ubereats, DiDi, Clip, NetPay, Pago Open Table, aDomicilio.
//
// `Dolares` es el que cuesta dinero: el catalogo lo marca `cash` -- billetes FISICOS
// en el cajon -- y el nombre no dice "efectivo" ni "cash". Sin mapa cuenta como
// tarjeta, el efectivo esperado sale corto por ese monto, y el conteo cierra con
// SOBRANTE. Un sobrante se lee como "hay dinero de mas" y tapa un faltante igual.
//
// Segunda mitad: cortesias y plataformas vivian sumadas dentro de `tarjeta`, que es
// justo el numero que en AMALAY se concilia A MANO contra la terminal bancaria
// (Daniel, 2026-09-05: "ellos lo cobran en el POS y en la terminal manualmente").
// Con cortesias adentro nunca iba a cuadrar y la diferencia no tenia dueno.

/** El catalogo real de AMALAY, tal como esta en `pos_payment_methods` hoy. */
const CATALOGO_AMALAY: Record<string, string> = {
  'efectivo': 'cash',
  'dólares': 'cash',
  'tarjeta de credito': 'card',
  'tarjeta de debito': 'card',
  'clip': 'terminal',
  'transferencia': 'transfer',
  'rappi': 'platform',
  'ubereats': 'platform',
  'didi food': 'platform',
  'pago open table': 'platform',
  'cortesía': 'other',
  'vale amalay': 'other',
  'venta terceros': 'other',
  'mercadotecnia': 'other',
  'influencer': 'other',
  'netpay': 'other',
  'adomicilio': 'other',
  'claudia sada': 'other',
}

const orden = (metodo: string, total: number, propina = 0) => ({
  status: 'cerrada', total, propina, descuento: 0,
  pagos: [{ metodo, monto: total + propina }],
})

describe('los dolares del cajon cuentan como efectivo', () => {
  it('con el catalogo, una venta en dolares suma al efectivo esperado', () => {
    const s = computeOrderSummary([orden('Dólares', 1000)], [], CATALOGO_AMALAY)
    expect(s.efectivo).toBe(1000)
    expect(s.tarjeta).toBe(0)

    const { efectivoEsperado } = calcEfectivoEsperado(summaryToArqueoInput(s, 500))
    expect(efectivoEsperado).toBe(1500)   // fondo 500 + 1000 de dolares
  })

  it('SIN catalogo esos mismos $1,000 se van a tarjeta y el cajon queda corto', () => {
    // Esto NO es una regresion que se este arreglando en la formula: es el costo
    // exacto de no pasar el mapa, que es lo que hacia el wizard. Se deja escrito
    // para que se vea cuanto dinero mueve el tercer argumento.
    const s = computeOrderSummary([orden('Dólares', 1000)], [])
    expect(s.efectivo).toBe(0)
    expect(s.tarjeta).toBe(1000)

    const { efectivoEsperado, diferencia } = calcEfectivoEsperado(
      summaryToArqueoInput(s, 500),
      1500,                                // el cajero cuenta los dolares: 500 + 1000
    )
    expect(efectivoEsperado).toBe(500)
    expect(diferencia).toBe(1000)          // SOBRANTE fantasma de $1,000
  })
})

describe('cortesias y plataformas salen de tarjeta', () => {
  it('una cortesia no es una venta con tarjeta', () => {
    const s = computeOrderSummary([orden('Cortesía', 800)], [], CATALOGO_AMALAY)
    expect(s.tarjeta).toBe(0)
    expect(s.otros).toBe(800)
  })

  it('Rappi tampoco: la terminal bancaria nunca vio ese dinero', () => {
    const s = computeOrderSummary([orden('Rappi', 450)], [], CATALOGO_AMALAY)
    expect(s.tarjeta).toBe(0)
    expect(s.otros).toBe(450)
  })

  it('Clip SI es tarjeta: cobra la terminal y contra ella se concilia', () => {
    const s = computeOrderSummary([orden('Clip', 300)], [], CATALOGO_AMALAY)
    expect(s.tarjeta).toBe(300)
    expect(s.otros).toBe(0)
  })

  it('lo que se movio de cubeta no toca el efectivo esperado', () => {
    // La cortesia no es dinero en el cajon ni antes ni ahora. Si este numero
    // cambiara, el arreglo de reporteria estaria rompiendo el arqueo.
    const antes = calcEfectivoEsperado(summaryToArqueoInput(
      computeOrderSummary([orden('Efectivo', 200)], [], CATALOGO_AMALAY), 500))
    const conCortesia = calcEfectivoEsperado(summaryToArqueoInput(
      computeOrderSummary([orden('Efectivo', 200), orden('Cortesía', 800)], [], CATALOGO_AMALAY), 500))
    expect(conCortesia.efectivoEsperado).toBe(antes.efectivoEsperado)
  })
})

describe('el desglose sigue sumando el total', () => {
  it('efectivo + tarjeta + transferencias + otros = total de ventas', () => {
    // Sin esta propiedad, sacar `otros` de `tarjeta` dejaria un hueco en el corte
    // y alguien lo leeria como dinero perdido.
    const s = computeOrderSummary([
      orden('Efectivo', 1000), orden('Dólares', 500), orden('Tarjeta de credito', 700),
      orden('Clip', 300), orden('Transferencia', 400), orden('Cortesía', 250),
      orden('Rappi', 150), orden('Vale Amalay', 100),
    ], [], CATALOGO_AMALAY)
    expect(s.efectivo + s.tarjeta + s.transferencias + s.otros).toBeCloseTo(s.totalVentas, 6)
    expect(s.totalVentas).toBe(3400)
    expect(s.efectivo).toBe(1500)          // Efectivo + Dolares
    expect(s.tarjeta).toBe(1000)           // credito + Clip
    expect(s.transferencias).toBe(400)
    expect(s.otros).toBe(500)              // Cortesia + Rappi + Vale
  })
})

describe('lo que no cambio', () => {
  it('la propina de una forma que no es efectivo sigue saliendo del cajon', () => {
    // Al mesero se le paga en billetes aunque el cliente haya pagado con Rappi.
    const s = computeOrderSummary([orden('Rappi', 500, 60)], [], CATALOGO_AMALAY)
    expect(s.propinasNoEfectivo).toBeCloseTo(60, 6)
    expect(s.propinaEfectivo).toBe(0)
  })

  it('un nombre que el catalogo no tiene sigue cayendo donde caia', () => {
    // Con mapa presente pero sin esa llave, se usa la heuristica de siempre. No se
    // cambia el destino de nombres viejos: moveria cierres historicos de cubeta.
    const s = computeOrderSummary([orden('forma que ya nadie usa', 100)], [], CATALOGO_AMALAY)
    expect(s.tarjeta).toBe(100)
    expect(s.otros).toBe(0)
  })

  it('sin pagos[] se usa metodo_pago, y tambien pasa por el catalogo', () => {
    const s = computeOrderSummary(
      [{ status: 'cerrada', total: 900, propina: 0, descuento: 0, metodo_pago: 'Dólares', pagos: null }],
      [], CATALOGO_AMALAY)
    expect(s.efectivo).toBe(900)
  })

  it('un pago mixto reparte la venta entre las cubetas correctas', () => {
    const s = computeOrderSummary([{
      status: 'cerrada', total: 1000, propina: 0, descuento: 0,
      pagos: [{ metodo: 'Dólares', monto: 400 }, { metodo: 'Cortesía', monto: 600 }],
    }], [], CATALOGO_AMALAY)
    expect(s.efectivo).toBeCloseTo(400, 6)
    expect(s.otros).toBeCloseTo(600, 6)
    expect(s.tarjeta).toBe(0)
  })
})

// ── El arreglo de verdad esta en el sitio de llamada ─────────────────────────
// La formula ya sabia usar el mapa. Lo que fallaba era que el wizard no se lo daba.

const wizard = (() => {
  const fuente = readFileSync(
    join(__dirname, '..', 'components', 'pos', 'CierreCajaWizard.tsx'), 'utf8')
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
})()

describe('el wizard le pregunta al catalogo antes de cerrar', () => {
  it('carga las formas de pago', () => {
    expect(wizard).toMatch(/getPaymentMethodsFromDB/)
  })

  it('y se las pasa a computeOrderSummary como tercer argumento', () => {
    const i = wizard.indexOf('computeOrderSummary(')
    const llamada = wizard.slice(wizard.indexOf('const summary = computeOrderSummary('))
    expect(i).toBeGreaterThan(-1)
    expect(llamada.slice(0, 200)).toMatch(/mapaDeFormas,/)
  })

  it('un catalogo vacio no impide cerrar la caja', () => {
    // A las 2 a.m. sin catalogo legible, trabar el cierre cuesta mas que un
    // desglose adivinado. `undefined` = heuristica de antes.
    expect(wizard).toMatch(/if \(formas\.length > 0\)/)
    expect(wizard).toMatch(/let mapaDeFormas: Record<string, string> \| undefined/)
  })

  it('guarda el desglose de otros en el cierre', () => {
    // La fila vive en lib/pos-cierre-fila.ts (2026-09-10); el wizard le pasa `otros`.
    const fila = readFileSync(join(process.cwd(), 'src/lib/pos-cierre-fila.ts'), 'utf8')
    expect(fila).toMatch(/otros_sistema: d\.otros/)
    expect(wizard).toMatch(/otros: systemData\.otros/)
  })
})

describe('los movimientos de efectivo se leen del restaurante correcto', () => {
  it('la consulta filtra por client_id', () => {
    // La RLS tapa al extrano, pero `user_has_client_access` le dice que si a TODAS
    // las membresias de un mismo usuario. Daniel tiene ocho. Depositos y retiros
    // entran directo al efectivo esperado.
    const i = wizard.indexOf('pos_cash_movements?')
    expect(i).toBeGreaterThan(-1)
    expect(wizard.slice(i, i + 200)).toMatch(/client_id=eq\.\$\{_cid\(\)\}/)
  })
})

describe('la columna del cierre existe en el repo', () => {
  it('hay migracion para otros_sistema', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'migrations',
        '20260909060000_pos_cierres_otros_sistema.sql'), 'utf8')
    expect(sql).toMatch(/add column if not exists otros_sistema numeric/)
  })
})
