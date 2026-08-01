import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    await sbPatch('agent_events', `id=eq.${id}`, { status: 'acknowledged' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
