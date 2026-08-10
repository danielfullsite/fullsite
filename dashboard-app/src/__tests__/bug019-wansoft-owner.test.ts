// BUG-019 — legacy Wansoft ownership: exact owner, fail-closed, no fallback.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ownsLegacyWansoft, legacyWansoftOwner } from '@/lib/wansoft-owner'

const VOICE = join(process.cwd(), 'src/app/api/voice/route.ts')
const COACH = join(process.cwd(), 'src/app/api/coach/route.ts')
const POLIZAS = join(process.cwd(), 'src/app/api/contabilidad/polizas/route.ts')

describe('ownsLegacyWansoft — exact owner, fail-closed', () => {
  afterEach(() => { delete process.env.WANSOFT_LEGACY_CLIENT_ID })

  it('#7 authorizes ONLY the exact configured owner', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'amalay'
    expect(ownsLegacyWansoft('amalay')).toBe(true)
    expect(ownsLegacyWansoft(' AMALAY ')).toBe(true)
  })
  it('#3/#4 denies other live tenants', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'amalay'
    for (const t of ['coffee-shop', 'nomada', 'sushi-zen', 'demo']) expect(ownsLegacyWansoft(t)).toBe(false)
  })
  it('#5 denies Client #2 and #6 a hypothetical data_source=wansoft tenant', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'amalay'
    expect(ownsLegacyWansoft('client-2')).toBe(false)
    expect(ownsLegacyWansoft('wansoft-tenant-2')).toBe(false)
  })
  it('denies empty / non-string / injection input', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'amalay'
    for (const v of ['', null, undefined, 123, {}, "amalay' OR '1'='1"]) expect(ownsLegacyWansoft(v as unknown)).toBe(false)
  })

  // No fallback: a missing/blank security var must DENY, never grant (not even AMALAY).
  it('MISSING var → owner null → denies even AMALAY', () => {
    delete process.env.WANSOFT_LEGACY_CLIENT_ID
    expect(legacyWansoftOwner()).toBeNull()
    expect(ownsLegacyWansoft('amalay')).toBe(false)
  })
  it('EMPTY / whitespace var → owner null → denies even AMALAY', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = ''
    expect(ownsLegacyWansoft('amalay')).toBe(false)
    process.env.WANSOFT_LEGACY_CLIENT_ID = '   '
    expect(legacyWansoftOwner()).toBeNull()
    expect(ownsLegacyWansoft('amalay')).toBe(false)
  })
  it('WRONG var → only that exact tenant authorized, AMALAY denied', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'otro-owner'
    expect(ownsLegacyWansoft('otro-owner')).toBe(true)
    expect(ownsLegacyWansoft('amalay')).toBe(false)
  })
})

describe('static source-order: authz precedes service-role / legacy query', () => {
  for (const [name, file, gate] of [
    ['voice', VOICE, 'ownsLegacyWansoft(auth.clientId)'],
    ['coach', COACH, 'ownsLegacyWansoft(clientId)'],
  ] as const) {
    it(`#8 ${name}: withPOSAuth → ownership gate (403) → service key → wansoft fetch`, () => {
      const s = readFileSync(file, 'utf8')
      const iAuth = s.indexOf('withPOSAuth(request)')
      const iGate = s.indexOf(gate)
      const iSvc = s.indexOf('SUPABASE_SERVICE_KEY')
      const iWansoft = s.indexOf('/rest/v1/wansoft')
      expect(iAuth).toBeGreaterThan(-1)
      expect(iGate).toBeGreaterThan(iAuth)
      expect(iSvc).toBeGreaterThan(iGate)
      if (iWansoft > -1) expect(iWansoft).toBeGreaterThan(iGate)
      expect(s).toContain('status: 403')
    })
    it(`#9 ${name}: no browser-based tenant resolution`, () => {
      const s = readFileSync(file, 'utf8')
      expect(s).not.toMatch(/\bgetClientId\b/)
      expect(s).not.toContain('x-client-id')
    })
  }

  it('polizas: tenant auth + exact legacy ownership gate; no anon fallback', () => {
    const s = readFileSync(POLIZAS, 'utf8')
    const iAuth = s.indexOf('withPOSAuth(request)')
    const iGate = s.indexOf('ownsLegacyWansoft(clientId)')
    const iLegacy = s.indexOf('fetchWansoftDaily(fecha)')
    expect(iAuth).toBeGreaterThan(-1)
    expect(iGate).toBeGreaterThan(iAuth)
    expect(iLegacy).toBeGreaterThan(-1)
    expect(s).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(s).toContain("process.env.SUPABASE_SERVICE_KEY || ''")
    expect(s).toContain("{ error: 'service_unavailable' }")
  })
})
