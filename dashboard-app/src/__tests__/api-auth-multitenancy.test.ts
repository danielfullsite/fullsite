import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// FUGA 2026-08-30: withPOSAuth con `limit=1` sin order devolvía una membresía
// ARBITRARIA para usuarios multi-tenant → /api/owner/* leía/escribía sobre otro
// restaurante (el Equipo de tekila-rg mostró el roster real de AMALAY).
// Contrato nuevo bajo prueba:
//  - header x-fullsite-tenant válido (miembro) → ese tenant
//  - header de un tenant del que NO es miembro → null (401)
//  - sin header + varias membresías → null (jamás adivinar)
//  - sin header + una sola membresía real → esa

const SESSION_USER = 'user-123'

vi.mock('@/lib/shift-token', () => ({
  verifyShiftToken: vi.fn(async () => null),
}))

import { withPOSAuth } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

function reqWith(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.fullsite.mx/api/owner/staff', {
    headers: { Authorization: 'Bearer un-jwt-de-sesion', ...headers },
  })
}

function mockMemberships(rows: Array<{ client_id: string; role: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: SESSION_USER }), { status: 200 })
    }
    if (u.includes('/rest/v1/client_users')) {
      return new Response(JSON.stringify(rows), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  }))
}

describe('withPOSAuth — resolución de tenant multi-membresía (fuga 2026-08-30)', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('honra x-fullsite-tenant cuando HAY membresía para ese tenant', async () => {
    mockMemberships([
      { client_id: 'amalay', role: 'dueño' },
      { client_id: 'tekila-rg', role: 'platform_actas' },
    ])
    const auth = await withPOSAuth(reqWith({ 'x-fullsite-tenant': 'tekila-rg' }))
    expect(auth?.clientId).toBe('tekila-rg')
  })

  it('rechaza x-fullsite-tenant de un tenant del que NO es miembro', async () => {
    mockMemberships([{ client_id: 'amalay', role: 'dueño' }])
    const auth = await withPOSAuth(reqWith({ 'x-fullsite-tenant': 'tekila-rg' }))
    expect(auth).toBeNull()
  })

  it('multi-membresía SIN header → null (jamás adivinar: esa era la fuga)', async () => {
    mockMemberships([
      { client_id: 'amalay', role: 'dueño' },
      { client_id: 'coffee-shop', role: 'dueño' },
    ])
    const auth = await withPOSAuth(reqWith())
    expect(auth).toBeNull()
  })

  it('una sola membresía real sin header → esa (el caso del cliente normal)', async () => {
    mockMemberships([{ client_id: 'tekila-rg', role: 'dueño' }])
    const auth = await withPOSAuth(reqWith())
    expect(auth?.clientId).toBe('tekila-rg')
  })

  it('act-as: header a un tenant donde SOLO es platform_actas → entra como dueño', async () => {
    // La existencia de la fila actas prueba que un admin entró vía act-as
    // (endpoint gated); debe operar con acceso de dueño, no rebotar en /owner/*.
    mockMemberships([
      { client_id: 'amalay', role: 'dueño' },
      { client_id: 'tekila-rg', role: 'platform_actas' },
    ])
    const auth = await withPOSAuth(reqWith({ 'x-fullsite-tenant': 'tekila-rg' }))
    expect(auth?.clientId).toBe('tekila-rg')
    expect(auth?.role).toBe('dueño')
  })

  it('una membresía real + una actas, sin header → la real (el actas no es home)', async () => {
    mockMemberships([
      { client_id: 'carls-jr', role: 'platform_actas' },
      { client_id: 'tekila-rg', role: 'dueño' },
    ])
    const auth = await withPOSAuth(reqWith())
    expect(auth?.clientId).toBe('tekila-rg')
  })
})
