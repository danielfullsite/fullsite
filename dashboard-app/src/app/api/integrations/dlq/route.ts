import { type NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth, unauthorizedResponse } from '@/lib/integrations/admin-auth'
import { processRappiOrder } from '@/lib/integrations/rappi/ingest'
import { processVerifiedUberPayload } from '@/lib/integrations/uber-eats/webhook-handler'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DLQ_LEASE_MS = 5 * 60 * 1000

function dbConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_KEY?.trim()
  return url && key ? { url, key } : null
}

function headers(key: string, prefer?: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request).ok) return unauthorizedResponse()
  const db = dbConfig()
  if (!db) return NextResponse.json({ ok: false, error: 'SERVICE_DB_REQUIRED' }, { status: 503 })

  const res = await fetch(
    `${db.url}/rest/v1/integration_webhook_dlq?status=neq.resolved` +
    '&select=id,provider,event_type,client_id,failure_reason,status,attempts,last_error,claimed_at,created_at,updated_at' +
    '&order=created_at.asc&limit=200',
    { headers: headers(db.key), cache: 'no-store' },
  )
  if (!res.ok) return NextResponse.json({ ok: false, error: 'DLQ_READ_FAILED' }, { status: 502 })
  const rows = await res.json().catch(() => [])
  return NextResponse.json({ ok: true, pending: Array.isArray(rows) ? rows.length : 0, entries: rows })
}

export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request).ok) return unauthorizedResponse()
  const db = dbConfig()
  if (!db) return NextResponse.json({ ok: false, error: 'SERVICE_DB_REQUIRED' }, { status: 503 })

  const body = await request.json().catch(() => ({})) as { id?: string }
  const id = String(body.id || '')
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'INVALID_DLQ_ID' }, { status: 400 })

  const read = await fetch(
    `${db.url}/rest/v1/integration_webhook_dlq?id=eq.${encodeURIComponent(id)}&status=neq.resolved&select=*&limit=1`,
    { headers: headers(db.key), cache: 'no-store' },
  )
  const rows = read.ok ? await read.json().catch(() => []) : []
  const candidate = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined
  if (!candidate) return NextResponse.json({ ok: false, error: 'DLQ_ENTRY_NOT_FOUND' }, { status: 404 })

  // Compare-and-swap con lease: dos operadores no reprocesan la misma orden a
  // la vez, pero un worker muerto tampoco la congela para siempre.
  const now = new Date()
  const leaseCutoff = new Date(now.getTime() - DLQ_LEASE_MS)
  const status = String(candidate.status || '')
  const claimedAtMs = typeof candidate.claimed_at === 'string' ? Date.parse(candidate.claimed_at) : Number.NaN
  const expiredProcessing = status === 'processing' && (!Number.isFinite(claimedAtMs) || claimedAtMs < leaseCutoff.getTime())
  if (!['pending', 'failed'].includes(status) && !expiredProcessing) {
    return NextResponse.json({ ok: false, error: 'DLQ_ENTRY_BUSY' }, { status: 409 })
  }

  const attempts = Number(candidate.attempts || 0) + 1
  const claimToken = crypto.randomUUID()
  const claimFilter = expiredProcessing
    ? `status=eq.processing&or=(claimed_at.is.null,claimed_at.lt.${encodeURIComponent(leaseCutoff.toISOString())})`
    : 'status=in.(pending,failed)'
  const claim = await fetch(
    `${db.url}/rest/v1/integration_webhook_dlq?id=eq.${encodeURIComponent(id)}&${claimFilter}`,
    {
      method: 'PATCH',
      headers: headers(db.key, 'return=representation'),
      body: JSON.stringify({
        status: 'processing', attempts, last_error: null,
        claimed_at: now.toISOString(), claim_token: claimToken, updated_at: now.toISOString(),
      }),
    },
  )
  const claimedRows = claim.ok ? await claim.json().catch(() => []) : []
  const entry = Array.isArray(claimedRows) ? claimedRows[0] as Record<string, unknown> | undefined : undefined
  if (!entry) return NextResponse.json({ ok: false, error: 'DLQ_ENTRY_BUSY' }, { status: 409 })

  const correlationId = crypto.randomUUID()
  try {
    let action: string
    let orderId: string | undefined
    if (entry.provider === 'rappi') {
      // quarantine:false evita crear otra fila DLQ cuando la causa sigue viva.
      const result = await processRappiOrder(entry.payload, 'manual', correlationId, { quarantine: false })
      if (result.action === 'dlq') throw new Error(result.reason || 'RAPPI_REPLAY_REJECTED')
      action = result.action
      orderId = result.orderId
    } else if (entry.provider === 'ubereats') {
      const result = await processVerifiedUberPayload(entry.payload as Record<string, unknown>, { skipDlqOnError: true })
      if (!result.ok) throw new Error(result.error || 'UBER_REPLAY_REJECTED')
      action = 'processed'
    } else {
      throw new Error(`UNSUPPORTED_PROVIDER_${String(entry.provider)}`)
    }

    const resolvedAt = new Date().toISOString()
    const persisted = await fetch(
      `${db.url}/rest/v1/integration_webhook_dlq?id=eq.${encodeURIComponent(id)}` +
      `&status=eq.processing&claim_token=eq.${encodeURIComponent(claimToken)}`,
      {
      method: 'PATCH',
      headers: headers(db.key, 'return=minimal'),
      body: JSON.stringify({
        status: 'resolved', resolved_at: resolvedAt, last_error: null,
        claimed_at: null, claim_token: null, updated_at: resolvedAt,
      }),
    })
    if (!persisted.ok) throw new Error(`DLQ_RESOLUTION_PERSIST_FAILED_${persisted.status}`)
    return NextResponse.json({ ok: true, id, provider: entry.provider, action, order_id: orderId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await fetch(
      `${db.url}/rest/v1/integration_webhook_dlq?id=eq.${encodeURIComponent(id)}` +
      `&status=eq.processing&claim_token=eq.${encodeURIComponent(claimToken)}`,
      {
      method: 'PATCH',
      headers: headers(db.key, 'return=minimal'),
      body: JSON.stringify({
        status: 'failed', last_error: message.slice(0, 1000),
        claimed_at: null, claim_token: null, updated_at: new Date().toISOString(),
      }),
    }).catch(() => null)
    return NextResponse.json({ ok: false, error: 'DLQ_REPLAY_FAILED', detail: message }, { status: 422 })
  }
}
