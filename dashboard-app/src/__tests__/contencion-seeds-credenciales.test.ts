// Contención V-A10 — seeds/_lib/get-session.ts iniciaba sesión como el usuario demo
// (rol dueño) con una contraseña LITERAL en el repo. Ahora las credenciales salen de
// SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD y, si faltan, falla con un mensaje claro ANTES de
// hacer cualquier llamada. Valores de prueba falsos; fetch simulado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Nada de leer .env.local desde una prueba.
vi.mock('../../seeds/_lib/supabase.ts', () => ({ getAdminClient: () => { throw new Error('no usar en pruebas') } }))

const ENV = ['SEED_DEMO_EMAIL', 'SEED_DEMO_PASSWORD'] as const
// Ruta en variable: seeds/** está fuera del tsconfig (usa imports con '.ts'); así tsc no
// arrastra el árbol de seeds al programa y vitest lo resuelve igual en tiempo de ejecución.
const GET_SESSION: string = '../../seeds/_lib/get-session.ts'

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyectoficticio.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  for (const k of ENV) delete process.env[k]
})
afterEach(() => { vi.unstubAllGlobals(); for (const k of ENV) delete process.env[k] })

describe('seeds — credenciales del usuario demo desde el entorno', () => {
  it('sin SEED_DEMO_PASSWORD → error claro y ninguna llamada de red', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    process.env.SEED_DEMO_EMAIL = 'demo@fixture.test'
    const { getDemoSession } = await import(GET_SESSION)
    await expect(getDemoSession()).rejects.toThrow(/SEED_DEMO_PASSWORD/)
    expect(f).not.toHaveBeenCalled()
  })

  it('sin SEED_DEMO_EMAIL → error claro', async () => {
    vi.stubGlobal('fetch', vi.fn())
    process.env.SEED_DEMO_PASSWORD = 'contrasena-falsa-de-prueba'
    const { requireDemoCredentials } = await import(GET_SESSION)
    expect(() => requireDemoCredentials()).toThrow(/SEED_DEMO_EMAIL/)
  })

  it('con variables → usa exactamente esos valores en el login', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    process.env.SEED_DEMO_EMAIL = 'demo@fixture.test'
    process.env.SEED_DEMO_PASSWORD = 'contrasena-falsa-de-prueba'
    const { getDemoSession } = await import(GET_SESSION)
    await getDemoSession()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('grant_type=password')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'demo@fixture.test', password: 'contrasena-falsa-de-prueba' })
  })
})
