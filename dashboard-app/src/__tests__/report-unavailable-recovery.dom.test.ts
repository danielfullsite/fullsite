import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const calls = vi.hoisted(() => ({ recent: vi.fn(), range: vi.fn() }))
vi.mock('@/lib/data', () => ({ getRecentDays: calls.recent, getDateRange: calls.range,
  aggregateMeseros: () => [], aggregateGrupos: () => [], aggregatePayments: () => [] }))
vi.mock('@/components/PageHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h1', null, title) }))
vi.mock('recharts', () => Object.fromEntries(['ResponsiveContainer', 'AreaChart', 'Area', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip'].map(name => [name, ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)])))
import CajaPage from '@/app/caja/page'
import ReportesPage from '@/app/reportes/page'
import { ReportUnavailableHost } from '@/components/ReportUnavailable'
import { __resetReportStatus } from '@/lib/report-status'

// El AppShell monta el aviso arriba del contenido; en prueba se monta igual, al
// lado de la pantalla, porque el aviso ya no vive dentro de cada página.
const withShell = (Page: React.ComponentType) =>
  React.createElement(React.Fragment, null, React.createElement(ReportUnavailableHost), React.createElement(Page))

const day = { fecha: '2026-09-10', ventas_dia: 1234, ventas_brutas: 1234, efectivo: 1234, tarjeta: 0, tickets_count: 1, personas_restaurant: 1, descuentos: 0, propinas_total: 0, ticket_promedio_restaurant: 1234, devoluciones: 0, mesas_atendidas: 1, ordenes_llevar: 0, meseros: [], platillos_top: [], ventas_por_grupo: [], pago_métodos: [] }
beforeEach(() => { calls.recent.mockReset(); calls.range.mockReset(); __resetReportStatus() })
afterEach(() => { cleanup(); __resetReportStatus(); vi.restoreAllMocks() })

it('automatic report keeps the screen, hides the amounts it could not confirm, and retry brings them back', async () => {
  calls.recent.mockRejectedValueOnce(new Error('POS_REPORT_UNAVAILABLE')).mockResolvedValueOnce([day])
  render(withShell(CajaPage))
  expect((await screen.findByRole('alert')).textContent).toContain('Datos no disponibles')
  // La pantalla NO se tapa: el reporte sigue ahí para poder operar.
  expect((await screen.findAllByText('Total ventas')).length).toBeGreaterThan(0)
  // Pero una lectura caída no vale cero: ninguna cifra se muestra como dato.
  const valores = screen.getAllByTestId('kpi-valor')
  expect(valores.length).toBeGreaterThan(0)
  expect(valores.every(v => v.textContent === '—')).toBe(true)
  expect(screen.queryByText(/\$0\.00/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.getAllByText(/1,234/).length).toBeGreaterThan(0)
  expect(calls.recent).toHaveBeenCalledTimes(2)
})

it('manual report retries the same selected date interval without showing failed data as zero', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  calls.range.mockRejectedValueOnce(new Error('POS_REPORT_UNAVAILABLE')).mockResolvedValueOnce([day])
  render(withShell(ReportesPage))
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }))
  await screen.findByRole('alert')
  expect(screen.queryByText(/\$0\.00/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  await waitFor(() => expect(calls.range).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(calls.range.mock.calls[1]).toEqual(calls.range.mock.calls[0])
  expect(screen.getAllByText(/1,234/).length).toBeGreaterThan(0)
})
