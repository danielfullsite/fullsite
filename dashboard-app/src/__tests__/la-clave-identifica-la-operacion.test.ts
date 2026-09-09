import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// LA MISMA FACTURA ENTRO DOS VECES AL INVENTARIO. NO ES UN GUION: PASO.
//
// Leido de `pos_inventory_movements` de AMALAY el 2026-09-09 (la clave vive dentro de
// `notes` como `[key:...]`):
//
//   invoice_entry_dashboard_2026-07-20_16-59_A1B2C3D4-E5F
//   invoice_entry_dashboard_2026-07-20_17-00_A1B2C3D4-E5F   ← 1 min 12 s despues
//
// La misma factura con SEIS insumos (15, 10, 6, 5, 1 y 20 unidades) se aplico dos veces:
// 57 unidades fantasma, mas un segundo recalculo de costo promedio ponderado que ya no
// corresponde a ninguna compra real. Y una merma se duplico el mismo dia, con 1 min 18 s
// de separacion.
//
// LA CAUSA: `nowKey()` armaba la clave de idempotencia con el MINUTO del reloj.
//
//     `${año}-${mes}-${dia}_${hora}-${minuto}`
//
// El almacenista guarda, la red del restaurante tarda, la pagina parece no responder, y
// vuelve a guardar. Si en medio cambio el minuto, la clave es OTRA, la comprobacion de
// duplicados no encuentra la anterior, y la operacion se aplica completa por segunda vez.
//
// EL ERROR OPUESTO, que es igual de caro: una clave demasiado estable descarta una
// captura LEGITIMA como duplicado. Por eso la clave se renueva en cuanto una operacion se
// confirma -- vive exactamente lo que dura un intento y sus reintentos.

const raiz = join(__dirname, '..')
const sinComentarios = (r: string) =>
  readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Las pantallas de inventario que arman una clave de idempotencia. */
const PANTALLAS = [
  'app/inventario-real/entradas/page.tsx',
  'app/inventario-real/devoluciones/page.tsx',
  'app/inventario-real/transferencias/page.tsx',
  'app/inventario-real/toma-fisica/page.tsx',
  'app/inventario-real/merma/page.tsx',
]

describe('ninguna pantalla arma la clave con el reloj', () => {
  for (const p of PANTALLAS) {
    it(`${p.split('/')[2]} ya no define nowKey()`, () => {
      expect(sinComentarios(p)).not.toMatch(/function nowKey/)
    })

    it(`${p.split('/')[2]} usa la clave de operacion`, () => {
      expect(sinComentarios(p)).toMatch(/claveDeOperacion/)
    })

    it(`${p.split('/')[2]} renueva la clave al confirmar`, () => {
      // Sin esto, dos capturas legitimas seguidas compartirian clave y la segunda se
      // descartaria como duplicado -- el error opuesto, y tambien cuesta.
      expect(sinComentarios(p)).toMatch(/confirmarOperacion\(\)/)
    })
  }
})

describe('el helper compartido', () => {
  const helper = sinComentarios('lib/clave-de-operacion.ts')

  it('la clave NO se deriva del reloj', () => {
    expect(helper).toMatch(/crypto\.randomUUID\(\)/)
  })

  it('el respaldo para navegadores viejos lleva aleatoriedad, no solo tiempo', () => {
    // `Date.now()` a secas repetiria clave en el mismo milisegundo y, peor, haria que dos
    // capturas cercanas se parecieran. La parte aleatoria es la que da unicidad.
    const i = helper.indexOf('function nuevaClave')
    const cuerpo = helper.slice(i, i + 400)
    expect(cuerpo).toMatch(/Math\.random\(\)/)
  })

  it('expone confirmar, que es lo que evita el error opuesto', () => {
    expect(helper).toMatch(/confirmar: \(\) => void/)
  })
})

describe('el formato de las claves conserva la fecha delante', () => {
  // Se conserva para que las filas de `wansoft_data` sigan siendo legibles y
  // consultables por prefijo de fecha; la unicidad la da la clave de operacion.
  const casos: Array<[string, RegExp]> = [
    ['app/inventario-real/entradas/page.tsx', /inventory_entry_\$\{fecha\}_\$\{claveDeOperacion\}/],
    ['app/inventario-real/devoluciones/page.tsx', /inventory_return_\$\{todayISO\(\)\}_\$\{claveDeOperacion\}/],
    ['app/inventario-real/transferencias/page.tsx', /inventory_transfer_\$\{todayStr\(\)\}_\$\{claveDeOperacion\}/],
    ['app/inventario-real/toma-fisica/page.tsx', /physical_count_\$\{todayISO\(\)\}_\$\{claveDeOperacion\}/],
    ['app/inventario-real/merma/page.tsx', /inventory_waste_\$\{todayISO\(\)\}_\$\{claveDeOperacion\}/],
  ]
  for (const [archivo, patron] of casos) {
    it(archivo.split('/')[2], () => {
      expect(sinComentarios(archivo)).toMatch(patron)
    })
  }
})

describe('devoluciones: una sola clave para la base y para el historial', () => {
  it('no vuelve a calcularla para el historial en pantalla', () => {
    // Defecto propio de esta pantalla: llamaba a `nowKey()` DOS veces, una para la base y
    // otra para el historial. Al cambiar el minuto entre ambas, lo que se mostraba no era
    // lo que quedaba escrito.
    const src = sinComentarios('app/inventario-real/devoluciones/page.tsx')
    expect(src).toMatch(/const dataKey = /)
    expect((src.match(/data_key: dataKey/g) || []).length).toBe(2)
  })
})

describe('lo que NO se toco, y por que', () => {
  it('entradas-factura ya usaba el UUID del comprobante', () => {
    // Es el ejemplo bien hecho: la misma factura no puede importarse dos veces porque la
    // clave es el UUID del CFDI, no el reloj.
    const src = sinComentarios('app/inventario-real/entradas-factura/page.tsx')
    expect(src).toMatch(/const idempotencyKey = `cfdi_\$\{cfdiUuid\}`/)
  })

  it('pos/merma YA NO tiene el defecto opuesto — se cerro despues', () => {
    // Esta nota decia que `pos/merma` quedaba pendiente: su clave era
    // `merma-${dia}-${insumo:cantidad}...`, que deduplica bien un reintento pero
    // DESCARTA una segunda merma legitima identica el mismo dia, y el `slice(0, 140)`
    // hacia colisionar mermas distintas con muchos insumos.
    //
    // Se cerro el 2026-09-09 con el mismo hook que usan las cinco pantallas de
    // inventario-real. La nota se conserva --en vez de borrarla-- porque el par de
    // defectos espejo es lo que hay que recordar: una clave con el reloj aplica dos
    // veces, una clave con el contenido aplica una sola. Detalle en
    // `la-segunda-merma-del-dia-tambien-existe.test.ts`.
    const p = join(raiz, 'app/pos/merma/page.tsx')
    if (!existsSync(p)) return
    const src = readFileSync(p, 'utf8')
    expect(src).toMatch(/idempotency_key = `merma-\$\{today\}-\$\{claveDeOperacion\}`/)
    expect(src).not.toMatch(/\.slice\(0, 140\)/)
  })
})
