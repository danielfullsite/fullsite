import { createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const caja = vi.hoisted(() => ({
  pending: [] as Array<{ operation: string; command: Record<string, unknown> }>,
  actorHuella: {
    staff: { id: 'manager-fingerprint', name: 'Encargada', role: 'manager' },
    actor_token: 'actor-from-reader',
    expires_at: Date.now() + 600_000,
    offline: true,
  },
  actorPin: {
    staff: { id: 'manager-pin', name: 'Encargado', role: 'manager' },
    actor_token: 'actor-from-pin',
    expires_at: Date.now() + 600_000,
    offline: true,
  },
  recuperarCajon: vi.fn(),
  recuperarImpresion: vi.fn(),
  autorizarHuella: vi.fn(),
  autorizarPin: vi.fn(),
}))

vi.mock('@/lib/pedro-comandos', () => ({ operacionesPendientesCaja: () => caja.pending }))
vi.mock('@/lib/pedro-cajon', () => ({ recuperarCajonCaja: caja.recuperarCajon }))
vi.mock('@/lib/pedro-impresion', () => ({ recuperarImpresionCaja: caja.recuperarImpresion }))
vi.mock('@/lib/pedro-actor', () => ({
  autorizarOperacionConHuellaEnCaja: caja.autorizarHuella,
  autorizarOperacionConPinEnCaja: caja.autorizarPin,
}))
vi.mock('@/components/pos/useEstadoHuellaCaja', () => ({
  useEstadoHuellaCaja: () => ({ disponible: true }),
}))

import AperturasPendientesDeCaja from '@/components/pos/AperturasPendientesDeCaja'
import ImpresionesPendientesDeCaja from '@/components/pos/ImpresionesPendientesDeCaja'

beforeEach(() => {
  cleanup()
  caja.pending = []
  caja.recuperarCajon.mockReset().mockResolvedValue({ recovered: true })
  caja.recuperarImpresion.mockReset().mockResolvedValue({ recovered: true })
  caja.autorizarHuella.mockReset().mockResolvedValue(caja.actorHuella)
  caja.autorizarPin.mockReset().mockResolvedValue(caja.actorPin)
})

afterEach(cleanup)

it('la huella recupera exactamente la misma apertura pendiente con un actor fresco', async () => {
  const operation = 'drawer-recovery:command-fixed-91'
  caja.pending = [{ operation, command: { command_id: 'command-fixed-91', command_type: 'DRAWER_OPEN', turno_id: 'closed-turn' } }]

  render(createElement(AperturasPendientesDeCaja))
  const pendingButton = await screen.findByRole('button', { name: /^Recuperar apertura manual/ })
  expect(pendingButton.className).toContain('min-h-[56px]')
  fireEvent.click(pendingButton)

  const fingerprintButton = screen.getByRole('button', { name: 'Recuperar solicitud original con huella' })
  expect(fingerprintButton.className).toContain('min-h-[56px]')
  fireEvent.click(fingerprintButton)

  await waitFor(() => expect(caja.recuperarCajon).toHaveBeenCalledWith(operation, caja.actorHuella))
  expect(caja.autorizarHuella).toHaveBeenCalledOnce()
  expect(caja.autorizarPin).not.toHaveBeenCalled()
  expect(caja.recuperarCajon).toHaveBeenCalledOnce()
})

it('el PIN recupera exactamente la misma verificación de impresión con un actor fresco', async () => {
  const operation = 'print-resolution:command-fixed-37'
  caja.pending = [{ operation, command: { command_id: 'command-fixed-37', command_type: 'PRINT_UNCERTAIN_RESOLVE', job_id: 'job-37' } }]

  render(createElement(ImpresionesPendientesDeCaja))
  const pendingButton = await screen.findByRole('button', { name: /^Recuperar verificación/ })
  expect(pendingButton.className).toContain('min-h-[56px]')
  fireEvent.click(pendingButton)

  const fingerprintButton = screen.getByRole('button', { name: 'Recuperar verificación con huella' })
  const pinButton = screen.getByRole('button', { name: 'Recuperar verificación original' }) as HTMLButtonElement
  const closeButton = screen.getByRole('button', { name: 'Cerrar' })
  expect(fingerprintButton.className).toContain('min-h-[56px]')
  expect(pinButton.className).toContain('min-h-[56px]')
  expect(closeButton.className).toContain('min-h-[56px]')
  expect(pinButton.disabled).toBe(true)

  fireEvent.change(screen.getByLabelText('PIN del encargado para recuperar'), { target: { value: '12a34' } })
  fireEvent.click(pinButton)

  await waitFor(() => expect(caja.recuperarImpresion).toHaveBeenCalledWith(operation, caja.actorPin))
  expect(caja.autorizarPin).toHaveBeenCalledWith('1234')
  expect(caja.autorizarHuella).not.toHaveBeenCalled()
  expect(caja.recuperarImpresion).toHaveBeenCalledOnce()
})
