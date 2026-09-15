import { describe, it, expect } from 'vitest'
import { clasificarConflicto409 } from '@/lib/pos-offline-db'
import { mismoDiaDeVenta } from '@/lib/dia-de-venta'
import { readFileSync } from 'fs'
import { join } from 'path'

// PR-1 turnos — regresiones del incidente de campo (junta 2026-09-01):
// "parecía abrirse el turno pero luego no existía", órdenes descartadas por 409,
// y turnos legítimos declarados 'del día anterior' en la madrugada.

describe('409 de save-order — clasificación', () => {
  it('TURN_NOT_FOUND es REINTENTABLE: el turno pudo abrirse offline y aún no subir', () => {
    const r = clasificarConflicto409('TURN_NOT_FOUND')
    expect(r.errorClass).toBe('TRANSIENT_RETRYABLE')
  })

  it('TURN_CLOSED_CONFLICT sigue terminal: dinero de un corte cerrado exige decisión humana', () => {
    expect(clasificarConflicto409('TURN_CLOSED_CONFLICT').errorClass).toBe('TERMINAL_NON_RETRYABLE')
    expect(clasificarConflicto409('TURN_CLOSED_NO_ACTIVE').errorClass).toBe('TERMINAL_NON_RETRYABLE')
  })

  it('un 409 sin código conocido no se reintenta a ciegas', () => {
    expect(clasificarConflicto409(undefined).errorClass).toBe('TERMINAL_NON_RETRYABLE')
  })
})

describe('vigencia del turno por día de venta (corte 05:00)', () => {
  it('un turno abierto a las 19:00 sigue vigente a la 01:30 del día natural siguiente', () => {
    expect(mismoDiaDeVenta('2026-09-01T19:00:00', '2026-09-02T01:30:00', '05:00:00')).toBe(true)
  })

  it('un turno de ayer 10:00 NO es del día de venta de hoy 10:00', () => {
    expect(mismoDiaDeVenta('2026-09-01T10:00:00', '2026-09-02T10:00:00', '05:00:00')).toBe(false)
  })
})

describe('verdad única de apertura', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

  it('/pos/turno ya no tiene su propia apertura: delega en openTurno()', () => {
    const page = src('app/pos/turno/page.tsx')
    expect(page).toContain('openTurno(')
    // La implementación paralela usaba crypto.randomUUID + POST propio a pos_turnos.
    expect(page).not.toContain('crypto.randomUUID()')
    expect(page).not.toMatch(/queueOperation\('pos_turnos'/)
  })

  it('TurnoGate lee el cache unificado pos_turno_cache y valida por día de venta', () => {
    const gate = src('components/pos/TurnoGate.tsx')
    expect(gate).toContain("pos_turno_cache")
    expect(gate).toContain('mismoDiaDeVenta')
    expect(gate).not.toContain('.toDateString()')
  })

  it('el replay de pos_turnos va con merge-duplicates y los turnos drenan primero', () => {
    const sync = src('lib/offline-sync.ts')
    expect(sync).toContain('resolution=merge-duplicates')
    expect(sync).toMatch(/pos_turnos.*primero|PRIMERO/i)
  })
})
