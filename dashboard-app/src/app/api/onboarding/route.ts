import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { onboardTenant } from '@/lib/onboard-tenant'

/** Adaptador legacy de administrador; comparte todos los gates del alta actual. */
export async function POST(request: NextRequest) {
  const adminSecret = process.env.ONBOARDING_SECRET
  if (!adminSecret || !process.env.SUPABASE_SERVICE_KEY) return NextResponse.json({ error: 'Onboarding no configurado' }, { status: 503 })
  const provided = Buffer.from(request.headers.get('x-onboarding-secret') || '')
  const expected = Buffer.from(adminSecret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const body = await request.json()
    const result = await onboardTenant({ clientId: body.clientId, email: body.email, password: body.password,
      display_name: body.display_name || body.displayName, accent_color: body.accent_color,
      default_theme: body.default_theme, logo_url: body.logo_url, mesas: body.mesas, plan: body.plan })
    return NextResponse.json({ ...result, success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Error interno',
      step: error && typeof error === 'object' && 'step' in error ? error.step : 'provision', retryable: true }, { status: 500 })
  }
}
