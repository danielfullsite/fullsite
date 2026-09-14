import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const wizard = readFileSync(
  join(process.cwd(), 'src/components/pos/CierreCajaWizard.tsx'),
  'utf8',
)

describe('el cierre de caja cabe en una pantalla tactil horizontal', () => {
  it('el resumen y la aprobacion se reparten en dos columnas anchas', () => {
    expect(wizard).toContain("step === 2 ? 'max-w-5xl' : 'max-w-3xl'")
    expect(wizard).toContain('lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]')
  })

  it('el modal no desplaza la cabecera completa y conserva scroll solo como respaldo', () => {
    expect(wizard).toContain('max-h-[96vh] overflow-hidden flex flex-col')
    expect(wizard).not.toContain('max-w-3xl max-h-[96vh] overflow-y-auto')
    expect(wizard).toContain("p-5 overflow-y-auto ${step === 2")
  })
})
