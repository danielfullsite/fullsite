import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('daily Corte Z gate contract', () => {
  const gate = readFileSync(resolve(process.cwd(), 'src/components/pos/TurnoGate.tsx'), 'utf8')
  const data = readFileSync(resolve(process.cwd(), 'src/lib/pos-data.ts'), 'utf8')

  it('does not allow continuing with a stale shift', () => {
    expect(gate).not.toContain('Continuar con turno actual')
    expect(gate).toContain('Ir a realizar Corte Z')
  })

  it('detects and blocks multiple active shifts', () => {
    expect(data).toContain('activeCount: turnos.length')
    expect(gate).toContain("setStatus('conflict')")
    expect(gate).toContain('El POS queda bloqueado')
  })
})
