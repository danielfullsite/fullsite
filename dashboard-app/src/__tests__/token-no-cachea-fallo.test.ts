// getAuthToken() no puede cachear su propio fallo.
//
// Este era el veneno que dejaba a la app leyendo como anónima.
//
// El código hacía `_cachedToken = session?.access_token || SUPABASE_KEY` y
// guardaba el resultado pasara lo que pasara. Si la sesión todavía no estaba
// lista —normal en los primeros milisegundos, o si getSession() tardaba más de
// 3 s en una red mala— se cacheaba LA ANON KEY como si fuera un token de sesión,
// y se la devolvía a TODOS los que llamaran durante los siguientes 30 segundos.
//
// Con RLS eso no produce un error: produce CERO FILAS. No hay ninguna política
// para el rol `anon` en todo el esquema (0 de 350), así que cada consulta de esa
// ventana regresaba vacía y cada pantalla enseñaba su estado de "sin datos" o su
// fallback, en silencio.
//
// Síntoma visible: la configuración del restaurante nunca cargaba. El sidebar
// decía "amalay" en vez de "AMALAY Coffee & Market", y se aplicaba IVA del 16% a
// restaurantes cuya fila dice 0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
}))

const ANON = 'anon-key-de-prueba'
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON)

beforeEach(() => {
  vi.resetModules()
  getSession.mockReset()
})
afterEach(() => { vi.useRealTimers() })

async function cargar() {
  const mod = await import('@/lib/data')
  return mod.getAuthToken
}

describe('getAuthToken', () => {
  it('sin sesión devuelve la anon key pero NO la cachea', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    const getAuthToken = await cargar()

    const primero = await getAuthToken()
    expect(primero).toBe(ANON)

    // La sesión ya llegó. La segunda llamada tiene que verla — si el fallo se
    // hubiera cacheado, seguiría devolviendo la anon key 30 segundos.
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'token-real' } } })
    expect(await getAuthToken()).toBe('token-real')
  })

  it('un token real SÍ se cachea: no se consulta la sesión en cada llamada', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-real' } } })
    const getAuthToken = await cargar()

    expect(await getAuthToken()).toBe('token-real')
    const llamadas = getSession.mock.calls.length
    expect(await getAuthToken()).toBe('token-real')
    expect(getSession.mock.calls.length).toBe(llamadas) // vino del caché
  })

  it('si getSession revienta tampoco se cachea el error', async () => {
    getSession.mockRejectedValueOnce(new Error('red caída'))
    const getAuthToken = await cargar()
    expect(await getAuthToken()).toBe(ANON)

    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'token-real' } } })
    expect(await getAuthToken()).toBe('token-real')
  })

  it('nunca devuelve cadena vacía: sin sesión, la anon key', async () => {
    // Devolver '' mandaría una petición sin Authorization, que es un 401 en vez
    // de un resultado vacío — y el código que llama espera una cadena usable.
    getSession.mockResolvedValueOnce({ data: { session: null } })
    const getAuthToken = await cargar()
    expect(await getAuthToken()).toBeTruthy()
  })
})
