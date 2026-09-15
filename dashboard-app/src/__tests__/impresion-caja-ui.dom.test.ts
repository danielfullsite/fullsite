import { createElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import DocumentoImpresoDeCaja from '@/components/pos/DocumentoImpresoDeCaja'
import ImpresionesPendientesDeCaja from '@/components/pos/ImpresionesPendientesDeCaja'
import ImpresionesInciertasDeCaja from '@/components/pos/ImpresionesInciertasDeCaja'
import CobroDeCaja from '@/components/pos/CobroDeCaja'
import { imprimirReciboPagoCaja, resolverImpresionCaja } from '@/lib/pedro-impresion'
import type { FinanzasDeCaja } from '@/lib/pedro-finanzas'
const network = vi.mocked(localNetworkFetch)
const actor = { staff: { id: 'operator', name: 'Operador', role: 'admin' }, actor_token: 'synthetic-token', expires_at: Date.now() + 600000, offline: true }
const finance: FinanzasDeCaja = { order_id: 'order', turno_id: 'turn', currency: 'MXN', revision: 5, order_revision: 3,
  total_cents: 5800, paid_cents: 5800, reserved_cents: 0, balance_cents: 0, status: 'settled',
  accounts: [{ account_id: 'full', total_cents: 5800, paid_cents: 5800, reserved_cents: 0, balance_cents: 0 }],
  payments: [{ payment_id: 'paid', account_id: 'full', amount_cents: 5800, method: 'cash', status: 'accepted' }] }
const order = { id: 'order', order_revision: 3, turno_id: 'turn', total_cents: 999999, financial_order: finance }
const job = { job_id: 'job', uncertain_episode_id: 'episode', printer_name: 'Caja', document_type: 'receipt', created_at: '', copies: 1, copies_printed: 0 }
beforeEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('pos_actor_session', JSON.stringify(actor)) })
const eventReply = (command: Record<string, unknown>, result: Record<string, unknown>) => Response.json({ results: [{ event: { payload: command }, result }] })
it('precheck sends only canonical identity, then an explicit reasoned copy references the original', async () => {
  const documents: Record<string, unknown>[] = []
  const commands: Record<string, unknown>[] = []
  network.mockImplementation(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json({ authoritative: true, write_authority: 'caja', print_documents: documents })
    const command = JSON.parse(String(init.body)); commands.push(command)
    expect(command).not.toHaveProperty('total_cents'); expect(command).not.toHaveProperty('data_b64'); expect(command).not.toHaveProperty('items')
    const document = { document_id: command.command_id, kind: 'precheck', order_id: 'order', order_revision: 3, financial_revision: 5, ...(command.original_document_id ? { original_document_id: command.original_document_id, reason: command.reason } : {}) }
    documents.push(document)
    return eventReply(command, { print_document: document })
  })
  render(createElement(DocumentoImpresoDeCaja, { order }))
  const first = screen.getByRole('button', { name: 'Imprimir precuenta' })
  await vi.waitFor(() => expect((first as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(first)
  const copy = await screen.findByRole('button', { name: 'Imprimir copia de precuenta' })
  expect((copy as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Motivo de la copia'), { target: { value: 'Cliente solicita otra copia' } })
  fireEvent.click(copy)
  await vi.waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[1]).toMatchObject({ original_document_id: commands[0].command_id, reason: 'Cliente solicita otra copia' })
  expect(commands[1].command_id).not.toBe(commands[0].command_id)
})
it('accepted payments retain a receipt button after full settlement and do not serialize browser amounts', async () => {
  const posted: Record<string, unknown>[] = []
  network.mockImplementation(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json({ authoritative: true, write_authority: 'caja', financial_orders: [finance], salon_orders: [], print_documents: [] })
    const command = JSON.parse(String(init.body)); posted.push(command)
    return eventReply(command, { print_document: { document_id: command.command_id, order_id: 'order', payment_id: 'paid', order_revision: 3, financial_revision: 5 } })
  })
  render(createElement(CobroDeCaja, { order, onClose: () => {}, onChanged: () => {} }))
  await screen.findByText('Cuenta liquidada. Cocina conserva la preparación pendiente.')
  // Los cobros ya confirmados viven en su pestaña (2026-09-12, POS sin scroll).
  fireEvent.click(await screen.findByRole('tab', { name: /Cobrados/ }))
  const button = await screen.findByRole('button', { name: 'Imprimir recibo del abono' })
  await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  await vi.waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ command_type: 'PAYMENT_RECEIPT_PRINT', payment_id: 'paid', expected_revision: 3, expected_financial_revision: 5 })
  expect(posted[0]).not.toHaveProperty('total_cents')
})
it('lost receipt ACK is globally recoverable without reading a closed account or making a new print', async () => {
  let original: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('ACK lost') })
  await expect(imprimirReciboPagoCaja(finance, 'paid')).rejects.toMatchObject({ incierto: true })
  network.mockImplementationOnce(async (url, init) => {
    expect(url).toMatch(/\/events$/); expect(JSON.parse(String(init?.body))).toEqual(original)
    return Response.json({ results: [{ duplicate: true, receipt: { command_id: original.command_id, sequence: 9 }, result: {
      print_document: { document_id: original.command_id, order_id: 'order', payment_id: 'paid', order_revision: 3, financial_revision: 5 },
    } }] })
  })
  render(createElement(ImpresionesPendientesDeCaja))
  fireEvent.click(await screen.findByRole('button', { name: /^Recuperar recibo/ }))
  await screen.findByText(/Solicitud original recuperada/)
  expect(network).toHaveBeenCalledTimes(2)
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('a lost resolution recovers with fresh manager approval even when the queue no longer contains the job', async () => {
  let original: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('ACK lost after resolved') })
  await expect(resolverImpresionCaja(job, 'printed', 'Verifiqué papel completo', actor)).rejects.toMatchObject({ incierto: true })
  network.mockImplementationOnce(async (url) => { expect(url).toMatch(/\/auth\/pin$/); return Response.json({ ...actor, actor_token: 'fresh-token' }) })
    .mockImplementationOnce(async (url, init) => {
      expect(url).toMatch(/\/events$/); expect(JSON.parse(String(init?.body))).toEqual(original)
      expect(new Headers(init?.headers).get('x-fullsite-actor')).toBe('fresh-token')
      return eventReply(original, { print_resolution: { job_id: job.job_id, uncertain_episode_id: job.uncertain_episode_id, resolution: 'printed', reason: original.reason } })
    })
  render(createElement(ImpresionesPendientesDeCaja))
  fireEvent.click(await screen.findByRole('button', { name: /^Recuperar verificación ·/ }))
  fireEvent.change(screen.getByLabelText('PIN del encargado para recuperar'), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar verificación original' }))
  await screen.findByText(/Solicitud original recuperada/)
  expect(network).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(localStorage)).not.toContain('1234')
})
it('uncertain paper requires a selected episode, reason, and fresh approval for a copy', async () => {
  network.mockResolvedValueOnce(Response.json({ authoritative: true, jobs: [job] }))
    .mockResolvedValueOnce(Response.json(actor))
    .mockImplementationOnce(async (_url, init) => {
      const command = JSON.parse(String(init?.body))
      expect(command).toMatchObject({ command_type: 'PRINT_UNCERTAIN_RESOLVE', job_id: 'job', uncertain_episode_id: 'episode', resolution: 'reprint', reason: 'Se atascó el papel' })
      expect(command).not.toHaveProperty('data_b64')
      return eventReply(command, { print_resolution: command })
    }).mockResolvedValueOnce(Response.json({ authoritative: true, jobs: [] }))
  render(createElement(ImpresionesInciertasDeCaja))
  fireEvent.click(screen.getByRole('button', { name: 'Consultar impresiones por verificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Caja · receipt · job' }))
  const confirm = screen.getByRole('button', { name: 'Confirmar verificación en Caja' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Resultado verificado'), { target: { value: 'reprint' } })
  fireEvent.change(screen.getByLabelText('Detalle de la verificación'), { target: { value: 'Se atascó el papel' } })
  fireEvent.change(screen.getByLabelText('PIN del encargado'), { target: { value: '1234' } })
  fireEvent.click(confirm)
  await screen.findByText('Caja guardó la solicitud de copia. Verifica su salida en la impresora.')
})
