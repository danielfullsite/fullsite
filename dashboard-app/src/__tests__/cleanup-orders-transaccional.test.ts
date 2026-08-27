// Regresión — el borrado total de órdenes no puede quedar sin registro.
//
// EL DEFECTO ORIGINAL
//
// El 2026-08-25 a las 20:49:03 (Monterrey) un `DELETE` se llevó las órdenes de AMALAY. Con
// todas las protecciones puestas: rol gerente, autorización nominal, el texto literal
// "BORRAR TODAS LAS ORDENES" y un digest contra un respaldo recién bajado.
//
// El problema no fue el borrado. Fue que **no dejó ni una línea**. Sin rastro, el resultado
// era indistinguible de una pérdida de datos: `pos_orders` vacío contra 303 operaciones
// `COMMITTED`. Sólo se reconstruyó leyendo los registros de Supabase, que caducan a las 24 h.
//
// LOS DOS ARREGLOS QUE NO SERVÍAN
//
// 1. Escribir la auditoría DESPUÉS del borrado, con `try/catch`. Reproduce el defecto: si esa
//    escritura falla, el borrado vuelve a ser invisible.
//
// 2. Meter `STARTED`, el `DELETE` y `FAILED` en UNA función de base de datos — o sea, una
//    transacción. Se ve atómico y correcto. **No lo es:** si la transacción aborta, Postgres
//    revierte todo, incluida la fila `STARTED`, y tampoco queda constancia. `FAILED` escrito
//    ahí dentro se revierte por la misma razón.
//
// LO QUE ESTE ARCHIVO FIJA
//
// El protocolo de tres fases, cada una en su propia transacción:
//
//   Fase 1 · r1_cleanup_begin    la intención y el respaldo. Confirma antes de tocar nada.
//   Fase 2 · r1_cleanup_commit   bloquea, valida, borra y deja COMMITTED — atómico.
//   Fase 3 · r1_cleanup_fail     el fracaso, después y aparte. Nunca degrada un COMMITTED.
//
// Estas pruebas cubren la capa web: que llame las fases en orden, que no borre si la fase 1
// no confirmó, y que un corte de red no se reporte a ciegas.
//
// Lo que NO pueden demostrar, porque vive en Postgres: que `STARTED` sobreviva a una
// transacción abortada, la serialización por `FOR UPDATE`, y la restauración. Eso se verificó
// contra las funciones reales en producción (P0–P13 en
// docs/offline/CONTRADICCION-ORDENES-AMALAY-2026-08-26.md), incluida una prueba de bloqueo
// con dos conexiones simultáneas. Un doble simulado de plpgsql no probaría nada sobre plpgsql.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'
const CONFIRMA = 'BORRAR TODAS LAS ORDENES'
const OP = 'op-prueba-0001'

type Llamada = { url: string; method: string; body: Record<string, unknown> | undefined }
type Fila = { state: string; client_id: string; expected_count: number; deleted?: number; sha: string }

let llamadas: Llamada[] = []
let ordenes: Array<{ id: string; total?: number }> = []
let libro: Map<string, Fila>

/** Huella sobre el contenido, no sobre el conteo: cambiar un campo la cambia. */
const sha = (rows: unknown[]) => JSON.stringify(rows)

type Opciones = {
  /** La fase 1 no puede escribir — la auditoría es inaccesible. */
  fase1Http?: number
  /** La conexión muere DESPUÉS de que la fase 2 confirmó. */
  cortarDespuesDelCommit?: boolean
  /** La fase 3 tampoco responde. */
  fase3Http?: number
}

function instalarFetch(opts: Opciones = {}) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    llamadas.push({ url: u, method, body })
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json } as unknown as Response)

    if (u.includes('/rest/v1/pos_cleanup_atoradas')) return ok([])

    if (u.includes('/rest/v1/pos_orders') && method === 'GET') return ok(ordenes)

    // ── Fase 1 ──
    if (u.includes('/rpc/r1_cleanup_begin')) {
      if (opts.fase1Http) {
        return { ok: false, status: opts.fase1Http, text: async () => 'auditoría inaccesible' } as unknown as Response
      }
      const a = body as Record<string, unknown>
      const id = String(a.p_operation_id)
      if (a.p_confirmation !== CONFIRMA) return ok({ ok: false, error: 'CONFIRMACION_INVALIDA' })
      const previa = libro.get(id)
      if (previa) {
        return ok({ ok: previa.state !== 'FAILED', replay: true, state: previa.state, deleted: previa.deleted })
      }
      if (ordenes.length !== a.p_expected_count) {
        return ok({ ok: false, error: 'CONTEO_CAMBIO', expected: a.p_expected_count, current: ordenes.length })
      }
      libro.set(id, {
        state: 'STARTED', client_id: String(a.p_client_id),
        expected_count: Number(a.p_expected_count), sha: sha(ordenes),
      })
      return ok({ ok: true, state: 'STARTED', replay: false, operation_id: id })
    }

    // ── Fase 2 ──
    if (u.includes('/rpc/r1_cleanup_commit')) {
      const a = body as Record<string, unknown>
      const id = String(a.p_operation_id)
      const fila = libro.get(id)
      if (!fila) return ok({ ok: false, error: 'SIN_FASE_1' })
      if (fila.client_id !== a.p_client_id) return ok({ ok: false, error: 'TENANT_NO_COINCIDE' })
      if (fila.state === 'COMMITTED') return ok({ ok: true, replay: true, state: 'COMMITTED', deleted: fila.deleted })
      if (fila.state === 'FAILED') return ok({ ok: false, replay: true, state: 'FAILED' })
      if (sha(ordenes) !== fila.sha) return ok({ ok: false, error: 'DIGEST_NO_COINCIDE' })
      if (ordenes.length !== fila.expected_count) return ok({ ok: false, error: 'CONTEO_CAMBIO' })

      const borradas = ordenes.length
      ordenes = []
      libro.set(id, { ...fila, state: 'COMMITTED', deleted: borradas })
      // La transacción ya cerró. Si la conexión muere aquí, el borrado quedó hecho y
      // registrado; lo único que se perdió es la respuesta.
      if (opts.cortarDespuesDelCommit) throw new Error('socket hang up')
      return ok({ ok: true, replay: false, state: 'COMMITTED', deleted: borradas })
    }

    // ── Fase 3 ──
    if (u.includes('/rpc/r1_cleanup_fail')) {
      if (opts.fase3Http) {
        return { ok: false, status: opts.fase3Http, text: async () => 'sin fase 3' } as unknown as Response
      }
      const a = body as Record<string, unknown>
      const fila = libro.get(String(a.p_operation_id))
      if (!fila) return ok({ ok: false, error: 'OPERACION_NO_ENCONTRADA' })
      // Un COMMITTED no se degrada. Su respuesta ES el veredicto sobre un corte ambiguo.
      if (fila.state === 'COMMITTED') {
        return ok({ ok: false, error: 'YA_ESTABA_COMMITTED', state: 'COMMITTED', deleted: fila.deleted })
      }
      libro.set(String(a.p_operation_id), { ...fila, state: 'FAILED' })
      return ok({ ok: true, state: 'FAILED' })
    }

    return ok({})
  })
}

let identidad: { clientId: string; staffId: string; staffName: string; role: string } | null = null
vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return { ...real, withPOSAuth: async () => identidad }
})

const fases = () =>
  llamadas.filter(c => c.url.includes('/rpc/r1_cleanup_'))
    .map(c => c.url.split('/rpc/')[1])

const borradosDirectos = () =>
  llamadas.filter(c => c.url.includes('/rest/v1/pos_orders') && c.method === 'DELETE')

function pedir(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as import('next/server').NextRequest
}

async function digestDe(rows: unknown[]) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

const cuerpo = async (extra: Record<string, unknown> = {}) => ({
  confirm: CONFIRMA, digest: await digestDe(ordenes), operation_id: OP, ...extra,
})

beforeEach(() => {
  vi.resetModules()
  llamadas = []
  libro = new Map()
  ordenes = [{ id: 'ord-1' }, { id: 'ord-2' }, { id: 'ord-3' }]
  identidad = { clientId: 'amalay', staffId: 'staff-daniel', staffName: 'Daniel', role: 'gerente' }
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  delete process.env.POS_ORDER_CLEANUP_STAFF_IDS
  instalarFetch()
})

describe('el borrado total pasa por el protocolo de tres fases', () => {
  it('EL BUG: la ruta no borra por su cuenta — pasa por begin y luego commit', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir(await cuerpo()))

    expect(res.status).toBe(200)
    expect(fases(), 'la intención debe registrarse ANTES del efecto')
      .toEqual(['r1_cleanup_begin', 'r1_cleanup_commit'])
    expect(borradosDirectos(), 'un DELETE directo no puede ser atómico con su registro').toHaveLength(0)
    expect(await res.json()).toMatchObject({ ok: true, state: 'COMMITTED', deleted: 3 })
  })

  it('AUDITORÍA INACCESIBLE: si la fase 1 no puede escribir, NO se borra', async () => {
    // La propiedad central del rediseño, y la inversión exacta del diseño best-effort:
    // ahí el borrado iba primero y la constancia era una esperanza. Aquí es un requisito.
    instalarFetch({ fase1Http: 503 })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir(await cuerpo()))

    expect(res.status).toBe(500)
    expect(fases(), 'nunca debe llegar a la fase 2').not.toContain('r1_cleanup_commit')
    expect(ordenes, 'nada se borró').toHaveLength(3)
    // Sí llama la fase 3, y está bien: si la fase 1 alcanzó a escribir la fila y murió al
    // devolver la respuesta, esto cierra ese STARTED huérfano. Si no la escribió, la fase 3
    // responde OPERACION_NO_ENCONTRADA y no pasa nada.
    expect(fases()).toEqual(['r1_cleanup_begin', 'r1_cleanup_fail'])
  })

  it('la fase 1 lleva quién, cuántas, contra qué, y de dónde vino la petición', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    await DELETE(pedir(await cuerpo({ reason: 'órdenes de prueba' }), {
      'x-vercel-id': 'iad1::abc123', 'x-vercel-deployment-url': 'dpl-xyz.vercel.app',
    }))

    const begin = llamadas.find(c => c.url.includes('r1_cleanup_begin'))!.body!
    expect(begin).toMatchObject({
      p_client_id: 'amalay', p_operation_id: OP, p_actor: 'Daniel',
      p_staff_id: 'staff-daniel', p_role: 'gerente',
      p_confirmation: CONFIRMA, p_expected_count: 3, p_reason: 'órdenes de prueba',
    })
    // El identificador de petición es lo que faltó para correlacionar el incidente real.
    expect(begin.p_request_metadata).toMatchObject({
      request_id: 'iad1::abc123', deployment: 'dpl-xyz.vercel.app',
    })
  })

  it('la metadata NO lleva credenciales', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    await DELETE(pedir(await cuerpo(), {
      'x-vercel-id': 'iad1::abc', authorization: 'Bearer TOKEN_SECRETO', cookie: 'sesion=SECRETO',
    }))

    const meta = JSON.stringify(llamadas.find(c => c.url.includes('r1_cleanup_begin'))!.body!.p_request_metadata)
    expect(meta, 'un libro que guarda credenciales convierte cada lectura en una fuga')
      .not.toMatch(/TOKEN_SECRETO|SECRETO|Bearer/)
  })

  it('TIMEOUT DESPUÉS DEL COMMIT: la fase 3 da el veredicto, no se adivina', async () => {
    // El caso feo: la transacción cerró, el borrado y su constancia quedaron, y la respuesta
    // nunca llegó. La fase 3 se niega a degradar un COMMITTED, así que su respuesta resuelve
    // la ambigüedad sin que el cliente tenga que suponer nada.
    instalarFetch({ cortarDespuesDelCommit: true })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir(await cuerpo()))

    expect(fases()).toEqual(['r1_cleanup_begin', 'r1_cleanup_commit', 'r1_cleanup_fail'])
    expect(res.status, 'reportar error haría que el operador lo repita').toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, state: 'COMMITTED', deleted: 3, replay: true })
    expect(libro.get(OP)!.state, 'la fase 3 no degradó el COMMITTED').toBe('COMMITTED')
  })

  it('DOBLE CLIC: la segunda petición no vuelve a borrar', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')
    const primera = await DELETE(pedir(await cuerpo()))
    expect(await primera.json()).toMatchObject({ deleted: 3, replay: false })

    // El operador vuelve a hacer clic con la pantalla vieja: mismo digest, misma llave.
    const segunda = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe([{ id: 'ord-1' }, { id: 'ord-2' }, { id: 'ord-3' }]), operation_id: OP }))

    // El digest ya no coincide —la tabla quedó vacía—, así que ni siquiera llega a la fase 1.
    expect(segunda.status).toBe(409)
    expect(fases().filter(f => f === 'r1_cleanup_commit')).toHaveLength(1)
  })

  it('REPLAY: reintentar la misma llave sobre una tabla ya vacía devuelve el resultado anterior', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')
    await DELETE(pedir(await cuerpo()))
    llamadas = []

    // Reintento honesto: el cliente vuelve a leer (ya no hay órdenes) y usa la misma llave.
    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe([]), operation_id: OP }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, replay: true, state: 'COMMITTED', deleted: 3 })
  })

  it('DIGEST VIEJO: si las órdenes cambiaron desde el respaldo, se aborta antes de la fase 1', async () => {
    const dig = await digestDe(ordenes)
    ordenes = [...ordenes, { id: 'ord-4-llegó-después' }]
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))

    expect(res.status).toBe(409)
    expect(fases()).toHaveLength(0)
  })

  it('CONTEO CAMBIADO entre la fase 1 y la fase 2: no se borra, y queda FAILED', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')
    const body = await cuerpo()
    // La fase 1 corre con 3; una orden entra antes de la fase 2.
    const originalFetch = globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const r = await originalFetch(url, init)
      if (String(url).includes('r1_cleanup_begin')) ordenes = [...ordenes, { id: 'ord-4-a-media-operación' }]
      return r
    })

    const res = await DELETE(pedir(body))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'DIGEST_NO_COINCIDE' })
    expect(ordenes, 'no se borró ninguna').toHaveLength(4)
    expect(libro.get(OP)!.state, 'la fase 3 dejó constancia del rechazo').toBe('FAILED')
  })

  it('TENANT CRUZADO: otro restaurante no puede ejecutarlo — ni siquiera un gerente', async () => {
    identidad = { clientId: 'boruca', staffId: 's1', staffName: 'Daniel', role: 'gerente' }
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: 'x', operation_id: OP }))

    expect(res.status).toBe(403)
    expect(llamadas, 'ni siquiera debe leer las órdenes del otro tenant').toHaveLength(0)
  })

  it('sin operation_id no se borra: se rechaza antes de cualquier fase', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe(ordenes) }))

    expect(res.status).toBe(400)
    expect(fases()).toHaveLength(0)
  })

  it('sin la confirmación literal no se borra', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'sí bórralo', digest: await digestDe(ordenes), operation_id: OP }))

    expect(res.status).toBe(400)
    expect(fases()).toHaveLength(0)
  })

  it('si la fase 3 tampoco responde, queda un STARTED — que es el punto', async () => {
    // Es el peor caso posible, y aun así deja rastro: la operación se queda en STARTED y la
    // vista de atoradas la delata. Silencio total ya no es un resultado alcanzable.
    instalarFetch({ cortarDespuesDelCommit: true, fase3Http: 503 })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir(await cuerpo()))

    expect(res.status).toBe(500)
    expect(libro.get(OP), 'hay constancia de que se intentó').toBeDefined()
  })

  it('el GET avisa de operaciones atoradas antes de que el operador lance otra', async () => {
    const { GET } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await GET(pedir({}))

    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('operaciones_atoradas')
    expect(llamadas.some(c => c.url.includes('pos_cleanup_atoradas'))).toBe(true)
  })
})
