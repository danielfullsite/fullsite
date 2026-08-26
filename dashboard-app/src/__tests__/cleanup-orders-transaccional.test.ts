// Regresión — el borrado total de órdenes no puede quedar sin registro.
//
// EL DEFECTO ORIGINAL
//
// El 2026-08-25 a las 20:49:03 (Monterrey) esta ruta borró las órdenes de AMALAY. La acción
// fue legítima: exige rol gerente, autorización nominal, el texto literal "BORRAR TODAS LAS
// ORDENES" y un digest que coincida con un respaldo recién bajado.
//
// El problema no fue el borrado. Fue que **no dejó ni una línea**. Sin rastro, el resultado
// era indistinguible de una pérdida de datos: `pos_orders` vacío contra 303 operaciones
// `COMMITTED` en `pos_save_operations`. Sólo se reconstruyó leyendo los registros de
// Supabase, que caducan a las 24 horas.
//
// EL PRIMER ARREGLO, QUE NO SERVÍA
//
// Escribir la auditoría DESPUÉS del borrado, con `try/catch`. Reproduce el defecto exacto:
// si esa escritura falla, el borrado vuelve a ser invisible. Un registro *best-effort* de
// una acción destructiva no es un registro.
//
// LO QUE ESTE ARCHIVO FIJA
//
// La ruta ya no borra. Delega en `r1_cleanup_orders`, donde el borrado y su constancia
// ocurren en la misma transacción de Postgres. Estas pruebas cubren la capa web —
// que llame al RPC con los datos correctos, que exija la llave de idempotencia, y que un
// reintento no borre dos veces.
//
// Lo que estas pruebas NO pueden demostrar, porque vive en la base: la atomicidad real y la
// restauración desde el respaldo. Eso se verificó contra la función real en producción
// (P1–P6, ver docs/offline/CONTRADICCION-ORDENES-AMALAY-2026-08-26.md). Un doble simulado
// de plpgsql no probaría nada sobre plpgsql.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

type Llamada = { url: string; method: string; body: Record<string, unknown> | undefined }
let llamadas: Llamada[] = []
let ordenesEnBd: Array<{ id: string }> = []

/** Libro de operaciones, del lado del doble. Sobrevive entre peticiones de una misma prueba. */
let libro: Map<string, { state: string; deleted: number }>

type Opciones = {
  /** El RPC responde HTTP no-2xx (la base caída, PostgREST reventado). */
  rpcHttp?: number
  /** La petición se corta después de que la transacción ya hizo COMMIT. */
  cortarDespuesDeCommit?: boolean
}

function instalarFetch(opts: Opciones = {}) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    llamadas.push({ url: u, method, body })

    if (u.includes('/rest/v1/pos_orders') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ordenesEnBd } as unknown as Response
    }

    if (u.includes('/rest/v1/rpc/r1_cleanup_orders')) {
      if (opts.rpcHttp) {
        return { ok: false, status: opts.rpcHttp, text: async () => 'error simulado' } as unknown as Response
      }
      const a = body as Record<string, unknown>
      const opId = String(a.p_operation_id)

      // Reintento: mismo resultado, sin volver a borrar.
      const previa = libro.get(opId)
      if (previa) {
        return { ok: true, status: 200, json: async () => ({
          ok: previa.state === 'COMMITTED', replay: true, state: previa.state,
          deleted: previa.deleted, operation_id: opId,
        }) } as unknown as Response
      }

      // Control de concurrencia: el conteo dentro de la transacción manda.
      if (ordenesEnBd.length !== a.p_expected_count) {
        libro.set(opId, { state: 'FAILED', deleted: 0 })
        return { ok: true, status: 200, json: async () => ({
          ok: false, state: 'FAILED', error: 'CONTEO_CAMBIO',
          expected: a.p_expected_count, current: ordenesEnBd.length, operation_id: opId,
        }) } as unknown as Response
      }

      const borradas = ordenesEnBd.length
      ordenesEnBd = []
      libro.set(opId, { state: 'COMMITTED', deleted: borradas })

      // La transacción ya cerró. Si la conexión muere aquí, el borrado quedó hecho y
      // registrado; lo único que se perdió es la respuesta.
      if (opts.cortarDespuesDeCommit) throw new Error('socket hang up')

      return { ok: true, status: 200, json: async () => ({
        ok: true, state: 'COMMITTED', deleted: borradas, replay: false, operation_id: opId,
      }) } as unknown as Response
    }

    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  })
}

let identidad: { clientId: string; staffId: string; staffName: string; role: string } | null = null
vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return { ...real, withPOSAuth: async () => identidad }
})

const rpcs = () =>
  llamadas.filter(c => c.url.includes('/rpc/r1_cleanup_orders'))
    .map(c => c.body as Record<string, unknown>)

const borradosDirectos = () =>
  llamadas.filter(c => c.url.includes('/rest/v1/pos_orders') && c.method === 'DELETE')

function pedir(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

/** El digest que la ruta calcula sobre las órdenes leídas. */
async function digestDe(ordenes: unknown[]) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(JSON.stringify(ordenes)).digest('hex')
}

const OP = 'op-prueba-0001'
const CONFIRMA = 'BORRAR TODAS LAS ORDENES'

beforeEach(() => {
  vi.resetModules()
  llamadas = []
  libro = new Map()
  ordenesEnBd = [{ id: 'ord-1' }, { id: 'ord-2' }, { id: 'ord-3' }]
  identidad = { clientId: 'amalay', staffId: 'staff-daniel', staffName: 'Daniel', role: 'gerente' }
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  delete process.env.POS_ORDER_CLEANUP_STAFF_IDS
  instalarFetch()
})

describe('el borrado total pasa por la operación transaccional', () => {
  it('EL BUG: la ruta no borra por su cuenta — delega en r1_cleanup_orders', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe(ordenesEnBd), operation_id: OP }))

    expect(res.status).toBe(200)
    expect(rpcs(), 'sin el RPC, borrado y registro vuelven a poder separarse').toHaveLength(1)
    expect(borradosDirectos(), 'un DELETE directo a pos_orders no puede ser atómico con su registro')
      .toHaveLength(0)
    expect(await res.json()).toMatchObject({ ok: true, state: 'COMMITTED', deleted: 3 })
  })

  it('la operación lleva quién, cuántas, contra qué respaldo y con qué llave', async () => {
    const dig = await digestDe(ordenesEnBd)
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP, reason: 'órdenes de prueba' }))

    expect(rpcs()[0]).toMatchObject({
      p_client_id: 'amalay',
      p_operation_id: OP,
      p_actor: 'Daniel',
      p_staff_id: 'staff-daniel',
      p_role: 'gerente',
      p_backup_digest: dig,
      p_expected_count: 3,
      p_reason: 'órdenes de prueba',
    })
  })

  it('sin operation_id no se borra: la petición se rechaza antes del RPC', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe(ordenesEnBd) }))

    expect(res.status).toBe(400)
    expect(rpcs()).toHaveLength(0)
  })

  it('DOBLE PETICIÓN: la misma llave borra una vez y la segunda es replay', async () => {
    const dig = await digestDe(ordenesEnBd)
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const primera = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))
    expect(await primera.json()).toMatchObject({ deleted: 3, replay: false })

    // La segunda llega con el mismo respaldo (el operador reintentó con la pantalla vieja).
    const segunda = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))

    // El digest ya no coincide —la tabla quedó vacía—, así que ni siquiera llega al RPC.
    // Ésa es la primera barrera; la segunda (replay) se prueba en el caso del timeout.
    expect(segunda.status).toBe(409)
    expect(rpcs()).toHaveLength(1)
  })

  it('TIMEOUT DESPUÉS DEL COMMIT: reintentar con la misma llave no borra dos veces', async () => {
    // El caso feo: la transacción cerró, el borrado y su registro quedaron, y la respuesta
    // nunca llegó. El cliente no puede distinguirlo de un fallo — y no necesita hacerlo.
    instalarFetch({ cortarDespuesDeCommit: true })
    const dig = await digestDe(ordenesEnBd)
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const cortada = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))
    expect(cortada.status).toBe(500)
    expect(libro.get(OP), 'la constancia quedó aunque el cliente no la haya visto')
      .toMatchObject({ state: 'COMMITTED', deleted: 3 })

    // Reintento con la misma llave. La red vuelve; las órdenes ya no están.
    llamadas = []
    ordenesEnBd = []
    instalarFetch()
    const reintento = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe([]), operation_id: OP }))

    expect(reintento.status).toBe(200)
    expect(await reintento.json(), 'el reintento devuelve el resultado anterior, no borra otra vez')
      .toMatchObject({ ok: true, replay: true, state: 'COMMITTED', deleted: 3 })
  })

  it('CONTEO CAMBIADO dentro de la transacción: no se borra nada, y queda FAILED', async () => {
    // Una orden nueva entra entre el respaldo y el borrado. Aquí el digest todavía
    // coincidiría —la ruta ya leyó—, y sólo el conteo transaccional lo detiene.
    const dig = await digestDe(ordenesEnBd)
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')
    ordenesEnBd = [...ordenesEnBd, { id: 'ord-4-llegó-a-media-transacción' }]
    // El doble responde al conteo, no al digest: simula la ventana real.
    vi.stubGlobal('fetch', ((original) => async (url: string, init?: RequestInit) => {
      if (String(url).includes('/rest/v1/pos_orders') && (init?.method ?? 'GET') === 'GET') {
        llamadas.push({ url: String(url), method: 'GET', body: undefined })
        return { ok: true, status: 200, json: async () => ordenesEnBd.slice(0, 3) } as unknown as Response
      }
      return original(url, init)
    })(globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>))

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'CONTEO_CAMBIO', expected: 3, current: 4 })
    expect(ordenesEnBd, 'no se borró ninguna').toHaveLength(4)
    expect(libro.get(OP)).toMatchObject({ state: 'FAILED' })
  })

  it('DIGEST VENCIDO: si las órdenes cambiaron desde el respaldo, se aborta con 409', async () => {
    const dig = await digestDe(ordenesEnBd)
    ordenesEnBd = [...ordenesEnBd, { id: 'ord-4-llegó-después' }]
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: dig, operation_id: OP }))

    expect(res.status).toBe(409)
    expect(rpcs()).toHaveLength(0)
  })

  it('sin la confirmación literal no se borra', async () => {
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: 'sí bórralo', digest: await digestDe(ordenesEnBd), operation_id: OP }))

    expect(res.status).toBe(400)
    expect(rpcs()).toHaveLength(0)
  })

  it('TENANT CRUZADO: otro restaurante no puede ejecutarlo — ni siquiera un gerente', async () => {
    identidad = { clientId: 'boruca', staffId: 's1', staffName: 'Daniel', role: 'gerente' }
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: 'x', operation_id: OP }))

    expect(res.status).toBe(403)
    expect(rpcs()).toHaveLength(0)
    expect(llamadas, 'ni siquiera debe leer las órdenes del otro tenant').toHaveLength(0)
  })

  it('si el RPC no responde, el cliente recibe 502 y puede reintentar con la misma llave', async () => {
    instalarFetch({ rpcHttp: 503 })
    const { DELETE } = await import('@/app/api/pos/admin/cleanup-orders/route')

    const res = await DELETE(pedir({ confirm: CONFIRMA, digest: await digestDe(ordenesEnBd), operation_id: OP }))

    expect(res.status).toBe(502)
    expect(ordenesEnBd, 'nada se borró').toHaveLength(3)
  })
})
