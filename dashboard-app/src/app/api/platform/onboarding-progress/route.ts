import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { normalizeProgress, nextStep, isComplete, isSecretFree } from '@/lib/onboarding-wizard'

// Progreso del wizard de alta, reanudable e idempotente. Se guarda en
// clients.pos_settings['onboarding.progress'] (reusa el sistema de settings; sin tabla nueva).
// Admin-gated (2FA) + service_role.
//   GET ?clientId=X            → { progress, nextStep, complete }
//   PUT { clientId, progress }  → guarda el progreso saneado; RECHAZA si trae secretos
//
// Gate: factory.wizard_resumable (el cliente decide si usa este endpoint). Sin él, el wizard
// legacy (client-only) sigue funcionando igual.

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const PROGRESS_KEY = 'onboarding.progress'

async function leerPosSettings(clientId: string): Promise<Record<string, unknown>> {
  const res = await platformServiceFetch(
    `clients?id=eq.${encodeURIComponent(clientId)}&select=pos_settings&limit=1`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) return {}
  const rows = await res.json().catch(() => [])
  return (Array.isArray(rows) && rows[0]?.pos_settings) || {}
}

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const clientId = req.nextUrl.searchParams.get('clientId') || ''
  if (!CLIENT_RE.test(clientId)) return NextResponse.json({ error: 'clientId inválido' }, { status: 400 })

  try {
    const settings = await leerPosSettings(clientId)
    const progress = normalizeProgress(settings[PROGRESS_KEY])
    // Estado vacío = wizard sin empezar: progress.completed [], nextStep 'cliente'.
    return NextResponse.json({ progress, nextStep: nextStep(progress), complete: isComplete(progress) })
  } catch {
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  let body: { clientId?: string; progress?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const clientId = body.clientId || ''
  if (!CLIENT_RE.test(clientId)) return NextResponse.json({ error: 'clientId inválido' }, { status: 400 })

  // Nunca exportar secretos: si el progreso trae una llave secreta, se RECHAZA (no se enmascara,
  // no se guarda a medias). El cliente debe mandar estado ya sin secretos.
  if (!isSecretFree(body.progress)) {
    return NextResponse.json({ error: 'el progreso no puede contener secretos (pin/token/contraseña…)' }, { status: 400 })
  }
  const progress = normalizeProgress(body.progress) // saneo defensivo + normalización
  progress.updatedAt = new Date().toISOString()

  try {
    // Merge idempotente: lee settings, fija sólo la llave de progreso, reescribe.
    const settings = await leerPosSettings(clientId)
    const merged = { ...settings, [PROGRESS_KEY]: progress }
    const res = await platformServiceFetch(`clients?id=eq.${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ pos_settings: merged }),
    })
    if (!res.ok) return NextResponse.json({ error: `write failed ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true, progress, nextStep: nextStep(progress), complete: isComplete(progress) })
  } catch {
    return NextResponse.json({ error: 'write failed' }, { status: 500 })
  }
}
