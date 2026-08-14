import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-auth'

// Consola de flota — el admin (daniel@fullsite.mx) crea la config de una terminal
// y obtiene un CÓDIGO. La máquina lo canjea en /api/pos/provision. Gated por
// PLATFORM_ADMIN_EMAILS + service key server-side.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function svc() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' }
}

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L). Código legible ej. ABC3-9XQ2.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-'
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return s
}

const VALID_ROLES = ['server_pos', 'pos', 'kds', 'admin']

export async function POST(req: NextRequest) {
  const admin = await requirePlatformAdmin(req)
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as {
    client_id?: string
    terminal_role?: string
    terminal_name?: string
    pos_server_ip?: string | null
    kds_station?: string | null
    local_ui?: boolean
    expires_hours?: number
  } | null

  if (!body?.client_id || !body?.terminal_role || !body?.terminal_name) {
    return NextResponse.json({ error: 'client_id, terminal_role y terminal_name son requeridos' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(body.terminal_role)) {
    return NextResponse.json({ error: 'terminal_role inválido' }, { status: 400 })
  }

  const code = makeCode()
  const row = {
    code,
    client_id: body.client_id.trim(),
    terminal_role: body.terminal_role,
    terminal_name: body.terminal_name.trim(),
    pos_server_ip: body.terminal_role === 'server_pos' ? null : (body.pos_server_ip || null),
    kds_station: body.terminal_role === 'kds' ? (body.kds_station || 'cocina') : null,
    local_ui: body.local_ui !== false,
    created_by: admin,
    expires_at: body.expires_hours ? new Date(Date.now() + body.expires_hours * 3600_000).toISOString() : null,
  }

  const res = await fetch(`${SB_URL}/rest/v1/provisioning_tokens`, {
    method: 'POST',
    headers: { ...svc(), Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!res.ok) return NextResponse.json({ error: 'DB_ERROR', detail: await res.text().catch(() => '') }, { status: 502 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, code, terminal: created })
}

export async function GET(req: NextRequest) {
  const admin = await requirePlatformAdmin(req)
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const client = req.nextUrl.searchParams.get('client_id')
  const q = client
    ? `provisioning_tokens?client_id=eq.${encodeURIComponent(client)}&order=created_at.desc&limit=200`
    : `provisioning_tokens?order=created_at.desc&limit=200`
  const res = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: svc(), cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'DB_ERROR' }, { status: 502 })
  return NextResponse.json({ terminals: await res.json() })
}
