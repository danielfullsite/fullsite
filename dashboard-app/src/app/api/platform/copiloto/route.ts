import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { runCopilot } from '@/lib/copilot'

// POST /api/platform/copiloto — turno del copiloto. Body: { messages: [{role,content}] }
// Devuelve { text, pendingAction? }. Las acciones NO se ejecutan aquí (se confirman aparte).
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { messages?: { role: 'user' | 'assistant'; content: string }[] } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  const messages = Array.isArray(body.messages) ? body.messages.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
  if (messages.length === 0) return Response.json({ error: 'messages requerido' }, { status: 400 })

  const today = new Date().toISOString().slice(0, 10)
  const result = await runCopilot(messages, today)
  return Response.json(result)
}
