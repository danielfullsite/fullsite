import { NextRequest } from 'next/server'

// SQL permits 4 MiB for p_event. The HTTP body also carries the stream ID,
// credential and history hashes; its ceiling must leave room for that envelope.
// SQL remains responsible for validating the event's actual jsonb size.
const MAX_MATERIALIZE_BODY_BYTES = 4 * 1024 * 1024 + 4096

/** Fixed-purpose bridge to the materializer. The database verifies the scoped
 * stream credential, active writer, sequence and history hash before effects.
 * No Supabase service credential is ever shipped to a restaurant terminal. */
export async function POST(request: NextRequest) {
  let raw: string
  try { raw = await request.text() } catch { return Response.json({ error: 'INVALID_EVENT' }, { status: 400 }) }
  if (Buffer.byteLength(raw) > MAX_MATERIALIZE_BODY_BYTES) return Response.json({ error: 'EVENT_TOO_LARGE' }, { status: 413 })
  let input
  try { input = JSON.parse(raw) } catch { return Response.json({ error: 'INVALID_EVENT' }, { status: 400 }) }
  const { p_stream_id, p_credential, p_previous_history_hash, p_history_hash, p_event } = input || {}
  if (typeof p_stream_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(p_stream_id)
    || typeof p_credential !== 'string' || p_credential.length < 32 || p_credential.length > 256
    || ![p_previous_history_hash, p_history_hash].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
    || !p_event || typeof p_event !== 'object' || Array.isArray(p_event)) {
    return Response.json({ error: 'INVALID_EVENT' }, { status: 400 })
  }
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'SYNC_UNAVAILABLE' }, { status: 503 })
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/apply_pos_caja_event`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_stream_id, p_credential, p_previous_history_hash, p_history_hash, p_event }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await response.json()
    if (!response.ok) return Response.json({ error: result.message === 'SYNC_UNAUTHORIZED' ? 'SYNC_UNAUTHORIZED' : 'SYNC_REJECTED' },
      { status: result.message === 'SYNC_UNAUTHORIZED' ? 403 : 409 })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'SYNC_UNCONFIRMED' }, { status: 503 }) }
}
