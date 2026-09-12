// El alta genera PINs de diez dígitos. Cualquier pantalla que trunque antes
// deja fuera a ese empleado justo en autorizaciones sensibles.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PIN_LENGTH } from '@/lib/staff-pin'

const ROOT = new URL('..', import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

function topesDePin(source: string): Array<{ line: number; limit: number; source: string }> {
  const lines = source.split('\n')
  const hits: Array<{ line: number; limit: number; source: string }> = []
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(?:maxLength=\{|\.slice\(0,\s*)(\d+)/g)) {
      const context = lines.slice(Math.max(0, index - 9), index + 2).join('\n')
      if (/\bpin\b/i.test(context)) hits.push({ line: index + 1, limit: Number(match[1]), source: line.trim() })
    }
  })
  return hits
}

describe('PIN de empleado — longitud consistente', () => {
  const files = [...walk(join(ROOT, 'app', 'pos')), ...walk(join(ROOT, 'components', 'pos'))]

  it('ningún input o teclado de PIN trunca un PIN válido', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const hit of topesDePin(readFileSync(file, 'utf8'))) {
        if (hit.limit < PIN_LENGTH) offenders.push(`${file.replace(ROOT, '')}:${hit.line} → ${hit.source}`)
      }
    }
    expect(offenders, `Acepta los ${PIN_LENGTH} dígitos de staff-pin:\n${offenders.join('\n')}`).toEqual([])
  })

  it('la longitud generada cabe en el contrato de /api/owner/staff', () => {
    expect(PIN_LENGTH).toBeGreaterThanOrEqual(4)
    expect(PIN_LENGTH).toBeLessThanOrEqual(10)
  })
})
