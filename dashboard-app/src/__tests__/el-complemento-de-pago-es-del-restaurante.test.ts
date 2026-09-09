import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA RUTA QUE SE QUEDO FUERA DEL BARRIDO DE FUGAS DEL 2026-08-30.
//
// Su hermana `factura/timbrar` lleva desde entonces `withPOSAuth` y un comentario que
// explica por que: resolvia el tenant con `client_users limit=1` SIN order, y para un
// usuario con varias membresias Postgres devolvia una fila arbitraria -- se timbraba un
// CFDI, que es una escritura fiscal IRREVERSIBLE ante el SAT, contra el restaurante
// equivocado. Daniel tiene ocho membresias.
//
// `factura/complemento-pago` hace lo mismo --timbra un complemento de pago, tambien
// irreversible-- y seguia con `requireAuth`, que SOLO comprueba que hay una sesion:
//
//     export async function requireAuth(request) {
//       const userId = await getSessionUserId(request)
//       if (!userId) return 401
//       return null            // <- ni tenant, ni rol, ni nada mas
//     }
//
// Sin tenant y sin ninguna comprobacion sobre el UUID recibido, cualquier usuario
// autenticado de cualquier restaurante podia timbrar un complemento contra cualquier
// CFDI, con el RFC y el monto que quisiera, usando las credenciales del PAC de la
// empresa. Hoy ningun cliente de la app la llama: el defecto era alcanzable, no
// explotado.

const src = readFileSync(join(__dirname, '..', 'app', 'api', 'factura',
  'complemento-pago', 'route.ts'), 'utf8')
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el tenant sale del servidor, como en timbrar', () => {
  it('usa withPOSAuth', () => {
    expect(codigo).toMatch(/const auth = await withPOSAuth\(request\)/)
    expect(codigo).toMatch(/if \(!auth\) return unauthorized\(\)/)
  })

  it('y ya NO usa requireAuth, que solo mira que haya sesion', () => {
    expect(codigo).not.toMatch(/requireAuth/)
  })

  it('el clientId viene del token, nunca del cuerpo', () => {
    expect(codigo).toMatch(/const clientId = auth\.clientId/)
    expect(codigo).not.toMatch(/body\.client_id|body\.clientId/)
  })
})

describe('el CFDI original tiene que ser de este restaurante', () => {
  it('se busca por folio_fiscal ACOTADO por client_id', () => {
    // Sin el filtro de tenant, el token no restringiria nada: el UUID lo pone el
    // cuerpo de la peticion.
    const i = codigo.indexOf('pos_cfdi_requests')
    expect(i).toBeGreaterThan(-1)
    const consulta = codigo.slice(i, i + 400)
    expect(consulta).toMatch(/folio_fiscal=eq\.\$\{encodeURIComponent\(body\.relatedUuid\)\}/)
    expect(consulta).toMatch(/client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/)
  })

  it('si no aparece, NO se timbra', () => {
    expect(codigo).toMatch(/if \(!original\)/)
    expect(codigo).toMatch(/CFDI original no encontrado/)
  })

  it('el mensaje no revela si existe en otro restaurante', () => {
    // Una respuesta distinta para "no existe" y "existe pero no es tuyo" convierte la
    // ruta en un oraculo de UUIDs ajenos.
    const cuerpo = codigo.slice(codigo.indexOf('if (!original)'), codigo.indexOf('if (!original)') + 300)
    expect(cuerpo).not.toMatch(/otro (restaurante|tenant|cliente)/i)
  })

  it('un fallo al verificar tampoco timbra', () => {
    // Fail-closed: si la comprobacion no se pudo hacer, no se asume que paso.
    const i = codigo.indexOf('if (!res.ok)')
    expect(i).toBeGreaterThan(-1)
    expect(codigo.slice(i, i + 220)).toMatch(/No se pudo verificar el CFDI original/)
  })

  it('la verificacion ocurre ANTES de timbrar', () => {
    // Timbrar y despues comprobar seria inutil: el CFDI ya existe ante el SAT.
    expect(codigo.indexOf('pos_cfdi_requests'))
      .toBeLessThan(codigo.indexOf('await stampPaymentComplement'))
  })
})

describe('el complemento tiene que cuadrar con lo que dice complementar', () => {
  it('el RFC del receptor debe coincidir con el del CFDI original', () => {
    expect(codigo).toMatch(/original\.rfc \|\| ''\)\.toUpperCase\(\) !== String\(body\.receiverRfc\)\.toUpperCase\(\)/)
  })

  it('el monto no puede exceder el total de la factura', () => {
    expect(codigo).toMatch(/body\.amount > totalOriginal/)
  })

  it('un total ausente o cero NO bloquea el timbrado', () => {
    // No hay tabla con el saldo acumulado de parcialidades. Se comprueba lo que se
    // puede comprobar y no se inventa una regla de negocio que rechace pagos validos.
    expect(codigo).toMatch(/Number\.isFinite\(totalOriginal\) && totalOriginal > 0/)
  })
})

describe('las validaciones que ya estaban siguen', () => {
  it.each([
    ['relatedUuid', /Falta UUID del CFDI original/],
    ['receiverRfc', /Falta RFC del receptor/],
    ['amount', /Monto inválido/],
    ['paymentForm', /Falta forma de pago/],
    ['paymentDate', /Falta fecha de pago/],
  ])('sigue exigiendo %s', (_campo, mensaje) => {
    expect(codigo).toMatch(mensaje)
  })
})

describe('la ruta hermana sigue como estaba', () => {
  it('timbrar conserva su withPOSAuth y su filtro de tenant', () => {
    const timbrar = readFileSync(join(__dirname, '..', 'app', 'api', 'factura',
      'timbrar', 'route.ts'), 'utf8')
    expect(timbrar).toMatch(/await withPOSAuth\(req\)/)
    expect(timbrar).toMatch(/client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/)
  })
})
