import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ninguna consulta del chat puede leer datos sin filtrar por cliente.
 *
 * El chat consulta Supabase con SUPABASE_SERVICE_KEY, que se salta RLS por
 * diseño. Eso significa que el filtro por tenant tiene que estar en la URL: si
 * falta, la consulta devuelve los datos de TODOS los restaurantes.
 *
 * Pasó de verdad. Medido en producción el 2026-08-28: `pos_recipes` y
 * `pos_insumos` se consultaban sin `client_id`, y la de recetas devolvía
 * 110 filas de amalay + 10 de diezmex-demo a quien preguntara. Un prospecto en
 * una demo podía ver los costos y proveedores reales de otro restaurante.
 *
 * Esta prueba lee el código fuente en vez de ejecutar la ruta. Es a propósito:
 * así cubre también las consultas que alguien agregue mañana, que es donde
 * volvería a aparecer el problema.
 */

const RUTA = join(process.cwd(), 'src/app/api/chat/route.ts')
const FUENTE = readFileSync(RUTA, 'utf8')

/** Tablas que NO llevan client_id por diseño, con la razón. */
const SIN_TENANT_JUSTIFICADO: Record<string, string> = {
  // Tabla histórica de Wansoft sin columna de cliente. La protege
  // esDuenoDelHistoricoWansoft(), que pregunta por propiedad y falla cerrado.
  wansoft_waiter_categories: 'protegida por esDuenoDelHistoricoWansoft()',
  wansoft_food_cost: 'histórico legacy sin columna de cliente',
}

/** Extrae cada `/rest/v1/<tabla>?<query>` que aparece en el archivo. */
function consultasDelChat(): { tabla: string; query: string }[] {
  const encontradas: { tabla: string; query: string }[] = []
  const re = /\/rest\/v1\/([a-z_]+)\?([^`'"]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(FUENTE)) !== null) {
    encontradas.push({ tabla: m[1], query: m[2] })
  }
  return encontradas
}

describe('el chat nunca lee datos de otro restaurante', () => {
  const consultas = consultasDelChat()

  it('encuentra consultas que revisar (si no, la prueba no está probando nada)', () => {
    expect(consultas.length).toBeGreaterThan(5)
  })

  it('toda consulta filtra por cliente, salvo las justificadas', () => {
    const culpables = consultas.filter(c => {
      if (c.tabla in SIN_TENANT_JUSTIFICADO) return false
      // client_id o client_slug: distintas tablas usan distinto nombre.
      return !/client_id=eq\.|client_slug=eq\./.test(c.query)
    })

    expect(
      culpables.map(c => c.tabla),
      'estas consultas usan la service key SIN filtro de cliente: devuelven ' +
      'los datos de todos los restaurantes. Agrega client_id=eq.${client_id} ' +
      'o justifícalas en SIN_TENANT_JUSTIFICADO con la razón.',
    ).toEqual([])
  })

  it('pos_recipes filtra por cliente', () => {
    const receta = consultas.find(c => c.tabla === 'pos_recipes')
    expect(receta, 'el chat debe consultar pos_recipes').toBeDefined()
    expect(receta!.query).toContain('client_id=eq.')
  })

  it('pos_insumos filtra por cliente', () => {
    const insumo = consultas.find(c => c.tabla === 'pos_insumos')
    expect(insumo, 'el chat debe consultar pos_insumos').toBeDefined()
    expect(insumo!.query).toContain('client_id=eq.')
  })

  it('las excepciones están justificadas por escrito, no sólo listadas', () => {
    for (const [tabla, razon] of Object.entries(SIN_TENANT_JUSTIFICADO)) {
      expect(razon.length, `${tabla} necesita una razón real`).toBeGreaterThan(20)
    }
  })
})

describe('el chat conoce las sucursales del cliente', () => {
  const consultas = consultasDelChat()

  it('consulta client_locations', () => {
    const loc = consultas.find(c => c.tabla === 'client_locations')
    expect(loc, 'sin esto el chat responde "dime cuáles son tus sucursales"').toBeDefined()
    expect(loc!.query).toContain('client_id=eq.')
  })

  it('inyecta el contexto de sucursales al prompt', () => {
    expect(FUENTE).toContain('${sucursalesContext}')
  })

  it('convierte el total a número — PostgREST devuelve numeric como string', () => {
    // Sin Number(), sumar totales concatena texto y el comparativo da basura.
    expect(FUENTE).toMatch(/Number\(o\.total\)/)
  })
})
