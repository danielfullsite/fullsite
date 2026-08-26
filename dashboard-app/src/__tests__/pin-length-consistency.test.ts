// Todo input de PIN del POS tiene que aceptar exactamente PIN_LENGTH dígitos.
//
// Historia: `staff-pin.ts` genera PINs de 10 dígitos, pero cada pantalla eligió su propio
// tope a mano — había 4, 6 y 8 repartidos en 14 inputs. Con un PIN de 10 dígitos, un
// gerente no podía autorizar NADA (descuento, cancelación, void, movimiento de caja,
// reabrir cuenta, cerrar turno), y nadie podía checar asistencia. El PR #65 arregló sólo
// el teclado del login y dejó los otros 13 rotos.
//
// Este test no comprueba un número: comprueba que NO EXISTA un número. Mientras todos los
// inputs de PIN usen la constante, no se pueden volver a desincronizar.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PIN_LENGTH } from '@/lib/staff-pin'

const ROOT = new URL('..', import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Un `maxLength` es "de PIN" si en las ~8 líneas previas se nombra un PIN. */
function pinMaxLengths(src: string): { line: number; value: string; snippet: string }[] {
  const lines = src.split('\n')
  const hits: { line: number; value: string; snippet: string }[] = []
  lines.forEach((l, i) => {
    const m = l.match(/maxLength=\{(\d+)\}/)
    if (!m) return
    const ctx = lines.slice(Math.max(0, i - 8), i + 2).join('\n')
    if (/\bPIN\b|\bpin\b/i.test(ctx)) hits.push({ line: i + 1, value: m[1], snippet: l.trim() })
  })
  return hits
}

describe('longitud de PIN — una sola fuente de verdad', () => {
  const archivos = [
    ...walk(join(ROOT, 'app', 'pos')),
    ...walk(join(ROOT, 'components', 'pos')),
  ]

  it('encuentra archivos que revisar (el barrido no está vacío)', () => {
    expect(archivos.length).toBeGreaterThan(10)
  })

  it('ningún input de PIN fija su tope con un número literal', () => {
    const ofensores: string[] = []
    for (const f of archivos) {
      for (const h of pinMaxLengths(readFileSync(f, 'utf8'))) {
        ofensores.push(`${f.replace(ROOT, '')}:${h.line} → ${h.snippet}`)
      }
    }
    expect(ofensores, `Usa maxLength={PIN_LENGTH} de @/lib/staff-pin:\n${ofensores.join('\n')}`)
      .toEqual([])
  })

  it('los inputs de PIN usan la constante compartida', () => {
    const conConstante = archivos
      .map(f => (readFileSync(f, 'utf8').match(/maxLength=\{PIN_LENGTH\}/g) || []).length)
      .reduce((a, b) => a + b, 0)
    // Si alguien borra un input de PIN el número baja y hay que revisarlo a conciencia,
    // no ajustar este mínimo por inercia.
    expect(conConstante).toBeGreaterThanOrEqual(14)
  })

  it('PIN_LENGTH cae en el rango que acepta /api/owner/staff (4–10)', () => {
    expect(PIN_LENGTH).toBeGreaterThanOrEqual(4)
    expect(PIN_LENGTH).toBeLessThanOrEqual(10)
  })
})
