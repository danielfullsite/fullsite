import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA VENTA QUE OCURRIA EN MEDIO SE BORRABA EN SILENCIO.
//
// `recordMovement` leia el stock, calculaba el valor final EN MEMORIA, y despues escribia
// ese absoluto con un PATCH que filtraba solo por `id` y `client_id`. Sin version, sin
// condicion. El guion, un sabado a las 14:00 con la cocina descontando por receta (~39
// movimientos al dia, concentrados en horas pico):
//
//   1. Se lee aguacate: stock = 12. Se calcula 12 + 40 = 52 en memoria.
//   2. Entre esa lectura y el PATCH van varias llamadas HTTP -- el POST al ledger va
//      antes. En esa ventana el POS manda dos rondas y descuenta 3: stock = 9.
//   3. El PATCH escribe 52 y pisa el 9.
//   4. El saldo queda en 52 cuando deberia ser 49. Las 3 piezas vendidas desaparecieron
//      del saldo, aunque siguen en el ledger como 'recipe_deduction'.
//
// El ledger y el saldo se separan, y nadie se entera hasta que alguien cuenta a mano.
//
// LO QUE HACE CORRECTO AL REINTENTO: se aplica el DELTA sobre el valor releido, no el
// absoluto viejo. El movimiento vale "40 mas", no "52" -- escribir 52 otra vez repetiria
// exactamente el defecto que se esta arreglando.

const fuente = readFileSync(join(__dirname, '..', 'lib', 'inventory.ts'), 'utf8')
const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el PATCH exige que la fila siga como se leyo', () => {
  it('la lectura trae la version', () => {
    expect(codigo).toMatch(/select=id,ingredient_id,stock,updated_at/)
  })

  it('y el PATCH filtra por ella', () => {
    expect(codigo).toMatch(/updated_at=eq\.\$\{encodeURIComponent\(version\)\}/)
  })

  it('pide representacion para saber cuantas filas afecto', () => {
    // Con `return=minimal` un UPDATE que no afecta ninguna fila responde 200 igual: la
    // carrera seria invisible. Ese era medio defecto.
    const i = codigo.indexOf('pos_inventory?id=eq.${current.id}')
    expect(codigo.slice(i, i + 500)).toMatch(/Prefer: 'return=representation'/)
  })

  it('cero filas se trata como carrera, no como exito', () => {
    expect(codigo).toMatch(/if \(Array\.isArray\(filas\) && filas\.length > 0\) break/)
  })
})

describe('el reintento aplica el DELTA, no el absoluto viejo', () => {
  it('recalcula desde el stock releido mas la cantidad del movimiento', () => {
    // Si reintentara con `c.stock_after`, volveria a pisar: seria el mismo defecto con
    // un paso extra.
    expect(codigo).toMatch(/objetivo = Math\.max\(0, \(Number\(fila\.stock\) \|\| 0\) \+ c\.quantity\)/)
  })

  it('conserva el piso en 0: una baja no deja el saldo negativo', () => {
    expect(codigo).toMatch(/Math\.max\(0, \(Number\(fila\.stock\)/)
  })

  it('relee tambien la version, para que el siguiente intento pueda competir', () => {
    expect(codigo).toMatch(/version = fila\.updated_at/)
  })

  it('reintenta un numero acotado de veces', () => {
    expect(codigo).toMatch(/for \(let intento = 0; intento < 3; intento\+\+\)/)
  })
})

describe('lo que no se puede volver a perder en silencio', () => {
  it('agotar los reintentos es un ERROR reportado, no un exito', () => {
    // El defecto original no era perder la escritura: era perderla sin decirlo.
    expect(codigo).toMatch(/otra escritura gano la carrera tres veces/)
    expect(codigo).toMatch(/result\.errors\.push\(/)
  })

  it('un fallo HTTP sigue reportandose aparte', () => {
    expect(codigo).toMatch(/Stock update failed for \$\{c\.ingredient_id\}: \$\{patchRes\.status\}/)
  })

  it('el exito solo cuenta si de verdad escribio', () => {
    expect(codigo).toMatch(/if \(patchRes && patchRes\.ok\) \{\s*\n\s*result\.stock_updates\+\+/)
  })
})

describe('el patron es el que el repo ya usa', () => {
  it('cancel-item filtra por updated_at igual', () => {
    // No se invento nada: es el mismo control de concurrencia que ya protege pos_orders,
    // a dos archivos de distancia.
    const cancel = readFileSync(
      join(__dirname, '..', 'app', 'api', 'pos', 'cancel-item', 'route.ts'), 'utf8')
    expect(cancel).toMatch(/updated_at=eq\./)
  })
})
