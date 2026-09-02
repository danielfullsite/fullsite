import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// PR-3 cierre — regresión de la junta 2026-09-01: "al cerrar correctamente el
// día, el KDS y el comedor deben quedar automáticamente limpios", y las cuentas
// pendientes deben poder resolverse EN LOTE desde una sola pantalla.
// Contratos a nivel fuente: el comportamiento del state del local-server se
// prueba ejecutando en electron-app/local-server/tests/state.test.js.

const wizard = readFileSync(
  join(__dirname, '..', 'components', 'pos', 'CierreCajaWizard.tsx'), 'utf8')

describe('CierreCajaWizard — el cierre Z limpia el día', () => {
  it('limpia TODOS los caches locales del turno, no solo pos_turno_id', () => {
    for (const key of ['pos_turno_id', 'pos_turno_cache', 'pos_cached_turno', 'pos_last_turno_sync']) {
      expect(wizard).toContain(`localStorage.removeItem('${key}')`)
    }
  })

  it('avisa TURNO_CLOSED al local-server para purgar el KDS en modo LAN', () => {
    expect(wizard).toContain("command_type: 'TURNO_CLOSED'")
    expect(wizard).toContain('sendOrderToKitchen')
  })

  it('la cancelación en lote PATCHea por id con filtro (lección de los once turnos)', () => {
    expect(wizard).toContain('handleCancelarEnLote')
    expect(wizard).toMatch(/pos_orders\?id=eq\.\$\{encodeURIComponent\(o\.id\)\}&client_id=eq\./)
    // Cancelar, no borrar.
    expect(wizard).toContain("status: 'cancelada'")
    expect(wizard).not.toMatch(/method: 'DELETE'/)
  })

  it('el lote exige PIN de gerente con permiso corte_z y nota, y audita cada cuenta', () => {
    expect(wizard).toContain("hasPermission(gerente.role, 'corte_z')")
    expect(wizard).toContain("type: 'cancelada_en_lote_cierre'")
    expect(wizard).toContain('validateEscalationNota(escalationNota)')
  })
})

describe('local-server — TURNO_CLOSED purga el piso', () => {
  it('state.js limpia _orders/_kds/_mesas al cerrar turno', () => {
    const state = readFileSync(
      join(__dirname, '..', '..', '..', 'electron-app', 'local-server', 'core', 'state.js'), 'utf8')
    const closedCase = state.slice(state.indexOf('case EVENT.TURNO_CLOSED'), state.indexOf('case EVENT.STATE_SYNC'))
    expect(closedCase).toContain('this._orders.clear()')
    expect(closedCase).toContain('this._kds = []')
    expect(closedCase).toContain('this._mesas.clear()')
  })
})
