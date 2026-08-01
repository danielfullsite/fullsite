import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'
import type { Outcome } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
      `id=eq.${id}`,
      { outcome, status: 'resolved' },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
