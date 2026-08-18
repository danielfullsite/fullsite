// Proxy Supabase autenticado para el Offline Shell.
//
// Por qué: desde la red del restaurante Cloudflare bloquea clientes no-navegador
// y ~30 tablas del POS están RLS-locked a anon. El Offline Shell (Electron) no
// puede leer/escribir Supabase directo. Este proxy corre en Vercel (que sí
// alcanza Supabase), autoriza con el shift token del POS (withPOSAuth) y **fuerza
// el client_id del token en cada request** → aislamiento por tenant garantizado
// aunque el proxy use service key. El interceptor de fetch del cliente reescribe
// ${SUPABASE_URL}/rest/v1/* → /api/pos/db/rest/v1/* con el shift token.
//
// Seguridad:
//  - Solo /rest/v1/pos_* (tablas del POS) y /rest/v1/rpc/<allowlist>.
//  - GET/PATCH/DELETE: inyecta client_id=eq.<tokenClientId> (PostgREST hace AND) →
//    una fila de otro tenant nunca matchea, aunque filtren por id.
//  - POST a tablas: fuerza client_id=<tokenClientId> en cada fila del body.
//  - RPC (BLINDAJE B1 · P0-2): allowlist de nombres + SE FUERZA p_client_id del token
//    en el body. Antes se reenviaba el body verbatim → un mesero mandaba
//    p_client_id:"otro-tenant" y forjaba órdenes/stock ajenos. Ahora el param del
//    tenant lo pone el servidor, no el caller.

import { NextRequest, NextResponse } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// RPCs que el POS puede invocar por el proxy. Todos toman p_client_id (que forzamos).
const RPC_ALLOW = /^(r1_[a-z0-9_]+|activate_recipe_version)$/

function forbidden(msg: string) {
  return NextResponse.json({ error: msg }, { status: 403 })
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  const clientId = auth.clientId

  const { path } = await ctx.params
  const rel = (path || []).join('/')
  if (!rel.startsWith('rest/v1/')) return forbidden('solo /rest/v1/*')
  const resource = rel.slice('rest/v1/'.length)
  const isRpc = resource.startsWith('rpc/')
  if (isRpc) {
    const rpcName = resource.slice('rpc/'.length).split('?')[0]
    if (!RPC_ALLOW.test(rpcName)) return forbidden('rpc no permitido')
  } else if (!resource.startsWith('pos_')) {
    return forbidden('solo tablas pos_*')
  }

  // Query params del request original + forzar client_id salvo en inserts/rpc.
  const params = new URLSearchParams(req.nextUrl.search)
  if (!isRpc && req.method !== 'POST') {
    params.set('client_id', `eq.${clientId}`)
  }
  const qs = params.toString()
  const target = `${SUPABASE_URL}/rest/v1/${resource}${qs ? `?${qs}` : ''}`

  // Body: en POST a tablas pos_, forzar client_id del token en cada fila.
  let body: string | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await req.text().catch(() => '')
    if (raw && isRpc) {
      // Forzar p_client_id del token (el caller NO decide el tenant del RPC).
      try {
        const parsed = JSON.parse(raw)
        body = JSON.stringify({ ...parsed, p_client_id: clientId })
      } catch {
        body = raw
      }
    } else if (raw && !isRpc && req.method === 'POST') {
      try {
        const parsed = JSON.parse(raw)
        const withCid = Array.isArray(parsed)
          ? parsed.map((r) => ({ ...r, client_id: clientId }))
          : { ...parsed, client_id: clientId }
        body = JSON.stringify(withCid)
      } catch {
        body = raw
      }
    } else {
      body = raw || undefined
    }
  }

  // Headers que respeta PostgREST del request original (Prefer, Range, Content-Type).
  const fwd: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  const prefer = req.headers.get('prefer'); if (prefer) fwd['Prefer'] = prefer
  const range = req.headers.get('range'); if (range) fwd['Range'] = range

  try {
    const r = await fetch(target, { method: req.method, headers: fwd, body })
    const text = await r.text()
    const res = new NextResponse(text, { status: r.status })
    const ct = r.headers.get('content-type'); if (ct) res.headers.set('content-type', ct)
    const cr = r.headers.get('content-range'); if (cr) res.headers.set('content-range', cr)
    return res
  } catch {
    return NextResponse.json({ error: 'proxy error' }, { status: 502 })
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
