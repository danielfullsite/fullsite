import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { rateLimit, auditLog } from '@/lib/platform-writes'

// Control Plane · POST /api/platform/import — sube filas (menú/categorías/pagos) a
// un tenant. mode:'validate' → valida + preview; mode:'commit' → upsert. Nunca
// escribe sin confirmar. Via service_role, gateado, allowlist de datasets.
export const dynamic = 'force-dynamic'

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
type Row = Record<string, string>

function slug(s: string): string {
  return (s || '').toLowerCase().normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}
const num = (v: string) => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : NaN }
const int = (v: string, d = 0) => { const n = parseInt(String(v), 10); return isFinite(n) ? n : d }
const bool = (v: string, d = true) => { const s = String(v).trim().toLowerCase(); if (['true', '1', 'si', 'sí', 'activo', 'yes'].includes(s)) return true; if (['false', '0', 'no', 'inactivo'].includes(s)) return false; return d }

interface Spec {
  table: string
  onConflict: string
  build: (client: string, r: Row) => { row: Record<string, unknown> | null; error: string | null }
}
const SPECS: Record<string, Spec> = {
  menu: {
    table: 'pos_menu_items', onConflict: 'id',
    build: (client, r) => {
      const name = (r.name || r.nombre || '').trim()
      const price = num(r.price ?? r.precio)
      if (!name) return { row: null, error: 'falta name/nombre' }
      if (isNaN(price)) return { row: null, error: `price inválido ("${r.price ?? r.precio ?? ''}")` }
      const id = (r.id || '').trim() || `${client}-${slug(name)}`
      return { row: { id, client_id: client, name, price, category_id: (r.category_id || null) || null, active: bool(r.active ?? r.activo, true), sort_order: int(r.sort_order ?? r.orden, 0) }, error: null }
    },
  },
  categorias: {
    table: 'pos_menu_categories', onConflict: 'id',
    build: (client, r) => {
      const name = (r.name || r.nombre || '').trim()
      if (!name) return { row: null, error: 'falta name/nombre' }
      const id = (r.id || '').trim() || `${client}-${slug(name)}`
      return { row: { id, client_id: client, name, color: r.color || null, sort_order: int(r.sort_order ?? r.orden, 0), active: bool(r.active ?? r.activo, true) }, error: null }
    },
  },
  pagos: {
    table: 'pos_payment_methods', onConflict: 'id',
    build: (client, r) => {
      const name = (r.name || r.nombre || '').trim()
      if (!name) return { row: null, error: 'falta name/nombre' }
      const id = (r.id || '').trim() || `${client}-pm-${slug(name)}`
      return { row: { id, client_id: client, name, type: (r.type || r.tipo || 'other'), commission_pct: isNaN(num(r.commission_pct)) ? 0 : num(r.commission_pct), active: bool(r.active ?? r.activo, true) }, error: null }
    },
  },
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { client_id?: string; dataset?: string; rows?: Row[]; mode?: 'validate' | 'commit' } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  const { client_id, dataset, mode } = body
  if (!client_id || !CLIENT_RE.test(client_id)) return Response.json({ error: 'client_id inválido' }, { status: 400 })
  const spec = dataset ? SPECS[dataset] : undefined
  if (!spec) return Response.json({ error: 'dataset no permitido (menu | categorias | pagos)' }, { status: 400 })
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : []
  if (rows.length === 0) return Response.json({ error: 'sin filas' }, { status: 400 })

  const valid: Record<string, unknown>[] = []
  const errors: { fila: number; error: string }[] = []
  rows.forEach((r, i) => {
    const { row, error } = spec.build(client_id, r)
    if (error) errors.push({ fila: i + 1, error })
    else if (row) valid.push(row)
  })

  if (mode !== 'commit') {
    return Response.json({ total: rows.length, validas: valid.length, errores: errors.slice(0, 50), preview: valid.slice(0, 5) })
  }

  // commit
  const limited = rateLimit(gate.ctx)
  if (limited) return limited
  if (valid.length === 0) return Response.json({ error: 'no hay filas válidas para importar' }, { status: 400 })

  const res = await platformServiceFetch(`${spec.table}?on_conflict=${spec.onConflict}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(valid),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `No se pudo importar (${res.status})`, detail }, { status: 502 })
  }
  await auditLog(gate.ctx, { action: 'data.import', scope: 'tenant', target_tenant: client_id, detail: { dataset, filas: valid.length } })
  return Response.json({ ok: true, importadas: valid.length, ignoradas: errors.length })
}
