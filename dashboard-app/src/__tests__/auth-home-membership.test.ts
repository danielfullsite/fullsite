import { expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAuthHomeMembership } from '@/lib/auth-home-membership'
function fixture(rows: Array<{client_id:string;role:string}>, error: unknown = null) {
  let result = [...rows]
  const query = {
    select() { return query },
    eq(key: string, value: string) { if (key === 'client_id') result = result.filter(row => row.client_id === value); return query },
    neq(key: string, value: string) { if (key === 'role') result = result.filter(row => row.role !== value); return query },
    order() { result.sort((a,b) => a.client_id.localeCompare(b.client_id)); return query },
    limit() { return query },
    async maybeSingle() { return { data: result[0] || null, error } },
  }
  return { from: () => query } as unknown as Pick<SupabaseClient, 'from'>
}
it('adding owner of A does not turn membership Z/mesero into Z/owner', async () => {
  expect(await readAuthHomeMembership(fixture([{client_id:'a',role:'dueño'},{client_id:'z',role:'mesero'}]), 'user', 'z', {client_id:'z',role:'mesero'})).toEqual({clientId:'z',role:'mesero'})
})
it('without preferred home, tenant and role come from the same first real membership', async () => {
  expect(await readAuthHomeMembership(fixture([{client_id:'a',role:'platform_actas'},{client_id:'c',role:'dueño'},{client_id:'b',role:'cajero'}]), 'user')).toEqual({clientId:'b',role:'cajero'})
})
it('SDK error never uses returned foreign data and only permits same-tenant metadata fallback', async () => {
  const rows = [{client_id:'a',role:'dueño'}]
  expect(await readAuthHomeMembership(fixture(rows, {message:'failed'}), 'user', 'z', {client_id:'z',role:'mesero'})).toEqual({clientId:'z',role:'mesero'})
  expect(await readAuthHomeMembership(fixture(rows, {message:'failed'}), 'user', 'z', {client_id:'other',role:'dueño'})).toEqual({clientId:'z',role:'staff'})
})
it('missing membership produces an explicit neutral role rather than retaining a prior owner', async () => {
  expect(await readAuthHomeMembership(fixture([]), 'user', 'z')).toEqual({clientId:'z',role:'staff'})
})
it('a thrown lookup also clears the role using the same scope rule', async () => {
  const client = { from: () => { throw new Error('offline') } } as unknown as Pick<SupabaseClient, 'from'>
  expect(await readAuthHomeMembership(client,'user','z',{client_id:'a',role:'dueño'})).toEqual({clientId:'z',role:'staff'})
})
