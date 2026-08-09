// BUG-019 regression guard: no API route may resolve the tenant from a browser-supplied
// client_id. getClientId() trusts the x-client-id header / ?client_id= param, so with a
// service key it is a cross-tenant bypass. Routes must use withPOSAuth() instead.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })
}

describe('no browser-trusted tenant identity in API routes', () => {
  it('no route under src/app/api imports or calls getClientId', () => {
    const apiDir = join(process.cwd(), 'src/app/api')
    const offenders = walk(apiDir).filter(f => /\bgetClientId\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
