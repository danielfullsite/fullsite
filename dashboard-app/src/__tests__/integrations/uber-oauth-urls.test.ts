// Domain isolation tests for Uber Eats OAuth.
// Guarantees that sandbox and production never share auth or API hosts.
// Mixing domains (e.g. sandbox token → api.uber.com) causes Uber 401.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLoginUrl, getAuthorizeUrl, getApiBase } from '@/lib/integrations/uber-eats/oauth'

const SANDBOX_AUTH = 'https://sandbox-login.uber.com'
const PROD_AUTH = 'https://auth.uber.com'
const SANDBOX_API = 'https://test-api.uber.com'
const PROD_API = 'https://api.uber.com'

let savedEnv: string | undefined

beforeEach(() => { savedEnv = process.env.UBER_ENV })
afterEach(() => {
  if (savedEnv === undefined) delete process.env.UBER_ENV
  else process.env.UBER_ENV = savedEnv
})

describe('Sandbox domain isolation', () => {
  beforeEach(() => { process.env.UBER_ENV = 'sandbox' })

  it('uses sandbox-login.uber.com for token requests', () => {
    expect(getLoginUrl()).toContain(SANDBOX_AUTH)
  })

  it('uses sandbox-login.uber.com for authorize URL', () => {
    expect(getAuthorizeUrl()).toContain(SANDBOX_AUTH)
  })

  it('uses test-api.uber.com for API calls', () => {
    expect(getApiBase()).toBe(SANDBOX_API)
  })

  it('login URL never contains production auth host', () => {
    expect(getLoginUrl()).not.toContain('auth.uber.com')
  })

  it('API base is not the production API host', () => {
    // test-api.uber.com intentionally shares the suffix 'api.uber.com'
    // so we check identity, not substring
    expect(getApiBase()).not.toBe(PROD_API)
    expect(getApiBase()).not.toMatch(/^https:\/\/api\.uber\.com/)
  })

  it('login URL never contains API host (no domain mixing)', () => {
    expect(getLoginUrl()).not.toContain('test-api.uber.com')
    expect(getLoginUrl()).not.toContain('api.uber.com')
  })

  it('API base never contains auth host (no domain mixing)', () => {
    expect(getApiBase()).not.toContain('sandbox-login.uber.com')
    expect(getApiBase()).not.toContain('auth.uber.com')
  })
})

describe('Production domain isolation', () => {
  beforeEach(() => { process.env.UBER_ENV = 'production' })

  it('uses auth.uber.com for token requests', () => {
    expect(getLoginUrl()).toContain(PROD_AUTH)
  })

  it('uses auth.uber.com for authorize URL', () => {
    expect(getAuthorizeUrl()).toContain(PROD_AUTH)
  })

  it('uses api.uber.com for API calls', () => {
    expect(getApiBase()).toBe(PROD_API)
  })

  it('login URL never contains sandbox host', () => {
    expect(getLoginUrl()).not.toContain('sandbox')
  })

  it('API base never contains test-api host', () => {
    expect(getApiBase()).not.toContain('test-api')
  })

  it('login URL never contains API host (no domain mixing)', () => {
    expect(getLoginUrl()).not.toContain('api.uber.com')
    expect(getLoginUrl()).not.toContain('test-api.uber.com')
  })

  it('API base never contains auth host (no domain mixing)', () => {
    expect(getApiBase()).not.toContain('auth.uber.com')
    expect(getApiBase()).not.toContain('sandbox-login.uber.com')
  })
})

describe('Environment boundary — no cross-contamination', () => {
  it('sandbox auth host !== production auth host', () => {
    process.env.UBER_ENV = 'sandbox'
    const sandboxAuth = getLoginUrl()
    process.env.UBER_ENV = 'production'
    const prodAuth = getLoginUrl()
    expect(sandboxAuth).not.toBe(prodAuth)
  })

  it('sandbox API base !== production API base', () => {
    process.env.UBER_ENV = 'sandbox'
    const sandboxApi = getApiBase()
    process.env.UBER_ENV = 'production'
    const prodApi = getApiBase()
    expect(sandboxApi).not.toBe(prodApi)
  })
})
