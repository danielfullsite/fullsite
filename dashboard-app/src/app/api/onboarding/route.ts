import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { provisionTenant } from '@/lib/provision-tenant'

// Server-side Supabase client with service role for creating auth users.
// NOTE: the SDK is used ONLY for the Auth Admin API (createUser) + the client_users
// mapping — the existing, working behavior. All TENANT DATA provisioning goes through
// provisionTenant() (PostgREST + service_role), per the domain-contract rule.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    const body = await request.json()
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

    // 1. Create auth user with client_id in metadata
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm — no email verification needed
      user_metadata: {
        client_id: clientId,
        display_name: resolvedDisplayName,
      },
    })

    if (authError) {
      console.error('[onboarding] Auth error:', authError)
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 })
    }

    // 2. Create client_users mapping (owner)
    try {
      await supabase.from('client_users').insert({
        user_id: userId,
        client_id: clientId,
        role: 'dueño',
        created_at: new Date().toISOString(),
      })
    } catch {
      // Table might not exist — OK, user_metadata has client_id as fallback
    }

    // 3. Provision the full tenant skeleton (idempotent, config-driven).
    const provision = await provisionTenant({
      clientId,
      display_name: resolvedDisplayName || undefined,
      accent_color,
      default_theme,
      logo_url,
      plan,
      mesas,
    })

    return NextResponse.json({
      success: true,
      userId,
      clientId,
      provisioned: provision.created,
      message: `Tenant ${clientId} dado de alta con usuario ${email}`,
    })
  } catch (err) {
    console.error('[onboarding] Error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
