import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'


describe('POS tenant identity is visible before operations', () => {
  const layout = readFileSync(join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8')
  const turnoGate = readFileSync(join(process.cwd(), 'src/components/pos/TurnoGate.tsx'), 'utf8')

  it('derives the visible restaurant name from authenticated clientConfig', () => {
    expect(layout).toContain("import { useAuth } from '@/contexts/AuthContext'")
    expect(layout).toContain('const { clientConfig } = useAuth()')
    expect(layout).toContain("clientConfig?.display_name || clientConfig?.id || ''")
    expect(layout).toContain('restaurantName={restaurantName}')
  })

  it('shows the resolved tenant on the PIN and no-turno gates', () => {
    expect(layout).toContain('data-testid="pos-tenant-name"')
    expect(turnoGate).toContain('restaurantName?: string')
    expect(turnoGate.match(/data-testid="pos-tenant-name"/g)).toHaveLength(2)
  })
})
