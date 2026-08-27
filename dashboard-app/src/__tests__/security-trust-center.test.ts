import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = join(import.meta.dirname, '..', '..')

describe('public security trust center', () => {
  it('links public evidence and does not claim unearned certifications', () => {
    const page = readFileSync(join(appRoot, 'src/app/seguridad/page.tsx'), 'utf8')

    expect(page).toContain('observatory/analyze?host=app.fullsite.mx')
    expect(page).toContain('ssltest/analyze.html?d=fullsite.mx')
    expect(page).toContain("['SOC 2 / ISO 27001', 'No certificado'")
    expect(page).not.toContain("name: 'SOC 2 Type II'")
    expect(page).not.toContain("name: 'PCI-DSS SAQ-A'")
  })

  it('publishes a standard security contact file', () => {
    const securityTxt = readFileSync(join(appRoot, 'public/.well-known/security.txt'), 'utf8')

    expect(securityTxt).toContain('Contact: mailto:seguridad@fullsite.mx')
    expect(securityTxt).toContain('Canonical: https://app.fullsite.mx/.well-known/security.txt')
    expect(securityTxt).toContain('Policy: https://app.fullsite.mx/seguridad')
  })
})
