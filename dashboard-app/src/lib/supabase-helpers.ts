// Centralized Supabase helpers with mandatory client_id filtering
// Every query MUST go through these helpers for multi-tenant safety

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const headers = (extra?: Record<string, string>) => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  ...extra,
})

// GET with mandatory client_id filter
export async function sbGet<T = Record<string, unknown>[]>(
  table: string,
  clientId: string,
  params?: Record<string, string>,
): Promise<T> {
  const searchParams = new URLSearchParams({
    client_id: `eq.${clientId}`,
    ...params,
  })
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${searchParams}`,
    { headers: headers(), cache: 'no-store' }
  )
  if (!res.ok) return [] as unknown as T
  return res.json()
}

// POST with auto-injected client_id
export async function sbPost(
  table: string,
  clientId: string,
  data: Record<string, unknown>,
  options?: { upsert?: boolean },
): Promise<boolean> {
  const prefer = options?.upsert
    ? 'resolution=merge-duplicates,return=minimal'
    : 'return=minimal'
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: prefer }),
    body: JSON.stringify({ client_id: clientId, ...data }),
  })
  return res.ok
}

// PATCH with client_id scope (prevents cross-tenant updates)
export async function sbPatch(
  table: string,
  clientId: string,
  filter: string, // e.g., "id=eq.abc123"
  data: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${filter}&client_id=eq.${clientId}`,
    {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(data),
    }
  )
  return res.ok
}

// DELETE with client_id scope
export async function sbDelete(
  table: string,
  clientId: string,
  filter: string,
): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${filter}&client_id=eq.${clientId}`,
    { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) }
  )
  return res.ok
}
