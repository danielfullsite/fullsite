// El alta de empleados estaba rota de punta a punta en producción, por dos causas
// independientes que juntas hacían imposible incorporar a nadie:
//
//   1. staff-pin.ts genera PINs de 10 dígitos (PIN_LENGTH = 10), pero el teclado del
//      POS truncaba la entrada en 8 (`.slice(0, 8)`). Un empleado nuevo recibía un PIN
//      que el teclado NO PODÍA aceptar: no es que costara entrar, es que era imposible.
//
//   2. /pos/staff escribía (y leía) directo a `rest/v1/pos_staff` con la ANON KEY.
//      BUG-019 cerró esa tabla: api/pos/pin/route.ts:46 dice "pos_staff is now
//      tenant-scoped RLS with NO anon access" y por eso usa la service key incluso para
//      leer. La pantalla no podía dar de alta, editar, ni siquiera listar.
//
// Estos tests fijan el CONTRATO, no el texto: el primero ata el teclado al generador,
// así que cambiar PIN_LENGTH sin tocar el teclado vuelve a fallar aquí.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PIN_LENGTH } from '@/lib/staff-pin'

const layout = readFileSync(new URL('../app/pos/layout.tsx', import.meta.url), 'utf8')
const staffPage = readFileSync(new URL('../app/pos/staff/page.tsx', import.meta.url), 'utf8')

describe('alta de empleados — el PIN que se genera debe poder teclearse', () => {
  it('el teclado del POS acepta exactamente PIN_LENGTH dígitos', () => {
    const limites = [...layout.matchAll(/setPin\(\(p\) => \([^)]*\)\.slice\(0, (\d+)\)\)/g)]
      .map(m => Number(m[1]))

    expect(limites.length, 'no se encontró el límite del teclado').toBeGreaterThan(0)
    for (const l of limites) expect(l).toBe(PIN_LENGTH)
  })

  it('PIN_LENGTH cae dentro de lo que acepta la API (4–10)', () => {
    // /api/owner/staff valida con /^\d{4,10}$/. Si PIN_LENGTH se saliera de ese rango,
    // el generador produciría PINs que la propia API rechaza.
    expect(PIN_LENGTH).toBeGreaterThanOrEqual(4)
    expect(PIN_LENGTH).toBeLessThanOrEqual(10)
  })
})

describe('alta de empleados — pos_staff no se toca con la anon key', () => {
  it('la pantalla de staff no escribe directo a pos_staff', () => {
    const escrituras = [...staffPage.matchAll(/method:\s*'(POST|PATCH|DELETE)'/g)]
    expect(escrituras.length, 'no hay escrituras que revisar').toBeGreaterThan(0)
    // Ninguna escritura puede apuntar a PostgREST sobre pos_staff.
    expect(staffPage).not.toMatch(/rest\/v1\/pos_staff\?[^`]*`,\s*\{\s*method:\s*'(POST|PATCH)'/)
    expect(staffPage).not.toMatch(/rest\/v1\/pos_staff`,\s*\{\s*method:\s*'POST'/)
  })

  it('la pantalla de staff tampoco LEE pos_staff con la anon key', () => {
    // BUG-019 cerró la tabla a anon también para lectura: sin esto la lista sale vacía.
    const lecturasDirectas = [...staffPage.matchAll(/rest\/v1\/pos_staff\?/g)]
    expect(lecturasDirectas, 'quedan lecturas directas a pos_staff').toHaveLength(0)
  })

  it('toda la gestión pasa por /api/owner/staff', () => {
    expect(staffPage).toContain('/api/owner/staff')
  })
})
