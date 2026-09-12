import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'
process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'test'

import { auditDetailsText, logAudit, parseAuditDetails } from '@/lib/pos-data'

const DETAIL = { item: 'Chilaquiles', amount: 185 }

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('pos_audit_log.details jsonb', () => {
  it('manda el objeto por el cable, no un escalar string', async () => {
    let sent: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return { ok: true } as Response
    }))

    await logAudit({ action: 'item_cancelled', actor: 'Omar', details: DETAIL })

    expect(sent?.details).toEqual(DETAIL)
    expect(typeof sent?.details).toBe('object')
  })

  it('tolera objetos nuevos y strings históricos al leer y buscar', () => {
    expect(parseAuditDetails(DETAIL)).toEqual(DETAIL)
    expect(parseAuditDetails(JSON.stringify(DETAIL))).toEqual(DETAIL)
    expect(auditDetailsText(DETAIL).toLowerCase()).toContain('chilaquiles')
    expect(auditDetailsText(JSON.stringify(DETAIL)).toLowerCase()).toContain('chilaquiles')
  })

  it('un valor corrupto no tumba auditoría', () => {
    expect(parseAuditDetails('no-json')).toBeNull()
    expect(auditDetailsText(null)).toBe('')
  })
})
