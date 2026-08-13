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

  it('renders platform tenants through the same server-mediated admin endpoint', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/platform/tenants/page.tsx'), 'utf8')
    expect(source).toContain('/api/platform/overview')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(source).not.toContain('/rest/v1/')
    expect(source).not.toContain('fullsite_client_id')
    expect(source).toContain('impersonation auditada')
    expect(source).toContain('No se habilita cambiando tenant en browser')
    expect(source).toContain('Uber')
    expect(source).toContain('Rappi')
    expect(source).toContain('DiDi')
    expect(source).toContain('OperationChip')
    expect(source).toContain('disabled')
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

  it('adds tenant operations health only after platform-admin authorization', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/platform/overview/route.ts'), 'utf8')
    const authzIndex = source.indexOf("admins.has(user.email.toLowerCase())")
    for (const table of ['pos_orders', 'pos_turnos', 'pos_print_jobs', 'pos_bridge_logs']) {
      const tableIndex = source.indexOf(`${table}?select`)
      expect(tableIndex).toBeGreaterThan(authzIndex)
    }
    expect(source).toContain('operations: makeOperations()')
    expect(source).not.toContain('SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('only exposes the Control Center sidebar link to configured platform admin emails', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8')
    expect(source).toContain('NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS')
    expect(source).toContain("label: 'God Mode'")
    expect(source).toContain("href: '/platform'")
    expect(source).toContain("href: '/platform/tenants'")
    expect(source).toContain('platformOnly: true')
    expect(source).toContain('isPlatformAdminEmail(user?.email)')
  })
})
