import { NextRequest } from 'next/server'

// ─── Sync de templates de huella (service_role del lado SERVIDOR) ─────────────
// El servicio local de huella (print-bridge/fingerprint-service.exe) corre en la caja y
// NO debe tener el service_role (= llave maestra de TODOS los clientes). En vez de eso,
// manda un secreto ACOTADO (FINGERPRINT_SYNC_SECRET) y ESTE endpoint hace la escritura con
// service_role aquí, del lado servidor. Así una caja comprometida no expone la BD entera.
//
// Tabla: pos_fingerprint_templates (id TEXT PK = staff_id, client_id, template, updated_at).
// RLS: service_role bypassa; authenticated puede SELECT su propio client. El template es
// dato biométrico → nunca se expone al cliente-navegador; solo el servicio local lo consume.

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
}

// El servicio de huella se autentica con un secreto dedicado (NO el service_role).
function authorized(req: NextRequest): boolean {
  const secret = process.env.FINGERPRINT_SYNC_SECRET
  if (!secret || secret.length < 16) return false // sin secreto fuerte configurado → cerrado
  return (req.headers.get('x-fp-secret') || '') === secret
}

const CID_RE = /^[a-z0-9_-]{1,40}$/i

// GET ?client_id=X → { templates: [{ id, template }] }  (para sincronizar hacia la caja)
export async function GET(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: 'no autorizado' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('client_id') || ''
  if (!CID_RE.test(clientId)) return Response.json({ error: 'client_id inválido' }, { status: 400 })
  const { url, headers } = sb()
  const res = await fetch(
    `${url}/rest/v1/pos_fingerprint_templates?client_id=eq.${encodeURIComponent(clientId)}&select=id,template`,
    { headers, cache: 'no-store' }
  )
  const templates = res.ok ? await res.json() : []
  return Response.json({ templates })
}

// POST { client_id, staff_id, template }  (upsert de un template)
export async function POST(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: 'no autorizado' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const clientId = typeof b.client_id === 'string' ? b.client_id : ''
  const staffId = typeof b.staff_id === 'string' ? b.staff_id : ''
  const template = typeof b.template === 'string' ? b.template : ''
  if (!CID_RE.test(clientId) || !staffId || !template) return Response.json({ error: 'faltan campos' }, { status: 400 })
  const { url, headers } = sb()
  const res = await fetch(`${url}/rest/v1/pos_fingerprint_templates`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: staffId, client_id: clientId, template, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) return Response.json({ error: 'no se pudo guardar' }, { status: 502 })
  return Response.json({ ok: true })
}

// DELETE ?client_id=X&staff_id=Y
export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: 'no autorizado' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('client_id') || ''
  const staffId = req.nextUrl.searchParams.get('staff_id') || ''
  if (!CID_RE.test(clientId) || !staffId) return Response.json({ error: 'faltan params' }, { status: 400 })
  const { url, headers } = sb()
  const res = await fetch(
    `${url}/rest/v1/pos_fingerprint_templates?id=eq.${encodeURIComponent(staffId)}&client_id=eq.${encodeURIComponent(clientId)}`,
    { method: 'DELETE', headers }
  )
  if (!res.ok) return Response.json({ error: 'no se pudo borrar' }, { status: 502 })
  return Response.json({ ok: true })
}
