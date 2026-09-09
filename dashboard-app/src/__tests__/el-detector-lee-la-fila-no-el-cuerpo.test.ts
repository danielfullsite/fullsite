import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// DOS FORMAS DE APAGAR EL DETECTOR DE SKIMMING, LAS DOS POR EL MISMO MOTIVO.
//
// El detector se evaluaba con los insumos que manda el CLIENTE, y quien cobra es quien
// manda el cuerpo. De ahi salian los dos huecos que reporto la caceria del 2026-09-08.
//
// HUECO 1 — omitir `items`. La guarda era
//     if (body.status === 'cerrada' && Array.isArray(body.items) && body.items.length > 0)
// y `Array.isArray(undefined)` es false, asi que el bloque ENTERO no corria: ni un
// console.warn, ni una fila en pos_audit_log. Cero rastro. Y como `r1_save_order` hace
// `items = coalesce(NULL, items)`, los renglones reales se CONSERVAN: la orden queda
// presentable —platillos correctos, mesero correcto, hora correcta— con `total = 1.00`.
//
//     POST /api/pos/save-order   (con el shift token del propio mesero)
//     { order_id, expected_revision, status:'cerrada', total:1,
//       pagos:[{metodo:'Efectivo',monto:1}], turno_id, closed_at }
//
// PAYMENT_MISMATCH pasa (100¢ == 100¢). El arqueo espera $1.00 por esa mesa. Sobre un
// ticket real de $1,339.80, se embolsa $1,338.80. Es estrictamente mejor para quien roba
// que bajar el total con descuento, porque no deja ni la linea de descuentos en el Z.
//
// HUECO 2 — el `descuento` tambien lo pone el cliente, y se restaba ANTES de comparar:
//     const base = sumItems - cents(body.descuento ?? 0)
// Mandar `descuento: 1000` hacia que la aritmetica cuadrara sola. El robo se escondia
// justo en el campo que sirve de excusa.
//
// EL ARREGLO: leer LA FILA YA ESCRITA. Omitir `items` deja de servir —el servidor usa
// los que tiene— y el descuento que se resta es el que quedo escrito, que es el mismo
// que el corte va a cobrar.

const ruta = readFileSync(
  join(__dirname, '..', 'app', 'api', 'pos', 'save-order', 'route.ts'), 'utf8',
)
const codigo = ruta.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('la deteccion ya no depende del cuerpo', () => {
  it('existe la funcion que audita contra la fila', () => {
    expect(codigo).toMatch(/async function auditarCierreContraLaFila/)
  })

  it('HUECO 1 CERRADO: omitir items ya no apaga nada', () => {
    // La guarda vieja miraba el arreglo del cuerpo. Si vuelve, esta prueba se pone roja.
    expect(codigo).not.toMatch(/body\.status === 'cerrada' && Array\.isArray\(body\.items\)/)
    // La condicion se amplio despues a 'dividida' —la orden madre de un split, que es el
    // unico punto donde la suma tiene con que compararse—. Lo que importa aqui es que
    // NADA de lo que decide auditar dependa de `body.items`.
    expect(codigo).toMatch(/if \(body\.status === 'cerrada'( \|\| body\.status === 'dividida')?\) \{/)
  })

  it('HUECO 2 CERRADO: el descuento sale de la fila, no del cuerpo', () => {
    expect(codigo).not.toMatch(/sumItems - cents\(body\.descuento/)
    expect(codigo).toMatch(/const descuento = cents\(fila\.descuento \?\? 0\)/)
  })

  it('los renglones se suman desde la fila', () => {
    expect(codigo).toMatch(/const items = typeof fila\.items === 'string'/)
    expect(codigo).toMatch(/select=items,total,descuento,mesero/)
  })

  it('y el total comparado tambien', () => {
    // Pasó de `const` a `let` cuando se agregó la rama de la orden madre de un split,
    // que compara contra lo que cobraron sus cuentas en vez de contra su propia fila.
    // Lo que se ancla es de DÓNDE sale el valor inicial: de la fila, nunca del cuerpo.
    expect(codigo).toMatch(/(const|let) declaredTotal = cents\(fila\.total \?\? 0\)/)
  })

  it('la lectura es fresca — un cache serviria el estado anterior', () => {
    const i = codigo.indexOf('select=items,total,descuento,mesero')
    expect(codigo.slice(i, i + 260)).toMatch(/cache: 'no-store'/)
  })
})

describe('la sospecha ya no se puede firmar con nombre ajeno', () => {
  it('el actor sale del token, no de body.mesero', () => {
    expect(codigo).not.toMatch(/actor: body\.mesero/)
    expect(codigo).toMatch(/actor: auth\.staffName \|\| auth\.staffId/)
  })

  it('y lo que el cliente afirmo queda marcado como afirmacion', () => {
    expect(codigo).toMatch(/mesero_declarado/)
  })
})

describe('lo que NO se puede romper', () => {
  it('la deteccion NO bloquea el guardado', () => {
    // Un 400 aqui viajaria al replay de la cola offline, donde es TERMINAL: el cobro se
    // perderia para siempre. La funcion no puede rechazar ni lanzar -- se traga todo en
    // su catch y devuelve void.
    const i = codigo.indexOf('async function auditarCierreContraLaFila')
    const cuerpo = codigo.slice(i, codigo.indexOf('export async function POST'))
    expect(cuerpo).toMatch(/catch \{/)
    expect(cuerpo).not.toMatch(/return Response\.json/)
    expect(cuerpo).not.toMatch(/throw /)
    expect(cuerpo).toMatch(/Promise<void>/)
  })

  it('pero SI se espera: en serverless el trabajo posterior a la respuesta se corta', () => {
    // Con `void` la auditoria podria no escribirse nunca -- justo en el caso que
    // interesa. El guardado ya esta commiteado en ese punto, asi que esperar solo
    // cuesta latencia.
    expect(codigo).toMatch(/await auditarCierreContraLaFila\(/)
    expect(codigo).not.toMatch(/void auditarCierreContraLaFila\(/)
  })

  it('sin tasa de IVA resoluble no se audita', () => {
    // Comparar sin la tasa producia el falso positivo de agosto: 15 eventos, todos
    // x1.16 exacto, que taparon el caso real.
    expect(codigo).toMatch(/if \(ivaRate === null\) return/)
  })

  it('una orden cerrada sin renglones no se acusa', () => {
    // No hay contra que comparar. Afirmar un faltante ahi seria inventar.
    expect(codigo).toMatch(/if \(!Array\.isArray\(items\) \|\| items\.length === 0\) return/)
  })

  it('solo se marca la direccion del fraude, con tolerancia de $1', () => {
    expect(codigo).toMatch(/if \(diff <= 100\) return/)
  })

  it('los renglones cancelados siguen sin sumar', () => {
    expect(codigo).toMatch(/\.filter\(it => !it\?\.cancelled\)/)
  })
})
