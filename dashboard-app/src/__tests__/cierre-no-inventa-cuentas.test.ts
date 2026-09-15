// UN SNAPSHOT INCOMPLETO NO ES UN «NO HAY CUENTAS ABIERTAS».
//
// Campo, AMALAY, 2026-09-14, medido contra la terminal real:
//
//   Pedro (GET /state, con credencial LAN):
//       authoritative            : true
//       order_snapshot_complete  : false     ← lo dice él mismo
//       salon_orders             : []        ← cero
//   Supabase, mismo turno mu0o364i2erd, al mismo segundo:
//       mesa 1  enviada  $197.20
//       mesa 2  enviada  $232.00
//
// El wizard de Cierre de Caja abrió directo en «Paso 1 de 2 · ¿Cuánto efectivo
// hay en caja?». La verificación previa de GUARD-08 no se disparó: para ella no
// había ninguna cuenta abierta. El Corte Z se habría cerrado limpio con $429.20
// colgando en el salón.
//
// La causa está en `leerCuentasAbiertas` (CierreCajaWizard.tsx): preguntaba
//
//     if (salon.procedencia !== 'sin-pedro') { ...usar la lista de Pedro... }
//
// es decir, sólo se iba a la nube cuando Pedro NO CONTESTABA. Un Pedro que
// contesta «soy autoritativo pero mi foto está incompleta» caía del lado bueno
// y su lista vacía se tomaba como verdad. `leerSalon` ya calcula ese `completa`
// —el plano de mesas lo usa para pintar el aviso ámbar— y el cierre lo ignoraba.
//
// Es exactamente el error que este mismo repo ya documentó para la guarda de
// ABRIR turno (`evaluarAperturaDeTurno`, pos-cierre-guard.ts): «un fallo leído
// como si fuera un hecho», incidente del 2026-08-31. La guarda de abrir separa
// `determinado:false` de «no hay»; la de cerrar no lo hacía.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pedroPuedeAfirmarElSalon } from '../lib/pos-cierre-guard'

const wizard = readFileSync(new URL('../components/pos/CierreCajaWizard.tsx', import.meta.url), 'utf8')
const gate = readFileSync(new URL('../components/pos/TurnoGate.tsx', import.meta.url), 'utf8')
const sinComentarios = wizard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('quién puede decidir que no hay cuentas abiertas', () => {
  it('Pedro decide cuando es autoritativo Y su foto está completa', () => {
    expect(pedroPuedeAfirmarElSalon({ autoritativa: true, completa: true })).toBe(true)
  })

  it('REGRESION: un Pedro autoritativo con la foto INCOMPLETA no decide', () => {
    // Éste es el caso medido en AMALAY. Si esto pasa a `true`, el Corte Z
    // vuelve a cerrarse con cuentas abiertas invisibles.
    expect(pedroPuedeAfirmarElSalon({ autoritativa: true, completa: false })).toBe(false)
  })

  it('un Pedro no autoritativo tampoco decide, aunque se diga completo', () => {
    expect(pedroPuedeAfirmarElSalon({ autoritativa: false, completa: true })).toBe(false)
  })
})

describe('el cierre no toma la lista de Pedro sin comprobar que esté completa', () => {
  it('REGRESION: ya no se decide por «procedencia !== sin-pedro»', () => {
    expect(sinComentarios).not.toMatch(/procedencia\s*!==\s*['"]sin-pedro['"]/)
  })

  it('la lista de Pedro sólo se usa detrás de pedroPuedeAfirmarElSalon', () => {
    expect(sinComentarios).toMatch(/pedroPuedeAfirmarElSalon\(\s*salon\s*\)/)
  })

  it('cuando nadie pudo confirmar, el cierre lo dice en vez de suponer que no hay', () => {
    // No bloquea —la regla dura del offline es que la noche siempre se puede
    // cerrar— pero tiene que quedar dicho en pantalla y escrito en el cierre.
    expect(sinComentarios).toMatch(/cuentasVerificadas/)
    expect(wizard).toMatch(/No se pudieron revisar las cuentas abiertas/i)
  })
})

// El mismo agujero estaba en el otro extremo del turno. `TurnoGate` daba por
// `determinado: true` la lista de Pedro con sólo mirar `writeAuthority`, que
// dice quién puede ESCRIBIR — no si la foto del salón está completa. Con la
// autoridad en Caja y el snapshot a medias, el turno abría sobre cuentas vivas,
// que es exactamente lo que la regla de Eduardo existe para impedir.
describe('abrir turno tampoco cree en una foto a medias', () => {
  it('REGRESION: la lista de Pedro pasa por pedroPuedeAfirmarElSalon', () => {
    expect(gate).toMatch(/writeAuthority === 'caja' && pedroPuedeAfirmarElSalon\(local\)/)
  })

  it('REGRESION: writeAuthority por sí solo ya no habilita el atajo', () => {
    const sinComent = gate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(sinComent).not.toMatch(/if \(local\.writeAuthority === 'caja'\) \{/)
  })
})
