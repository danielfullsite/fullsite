import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client with service role for creating users
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Auth: require admin secret or valid session
    const adminSecret = process.env.ONBOARDING_SECRET
    const providedSecret = request.headers.get('x-onboarding-secret')
    if (!adminSecret || providedSecret !== adminSecret) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { email, password, clientId, displayName } = await request.json()

    if (!email || !password || !clientId) {
      return NextResponse.json({ error: 'Email, password y clientId requeridos' }, { status: 400 })
    }

    // 1. Create auth user with client_id in metadata
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm — no email verification needed
      user_metadata: {
        client_id: clientId,
        display_name: displayName || '',
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

    // 2. Create client_users mapping
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

    return NextResponse.json({
      success: true,
      userId,
      message: `Usuario ${email} creado para ${clientId}`,
    })
  } catch (err) {
    console.error('[onboarding] Error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
