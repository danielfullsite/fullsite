import { createElement } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/lib/data', () => ({
  getRecentDays: vi.fn(), getLatestDay: vi.fn(), getDashboardFromPosOrders: vi.fn(), getDateRange: vi.fn(),
  getDeteccionesAgentes: async () => [], getTurnoAbierto: async () => null,
  aggregateMeseros: () => [], aggregatePayments: () => [], aggregateGrupos: () => [],
  getWansoftData: async () => null, isFullsitePOS: () => true,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ clientId: 'fixture-client', locationId: 'branch-2', locations: [], setLocationId: () => {} }) }))
vi.mock('@/components/PageHeader', () => ({ default: () => null }))
vi.mock('@/components/KPICard', () => ({ default: () => createElement('p', null, 'money-kpi') }))
vi.mock('@/components/PredictionWidget', () => ({ default: () => null }))
vi.mock('@/components/RevenueChart', () => ({ default: () => null }))
vi.mock('@/components/RevenueDistributionChart', () => ({ default: () => null }))
vi.mock('@/components/agentes/CentroAgentes', () => ({ default: () => null }))
import { getRecentDays, getLatestDay, getDashboardFromPosOrders, getDateRange } from '@/lib/data'
import DashboardPage from '@/app/page'
import VentasPage from '@/app/ventas/page'
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRecentDays).mockRejectedValue(new Error('Caja pendiente de confirmar'))
  vi.mocked(getLatestDay).mockResolvedValue(null)
  vi.mocked(getDateRange).mockRejectedValue(new Error('Caja pendiente de confirmar'))
})
afterEach(cleanup)
it('dashboard shows unavailability instead of turning a reporting failure into zero or historical fallback', async () => {
  render(createElement(DashboardPage))
  expect((await screen.findByRole('alert')).textContent).toContain('Ventas no disponibles')
  expect(getDashboardFromPosOrders).not.toHaveBeenCalled()
  expect(screen.queryByText('money-kpi')).toBeNull()
})
it('Ventas hides monetary KPIs on failure and scopes the report to the selected restaurant and branch', async () => {
  render(createElement(VentasPage))
  expect((await screen.findByRole('alert')).textContent).toContain('Ventas no disponibles')
  expect(vi.mocked(getDateRange).mock.calls[0].slice(2)).toEqual(['fixture-client', 'branch-2'])
  expect(screen.queryByText('money-kpi')).toBeNull()
})
