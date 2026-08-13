import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Platform Control Center security contract', () => {
  it('does not query Supabase REST directly from the browser page', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/platform/page.tsx'), 'utf8')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).not.toContain('/rest/v1/')
    expect(source).toContain('/api/platform/overview')
  })

  it('fails closed without configured platform admin emails', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/platform/overview/route.ts'), 'utf8')
    expect(source).toContain('PLATFORM_ADMIN_EMAILS')
    expect(source).toContain('PLATFORM_ADMIN_NOT_CONFIGURED')
    expect(source).not.toContain("|| 'daniel@fullsite.mx'")
    expect(source).not.toContain("|| 'amalay'")
  })

  it('does not fall back from service role to anon key for platform data', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/platform/overview/route.ts'), 'utf8')
    expect(source).toContain("const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''")
    expect(source).not.toContain('SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).not.toContain('SUPABASE_SERVICE_KEY || SB_ANON')
  })

  it('authorizes exact admin email before service-role table reads', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/platform/overview/route.ts'), 'utf8')
    const authzIndex = source.indexOf("admins.has(user.email.toLowerCase())")
    const serviceFetchIndex = source.indexOf("sbGet<ClientRow>")
    expect(authzIndex).toBeGreaterThan(0)
    expect(serviceFetchIndex).toBeGreaterThan(authzIndex)
  })
})
