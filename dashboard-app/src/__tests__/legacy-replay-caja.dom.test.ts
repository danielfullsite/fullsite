import { beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
vi.mock('@/lib/pedro-cliente', () => ({ leerSalon: vi.fn(), requiereCaja: () => true }))
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
import { leerSalon } from '@/lib/pedro-cliente'
import { getPendingQueue, queueOperation, syncAll } from '@/lib/pos-offline-db'
const read = vi.mocked(leerSalon)
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn())
  localStorage.setItem('fullsite_client_id', 'synthetic')
  localStorage.setItem('pos_shift_token', 'synthetic-session')
})
it.each([
  [{ autoritativa: true, writeAuthority: 'caja' }, 'CAJA_AUTHORITY'],
  [{ autoritativa: false, writeAuthority: 'legacy' }, 'CAJA_UNAVAILABLE'],
] as const)('retains old sales and cash movements without cloud requests: %s', async (state, blocked) => {
  await queueOperation('pos_cash_movements', 'POST', { id: 'old-move', amount: 50 }, undefined, undefined, 'SUPABASE_REST')
  await queueOperation('pos_turnos', 'PATCH', { id: 'old-turn', closed_at: '2026-09-05T01:00:00Z' }, 'pos_turnos?id=eq.old-turn', undefined, 'SUPABASE_REST')
  const before = await getPendingQueue()
  read.mockResolvedValue(state as never)
  expect(await syncAll({ retryExhausted: true })).toEqual({ synced: 0, failed: 0, blocked })
  expect(await getPendingQueue()).toEqual(before)
  expect(fetch).not.toHaveBeenCalled()
})
it('stops a replay when authority changes before its first write, preserving the queued payload', async () => {
  await queueOperation('pos_cash_movements', 'POST', { id: 'old-move', amount: 50 }, undefined, undefined, 'SUPABASE_REST')
  const before = await getPendingQueue()
  read.mockResolvedValueOnce({ autoritativa: true, writeAuthority: 'legacy' } as never)
    .mockResolvedValue({ autoritativa: true, writeAuthority: 'caja' } as never)
  expect(await syncAll()).toEqual({ synced: 0, failed: 0, blocked: 'CAJA_AUTHORITY' })
  expect(await getPendingQueue()).toEqual(before)
  expect(fetch).not.toHaveBeenCalled()
})
