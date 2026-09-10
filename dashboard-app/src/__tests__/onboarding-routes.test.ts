import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ onboard: vi.fn(), gate: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/onboard-tenant', () => ({ onboardTenant: mocks.onboard, InvalidOnboardingInput: class extends Error {} }))
vi.mock('@/lib/platform-auth', () => ({ requirePlatformAdmin2FA: mocks.gate }))
vi.mock('@/lib/platform-writes', () => ({ rateLimit: vi.fn(() => null), auditLog: mocks.audit }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: { admin: {} } })) }))
import { POST as platform } from '@/app/api/platform/onboard/route'
import { POST as legacy } from '@/app/api/onboarding/route'
const payload = { clientId: 'cafe', email: 'owner@example.com', password: 'synthetic-password' }
function req(body: unknown = payload) { return new NextRequest('http://localhost/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json', 'x-onboarding-secret': 'synthetic-secret' }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'synthetic-service')
  vi.stubEnv('ONBOARDING_SECRET', 'synthetic-secret')
  mocks.gate.mockResolvedValue({ ctx: { email: 'admin@example.com' } })
  mocks.audit.mockResolvedValue(true)
  mocks.onboard.mockResolvedValue({ userId: 'owner', clientId: 'cafe', provisioned: {}, staff_pins: [], local_server: null, activation: { active: true, activated: true, provisioning_state: 'complete' } })
})
afterEach(() => vi.unstubAllEnvs())
it.each([platform, legacy])('membership failure cannot produce success through either route', async route => {
  mocks.onboard.mockRejectedValueOnce(new Error('PROVISION_MEMBERSHIP_ROLE_CONFLICT'))
  const response = await route(req())
  expect(response.status).toBe(500)
  const body = await response.json()
  expect(body.ok).not.toBe(true); expect(body.success).not.toBe(true)
})
it.each([platform, legacy])('an inactive tenant remains visibly incomplete', async route => {
  mocks.onboard.mockResolvedValueOnce({ activation: { active: false }, provisioned: {} })
  const response = await route(req())
  expect(response.status).toBe(409)
  const body = await response.json()
  expect(body.ok).not.toBe(true); expect(body.success).not.toBe(true)
})
it.each([platform, legacy])('rejects null input before orchestration', async route => {
  expect((await route(req(null))).status).toBe(400)
  expect(mocks.onboard).not.toHaveBeenCalled()
})
it('platform requires admin gate and legacy requires secret', async () => {
  mocks.gate.mockResolvedValueOnce({ error: Response.json({ error: 'forbidden' }, { status: 403 }) })
  expect((await platform(req())).status).toBe(403)
  const unauthorized = new NextRequest('http://localhost/api/onboarding', { method: 'POST', body: JSON.stringify(payload) })
  expect((await legacy(unauthorized)).status).toBe(401)
  expect(mocks.onboard).not.toHaveBeenCalled()
})
it('both routes invoke the same completion contract', async () => {
  expect((await platform(req())).status).toBe(200)
  expect((await legacy(req())).status).toBe(200)
  expect(mocks.onboard).toHaveBeenCalledTimes(2)
  expect(mocks.onboard.mock.calls[0][1]).toMatchObject({ clientId: 'cafe', createLocalServer: true })
  expect(mocks.onboard.mock.calls[1][1]).toMatchObject({ clientId: 'cafe' })
})
