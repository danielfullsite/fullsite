// Regresión: `pos_audit_log.details` es jsonb, y el POS lo guardaba como texto.
//
// Qué pasaba (hasta 2026-08-27): `logAudit` hacía
//
//     details: event.details ? JSON.stringify(event.details) : null
//
// y luego serializaba el body ENTERO otra vez con JSON.stringify. PostgREST recibía
// texto y Postgres guardaba un ESCALAR JSON de tipo string, no un objeto. El log de
// auditoría del POS quedaba inconsultable desde SQL: `details->>'campo'` devolvía
// NULL en todas esas filas.
//
// Medido en producción (amalay, sólo lectura, 2026-08-27): 1,314 de 1,330 filas eran
// escalares string, y la última llevaba fecha de ayer. Las 16 sanas son exactamente
// `item_transferred` y `skimming_suspect` — las dos acciones que escriben las rutas de
// /api/pos, que siempre mandaron el objeto. Un solo escritor culpable: `logAudit`.
//
// LA OTRA MITAD, que es la que muerde: el LECTOR no toleraba el objeto. La pantalla
// /pos/auditoria filtraba con `e.details?.toLowerCase()`, y `?.` sólo protege de null
// — no de que el valor no sea texto. Arreglar el escritor sin arreglar el lector
// habría cambiado un dato invisible por una pantalla de auditoría caída. Por eso los
// dos van en el mismo cambio, y por eso este archivo prueba los dos lados.
//
// NO se migró ningún dato: las 1,314 filas históricas siguen como string.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'
process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'amalay'

import { logAudit, parseAuditDetails, auditDetailsText, type AuditLogEntry } from '@/lib/pos-data'

const DETALLE = { type: 'item_cancelled', item: 'Chilaquiles', motivo: 'cliente cambió', monto: 185 }

/** Intercepta el POST y devuelve el body que saldría por el cable. */
function fetchQueCaptura() {
  const cuerpos: Record<string, unknown>[] = []
  const espia = vi.fn(async (_url: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? '{}')))
    return { ok: true, status: 201, text: async () => '' } as unknown as Response
  })
  vi.stubGlobal('fetch', espia)
  return cuerpos
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('logAudit — el escritor manda details como objeto', () => {

  it('details sale como OBJETO, no como texto', async () => {
    const cuerpos = fetchQueCaptura()
    await logAudit({ action: 'item_cancelled', actor: 'Omar', details: { ...DETALLE } })
    expect(cuerpos).toHaveLength(1)
    expect(typeof cuerpos[0].details).not.toBe('string')
    expect(cuerpos[0].details).toEqual(DETALLE)
  })

  it('el dato queda consultable: details->>' + "'monto'" + ' ya no es NULL', async () => {
    // Se modela la consulta real de Postgres. Sobre un escalar de tipo string, ->>
    // devuelve NULL porque no hay llaves que buscar dentro de un string.
    const flechaTexto = (v: unknown, k: string) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? String((v as Record<string, unknown>)[k] ?? '') || null
        : null
    const cuerpos = fetchQueCaptura()
    await logAudit({ action: 'item_cancelled', actor: 'Omar', details: { ...DETALLE } })
    expect(flechaTexto(cuerpos[0].details, 'monto')).toBe('185')
    // Y así se veía antes, para que quede constancia de por qué era invisible:
    expect(flechaTexto(JSON.stringify(DETALLE), 'monto')).toBeNull()
  })

  it('sin details manda null de JSON, no la cadena "null"', async () => {
    const cuerpos = fetchQueCaptura()
    await logAudit({ action: 'cerrar_app', actor: 'Omar' })
    expect(cuerpos[0].details).toBeNull()
  })

  it('un details vacío se manda como objeto vacío, no como "{}"', async () => {
    const cuerpos = fetchQueCaptura()
    await logAudit({ action: 'status_changed', actor: 'Omar', details: {} })
    expect(cuerpos[0].details).toEqual({})
  })
})

describe('el lector tolera las dos formas', () => {

  const FILA = (details: AuditLogEntry['details']): AuditLogEntry => ({
    id: 1, client_id: 'amalay', order_id: 'A-1', action: 'item_cancelled',
    actor: 'Omar', mesa: 4, details, reason: null, approved_by: null,
    created_at: '2026-08-27T10:00:00Z',
  })

  it('parseAuditDetails devuelve lo mismo venga objeto o texto', () => {
    expect(parseAuditDetails(FILA(DETALLE).details))
      .toEqual(parseAuditDetails(FILA(JSON.stringify(DETALLE)).details))
  })

  it('parseAuditDetails aguanta null y basura sin lanzar', () => {
    expect(parseAuditDetails(null)).toBeNull()
    expect(parseAuditDetails('no soy json')).toBeNull()
    expect(parseAuditDetails('"soy un string json"')).toBeNull()
  })

  it('el filtro de búsqueda encuentra dentro del OBJETO', () => {
    // Éste es el caso que tumbaba la pantalla: `.toLowerCase()` sobre un objeto.
    const texto = auditDetailsText(FILA(DETALLE).details)
    expect(() => texto.toLowerCase()).not.toThrow()
    expect(texto.toLowerCase()).toContain('chilaquiles')
  })

  it('el filtro de búsqueda sigue encontrando dentro del TEXTO histórico', () => {
    const texto = auditDetailsText(FILA(JSON.stringify(DETALLE)).details)
    expect(texto.toLowerCase()).toContain('chilaquiles')
  })

  it('auditDetailsText nunca devuelve undefined', () => {
    // Devolver undefined reintroduce el bug: `undefined.toLowerCase()` lanza igual.
    for (const v of [null, '', {}, DETALLE, 'texto'] as AuditLogEntry['details'][]) {
      expect(typeof auditDetailsText(v)).toBe('string')
    }
  })

  it('viejas y nuevas conviven en la misma lista sin distinguirse', () => {
    // Mientras no se migre nada, una consulta de 200 eventos trae las dos formas.
    const filas = [FILA(DETALLE), FILA(JSON.stringify(DETALLE))]
    const buscadas = filas.filter(f => auditDetailsText(f.details).toLowerCase().includes('chilaquiles'))
    expect(buscadas).toHaveLength(2)
    expect(parseAuditDetails(filas[0].details)).toEqual(parseAuditDetails(filas[1].details))
  })
})
