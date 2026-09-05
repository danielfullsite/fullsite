import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
const html = readFileSync(resolve(process.cwd(), '../electron-app/local-server/kds-ui.html'), 'utf8')
const windows: any[] = []
afterEach(() => { windows.splice(0).forEach(w => w.close()) })

function screen({ reject = false, session = false } = {}) {
  const calls: { url: string; init: RequestInit; body: any }[] = []
  const errors: unknown[] = []
  const order = { id: 'mother', order_id: 'mother', authority: 'caja', turno_id: 'shift', kitchen_revision: 1, mesa: 2,
    status: 'enviada', created_at: '2026-01-01T01:00:00Z', updated_at: '2026-01-01T01:00:00Z',
    items: [{ id: 'round:coffee', nombre: 'Café', cantidad: 2, station: 'cocina', comanda_batch_id: 'round', comanda_batch_seq: 0 }],
    comanda_batches: { round: { status: 'enviada', seq: 0, created_at: '2026-01-01T01:00:00Z' } } }
  const actor = { staff: { id: 'cook', name: 'Cocina', role: 'admin' }, actor_token: 'signed-session', expires_at: Date.now() + 3600000, offline: true }
  const dom = new JSDOM(html, { url: 'http://localhost:7717/kds', runScripts: 'dangerously', beforeParse(w: any) {
    w.__KDS_CFG__ = { headers: { 'x-fullsite-terminal': 'KDS-1', 'x-fullsite-lan': 'synthetic' } }
    if (session) w.sessionStorage.setItem('pos_actor_session', JSON.stringify(actor))
    w.localStorage.setItem('kds_settings_v1', JSON.stringify({ sound: false, station: 'todas' }))
    w.addEventListener('error', (e: any) => errors.push(e.error))
    w.fetch = async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, init, body })
      if (url.endsWith('/auth/pin')) return Response.json(actor)
      if (url.endsWith('/events')) {
        if (reject) return Response.json({ results: [{ error: 'Permiso rechazado', code: 'PERMISSION_DENIED' }] })
        order.kitchen_revision++
        for (const item of order.items) if (body.item_ids.includes(item.id)) Object.assign(item, { preparation_status: body.status })
        order.status = body.status; order.comanda_batches.round.status = body.status
        return Response.json({ results: [{ receipt: { command_id: body.command_id }, result: { operational_order: order } }] })
      }
      return Response.json({ authoritative: true, write_authority: 'caja', kds_orders: order.status === 'entregada' ? [] : [order], kds_queue: [] })
    }
  } })
  windows.push(dom.window)
  return { win: dom.window as any, calls, errors, order }
}
it('real kitchen HTML asks PIN before changes, clears PIN and sends the authenticated command with a receipt', async () => {
  const s = screen()
  await vi.waitFor(() => expect(s.win.document.querySelector('[data-ready]')).not.toBeNull())
  // Old accepted kitchen work is never hidden by an age cutoff in Caja mode.
  s.win.document.querySelector('[data-ready]').click()
  expect(s.win.document.getElementById('actor-modal').classList.contains('show')).toBe(true)
  expect(s.calls.filter(c => c.url.endsWith('/events'))).toHaveLength(0)
  s.win.document.getElementById('actor-pin').value = '1234'
  s.win.document.getElementById('actor-form').dispatchEvent(new s.win.Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(s.win.document.getElementById('actor-modal').classList.contains('show')).toBe(false))
  expect(s.win.document.getElementById('actor-pin').value).toBe('')
  expect(s.calls.find(c => c.url.endsWith('/auth/pin'))?.body).toEqual({ pin: '1234' })
  expect(s.win.localStorage.getItem('pos_actor_session')).toBeNull()
  s.win.document.querySelector('[data-ready]').click()
  await vi.waitFor(() => expect(s.win.document.querySelector('[data-deliver]')).not.toBeNull())
  const change = s.calls.find(c => c.url.endsWith('/events'))!
  expect(change.init.headers).toMatchObject({ 'x-fullsite-actor': 'signed-session', 'x-fullsite-terminal': 'KDS-1' })
  expect(change.body).toMatchObject({ command_type: 'KITCHEN_SET', order_id: 'mother', turno_id: 'shift', expected_kitchen_revision: 1, item_ids: ['round:coffee'], status: 'lista' })
  expect(JSON.stringify(change.body)).not.toContain('signed-session')
  expect(s.errors).toEqual([])
})
it('rejected preparation never creates private ready state; blocking removes the actor session', async () => {
  const s = screen({ session: true, reject: true })
  await vi.waitFor(() => expect(s.win.document.querySelector('[data-ready]')).not.toBeNull())
  s.win.document.querySelector('[data-ready]').click()
  await vi.waitFor(() => expect(s.win.document.getElementById('toast').textContent).toContain('Permiso rechazado'))
  expect(s.win.document.querySelector('[data-deliver]')).toBeNull()
  expect(s.win.localStorage.getItem('kds_local_v3')).toBeNull()
  s.win.document.getElementById('actor-button').click()
  expect(s.win.sessionStorage.getItem('pos_actor_session')).toBeNull()
  expect(s.errors).toEqual([])
})
it('separate prepare and deliver buttons advance the current kitchen revision', async () => {
  const s = screen({ session: true })
  await vi.waitFor(() => expect(s.win.document.querySelector('.item[data-o]')).not.toBeNull())
  s.win.document.querySelector('.item[data-o]').click()
  await vi.waitFor(() => expect(s.win.document.querySelector('.item.i-preparando')).not.toBeNull())
  s.win.document.querySelector('[data-ready]').click()
  await vi.waitFor(() => expect(s.win.document.querySelector('[data-deliver]')).not.toBeNull())
  s.win.document.querySelector('[data-deliver]').click()
  await vi.waitFor(() => expect(s.win.document.querySelector('.card')).toBeNull())
  expect(s.calls.filter(c => c.url.endsWith('/events')).map(c => [c.body.status, c.body.expected_kitchen_revision])).toEqual([
    ['preparando', 1], ['lista', 2], ['entregada', 3],
  ])
  expect(s.errors).toEqual([])
})
