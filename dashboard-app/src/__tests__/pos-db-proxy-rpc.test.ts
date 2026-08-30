// El proxy /api/pos/db no puede prestar service_role a un RPC arbitrario.
//
// EL AGUJERO (cerrado el 2026-08-27)
//
// El proxy catch-all tenía seis protecciones, y las seis estaban escritas como
// `if (!isRpc)`. Cualquier petición a `/rest/v1/rpc/*` las saltaba todas:
//
//   1. el prefijo `pos_`            4. inyección de client_id en el query
//   2. la lista blanca ALLOW        5. forzado de client_id en el body
//   3. el gate de rol gerente       6. la redacción del PIN
//
// La justificación estaba escrita en la cabecera del archivo:
//
//   "los RPC r1_* se autoprotegen por tenant server-side"
//
// **Cierto a medias, y la mitad falsa es la que importa.** Los `r1_*` sí abren con
// `IF NOT private.can_write_client(p_client_id) THEN … FORBIDDEN_CLIENT`. Pero la
// primera rama de ese guardián es `if v_role = 'service_role' then return true`.
// El proxy llama con la service key. **El guardián se desarma solo.**
//
// Demostrado contra producción, misma llamada y mismo tenant ajeno:
//
//   claims.role = 'service_role'   → r1_save_order(...) → { ok: true, revision: 1 }
//   claims.role = 'authenticated'  → r1_save_order(...) → { ok: false, FORBIDDEN_CLIENT }
//
// O sea: cualquier empleado de cualquier restaurante que supiera un PIN del POS podía
// escribir en otro restaurante. Sin gate de rol en esa rama, un mesero bastaba. Y
// alcanzaba a las funciones destructivas `r1_cleanup_*`, que asumen que sólo
// `service_role` las invoca.
//
// La propiedad que fija este archivo: **ningún RPC sale por este proxy.**

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Llamada = { url: string; method: string }
let salientes: Llamada[] = []
let avisos: unknown[][] = []

let identidad: { clientId: string; staffId: string; staffName: string; role: string } | null = null
vi.mock('@/lib/api-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/api-auth')>()
  return { ...real, withPOSAuth: async () => identidad }
})

/** Una petición mínima con lo que el handler realmente lee. */
function pedir(opts: { metodo?: string; busqueda?: string; cuerpo?: unknown } = {}) {
  return {
    method: opts.metodo ?? 'GET',
    nextUrl: { search: opts.busqueda ?? '' },
    headers: { get: () => null },
    text: async () => (opts.cuerpo === undefined ? '' : JSON.stringify(opts.cuerpo)),
  } as unknown as import('next/server').NextRequest
}

const ruta = (...partes: string[]) => ({ params: Promise.resolve({ path: partes }) })

beforeEach(() => {
  vi.resetModules()
  salientes = []
  avisos = []
  identidad = { clientId: 'boruca', staffId: 's1', staffName: 'Mesero', role: 'mesero' }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE_KEY_SENTINEL'
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    salientes.push({ url: String(url), method: init?.method ?? 'GET' })
    return { ok: true, status: 200, text: async () => '[]', headers: { get: () => 'application/json' } } as unknown as Response
  })
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { avisos.push(args) })
})

describe('el proxy no expone RPC', () => {
  it('EL BUG: un RPC con el tenant de otro restaurante se rechaza y NUNCA sale a Supabase', async () => {
    const { POST } = await import('@/app/api/pos/db/[...path]/route')

    const res = await POST(
      pedir({ metodo: 'POST', cuerpo: { p_client_id: 'amalay', p_order_id: 'x', p_expected_revision: 0 } }),
      ruta('rest', 'v1', 'rpc', 'r1_save_order'),
    )

    expect(res.status).toBe(403)
    expect(salientes, 'si sale una sola petición, el guardián de la base ya se desarmó').toHaveLength(0)
  })

  it('tampoco pasa la capacidad destructiva — r1_cleanup_commit', async () => {
    // Estas funciones validan el tenant contra lo que guardó su fase 1, no contra quién
    // llama: fueron diseñadas asumiendo que sólo service_role las alcanza. Por este proxy
    // un shift token cualquiera les llegaba.
    const { POST } = await import('@/app/api/pos/db/[...path]/route')

    for (const fn of ['r1_cleanup_begin', 'r1_cleanup_commit', 'r1_cleanup_restore']) {
      const res = await POST(
        pedir({ metodo: 'POST', cuerpo: { p_client_id: 'amalay' } }),
        ruta('rest', 'v1', 'rpc', fn),
      )
      expect(res.status, `${fn} debería rechazarse`).toBe(403)
    }
    expect(salientes).toHaveLength(0)
  })

  it('se rechaza en todos los métodos, no sólo en POST', async () => {
    const mod = await import('@/app/api/pos/db/[...path]/route')

    for (const [nombre, handler] of [['GET', mod.GET], ['PATCH', mod.PATCH], ['DELETE', mod.DELETE]] as const) {
      const res = await handler(pedir({ metodo: nombre }), ruta('rest', 'v1', 'rpc', 'r1_save_order'))
      expect(res.status, `${nombre} debería rechazarse`).toBe(403)
    }
    expect(salientes).toHaveLength(0)
  })

  it('el rechazo deja rastro con el RPC y el tenant — y NO con el cuerpo', async () => {
    // Si algún Offline Shell viejo usaba esta rama, tiene que aparecer con nombre en vez
    // de fallar en silencio. Pero el cuerpo trae datos de la orden y no va al registro.
    const { POST } = await import('@/app/api/pos/db/[...path]/route')

    await POST(
      pedir({ metodo: 'POST', cuerpo: { p_client_id: 'amalay', p_customer_name: 'NOMBRE_DEL_CLIENTE' } }),
      ruta('rest', 'v1', 'rpc', 'r1_save_order'),
    )

    expect(avisos).toHaveLength(1)
    const registrado = JSON.stringify(avisos[0])
    expect(registrado).toContain('r1_save_order')
    expect(registrado).toContain('boruca')
    expect(registrado, 'el cuerpo puede traer datos del comensal').not.toContain('NOMBRE_DEL_CLIENTE')
  })

  it('el camino de tablas sigue funcionando y sigue forzando el tenant', async () => {
    // El fix no puede cerrar la puerta con el Offline Shell adentro.
    const { GET } = await import('@/app/api/pos/db/[...path]/route')

    const res = await GET(pedir({ busqueda: '?select=*' }), ruta('rest', 'v1', 'pos_orders'))

    expect(res.status).toBe(200)
    expect(salientes).toHaveLength(1)
    expect(salientes[0].url).toContain('client_id=eq.boruca')
  })

  it('un nombre de tabla que sólo PARECE rpc no se bloquea de más', async () => {
    // `rpc` es un prefijo de ruta, no una subcadena. Una tabla `pos_rpc_algo` es una tabla.
    const { GET } = await import('@/app/api/pos/db/[...path]/route')

    const res = await GET(pedir(), ruta('rest', 'v1', 'pos_orders'))
    expect(res.status).toBe(200)
    expect(avisos, 'no debería registrarse como intento de RPC').toHaveLength(0)
  })
})
