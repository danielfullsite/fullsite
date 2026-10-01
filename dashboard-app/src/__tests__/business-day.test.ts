import { describe, expect, it } from 'vitest'
import { businessDateAt, canShowFinalProjection, dayIsOpenForFinalDetection, type DashboardOperationStatus } from '@/lib/business-day'

const cerrado: DashboardOperationStatus = { businessDate: '2026-10-01', turnoAbierto: null }
const abierto: DashboardOperationStatus = {
  businessDate: '2026-10-01',
  turnoAbierto: { id: 'turno-1', numero: null, abiertoPor: 'Dueño', abiertoAt: '2026-10-01T22:00:00Z', fondoInicial: null },
}

describe('día de negocio del servidor', () => {
  it('usa la hora del servidor en la zona del restaurante, no la del navegador', () => {
    // 04:30 en Monterrey: el día operativo sigue siendo el 30 si inicia a las 05:00.
    expect(businessDateAt(new Date('2026-10-01T09:30:00Z'), 'America/Monterrey', '05:00:00')).toBe('2026-09-30')
    expect(businessDateAt(new Date('2026-10-01T11:30:00Z'), 'America/Monterrey', '05:00:00')).toBe('2026-10-01')
  })

  it('nunca permite una conclusión final para el día de negocio actual', () => {
    expect(dayIsOpenForFinalDetection('2026-10-01', cerrado, true)).toBe(true)
  })

  it('conserva comparaciones de un día histórico cerrado', () => {
    expect(dayIsOpenForFinalDetection('2026-09-30', cerrado, true)).toBe(false)
  })

  it('cubre un turno que cruzó medianoche aunque el último día visible sea anterior', () => {
    expect(dayIsOpenForFinalDetection('2026-09-30', abierto, true)).toBe(true)
  })

  it('falla cerrado cuando no existe estado operativo verificable', () => {
    expect(dayIsOpenForFinalDetection('2026-09-30', null, true)).toBe(true)
  })

  it('no presenta proyecciones finales para el turno abierto, ni aun tras medianoche', () => {
    expect(canShowFinalProjection('2026-10-01', abierto)).toBe(false)
    expect(canShowFinalProjection('2026-09-30', abierto)).toBe(false)
    expect(canShowFinalProjection('2026-09-30', cerrado)).toBe(true)
  })
})
