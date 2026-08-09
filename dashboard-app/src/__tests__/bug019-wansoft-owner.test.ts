// BUG-019 — voice/coach ownership gate for the AMALAY legacy Wansoft dataset.
// Determined, deterministic regressions (no network): unit ownership + static source-order
// proof that authorization runs before any service-role / legacy-table access.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ownsLegacyWansoft, legacyWansoftOwner } from '@/lib/wansoft-owner'

const VOICE = join(process.cwd(), 'src/app/api/voice/route.ts')
const COACH = join(process.cwd(), 'src/app/api/coach/route.ts')

describe('ownsLegacyWansoft — exact owner only (default deny)', () => {
  afterEach(() => { delete process.env.WANSOFT_LEGACY_CLIENT_ID })

  it('#7 authorizes the exact AMALAY owner', () => {
    expect(ownsLegacyWansoft('amalay')).toBe(true)
    expect(ownsLegacyWansoft(' AMALAY ')).toBe(true) // normalized
  })
  it('#3/#4 denies other live tenants (cross-tenant)', () => {
    for (const t of ['coffee-shop', 'nomada', 'sushi-zen', 'demo']) {
      expect(ownsLegacyWansoft(t)).toBe(false)
    }
  })
  it('#5 denies Client #2', () => {
    expect(ownsLegacyWansoft('client-2')).toBe(false)
  })
  it('#6 denies a hypothetical second Wansoft tenant (data_source is NOT the control)', () => {
    // ownership is exact clientId vs configured owner — a different tenant is denied even if
    // it were data_source='wansoft'. There is no data_source path here at all.
    expect(ownsLegacyWansoft('wansoft-tenant-2')).toBe(false)
  })
  it('denies empty / non-string / browser-shaped input', () => {
    expect(ownsLegacyWansoft('')).toBe(false)
    expect(ownsLegacyWansoft(null)).toBe(false)
    expect(ownsLegacyWansoft(undefined)).toBe(false)
    expect(ownsLegacyWansoft(123)).toBe(false)
    expect(ownsLegacyWansoft("amalay' OR '1'='1")).toBe(false)
  })
  it('owner is configurable server-side (env), exact match only', () => {
    process.env.WANSOFT_LEGACY_CLIENT_ID = 'otro-owner'
    expect(legacyWansoftOwner()).toBe('otro-owner')
    expect(ownsLegacyWansoft('otro-owner')).toBe(true)
    expect(ownsLegacyWansoft('amalay')).toBe(false)
  })
})

describe('static source-order proof: authz before service-role / legacy query', () => {
  for (const [name, file, gate] of [
    ['voice', VOICE, 'ownsLegacyWansoft(auth.clientId)'],
    ['coach', COACH, 'ownsLegacyWansoft(clientId)'],
  ] as const) {
    it(`#1/#2/#8 ${name}: withPOSAuth → ownership gate → service key → wansoft fetch, in order`, () => {
      const s = readFileSync(file, 'utf8')
      const iAuth = s.indexOf('withPOSAuth(request)')
      const iUnauth = s.indexOf('unauthorized()')
      const iGate = s.indexOf(gate)
      const iSvc = s.indexOf('SUPABASE_SERVICE_KEY')
      const iWansoft = s.indexOf('/rest/v1/wansoft')
      expect(iAuth).toBeGreaterThan(-1)
      expect(iUnauth).toBeGreaterThan(iAuth)          // #1/#2 anon → 401 before anything
      expect(iGate).toBeGreaterThan(iAuth)            // ownership gate after auth
      expect(iSvc).toBeGreaterThan(iGate)             // #8 service role AFTER ownership gate
      if (iWansoft > -1) expect(iWansoft).toBeGreaterThan(iGate) // legacy query AFTER gate
      expect(s).toContain("status: 403")              // denies with 403, no data
    })
    it(`#9 ${name}: does not resolve tenant from the browser`, () => {
      const s = readFileSync(file, 'utf8')
      expect(s).not.toMatch(/\bgetClientId\b/)
      expect(s).not.toContain("x-client-id")
    })
  }
})
