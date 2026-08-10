// Gate R2-G03 / CLON-MANIFEST — el schema estricto del manifest de cliente
// debe aceptar los manifests reales del repo y rechazar manifests inválidos.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { validateManifest, loadSchema, SCHEMA_PATH } from '../../scripts/manifests/validate_manifest.mjs'

const MANIFESTS_DIR = join(SCHEMA_PATH, '..')
const schema = loadSchema()

function loadManifest(name) {
  return JSON.parse(readFileSync(join(MANIFESTS_DIR, name), 'utf8'))
}

// Manifest mínimo válido — base para los casos negativos
function validBase() {
  return {
    client_id: 'cliente-test',
    display_name: 'Cliente Test',
    type: 'Coffee & Brunch',
    city: 'Monterrey, NL',
    timezone: 'America/Monterrey',
    plan: 'fullsite_software',
    features: { pos: true, inventory: false },
    support_email: 'hola@clientetest.mx',
    staff: [{ name: 'María López', role: 'dueño', email: 'maria@clientetest.mx' }],
  }
}

describe('manifests reales del repo', () => {
  const files = readdirSync(MANIFESTS_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'manifest.schema.json'
  )

  it('existe al menos un manifest de cliente', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} es válido contra el schema`, () => {
      const { valid, errors } = validateManifest(loadManifest(file), schema)
      expect(errors).toEqual([])
      expect(valid).toBe(true)
    })
  }
})

describe('manifest mínimo válido', () => {
  it('pasa la validación', () => {
    const { valid, errors } = validateManifest(validBase(), schema)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('acepta claves de metadata con prefijo _', () => {
    const m = { ...validBase(), _note: 'comentario' }
    expect(validateManifest(m, schema).valid).toBe(true)
  })
})

describe('rechaza manifests inválidos', () => {
  const cases = [
    ['falta client_id', (m) => { delete m.client_id }, /falta campo requerido "client_id"/],
    ['falta features', (m) => { delete m.features }, /falta campo requerido "features"/],
    ['falta support_email', (m) => { delete m.support_email }, /falta campo requerido "support_email"/],
    ['client_id con mayúsculas', (m) => { m.client_id = 'AMALAY' }, /client_id.*patrón/],
    ['client_id con espacios', (m) => { m.client_id = 'mi cliente' }, /client_id.*patrón/],
    ['clave desconocida a nivel raíz', (m) => { m.fetaures = { pos: true } }, /fetaures: clave desconocida/],
    ['plan fuera del enum', (m) => { m.plan = 'plan_pirata' }, /plan.*no está en/],
    ['feature desconocido', (m) => { m.features.superIA = true }, /features\.superIA: clave desconocida/],
    ['feature no booleano', (m) => { m.features.pos = 'yes' }, /features\.pos.*boolean/],
    ['features sin pos', (m) => { m.features = { inventory: true } }, /falta campo requerido "pos"/],
    ['iva_rate como porcentaje', (m) => { m.iva_rate = 16 }, /iva_rate: 16 > maximum 1/],
    ['iva_rate negativo', (m) => { m.iva_rate = -0.1 }, /iva_rate.*minimum/],
    ['mesas no entero', (m) => { m.mesas = 12.5 }, /mesas.*integer/],
    ['mesas negativas', (m) => { m.mesas = -1 }, /mesas.*minimum/],
    ['timezone sin región', (m) => { m.timezone = 'Monterrey' }, /timezone.*patrón/],
    ['data_source fuera del enum', (m) => { m.data_source = 'mysql' }, /data_source.*no está en/],
    ['default_theme fuera del enum', (m) => { m.default_theme = 'blue' }, /default_theme.*no está en/],
    ['rfc malformado', (m) => { m.rfc = 'no-es-rfc' }, /rfc.*patrón/],
    ['support_email sin @', (m) => { m.support_email = 'hola.clientetest.mx' }, /support_email.*patrón/],
    ['staff sin role', (m) => { m.staff = [{ name: 'Ana' }] }, /staff\[0\]: falta campo requerido "role"/],
    ['staff con role fuera del enum', (m) => { m.staff = [{ name: 'Ana', role: 'hacker' }] }, /staff\[0\]\.role.*no está en/],
    ['staff con clave desconocida', (m) => { m.staff = [{ name: 'Ana', role: 'mesero', salario: 100 }] }, /staff\[0\]\.salario: clave desconocida/],
    ['staff como objeto en vez de array', (m) => { m.staff = { name: 'Ana' } }, /staff.*array/],
    ['station_routing sin caja', (m) => {
      m.station_routing = { cocina: ['eggs'], barra: ['coffee'] }
    }, /station_routing: falta campo requerido "caja"/],
    ['station_routing con categoría no-slug', (m) => {
      m.station_routing = { cocina: ['Eggs Benedict'], barra: ['coffee'], caja: ['desserts'] }
    }, /cocina\[0\].*patrón/],
    ['station_routing con estación vacía', (m) => {
      m.station_routing = { cocina: [], barra: ['coffee'], caja: ['desserts'] }
    }, /cocina: 0 items < minItems 1/],
    ['station_routing con categorías duplicadas', (m) => {
      m.station_routing = { cocina: ['eggs', 'eggs'], barra: ['coffee'], caja: ['desserts'] }
    }, /cocina: items duplicados/],
    ['logo_url sin http', (m) => { m.logo_url = 'ftp://logo.png' }, /logo_url.*patrón/],
    ['telegram_chat_id_owner no numérico', (m) => { m.telegram_chat_id_owner = 'abc' }, /telegram_chat_id_owner.*patrón/],
    ['report_recipients como array', (m) => { m.report_recipients = ['a@b.mx'] }, /report_recipients.*object/],
    ['reviews con clave desconocida', (m) => { m.reviews = { rating: 5 } }, /reviews\.rating: clave desconocida/],
    ['manifest no-objeto', () => null, /tipo/],
  ]

  for (const [name, mutate, expectedError] of cases) {
    it(name, () => {
      const m = validBase()
      const mutated = mutate(m)
      const target = mutated === null ? 'no soy un manifest' : m
      const { valid, errors } = validateManifest(target, schema)
      expect(valid).toBe(false)
      expect(errors.join('\n')).toMatch(expectedError)
    })
  }
})

describe('sincronía schema ↔ validador', () => {
  it('el validador rechaza schemas con keywords que no implementa', () => {
    expect(() =>
      validateManifest({ x: 1 }, { type: 'object', properties: { x: { $ref: '#/defs/x' } } })
    ).toThrow(/no soportado/)
  })

  it('el schema declara additionalProperties: false a nivel raíz', () => {
    expect(schema.additionalProperties).toBe(false)
  })

  it('todos los campos requeridos están declarados en properties', () => {
    for (const req of schema.required) {
      expect(schema.properties[req], `required "${req}" sin definición`).toBeDefined()
    }
  })
})
