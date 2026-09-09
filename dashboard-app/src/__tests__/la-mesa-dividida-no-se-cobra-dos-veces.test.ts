import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA MESA DIVIDIDA SE PODIA COBRAR OTRA VEZ, COMPLETA.
//
// Encontrado el 2026-09-08 por la caceria de bugs de dinero. El guion, en ~10 toques y
// sin salir de la pantalla:
//
//   1. Mesa 12, 4 personas, $2,816. Ya enviada a cocina: existe en pos_orders con
//      status 'enviada' y order_revision 3.
//   2. Dividir cuenta -> Parejo -> 4. Se cobran las cuatro. Cada cobro escribe una fila
//      NUEVA (`{orden}-C1`..`-C4`, status 'cerrada').
//   3. A la orden MADRE no se le escribe nada. Lo unico que sale es
//      `avisarCierreDeOrden`, que es un aviso a la LAN -- un mensaje, no una escritura
//      (lib/aviso-lan.ts: "no es la fuente de verdad").
//   4. El POS navega al mapa. El mapa pide
//      `status=in.(enviada,preparando,lista,abierta,entregada)` (mesas/page.tsx:339).
//      La madre sigue 'enviada' -> la mesa 12 se pinta OCUPADA con los $2,816 enteros.
//   5. Quien la toque carga la madre (page.tsx:2138, mismos status) y la cobra otra vez.
//      El corte suma $2,816 + $2,816 contra una mesa que comio $2,816.
//
// VARIANTE SIN COBRO DOBLE, misma causa: cobrar la mesa completa en efectivo, dividir en
// 4 y registrar SOLO la cuenta 1. La mesa queda abierta con el total completo -- o sea
// indistinguible de una que se fue sin pagar -- y al cierre se cancela en lote con una
// nota. El faltante queda documentado como merma, no como robo.
//
// ESTABA LATENTE, NO ACTIVO: `select count(*) from pos_orders where id like '%-C%'` = 0
// en AMALAY. Nadie ha dividido una cuenta en produccion porque AMALAY sigue en Wansoft.
// El dia del cutover es el dia 1.

const raiz = join(__dirname, '..')
const sinComentarios = (r: string) =>
  readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('al liquidar el split, la madre se cierra', () => {
  /** Sólo la rama de liquidación: de `debeEmitirCierre` hasta el toast de "todas cobradas". */
  const bloque = (() => {
    const src = sinComentarios('app/pos/page.tsx')
    const i = src.indexOf('liquidacion.debeEmitirCierre')
    expect(i, 'no encontré la rama de liquidación').toBeGreaterThan(-1)
    const fin = src.indexOf('Todas las cuentas cobradas', i)
    expect(fin, 'la rama debe terminar en el toast').toBeGreaterThan(i)
    return src.slice(i, fin)
  })()

  it('se escribe la orden MADRE, no sólo el aviso a la LAN', () => {
    expect(bloque).toMatch(/saveOrder\(/)
  })

  it('con el id de la madre, sin sufijo de cuenta', () => {
    // `order.id` es `{orden}-C4` en la última cuenta. Escribir ESE id crearía una quinta
    // fila y dejaría la madre igual de abierta.
    expect(bloque).toMatch(/id: orderId,/)
    expect(bloque).not.toMatch(/id: payId/)
  })

  it('en estado dividida, que no es cerrada', () => {
    // Con 'cerrada' el corte contaría la venta dos veces y el arqueo pediría efectivo
    // que nunca entró: peor que el defecto original.
    expect(bloque).toMatch(/status: 'dividida'/)
  })

  it('y sin pagos: el dinero vive en las cuentas', () => {
    expect(bloque).toMatch(/pagos: \[\]/)
  })

  it('respetando la revisión de la madre — no un cero', () => {
    // `expected_revision: 0` sería un INSERT y chocaría con la orden que ya existe.
    expect(bloque).toMatch(/orderRevision,/)
    expect(bloque).not.toMatch(/orderRevision: 0/)
  })

  it('con su propio id de operación, para no chocar con la idempotencia del cobro', () => {
    expect(bloque).toMatch(/`\$\{opId\}-madre`/)
  })

  it('y si falla, se avisa en vez de fingir que la mesa quedó libre', () => {
    expect(bloque).toMatch(/cierreMadre\.ok/)
    expect(bloque).toMatch(/OFFLINE_QUEUED/)
  })
})

describe('el estado nuevo sale de donde tiene que salir', () => {
  it('la madre ya no aparece como mesa ocupada', () => {
    // Los 12 lugares que definen "ocupada" listan status explícitos y ninguno incluye
    // 'dividida'. Se ancla el del mapa, que es el que produjo el síntoma.
    const mapa = sinComentarios('app/pos/mesas/page.tsx')
    expect(mapa).toMatch(/status=in\.\(enviada,preparando,lista,abierta,entregada\)/)
    expect(mapa).not.toMatch(/dividida/)
  })

  it('ni se vuelve a cargar en el editor de la mesa', () => {
    const pos = sinComentarios('app/pos/page.tsx')
    expect(pos).toMatch(/status=in\.\(abierta,enviada,preparando,lista,entregada\)/)
  })

  it('y el corte sigue contando sólo cerradas', () => {
    expect(sinComentarios('app/pos/corte/page.tsx')).toMatch(/o\.status === 'cerrada'/)
  })
})

describe('el tipo admite el estado, para que TypeScript avise donde falte', () => {
  it('Order.status incluye dividida', () => {
    expect(sinComentarios('lib/pos-data.ts')).toMatch(/\| 'dividida'/)
  })
})

describe('la caja tampoco deja editar una orden liquidada', () => {
  // Sin esto el hueco seguiría abierto por el lado de Pedro: su guard consideraba "no
  // abierta" sólo a cancelada|pagada|cerrada, así que una madre 'dividida' se podía
  // seguir editando desde la caja.
  const dominio = readFileSync(
    join(raiz, '..', '..', 'electron-app', 'local-server', 'core', 'operational-domain.js'), 'utf8')

  it('dividida cuenta como cuenta no abierta', () => {
    const i = dominio.indexOf('ORDER_NOT_OPEN')
    expect(i).toBeGreaterThan(-1)
    const linea = dominio.slice(dominio.lastIndexOf('\n', i), i)
    expect(linea).toMatch(/'dividida'/)
  })
})
