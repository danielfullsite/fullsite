// Soporte remoto: allowlist estricta (sin shell arbitrario), consentimiento temporal, auditoría.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { SUPPORT_ACTIONS, findSupportAction, isConsentValid } from '../lib/support-actions'

describe('allowlist — nada fuera de la lista', () => {
  it('las acciones definidas son de soporte, ninguna abre un shell/sql', () => {
    const ids = SUPPORT_ACTIONS.map((a) => a.id)
    expect(ids).toContain('diagnose')
    for (const a of SUPPORT_ACTIONS) {
      expect(a.id).toMatch(/^[a-z_]+$/) // ids simples, sin comandos
      expect(a.id).not.toMatch(/exec|shell|sql|rm|sudo|eval/)
    }
  })
  it('findSupportAction rechaza cualquier id fuera de la allowlist', () => {
    expect(findSupportAction('rm -rf /')).toBeNull()
    expect(findSupportAction('exec')).toBeNull()
    expect(findSupportAction(123)).toBeNull()
    expect(findSupportAction('diagnose')?.readOnly).toBe(true)
  })
})

describe('consentimiento temporal — fail-closed', () => {
  const now = Date.parse('2026-08-27T12:00:00Z')
  it('válido sólo si existe y no venció', () => {
    expect(isConsentValid({ expiresAt: '2026-08-27T13:00:00Z' }, now)).toBe(true)
    expect(isConsentValid({ expiresAt: '2026-08-27T11:00:00Z' }, now)).toBe(false) // vencido
    expect(isConsentValid(null, now)).toBe(false)
    expect(isConsentValid({}, now)).toBe(false)
    expect(isConsentValid({ expiresAt: 'basura' }, now)).toBe(false)
  })
})

// ── API ──
vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { email: 'admin@fullsite.mx' } })),
  platformServiceFetch: vi.fn(),
}))
const auditSpy = vi.fn(async (_ctx: unknown, _entry: unknown) => true)
vi.mock('@/lib/platform-writes', () => ({
  auditLog: (ctx: unknown, entry: unknown) => auditSpy(ctx, entry),
  rateLimit: () => null,
}))
import { platformServiceFetch } from '@/lib/platform-auth'
import { GET, POST } from '@/app/api/platform/support/action/route'
const mockFetch = platformServiceFetch as unknown as Mock

let consentActivo = true
beforeEach(() => {
  auditSpy.mockClear()
  consentActivo = true
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => {
    const expiresAt = consentActivo
      ? new Date(Date.now() + 3600_000).toISOString()
      : new Date(Date.now() - 3600_000).toISOString()
    return { ok: true, json: async () => [{ pos_settings: { 'support.consent': { grantedBy: 'dueño', expiresAt } } }] } as unknown as Response
  })
})
function post(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}
function get() {
  return { headers: { get: () => null } } as unknown as import('next/server').NextRequest
}

describe('API soporte', () => {
  it('GET devuelve sólo la allowlist', async () => {
    const res = await GET(get())
    const j = await res.json() as { actions: { id: string }[] }
    expect(j.actions.map((a) => a.id)).toEqual(SUPPORT_ACTIONS.map((a) => a.id))
  })
  it('POST con acción fuera de la allowlist → 400 (sin shell posible)', async () => {
    const res = await POST(post({ clientId: 'diezmex', actionId: 'exec_shell' }))
    expect(res.status).toBe(400)
    expect(auditSpy).not.toHaveBeenCalled()
  })
  it('acción readonly (diagnose) → 200 sin consentimiento, auditada', async () => {
    const res = await POST(post({ clientId: 'diezmex', actionId: 'diagnose' }))
    expect(res.status).toBe(200)
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })
  it('acción con consentimiento vigente → 200 queued, auditada', async () => {
    consentActivo = true
    const res = await POST(post({ clientId: 'diezmex', actionId: 'request_sync' }))
    expect(res.status).toBe(200)
    const j = await res.json() as { status: string }
    expect(j.status).toBe('queued')
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })
  it('acción sin consentimiento vigente (vencido) → 403, no se ejecuta', async () => {
    consentActivo = false
    const res = await POST(post({ clientId: 'diezmex', actionId: 'restart_print_queue' }))
    expect(res.status).toBe(403)
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
