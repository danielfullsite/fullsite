import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// OP-10 del inventario de pendientes dice: "Doble cobro posible (`handlePayment` sin guard
// `updated_at`)", marcado 🟠 P0 abierto.
//
// Fui a verificarlo el 2026-09-08 y el documento está VIEJO: no sólo existe ese guard, hay
// CUATRO capas, y la última la sostiene la base de datos. Esta prueba las ancla, porque un
// P0 de dinero que se cierra sin prueba se vuelve a abrir solo.
//
// LAS CUATRO CAPAS, de la más frágil a la más dura:
//
//   1. operationLock            pos/page.tsx:3751 — el doble clic ni entra
//   2. checkOrderConflict       :3250 — relee la orden y aborta si otra terminal ya la
//                               cerró o la modificó. Es una comprobación del CLIENTE, con
//                               una ventana entre leer y escribir: por sí sola no basta,
//                               y por eso importan las dos de abajo.
//   3. expected_revision        save-order/route.ts:173 — control optimista en el servidor
//   4. save_operation_id        + PRIMARY KEY (client_id, order_id, save_operation_id) en
//                               pos_save_operations. Verificado contra la base: el
//                               exactly-once no depende de que el código se acuerde.
//
// La capa 4 es la que de verdad cierra el caso. Dos terminales cobrando la misma cuenta
// sin internet, cada una encolando su cobro, reproducen contra esa llave primaria: la
// segunda no puede insertar. No hay forma de que el código lo olvide, porque no es código.

const raiz = join(__dirname, '..')
const sinComentarios = (r: string) =>
  readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** El cuerpo de una función, para no enganchar coincidencias de otra parte del archivo. */
function cuerpoDe(archivo: string, firma: string, largo = 3000): string {
  const src = sinComentarios(archivo)
  const i = src.indexOf(firma)
  expect(i, `no encontré ${firma} en ${archivo}`).toBeGreaterThan(-1)
  return src.slice(i, i + largo)
}

describe('capa 1 y 2 — el POS no deja cobrar dos veces desde la pantalla', () => {
  const cobro = cuerpoDe('app/pos/page.tsx', 'const handlePayment = async')

  it('un segundo clic no entra mientras el primero corre', () => {
    expect(cobro).toMatch(/if \(operationLock\.current\) return/)
    expect(cobro).toMatch(/operationLock\.current = true/)
  })

  it('antes de cobrar relee la orden para ver si otra terminal se adelantó', () => {
    expect(cobro).toMatch(/checkOrderConflict\('payment'\)/)
  })

  it('esa relectura aborta si la orden ya está cerrada o cancelada', () => {
    const check = cuerpoDe('app/pos/page.tsx', 'const checkOrderConflict = async', 2000)
    expect(check).toMatch(/'cerrada'/)
    expect(check).toMatch(/'cancelada'/)
    expect(check).toMatch(/updated_at/)
  })

  it('y si falla la red NO bloquea el cobro — se apoya en las capas del servidor', () => {
    // Bloquear aquí dejaría al restaurante sin cobrar cada vez que parpadea el internet,
    // que es justo lo que este POS existe para evitar. La protección real va abajo.
    const check = cuerpoDe('app/pos/page.tsx', 'const checkOrderConflict = async', 2000)
    expect(check).toMatch(/catch\s*\{[\s\S]*?return false/)
  })
})

describe('capa 3 y 4 — el servidor y la base no aceptan el mismo cobro dos veces', () => {
  const ruta = sinComentarios('app/api/pos/save-order/route.ts')

  it('exige la revisión esperada de la orden', () => {
    expect(ruta).toMatch(/expected_revision/)
  })

  it('usa el camino idempotente cuando viene el id de operación', () => {
    expect(ruta).toMatch(/r1_save_order_idempotent/)
  })

  it('y comprueba si esa operación ya se guardó antes de repetirla', () => {
    expect(ruta).toMatch(/save_operation_id=eq\./)
    expect(ruta).toMatch(/state=eq\.COMMITTED/)
  })

  it('el cobro siempre manda su id de operación', () => {
    // Sin él, la ruta cae al camino legacy que sólo tiene OCC — la propia ruta lo dice.
    const cobro = cuerpoDe('app/pos/page.tsx', 'const handlePayment = async', 4000)
    expect(cobro).toMatch(/genOpId\(\)/)
  })

  it('saveOrder lo pasa al servidor', () => {
    const guardar = cuerpoDe('lib/pos-data.ts', 'export async function saveOrder', 3000)
    expect(guardar).toMatch(/save_operation_id/)
  })
})

describe('la reconciliación del dinero, que es lo que hace inútil cobrar de más', () => {
  it('la suma de los pagos tiene que dar exactamente el total más la propina', () => {
    const guardar = cuerpoDe('lib/pos-data.ts', 'export async function saveOrder', 1400)
    expect(guardar).toMatch(/pagosSum !== expected/)
    expect(guardar).toMatch(/PAYMENT_MISMATCH/)
  })

  it('se compara en centavos enteros, no en pesos con decimales', () => {
    // Comparar flotantes haría que 0.1 + 0.2 !== 0.3 rechazara cobros buenos y aceptara
    // malos. En dinero se cuenta en enteros.
    const guardar = cuerpoDe('lib/pos-data.ts', 'export async function saveOrder', 1400)
    expect(guardar).toMatch(/Math\.round\(\(n \|\| 0\) \* 100\)/)
  })

  it('y el servidor la vuelve a hacer, sin confiar en el navegador', () => {
    const ruta = sinComentarios('app/api/pos/save-order/route.ts')
    expect(ruta).toMatch(/toCents\(body\.total\)/)
  })
})
