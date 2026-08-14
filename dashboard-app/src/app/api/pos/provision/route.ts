import { NextRequest, NextResponse } from 'next/server'

// La máquina nueva canjea el CÓDIGO de provisioning → recibe su config y arranca.
// No requiere sesión: el código es un secreto de un solo uso (se marca redeemed).
// Es /api/pos/* → el middleware lo deja pasar (no gate de login). El wizard de
// Electron lo llama vía el proceso main (sin CORS).

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function svc() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { code?: string; terminal_id?: string } | null
  const code = (body?.code || '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'CODE_REQUIRED' }, { status: 400 })

  const look = await fetch(
    `${SB_URL}/rest/v1/provisioning_tokens?code=eq.${encodeURIComponent(code)}&limit=1`,
    { headers: svc(), cache: 'no-store' },
  )
  if (!look.ok) return NextResponse.json({ error: 'DB_ERROR' }, { status: 502 })
  const [tok] = await look.json()
  if (!tok) return NextResponse.json({ error: 'CODE_NOT_FOUND' }, { status: 404 })
  if (tok.redeemed_at) return NextResponse.json({ error: 'CODE_ALREADY_USED' }, { status: 409 })
  if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'CODE_EXPIRED' }, { status: 410 })
  }

  // Marca canjeado (best-effort — aunque falle el PATCH, devolvemos la config).
  await fetch(`${SB_URL}/rest/v1/provisioning_tokens?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { ...svc(), Prefer: 'return=minimal' },
    body: JSON.stringify({ redeemed_at: new Date().toISOString(), redeemed_by_terminal: body?.terminal_id || null }),
  }).catch(() => {})

  // Config que el wizard aplica tal cual (offline-ready por rol).
  return NextResponse.json({
    ok: true,
    config: {
      restaurant_id: tok.client_id,
      terminal_role: tok.terminal_role,
      terminal_name: tok.terminal_name,
      pos_server_ip: tok.pos_server_ip,
      kds_station: tok.kds_station,
      local_ui: tok.local_ui !== false,
    },
  })
}
