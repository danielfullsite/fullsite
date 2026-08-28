// Wizard de alta: reanudable, idempotente, y NUNCA exporta secretos. Autocontenido.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  WIZARD_STEPS, normalizeProgress, nextStep, isComplete, applyStep,
  sanitizeForPersistence, isSecretFree,
} from '../lib/onboarding-wizard'

describe('reanudable — retoma en el paso correcto', () => {
  it('estado vacío → empieza en cliente', () => {
    const p = normalizeProgress(null)
    expect(p.completed).toEqual([])
    expect(nextStep(p)).toBe('cliente')
    expect(isComplete(p)).toBe(false)
  })
  it('con pasos hechos, nextStep es el primer incompleto en orden canónico', () => {
    const p = normalizeProgress({ completed: ['sucursales', 'cliente', 'marcas'] })
    expect(p.completed).toEqual(['cliente', 'marcas', 'sucursales']) // reordenado canónico
    expect(nextStep(p)).toBe('menu')
  })
  it('todos los pasos → completo, nextStep null', () => {
    const p = normalizeProgress({ completed: [...WIZARD_STEPS] })
    expect(isComplete(p)).toBe(true)
    expect(nextStep(p)).toBeNull()
  })
  it('estado corrupto no rompe: pasos inválidos se descartan', () => {
    const p = normalizeProgress({ completed: ['cliente', 'inexistente', 42] })
    expect(p.completed).toEqual(['cliente'])
  })
})

describe('idempotente — reaplicar un paso no duplica', () => {
  it('applyStep dos veces = una', () => {
    let p = normalizeProgress(null)
    p = applyStep(p, 'cliente', { nombre: 'Rosta' })
    p = applyStep(p, 'cliente', { nombre: 'Rosta' })
    expect(p.completed).toEqual(['cliente'])
    expect(p.data.cliente).toEqual({ nombre: 'Rosta' })
  })
  it('el orden de completado sigue el canónico aunque se apliquen desordenados', () => {
    let p = normalizeProgress(null)
    p = applyStep(p, 'menu')
    p = applyStep(p, 'cliente')
    expect(p.completed).toEqual(['cliente', 'menu'])
  })
})

describe('nunca exporta secretos', () => {
  it('sanitizeForPersistence elimina llaves secretas recursivamente', () => {
    const limpio = sanitizeForPersistence({
      nombre: 'Ana', pin: '1234', staff: [{ name: 'Luis', password: 'x' }],
      config: { api_key: 'k', tema: 'oscuro' },
    })
    expect(limpio).toEqual({ nombre: 'Ana', staff: [{ name: 'Luis' }], config: { tema: 'oscuro' } })
  })
  it('applyStep sanea el payload aunque el llamador mande un secreto', () => {
    const p = applyStep(normalizeProgress(null), 'usuarios', { name: 'Luis', pin: '9999' })
    expect((p.data.usuarios as Record<string, unknown>).pin).toBeUndefined()
    expect((p.data.usuarios as Record<string, unknown>).name).toBe('Luis')
  })
  it('isSecretFree detecta secretos anidados', () => {
    expect(isSecretFree({ a: { b: { token: 'x' } } })).toBe(false)
    expect(isSecretFree({ a: { b: { nombre: 'ok' } } })).toBe(true)
  })
})

// ── API ──
vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { admin: 'test' } })),
  platformServiceFetch: vi.fn(),
}))
import { platformServiceFetch } from '@/lib/platform-auth'
import { GET, PUT } from '@/app/api/platform/onboarding-progress/route'
const mockFetch = platformServiceFetch as unknown as Mock

let writes: Record<string, unknown>[] = []
beforeEach(() => {
  writes = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if ((init?.method || 'GET') === 'GET' || !init?.method) {
      return { ok: true, json: async () => [{ pos_settings: {} }] } as unknown as Response
    }
    writes.push(JSON.parse(String(init.body)))
    return { ok: true, json: async () => ({}) } as unknown as Response
  })
})

function get(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) }, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}
function put(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}

describe('API onboarding-progress', () => {
  it('GET sin progreso → estado vacío, nextStep cliente', async () => {
    const res = await GET(get('clientId=diezmex'))
    const j = await res.json() as { nextStep: string; complete: boolean }
    expect(j.nextStep).toBe('cliente')
    expect(j.complete).toBe(false)
  })
  it('PUT con secreto en el progreso → 400, no escribe', async () => {
    const res = await PUT(put({ clientId: 'diezmex', progress: { data: { usuarios: { pin: '1234' } } } }))
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('PUT válido guarda el progreso saneado bajo onboarding.progress', async () => {
    const res = await PUT(put({ clientId: 'diezmex', progress: { completed: ['cliente'], data: { cliente: { nombre: 'Rosta' } } } }))
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    const settings = writes[0].pos_settings as Record<string, unknown>
    expect(settings['onboarding.progress']).toBeTruthy()
  })
})
