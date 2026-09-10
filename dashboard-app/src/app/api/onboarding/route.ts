import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { onboardTenant, InvalidOnboardingInput } from '@/lib/onboard-tenant'

// Server-side Supabase client with service role for creating auth users.
// The SDK only resolves Auth identities. The shared onboarding contract creates
// the pending skeleton and commits memberships/activation together through
// PostgREST with service role. A retry never resets existing credentials.
//
// Perezoso a propósito: Next evalúa este módulo al recolectar los datos de página
// durante el build. Construido en scope de módulo, un build sin credenciales tronaba
// con "supabaseUrl is required" y se caía el build completo. Aquí sólo se construye
// cuando entra una petición de verdad, que es cuando las variables existen.
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    )
  }
  return _supabase
}

export async function POST(request: NextRequest) {
  try {
    // Auth: require admin secret — fail closed if not configured
    const adminSecret = process.env.ONBOARDING_SECRET
    if (!adminSecret) {
      return NextResponse.json({ error: 'Onboarding no configurado' }, { status: 503 })
    }
    const providedSecret = request.headers.get('x-onboarding-secret')
    if (providedSecret !== adminSecret) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Fail-closed: full provisioning requires the service_role key.
    if (!process.env.SUPABASE_SERVICE_KEY) {
      return NextResponse.json(
        { error: 'Onboarding no configurado (falta service key)' },
        { status: 503 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    const {
      email,
      password,
      clientId,
      displayName,
      // Optional brand / plan fields for the tenant skeleton
      display_name,
      accent_color,
      default_theme,
      logo_url,
      plan,
      mesas,
    } = body

    if (!email || !password || !clientId) {
      return NextResponse.json({ error: 'Email, password y clientId requeridos' }, { status: 400 })
    }

    const resolvedDisplayName = display_name || displayName || ''

    const result = await onboardTenant(getSupabase().auth.admin, {
      clientId, email, password, display_name: resolvedDisplayName || undefined,
      accent_color, default_theme, logo_url, plan, mesas,
    })
    if (!result.activation.active) {
      return NextResponse.json({ success: false, error: 'El restaurante permanece inactivo', ...result }, { status: 409 })
    }
    return NextResponse.json({ success: true, ...result, message: `Tenant ${clientId} dado de alta` })
  } catch (err) {
    console.error('[onboarding] alta incompleta')
    return NextResponse.json({ error: err instanceof InvalidOnboardingInput ? err.message : 'No se pudo completar el alta' }, { status: err instanceof InvalidOnboardingInput ? 400 : 500 })
  }
}
