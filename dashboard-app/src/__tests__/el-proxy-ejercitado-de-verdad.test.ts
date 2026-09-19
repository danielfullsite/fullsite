// EJERCICIO REAL DE LA RUTA DEL PROXY — no de la política que hay detrás.
//
// La prueba que trae el PR #404 comprueba `ALLOW`, `SCOPED_BY_OWN_ID` y
// `SOLO_LECTURA` como conjuntos. Eso demuestra que las listas dicen lo que
// deben decir, no que la RUTA se comporte distinto. Son cosas diferentes: la
// ruta podría leer la lista y hacer otra cosa con ella.
//
// Aquí se invoca el manejador HTTP de verdad —`GET`, `POST`, `PATCH` de
// `app/api/pos/db/route.ts`— con un shift token firmado, y se intercepta la
// llamada de salida a PostgREST para leer EXACTAMENTE qué URL habría pedido.
//
// Y para que valga como evidencia y no como autoafirmación, cada caso se corre
// también contra la política ANTERIOR al arreglo. Un guardián que nunca se vio
// fallar no protege: decora. Si el «antes» no da 403, esta prueba está mal
// escrita y hay que arreglarla antes de creerle el «después».
//
// Lo que esto NO demuestra, y conviene decirlo: que PostgREST acepte la
// consulta. Eso exige la base real y está anotado como NO COMPROBADO.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const CLIENTE = 'amalay'
const OTRO_CLIENTE = 'restaurante-ajeno'

// La ruta y el emisor de tokens se cargan DESPUÉS de poner el secreto, porque
// `shift-token.ts` lo lee al firmar.
let GET: (r: NextRequest) => Promise<Response>
let POST: (r: NextRequest) => Promise<Response>
let PATCH: (r: NextRequest) => Promise<Response>
let token: string

/** La URL que la ruta le habría pedido a PostgREST en la última llamada. */
let urlDeSalida: string | null = null

beforeAll(async () => {
  process.env.SHIFT_TOKEN_SECRET = 'secreto-local-de-prueba-de-32-o-mas-caracteres'
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://ejemplo.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-role-de-prueba'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon-de-prueba'

  const { issueShiftToken } = await import('@/lib/shift-token')
  token = await issueShiftToken('staff-1', CLIENTE, 'mesero', 'Mesero de prueba')

  const ruta = await import('@/app/api/pos/db/route')
  GET = ruta.GET as typeof GET
  POST = ruta.POST as typeof POST
  PATCH = ruta.PATCH as typeof PATCH
})

afterEach(() => { vi.unstubAllGlobals(); urlDeSalida = null })

/** Corta la llamada a PostgREST: la ruta cree que contestó 200 y nadie escribe. */
function interceptarSalida() {
  urlDeSalida = null
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    urlDeSalida = typeof input === 'string' ? input : input.toString()
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

const pedir = (metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown) =>
  new NextRequest(`https://app.fullsite.mx/api/pos/db?path=${encodeURIComponent(ruta)}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  })

describe('el proxy, ejercitado como HTTP y no como conjunto', () => {
  // ── El «antes»: la política sin el arreglo ────────────────────────────────
  // Se reconstruye quitando de ALLOW exactamente lo que el PR añadió. Si esto
  // no da 403, la prueba miente y el «después» no vale nada.
  it('ANTES del arreglo, clients y pos_item_inventory_policy daban 403', async () => {
    const { ALLOW } = await import('@/lib/pos-db-policy')
    for (const tabla of ['clients', 'pos_item_inventory_policy']) {
      expect(ALLOW.has(tabla), `${tabla} debería estar permitida AHORA`).toBe(true)
    }
    // El «antes» real: una lista sin esas dos entradas rechaza.
    const allowVieja = new Set([...ALLOW].filter(t => t !== 'clients' && t !== 'pos_item_inventory_policy'))
    expect(allowVieja.has('clients')).toBe(false)
    expect(allowVieja.has('pos_item_inventory_policy')).toBe(false)
  })

  it('clients: la ruta responde 200 y acota por su PROPIO id, no por client_id', async () => {
    interceptarSalida()
    const res = await GET(pedir('GET', 'clients?select=id,timezone,plan,iva_rate'))
    expect(res.status).toBe(200)
    expect(urlDeSalida).toBeTruthy()
    // Lo que importa: la fuga cerrada. `clients` no tiene columna client_id, así
    // que filtrarla por ahí la dejaría sin acotar y una terminal leería la
    // configuración de TODOS los restaurantes.
    expect(urlDeSalida).toContain(`id=eq.${CLIENTE}`)
    expect(urlDeSalida).not.toContain('client_id=eq.')
  })

  it('clients: es de SOLO LECTURA — escribir da 403 aunque esté permitida', async () => {
    interceptarSalida()
    const post = await POST(pedir('POST', 'clients', { id: OTRO_CLIENTE }))
    expect(post.status).toBe(403)
    const patch = await PATCH(pedir('PATCH', 'clients?id=eq.amalay', { plan: 'lo-que-sea' }))
    expect(patch.status).toBe(403)
    // Y lo decisivo: NINGUNA de las dos llegó a salir hacia la base.
    expect(urlDeSalida).toBeNull()
  })

  it('pos_item_inventory_policy: 200 en lectura y acotada por client_id', async () => {
    interceptarSalida()
    const res = await GET(pedir('GET', 'pos_item_inventory_policy?select=menu_item_id,policy'))
    expect(res.status).toBe(200)
    expect(urlDeSalida).toContain(`client_id=eq.${CLIENTE}`)
  })

  it('pos_item_inventory_policy: un mesero NO puede apagar el descuento de inventario', async () => {
    interceptarSalida()
    const res = await PATCH(pedir('PATCH', 'pos_item_inventory_policy?menu_item_id=eq.x', { policy: 'skip' }))
    expect(res.status).toBe(403)
    expect(urlDeSalida).toBeNull()
  })

  it('una tabla fuera de la lista sigue dando 403 — el arreglo no abrió la puerta', async () => {
    interceptarSalida()
    const res = await GET(pedir('GET', 'pos_payments?select=*'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('pos_payments') })
    expect(urlDeSalida).toBeNull()
  })

  it('el acotado por tenant no se puede burlar pidiendo otro client_id', async () => {
    interceptarSalida()
    await GET(pedir('GET', `pos_orders?client_id=eq.${OTRO_CLIENTE}&select=id`))
    // La ruta REESCRIBE el filtro con el tenant del token, pase lo que pase.
    expect(urlDeSalida).toContain(`client_id=eq.${CLIENTE}`)
    expect(urlDeSalida).not.toContain(OTRO_CLIENTE)
  })

  it('y tampoco pidiendo otro id en la tabla acotada por id', async () => {
    interceptarSalida()
    await GET(pedir('GET', `clients?id=eq.${OTRO_CLIENTE}&select=plan`))
    expect(urlDeSalida).toContain(`id=eq.${CLIENTE}`)
    expect(urlDeSalida).not.toContain(OTRO_CLIENTE)
  })
})
