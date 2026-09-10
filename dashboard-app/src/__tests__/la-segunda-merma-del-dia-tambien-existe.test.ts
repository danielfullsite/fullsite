import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// EL DEFECTO ESPEJO DEL QUE SE ARREGLO EN LAS CINCO PANTALLAS DE INVENTARIO.
//
// En `inventario-real/` la clave de idempotencia llevaba el MINUTO del reloj, asi que
// un reintento pasado el minuto se aplicaba OTRA VEZ. Medido en produccion el
// 2026-09-09: una factura de seis insumos entro dos veces con 1 min 12 s de diferencia,
// 57 unidades fantasma.
//
// `pos/merma` tenia el defecto contrario, y es igual de caro:
//
//     `merma-${today}-` + entries.map(e => `${e.ingredient_id}:${e.quantity}`)
//                                 .join('|').slice(0, 140)
//
// La clave se arma con el CONTENIDO, y el contenido se repite:
//
//   1. Se echan a perder 2 kg de lechuga en la manana. Se registra.
//      Se echan a perder otros 2 kg en la tarde. Mismo dia, mismo ingrediente, misma
//      cantidad -> MISMA CLAVE -> `recordMovement` la descarta como duplicado y esa
//      merma nunca existio. El inventario dice que hay 2 kg que ya no estan.
//   2. Con muchos renglones, `.slice(0, 140)` corta la clave. Dos mermas DISTINTAS que
//      comparten el principio colisionan y la segunda tambien desaparece.
//
// Una merma que no se registra no es sólo un dato perdido: es merma que el sistema va a
// leer como robo cuando alguien cuente el almacen.

const src = readFileSync(
  join(__dirname, '..', 'app', 'pos', 'merma', 'page.tsx'), 'utf8')
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('la clave identifica la operacion, no el contenido', () => {
  it('usa la clave de operacion que ya existe en el repo', () => {
    // No se inventa un mecanismo nuevo: es el mismo hook que usan las cinco pantallas
    // de inventario-real desde el arreglo del minuto.
    expect(codigo).toMatch(/useClaveDeOperacion/)
    expect(codigo).toMatch(/const \{ clave: claveDeOperacion, confirmar: confirmarOperacion \}/)
  })

  it('la clave NO se arma con los ingredientes ni las cantidades', () => {
    expect(codigo).toMatch(/idempotency_key = `merma-\$\{today\}-\$\{claveDeOperacion\}`/)
    expect(codigo).not.toMatch(/entries\.map\(e => `\$\{e\.ingredient_id\}:\$\{e\.quantity\}`\)/)
  })

  it('y ya no se corta a 140 caracteres', () => {
    // El corte hacia colisionar mermas distintas que compartian el principio.
    expect(codigo).not.toMatch(/\.slice\(0, 140\)/)
  })

  it('se renueva SOLO despues de un guardado confirmado', () => {
    // Renovarla antes rompe la otra mitad: un reintento tras un error de red llevaria
    // otra clave y la merma se aplicaria dos veces — que es justo el defecto de las
    // cinco pantallas de inventario-real.
    const i = codigo.indexOf('confirmarOperacion()')
    expect(i).toBeGreaterThan(-1)
    // Va despues de la comprobacion de error, no antes.
    const error = codigo.indexOf('if (!invResult.success && !invResult.was_duplicate)')
    expect(error).toBeGreaterThan(-1)
    expect(i).toBeGreaterThan(error)
  })

  it('un error de guardado NO renueva la clave', () => {
    // La rama de error hace `return` antes de llegar a `confirmarOperacion()`.
    const bloqueError = codigo.slice(
      codigo.indexOf('if (!invResult.success && !invResult.was_duplicate)'),
      codigo.indexOf('confirmarOperacion()'))
    expect(bloqueError).toMatch(/return/)
    expect(bloqueError).not.toMatch(/confirmarOperacion\(\)/)
  })
})

describe('lo que no cambio', () => {
  it('sigue pasando por recordMovement, que es el contrato', () => {
    // AGENTS.md: UN solo recordMovement escribe el ledger + descuenta stock + previene
    // underflow + idempotencia, ATOMICO. Esta pagina ya lo respetaba.
    expect(codigo).toMatch(/const \{ recordMovement, confirmarMovimientoInventario \} = await import\('@\/lib\/inventory'\)/)
  })

  it('las cantidades siguen entrando en negativo', () => {
    expect(codigo).toMatch(/quantity: -Math\.abs\(e\.quantity\)/)
  })

  it('un duplicado real sigue tratandose como exito, no como error', () => {
    // `was_duplicate` es la respuesta correcta a un reintento: la operacion ya quedo.
    expect(codigo).toMatch(/!invResult\.success && !invResult\.was_duplicate/)
  })
})

describe('el hook hace lo que esta pagina necesita', () => {
  const hook = readFileSync(join(__dirname, '..', 'lib', 'clave-de-operacion.ts'), 'utf8')

  it('la clave es aleatoria, no derivada del reloj', () => {
    expect(hook).toMatch(/crypto\.randomUUID/)
  })

  it('y el respaldo para navegadores viejos tambien lleva aleatoriedad', () => {
    // Si el respaldo fuera solo `Date.now()`, dos capturas del mismo milisegundo
    // colisionarian — y volveriamos al defecto que se esta arreglando.
    expect(hook).toMatch(/Math\.random\(\)\.toString\(36\)/)
  })
})
