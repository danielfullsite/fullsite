import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { imprimirPrecuentaCaja, imprimirReciboPagoCaja, recuperarImpresionCaja, leerImpresionesInciertasCaja } from '@/lib/pedro-impresion'
import type { FinanzasDeCaja } from '@/lib/pedro-finanzas'
const network = vi.mocked(localNetworkFetch)
const finance = { order_id: 'o1', turno_id: 't1', currency: 'MXN', revision: 5, order_revision: 3,
  total_cents: 10000, paid_cents: 2500, reserved_cents: 1000, balance_cents: 7500, status: 'open',
  accounts: [], payments: [] } as FinanzasDeCaja
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ staff: { id: 'operator' }, actor_token: 'synthetic', expires_at: Date.now() + 600000 }))
})
it('recovers the exact precheck after a lost ACK despite later edits, without prices or printer bytes', async () => {
  let original: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('lost') })
  await expect(imprimirPrecuentaCaja({ id: 'o1', order_revision: 3, financial_order: finance })).rejects.toMatchObject({ incierto: true })
  expect(original).toMatchObject({ command_type: 'ORDER_PRECHECK_PRINT', expected_revision: 3, expected_financial_revision: 5 })
  expect(original).not.toHaveProperty('total_cents'); expect(original).not.toHaveProperty('data_b64')
  network.mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(original)
    return Response.json({ results: [{ duplicate: true, receipt: { command_id: original.command_id, sequence: 8 },
      result: { print_document: { document_id: original.command_id, kind: 'precheck', order_id: 'o1', order_revision: 3, financial_revision: 5 } } }] })
  })
  const result = await imprimirPrecuentaCaja({ id: 'o1', order_revision: 9, financial_order: { ...finance, revision: 12 } })
  expect(result.recovered).toBe(true)
  expect(result.document.order_revision).toBe(3)
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('keeps the journal when a receipt identifies another payment, then recovers without an open editor', async () => {
  let command: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => {
    command = JSON.parse(String(init?.body))
    return Response.json({ results: [{ event: { command_id: command.command_id }, result: {
      print_document: { document_id: command.command_id, order_id: 'o1', payment_id: 'wrong', order_revision: 3, financial_revision: 5 } } }] })
  })
  await expect(imprimirReciboPagoCaja(finance, 'p1')).rejects.toMatchObject({ incierto: true })
  expect(Object.keys(localStorage)).toHaveLength(1)
  network.mockImplementationOnce(async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(command)
    return Response.json({ results: [{ duplicate: true, receipt: { command_id: command.command_id, sequence: 9 }, result: {
      print_document: { document_id: command.command_id, order_id: 'o1', payment_id: 'p1', order_revision: 3, financial_revision: 5 } } }] })
  })
  await recuperarImpresionCaja('print-receipt:o1:p1')
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('a secondary or malformed queue reply is unavailable rather than no uncertain paper', async () => {
  network.mockResolvedValueOnce(Response.json({ authoritative: false, jobs: [] }))
  await expect(leerImpresionesInciertasCaja()).rejects.toThrow(/no confirmó/)
  network.mockResolvedValueOnce(Response.json({ authoritative: true, jobs: [{ job_id: 'job' }] }))
  await expect(leerImpresionesInciertasCaja()).rejects.toThrow(/no confirmó/)
  expect(network.mock.calls[0][1]?.headers).toEqual({ 'x-fullsite-actor': 'synthetic' })
})
