/**
 * F0 de `docs/security/PLAN-PIN-HASH.md` — la regla de cómo se guarda un PIN.
 *
 * Lo que estas pruebas tienen que demostrar, en orden de importancia:
 *
 *   1. **Falla CERRADO.** Sin pimienta lanza, y nunca devuelve algo parecido al PIN. Un
 *      fallback aquí convertiría un despliegue mal configurado en una fuga silenciosa.
 *   2. **El error habla el idioma de Pedro.** `authority_unavailable` / 503. Si viajara como
 *      401, Pedro BORRARÍA la credencial preparada de esa persona
 *      (`actor-authority.js:170`) y la dejaría sin entrar y sin respaldo, por una variable
 *      de entorno faltante.
 *   3. **Separa tenants.** El mismo PIN en dos restaurantes no puede dar el mismo hash, o un
 *      dump permite correlacionar personas entre clientes.
 *   4. **Es determinista.** Sin eso la búsqueda por índice no funciona y no hay login.
 *
 * Nota sobre el alcance: esto prueba la REGLA, no la migración. Que el backfill de F3 use la
 * misma pimienta que la lectura de F4 no se prueba aquí — se prueba re-derivando cada fila
 * contra la base, y está escrito como verificación 2 de F3 en el plan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hashPinParaBD,
  esPimientaNoConfigurada,
  PimientaNoConfigurada,
  HTTP_AUTORIDAD_NO_DISPONIBLE,
  VERSION_DE_PIMIENTA,
  _olvidarLlavesMemoizadas,
} from '@/lib/pos-pin-hash'

// Dos pimientas de prueba. No son secretos: nunca tocan una base ni un despliegue.
const PIMIENTA_A = 'a'.repeat(64)
const PIMIENTA_B = 'b'.repeat(64)

const original = process.env.POS_PIN_PEPPER

function ponerPimienta(valor?: string) {
  if (valor === undefined) delete process.env.POS_PIN_PEPPER
  else process.env.POS_PIN_PEPPER = valor
  _olvidarLlavesMemoizadas()
}

beforeEach(() => ponerPimienta(PIMIENTA_A))
afterEach(() => ponerPimienta(original))

describe('falla cerrado — sin pimienta no se hashea nada', () => {
  it('sin la variable, LANZA', async () => {
    ponerPimienta(undefined)
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(PimientaNoConfigurada)
  })

  it('con la variable vacía, LANZA', async () => {
    ponerPimienta('')
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(PimientaNoConfigurada)
  })

  it('con una pimienta de relleno corta, LANZA — no debilita en silencio', async () => {
    ponerPimienta('cambiame')
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(PimientaNoConfigurada)
  })

  it('con algo que no es hex, LANZA', async () => {
    ponerPimienta('z'.repeat(64))
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(PimientaNoConfigurada)
  })

  it('NUNCA hay un camino de regreso al texto plano', async () => {
    ponerPimienta(undefined)
    // Si algún día alguien "arregla" esto devolviendo el PIN cuando falta la pimienta, la
    // fuga sería total y silenciosa. Que tenga que borrar esta prueba para hacerlo.
    const resultado = await hashPinParaBD('amalay', '1234').catch(e => e)
    expect(resultado).toBeInstanceOf(Error)
    expect(String(resultado)).not.toContain('1234')
  })

  it('el mensaje dice cómo generar una, sin exponer ninguna', async () => {
    ponerPimienta(undefined)
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(/POS_PIN_PEPPER/)
    await expect(hashPinParaBD('amalay', '1234')).rejects.toThrow(/openssl rand -hex 32/)
  })
})

describe('el error habla el idioma de Pedro', () => {
  it('trae code authority_unavailable, no un 401 disfrazado', async () => {
    ponerPimienta(undefined)
    const e = await hashPinParaBD('amalay', '1234').catch(err => err)
    expect(esPimientaNoConfigurada(e)).toBe(true)
    expect((e as PimientaNoConfigurada).code).toBe('authority_unavailable')
  })

  it('el contrato HTTP es 503 — un 401 le borraría la credencial preparada a la persona', () => {
    expect(HTTP_AUTORIDAD_NO_DISPONIBLE.status).toBe(503)
    expect(HTTP_AUTORIDAD_NO_DISPONIBLE.code).toBe('authority_unavailable')
    // Los tres que Pedro lee como veredicto sobre el PIN (actor-authority.js:165).
    expect([400, 401, 403]).not.toContain(HTTP_AUTORIDAD_NO_DISPONIBLE.status)
  })

  it('el guardia no confunde cualquier Error con falta de pimienta', () => {
    expect(esPimientaNoConfigurada(new Error('otra cosa'))).toBe(false)
    expect(esPimientaNoConfigurada(null)).toBe(false)
    expect(esPimientaNoConfigurada('authority_unavailable')).toBe(false)
  })
})

describe('separación entre restaurantes', () => {
  it('el MISMO PIN en dos tenants da hashes distintos', async () => {
    const enAmalay = await hashPinParaBD('amalay', '1234')
    const enBoruca = await hashPinParaBD('boruca', '1234')
    expect(enAmalay).not.toBe(enBoruca)
  })

  it('un dump no permite correlacionar personas entre clientes', async () => {
    // Cuatro personas, dos restaurantes, dos PIN repetidos entre ellos: los cuatro hashes
    // tienen que ser distintos entre sí.
    const hashes = await Promise.all([
      hashPinParaBD('amalay', '1234'), hashPinParaBD('amalay', '5678'),
      hashPinParaBD('boruca', '1234'), hashPinParaBD('boruca', '5678'),
    ])
    expect(new Set(hashes).size).toBe(4)
  })

  it('dos PIN distintos del mismo tenant dan hashes distintos', async () => {
    expect(await hashPinParaBD('amalay', '1234')).not.toBe(await hashPinParaBD('amalay', '1235'))
  })
})

describe('determinismo — sin esto no hay búsqueda por índice ni login', () => {
  it('la misma entrada da siempre el mismo hash', async () => {
    const a = await hashPinParaBD('amalay', '1234')
    _olvidarLlavesMemoizadas()   // también a través de un arranque en frío
    expect(await hashPinParaBD('amalay', '1234')).toBe(a)
  })

  it('cambiar la pimienta cambia todos los hashes — por eso rotarla obliga a re-hashear', async () => {
    const conA = await hashPinParaBD('amalay', '1234')
    ponerPimienta(PIMIENTA_B)
    expect(await hashPinParaBD('amalay', '1234')).not.toBe(conA)
  })
})

describe('forma del hash — tiene que caber en la columna y en su CHECK', () => {
  it('son 64 caracteres hex en minúsculas', async () => {
    expect(await hashPinParaBD('amalay', '1234')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un PIN de 10 dígitos da la misma forma que uno de 4', async () => {
    expect(await hashPinParaBD('amalay', '1234567890')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('la versión que se escribe hoy es 1', () => {
    expect(VERSION_DE_PIMIENTA).toBe(1)
  })
})

describe('validación de entrada — el formato de la base, no uno inventado', () => {
  it('acepta de 4 a 10 dígitos, igual que pos_staff_pin_len_chk', async () => {
    for (const pin of ['1234', '12345', '1234567890']) {
      await expect(hashPinParaBD('amalay', pin)).resolves.toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('rechaza PIN fuera de ese rango o con basura', async () => {
    for (const pin of ['123', '12345678901', '12a4', '', '  1234  ']) {
      await expect(hashPinParaBD('amalay', pin), `pin ${JSON.stringify(pin)}`).rejects.toThrow(/PIN inválido/)
    }
  })

  it('rechaza un client_id que no es el formato que valida /api/pos/pin', async () => {
    for (const cid of ['', 'con espacio', 'con:dospuntos', 'x'.repeat(41)]) {
      await expect(hashPinParaBD(cid, '1234'), `cid ${JSON.stringify(cid)}`).rejects.toThrow(/client_id inválido/)
    }
  })

  it('el separador no es ambiguo: ningún client_id válido puede traer dos puntos', async () => {
    // Sin esta guarda, un tenant llamado `a:1` con PIN `2345` colisionaría con el tenant `a`
    // y PIN... imposible de formar, pero la ambigüedad no se razona: se prohíbe.
    await expect(hashPinParaBD('a:1', '2345')).rejects.toThrow(/client_id inválido/)
  })
})

describe('qué NO resuelve este módulo — que quede escrito, no supuesto', () => {
  it('el espacio de 4 dígitos sigue siendo 10,000: hashear no lo agranda', async () => {
    const todos = new Set<string>()
    for (let i = 0; i < 200; i++) {
      todos.add(await hashPinParaBD('amalay', String(i).padStart(4, '0')))
    }
    // 200 PIN distintos → 200 hashes distintos. Con la pimienta en la mano, recorrer los
    // 10,000 es igual de barato. La defensa contra adivinar es pin-throttle.ts, no esto.
    expect(todos.size).toBe(200)
  })
})
