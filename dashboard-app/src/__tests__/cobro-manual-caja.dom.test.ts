import { createElement } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import type { FinanzasDeCaja } from '@/lib/pedro-finanzas'
import CobroDeCaja from '@/components/pos/CobroDeCaja'

type Command = Record<string, unknown> & { command_id: string; command_type: string }
const { FinancialDomain } = createRequire(import.meta.url)('../../../electron-app/local-server/core/financial-domain.js') as {
  FinancialDomain: new () => {
    prepare: (command: Record<string, unknown>, context: unknown) => { financial_order: FinanzasDeCaja }
    apply: (value: FinanzasDeCaja) => void
    getOrder: (id: string) => FinanzasDeCaja
  }
}
const network = vi.mocked(localNetworkFetch)
const order = { id: 'manual-order', order_id: 'manual-order', turno_id: 'shift', created_by: 'cashier',
  order_revision: 2, total_cents: 10000, status: 'preparando', items: [{ cantidad: 1, sent_quantity: 1 }] }
const context = { order, turno: { id: 'shift' }, actor: { id: 'cashier', permissions: [] }, now: '2026-09-08T15:00:00Z' }

/** The component, payment helpers and durable browser journal are real. Only
 * HTTP is substituted: money comes from the production FinancialDomain and
 * duplicate responses use the runtime's canonical durable-receipt envelope. */
function server() {
  const domain = new FinancialDomain()
  domain.apply(domain.prepare({ command_type: 'FINANCIAL_OPEN', order_id: order.id, turno_id: order.turno_id,
    expected_revision: 0, expected_order_revision: 2, total_cents: 10000, currency: 'MXN' }, context).financial_order)
  const posts: Command[] = []
  const receipts = new Map<string, { financial_order: FinanzasDeCaja }>()
  let loseResponse: 'before-commit' | 'after-commit' | null = null
  network.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/state')) return Response.json({ authoritative: true, write_authority: 'caja', financial_orders: [domain.getOrder(order.id)] })
    expect(String(url)).toBe('http://127.0.0.1:7718/events')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-fullsite-actor')).toBe('fixture-actor-token')
    const command = JSON.parse(String(init?.body)) as Command
    posts.push(command)
    expect(command).not.toHaveProperty('actor_token')
    const previous = receipts.get(command.command_id)
    if (previous) return Response.json({ results: [{ duplicate: true, receipt: { command_id: command.command_id, sequence: receipts.size }, result: previous }] })
    const loss = loseResponse
    loseResponse = null
    if (loss === 'before-commit') throw new TypeError('Fixture connection lost before delivery')
    const result = domain.prepare(command, context)
    domain.apply(result.financial_order)
    receipts.set(command.command_id, structuredClone(result))
    if (loss === 'after-commit') throw new TypeError('Fixture acknowledgement lost after commit')
    return Response.json({ results: [{ event: { payload: command }, result }] })
  })
  return { posts, domain, loseNextResponse: (where: typeof loseResponse) => { loseResponse = where } }
}
const show = () => render(createElement(CobroDeCaja, { order, onClose: vi.fn(), onChanged: vi.fn() }))
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
async function reserve(tender: 'card' | 'transfer') {
  await screen.findByLabelText('Forma de pago')
  fill('Forma de pago', tender)
  fill('Importe a cobrar', '100.00')
  fill('Propina de este pago', '12.50')
  fireEvent.click(screen.getByRole('button', { name: 'Preparar registro de pago externo' }))
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago externo verificado' }))
const journal = () => Object.keys(localStorage).filter(key => key.startsWith('pos_comando_pendiente:'))

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('fullsite_client_id', 'fixture-client')
  localStorage.setItem('FULLSITE_LOCATION_ID', 'fixture-location')
  localStorage.setItem('FULLSITE_TERMINAL_ID', 'fixture-terminal')
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ staff: { id: 'cashier', name: 'Caja', role: 'cajero' },
    actor_token: 'fixture-actor-token', expires_at: Date.now() + 600000, offline: true }))
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No bank or cloud calls are permitted in this test') }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it.each(['card', 'transfer'] as const)('records manual %s with operator evidence and separate tip, and sends no result without its reference', async tender => {
  const caja = server()
  show()
  await reserve(tender)
  await screen.findByRole('heading', { name: 'Cobro por confirmar · $112.50' })
  expect(caja.posts).toHaveLength(1)
  expect(caja.posts[0]).toMatchObject({ command_type: 'FINANCIAL_PAYMENT_START', method: 'manual', tender,
    amount_cents: 10000, tip_cents: 1250, account_id: 'manual-order:full' })
  fill(/^Terminal o banco /, '  Fixture bank terminal  ')
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('referencia del pago')
  expect(caja.posts).toHaveLength(1)
  expect(journal()).toHaveLength(0)
  fill(/^Referencia /, '  fixture-reference  ')
  confirm()
  await screen.findByText('Cuenta liquidada. Cocina conserva la preparación pendiente.')
  expect(caja.posts[1]).toMatchObject({ command_type: 'FINANCIAL_PAYMENT_RESULT', payment_id: caja.posts[0].payment_id,
    status: 'accepted', evidence: { kind: 'manual_received', received_by: 'cashier', source: 'Fixture bank terminal',
      reference: 'fixture-reference', tender, currency: 'MXN', amount_cents: 11250 } })
  expect(caja.domain.getOrder(order.id)).toMatchObject({ total_cents: 10000, paid_cents: 10000, tip_cents: 1250,
    balance_cents: 0, reserved_cents: 0, payments: [{ status: 'accepted', accepted_at: context.now, amount_cents: 10000, tip_cents: 1250 }] })
  expect(screen.getByText(/Referencia fixture-reference/).textContent).toContain('Propina $12.50')
  expect(journal()).toHaveLength(0)
  expect(fetch).not.toHaveBeenCalled()
})

it('recovers the same payment result after a committed response is lost, without duplicating money or changing its evidence', async () => {
  const caja = server()
  show()
  await reserve('card')
  await screen.findByLabelText(/^Referencia /)
  fill(/^Terminal o banco /, 'Fixture terminal')
  fill(/^Referencia /, 'fixture-original-reference')
  caja.loseNextResponse('after-commit')
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('conservamos el mismo intento')
  expect(caja.domain.getOrder(order.id).paid_cents).toBe(10000)
  expect(journal()).toHaveLength(1)
  const saved = localStorage.getItem(journal()[0])!
  expect(saved).not.toContain('fixture-actor-token')
  expect(JSON.parse(saved)).toEqual(caja.posts[1])
  // Before the next poll, the UI still has the unconfirmed result. Retrying
  // reconnects with the persisted command, even if a text field was edited.
  fill(/^Referencia /, 'fixture-edited-reference')
  confirm()
  await screen.findByText('Cuenta liquidada. Cocina conserva la preparación pendiente.')
  expect(caja.posts).toHaveLength(3)
  expect(caja.posts[2]).toEqual(caja.posts[1])
  expect(caja.domain.getOrder(order.id).payments).toHaveLength(1)
  expect(caja.domain.getOrder(order.id)).toMatchObject({ paid_cents: 10000, tip_cents: 1250, revision: 3 })
  expect(screen.getByText(/Referencia fixture-original-reference/)).toBeTruthy()
  expect(screen.queryByText(/Referencia fixture-edited-reference/)).toBeNull()
  expect(journal()).toHaveLength(0)
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves the reservation command across a modal restart when connection fails before delivery', async () => {
  const caja = server()
  const first = show()
  caja.loseNextResponse('before-commit')
  await reserve('transfer')
  expect((await screen.findByRole('alert')).textContent).toContain('conservamos el mismo intento')
  expect(caja.domain.getOrder(order.id).payments).toHaveLength(0)
  expect(journal()).toHaveLength(1)
  first.unmount()
  show()
  await reserve('transfer')
  await screen.findByRole('heading', { name: 'Cobro por confirmar · $112.50' })
  expect(caja.posts).toHaveLength(2)
  expect(caja.posts[1]).toEqual(caja.posts[0])
  expect(caja.domain.getOrder(order.id)).toMatchObject({ paid_cents: 0, reserved_cents: 10000, reserved_tip_cents: 1250 })
  expect(caja.domain.getOrder(order.id).payments).toHaveLength(1)
  expect(journal()).toHaveLength(0)
  expect(fetch).not.toHaveBeenCalled()
})
