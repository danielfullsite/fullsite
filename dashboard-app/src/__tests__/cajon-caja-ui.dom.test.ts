import { createElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { abrirCajonPorPagoCaja, abrirCajonManualCaja } from '@/lib/pedro-cajon'
import CajonDeCaja from '@/components/pos/CajonDeCaja'
import AperturasPendientesDeCaja from '@/components/pos/AperturasPendientesDeCaja'
import ImpresionesInciertasDeCaja from '@/components/pos/ImpresionesInciertasDeCaja'
const network = vi.mocked(localNetworkFetch)
const actor = { staff: { id: 'cashier', name: 'Caja', role: 'admin' }, actor_token: 'synthetic', expires_at: Date.now() + 600000, offline: true }
const operation = (command: Record<string, unknown>) => ({ operation_id: command.command_id, kind: command.command_type === 'PAYMENT_DRAWER_OPEN' ? 'payment' : 'manual', turno_id: command.turno_id, order_id: command.order_id, payment_id: command.payment_id, reason: command.reason || 'Pago confirmado', job_id: 'job', printer_id: 'printer' })
const reply = (command: Record<string, unknown>) => Response.json({ results: [{ event: { payload: command }, result: { drawer_operation: operation(command) } }] })
beforeEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('pos_actor_session', JSON.stringify(actor)) })
it('confirmed cash does not automatically pulse; the explicit action sends only payment identity and is then disabled', async () => {
  const posts: Record<string, unknown>[] = []
  network.mockImplementation(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json({ authoritative: true, write_authority: 'caja', drawer_operations: [] })
    const command = JSON.parse(String(init.body)); posts.push(command); return reply(command)
  })
  render(createElement(CajonDeCaja, { orderId: 'order', paymentId: 'paid', turnoId: 'turn' }))
  const button = screen.getByRole('button', { name: 'Solicitar apertura para este abono' })
  await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  expect(posts).toHaveLength(0)
  fireEvent.click(button)
  await screen.findByText(/Apertura solicitada/)
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({ command_type: 'PAYMENT_DRAWER_OPEN', order_id: 'order', payment_id: 'paid', turno_id: 'turn' })
  expect(posts[0]).not.toHaveProperty('amount_cents'); expect(posts[0]).not.toHaveProperty('data_b64')
  expect((button as HTMLButtonElement).disabled).toBe(true)
})
it('a previously requested payment opening cannot issue another original pulse after remount', async () => {
  network.mockResolvedValue(Response.json({ authoritative: true, write_authority: 'caja', drawer_operations: [{ kind: 'payment', order_id: 'order', payment_id: 'paid' }] }))
  render(createElement(CajonDeCaja, { orderId: 'order', paymentId: 'paid', turnoId: 'turn' }))
  await screen.findByText(/La apertura para este abono ya fue solicitada/)
  expect((screen.getByRole('button', { name: 'Solicitar apertura para este abono' }) as HTMLButtonElement).disabled).toBe(true)
  expect(network.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})
it('manual opening requires reason and fresh PIN; rejection does not announce an open drawer', async () => {
  network.mockResolvedValueOnce(Response.json(actor)).mockResolvedValueOnce(Response.json({ results: [{ code: 'DRAWER_NOT_CONFIGURED', error: 'Cajón no configurado' }] }))
  render(createElement(CajonDeCaja, { turnoId: 'turn' }))
  const button = screen.getByRole('button', { name: 'Solicitar apertura manual' })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Motivo de apertura'), { target: { value: 'Cambio para caja' } })
  fireEvent.change(screen.getByLabelText('PIN para abrir el cajón'), { target: { value: '1234' } })
  fireEvent.click(button)
  await screen.findByText('Cajón no configurado')
  expect(screen.queryByText(/Apertura solicitada/)).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('1234')
})
it.each(['manual', 'payment'])('lost %s ACK can recover globally after the shift closes without a new pulse identity', async kind => {
  let original: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('Lost after durable pulse') })
  await expect(kind === 'manual' ? abrirCajonManualCaja('closed-turn', 'Cambio', actor) : abrirCajonPorPagoCaja('closed-order', 'paid', 'closed-turn')).rejects.toMatchObject({ incierto: true })
  if (kind === 'manual') network.mockResolvedValueOnce(Response.json({ ...actor, actor_token: 'fresh' }))
  network.mockImplementationOnce(async (url, init) => {
    expect(url).toMatch(/\/events$/); expect(JSON.parse(String(init?.body))).toEqual(original)
    return reply(original)
  })
  render(createElement(AperturasPendientesDeCaja))
  fireEvent.click(await screen.findByRole('button', { name: /^Recuperar apertura/ }))
  if (kind === 'manual') {
    fireEvent.change(screen.getByLabelText('PIN para recuperar el cajón'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar solicitud original del cajón' }))
  }
  await screen.findByText(/Solicitud original recuperada/)
  expect(Object.keys(localStorage)).toHaveLength(0)
  expect(network).toHaveBeenCalledTimes(kind === 'manual' ? 3 : 2)
})
it('drawer uncertainty is separate from paper and sends a manager-approved retry_pulse decision', async () => {
  const jobs = [{ job_id: 'drawer', uncertain_episode_id: 'episode', document_type: 'drawer_pulse', printer_name: 'Caja' }, { job_id: 'paper', uncertain_episode_id: 'paper-episode', document_type: 'receipt', printer_name: 'Papel' }]
  network.mockResolvedValueOnce(Response.json({ authoritative: true, jobs })).mockResolvedValueOnce(Response.json(actor))
    .mockImplementationOnce(async (_url, init) => {
      const command = JSON.parse(String(init?.body))
      expect(command).toMatchObject({ command_type: 'DRAWER_UNCERTAIN_RESOLVE', job_id: 'drawer', resolution: 'retry_pulse', reason: 'No abrió' })
      return Response.json({ results: [{ event: { payload: command }, result: { drawer_resolution: command } }] })
    }).mockResolvedValueOnce(Response.json({ authoritative: true, jobs: [] }))
  render(createElement(ImpresionesInciertasDeCaja, { kind: 'drawer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Consultar aperturas por verificar' }))
  fireEvent.click(await screen.findByRole('button', { name: /Caja · drawer_pulse/ }))
  expect(screen.queryByRole('button', { name: /Papel · receipt/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('Resultado verificado'), { target: { value: 'retry_pulse' } })
  fireEvent.change(screen.getByLabelText('Detalle de la verificación'), { target: { value: 'No abrió' } })
  fireEvent.change(screen.getByLabelText('PIN del encargado'), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar verificación en Caja' }))
  await screen.findByText(/Apertura solicitada/)
})
