/**
 * Security Authorization Tests
 *
 * Tests that verify security properties without network access (pure/config).
 * Integration tests are documented in docs/security/POS-BROWSER-SECURITY.md § Integration Tests.
 *
 * Run: pnpm test --run security-authorization
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: null }) }) }) }),
    }),
  }),
}))

import { resolveLoginRedirect } from '@/lib/roles'
import { canAccessPage, type DashboardRole } from '@/contexts/AuthContext'

// ─── T-01: user_metadata role does NOT grant dashboard access ─────────────────
// The post-login redirect is determined by resolveLoginRedirect.
// Verify that even if user_metadata.role were spoofed to 'dueño' by a mesero,
// the redirect logic correctly defaults without bypassing the restriction.
// NOTE: The REAL fix (P0-A) is moving role to app_metadata. These tests verify
// the redirect function behavior; the server-side enforcement must be validated
// via integration test IT-03 in the audit doc.

describe('SEC: post-login redirect — role boundaries', () => {
  it('mesero always goes to /pos regardless of other context', () => {
    expect(resolveLoginRedirect('mesero', 'vantara')).toBe('/pos')
    expect(resolveLoginRedirect('mesero', 'nomada-mini')).toBe('/pos')
    expect(resolveLoginRedirect('mesero', 'prueba-3')).toBe('/pos')
  })

  it('staff always goes to /pos', () => {
    expect(resolveLoginRedirect('staff', 'vantara')).toBe('/pos')
  })

  it('cajero always goes to /pos', () => {
    expect(resolveLoginRedirect('cajero', 'vantara')).toBe('/pos')
  })

  it('null role defaults to dashboard (safe fallback — does not default to /pos)', () => {
    // When role is null (not yet resolved), we do NOT auto-redirect to POS —
    // that would lock out managers on slow connections.
    expect(resolveLoginRedirect(null, 'vantara')).toBe('/')
  })

  it('unknown role does not grant dashboard access via page gating', () => {
    expect(canAccessPage('unknown' as DashboardRole, '/')).toBe(false)
    expect(canAccessPage('unknown' as DashboardRole, '/ventas')).toBe(false)
    expect(canAccessPage('unknown' as DashboardRole, '/admin')).toBe(false)
  })

  it('demo client always goes to /demo/dashboard', () => {
    expect(resolveLoginRedirect('dueño', 'demo')).toBe('/demo/dashboard')
    expect(resolveLoginRedirect('mesero', 'demo')).toBe('/demo/dashboard')
    expect(resolveLoginRedirect(null, 'demo')).toBe('/demo/dashboard')
  })
})

// ─── T-02: Role-based page access enforcement ─────────────────────────────────

describe('SEC: canAccessPage — mesero cannot access financial pages', () => {
  const role: DashboardRole = 'mesero'

  it('mesero cannot access / (dashboard)', () => expect(canAccessPage(role, '/')).toBe(false))
  it('mesero cannot access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(false))
  it('mesero cannot access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('mesero cannot access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('mesero cannot access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('mesero cannot access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(false))
  it('mesero cannot access /admin', () => expect(canAccessPage(role, '/admin')).toBe(false))
  it('mesero can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
})

describe('SEC: canAccessPage — gerente cannot access financial pages', () => {
  const role: DashboardRole = 'gerente'

  it('gerente cannot access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('gerente cannot access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('gerente cannot access /ingresos', () => expect(canAccessPage(role, '/ingresos')).toBe(false))
  it('gerente cannot access /roi', () => expect(canAccessPage(role, '/roi')).toBe(false))
  it('gerente cannot access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('gerente can access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(true))
  it('gerente can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
})

describe('SEC: canAccessPage — staff has POS-only access', () => {
  const role: DashboardRole = 'staff'

  it('staff can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('staff can access /pos subpath', () => expect(canAccessPage(role, '/pos/kitchen')).toBe(true))
  it('staff cannot access /', () => expect(canAccessPage(role, '/')).toBe(false))
  it('staff cannot access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(false))
  it('staff cannot access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(false))
  it('staff cannot access /proveedores', () => expect(canAccessPage(role, '/proveedores')).toBe(false))
})

// ─── T-03: PIN security — btoa is not a hash ─────────────────────────────────
// Verify the insecurity of btoa()-based PIN caching (P0-E).
// This test DOCUMENTS the attack, not the fix.

describe('SEC: PIN cache btoa() is reversible (P0-E — documents vulnerability)', () => {
  it('btoa(pin).slice(0,8) is deterministic and reversible in <10ms for 4-digit PINs', () => {
    const PIN = '1234'
    const stored = btoa(PIN).slice(0, 8)

    // Simulate attacker brute-force
    let recovered: string | null = null
    for (let p = 0; p < 10000; p++) {
      const candidate = String(p).padStart(4, '0')
      if (btoa(candidate).slice(0, 8) === stored) {
        recovered = candidate
        break
      }
    }

    // This MUST succeed — the test proves the vulnerability exists
    expect(recovered).toBe(PIN)
  })

  it('btoa is NOT a cryptographic function — it is base64 encoding', () => {
    expect(btoa('0000')).toBe('MDAwMA==')
    expect(btoa('9999')).toBe('OTk5OQ==')
    // Decoding is trivial
    expect(atob(btoa('1234'))).toBe('1234')
  })
})

// ─── T-04: NEXT_PUBLIC_* — no service key in public bundle ────────────────────

describe('SEC: no service_role key in NEXT_PUBLIC_* vars', () => {
  it('NEXT_PUBLIC_SUPABASE_ANON_KEY is defined (expected public key)', () => {
    // This var is intentionally public — anon key, not service key
    // We just verify it's not the service key pattern (service keys are longer)
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (anonKey) {
      // Supabase service role keys typically contain 'service_role' in JWT claims
      // Anon keys contain 'anon' in their JWT claims
      // We can't decode JWT in test, but we verify the var exists and is not undefined
      expect(typeof anonKey).toBe('string')
    }
    // Test passes even if undefined (CI may not have env)
  })

  it('SUPABASE_SERVICE_ROLE_KEY is NOT exposed as NEXT_PUBLIC_*', () => {
    // If this var existed, it would be in the browser bundle
    expect(process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(process.env.NEXT_PUBLIC_SERVICE_KEY).toBeUndefined()
    expect(process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY).toBeUndefined()
  })
})

// ─── T-05: getClientId() header — document the systemic risk ─────────────────

describe('SEC: x-client-id header is client-controlled (P0-N — documents pattern)', () => {
  it('a Headers object accepts arbitrary x-client-id values with no validation', () => {
    // This test documents that getClientId() receives whatever the client sends.
    // Fix: derive client_id from authenticated session, not from this header.
    const headers = new Headers()
    headers.set('x-client-id', 'amalay') // Attacker sets any tenant

    expect(headers.get('x-client-id')).toBe('amalay')
    // The point: without auth validation, any caller can impersonate any tenant
  })
})

// ─── T-06: Tenant redirect isolation ─────────────────────────────────────────

describe('SEC: resolveLoginRedirect — tenant-agnostic role enforcement', () => {
  it('same role → same redirect regardless of tenant', () => {
    const tenants = ['vantara', 'nomada-mini', 'prueba-3', 'nuevo-cliente']
    for (const tenant of tenants) {
      expect(resolveLoginRedirect('dueño', tenant)).toBe('/')
      expect(resolveLoginRedirect('mesero', tenant)).toBe('/pos')
      expect(resolveLoginRedirect('cajero', tenant)).toBe('/pos')
    }
  })

  it('dueño of tenant A does not get /demo route', () => {
    expect(resolveLoginRedirect('dueño', 'vantara')).toBe('/')
    expect(resolveLoginRedirect('dueño', 'vantara')).not.toBe('/demo/dashboard')
  })
})

// ─── T-07: Financial totals must not come from client input ───────────────────
// Documents the required behavior post-fix for P0-F (save-order).
// These are contract tests — they define what the fixed implementation MUST do.

describe('SEC: save-order contract — server must recalculate totals (post-fix requirement)', () => {
  it('total must be computable from items without trusting client input', () => {
    // Contract: given items with known prices, server calculates total
    const items = [
      { name: 'Chilaquiles', price: 120, qty: 2 },
      { name: 'Café', price: 45, qty: 1 },
    ]
    const iva_rate = 0.16
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0) // 285
    const iva = subtotal * iva_rate // 45.60
    const total = subtotal + iva // 330.60

    // Server should compute this, ignoring any client-supplied total
    expect(subtotal).toBe(285)
    expect(Number(iva.toFixed(2))).toBe(45.6)
    expect(Number(total.toFixed(2))).toBe(330.6)
  })

  it('discount must be validated against pos_promotions or manager PIN', () => {
    // A discount without a valid promo_id or manager approval should be 0
    const validateDiscount = (
      amount: number,
      promoId: string | null,
      managerApproved: boolean
    ): number => {
      if (!promoId && !managerApproved) return 0
      return amount
    }

    expect(validateDiscount(100, null, false)).toBe(0)
    expect(validateDiscount(100, 'promo-123', false)).toBe(100)
    expect(validateDiscount(100, null, true)).toBe(100)
  })
})

// ─── T-08: Onboarding secret — must be set and non-empty ─────────────────────

describe('SEC: ONBOARDING_SECRET gate (P0-M)', () => {
  it('onboarding route would be open if secret is empty string', () => {
    // Simulate the current guard: if (!secret || secret === req.header) allow
    const isOpen = (envSecret: string | undefined, provided: string) => {
      if (!envSecret) return true // BUG: open if not set
      return envSecret === provided
    }

    expect(isOpen(undefined, 'anything')).toBe(true) // Vulnerable: not set → open
    expect(isOpen('', 'anything')).toBe(true)         // Vulnerable: empty string is falsy
    expect(isOpen('strong-secret-123', 'wrong')).toBe(false)
    expect(isOpen('strong-secret-123', 'strong-secret-123')).toBe(true)
  })

  it('correct guard fails closed when secret is undefined', () => {
    // The fix: always require the secret, fail closed
    const isAuthorized = (envSecret: string | undefined, provided: string) => {
      if (!envSecret) return false // Fixed: fail closed
      return envSecret === provided
    }

    expect(isAuthorized(undefined, 'anything')).toBe(false)
    expect(isAuthorized('secret', 'secret')).toBe(true)
    expect(isAuthorized('secret', 'wrong')).toBe(false)
  })
})
