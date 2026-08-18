import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'
import type { Outcome } from '@/lib/agents/types'
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'

// BLINDAJE B1 (P0-4): auth + scoping por client_id (antes: PATCH por id sin auth).

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originBlock = sameOriginOnly(req); if (originBlock) return originBlock
  const auth = await withPOSAuth(req)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: { outcome?: Outcome } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const outcome = body.outcome
  if (!outcome || !['correct', 'false_positive'].includes(outcome)) {
    return NextResponse.json({ error: 'outcome must be correct or false_positive' }, { status: 400 })
  }

  try {
    await sbPatch(
      'agent_events',
      `id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(auth.clientId)}`,
      { outcome, status: 'resolved' },
    )
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
