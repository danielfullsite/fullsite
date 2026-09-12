// Regression: ISSUE-001 — los controles persistentes del KDS medían 32–38px
// Found by /qa on 2026-09-12
// Report: .gstack/qa-reports/qa-report-touch-pos-kds-2026-09-12.md
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve(process.cwd(), '../electron-app/local-server/kds-ui.html'), 'utf8')

describe('KDS — blancos táctiles persistentes', () => {
  it('mantiene en 44px los controles que cocina toca desde el encabezado', () => {
    expect(html).toContain('.view-switch button{min-height:44px')
    expect(html).toContain('.gear{width:44px;height:44px')
    expect(html).toContain('#actor-button{min-height:44px')
  })

  it('mantiene en 44px los cierres y selectores dentro de los modales', () => {
    expect(html).toContain('.modal-x{width:44px;height:44px')
    expect(html).toContain('.seg button{flex:1;min-height:44px')
    expect(html).toMatch(/@media\(max-width:640px\)\{[\s\S]*?\.gear\{width:44px;height:44px\}/)
  })
})
