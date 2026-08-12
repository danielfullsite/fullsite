import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { ACTION_TOOLS } from '@/lib/copilot'

// POST /api/platform/copiloto/execute — ejecuta una acción YA CONFIRMADA por el humano.
// Body: { tool, input }. Reenvía al endpoint /api/platform/* correspondiente (allowlist),
// que ya aplica auth + auditoría + rate-limit. No permite endpoints arbitrarios.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { tool?: string; input?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }

  const def = body.tool ? ACTION_TOOLS[body.tool] : undefined
  if (!def) return Response.json({ error: 'Acción no permitida' }, { status: 400 })

  const payload = def.buildBody(body.input || {})
  // Reenvía al endpoint real con la sesión del admin (cookie/authorization).
  const res = await fetch(`${req.nextUrl.origin}${def.endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: req.headers.get('cookie') || '',
      authorization: req.headers.get('authorization') || '',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const result = await res.json().catch(() => ({}))
  return Response.json({ ok: res.ok, status: res.status, result }, { status: res.ok ? 200 : res.status })
}
