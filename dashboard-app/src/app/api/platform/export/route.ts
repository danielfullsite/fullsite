import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog } from '@/lib/platform-writes'

// Control Plane · GET /api/platform/export?client_id=X&dataset=menu — baja datos de
// un tenant a CSV. Via service_role (cross-tenant), gateado. Allowlist de datasets
// (sin queries arbitrarias). ?format=json para JSON.
export const dynamic = 'force-dynamic'

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

// dataset → { tabla, select, order, limit? }. Solo tablas pos_* con client_id.
const DATASETS: Record<string, { table: string; select: string; order?: string; limit?: number }> = {
  menu: { table: 'pos_menu_items', select: 'id,name,price,category_id,active,sort_order', order: 'sort_order' },
  categorias: { table: 'pos_menu_categories', select: 'id,name,color,sort_order,active', order: 'sort_order' },
  personal: { table: 'pos_staff', select: 'id,name,pin,role,role_display,active', order: 'name' },
  pagos: { table: 'pos_payment_methods', select: 'id,name,type,commission_pct,active', order: 'name' },
  mesas: { table: 'pos_mesas', select: 'number,capacity,zone,shape,active', order: 'number' },
  ordenes: { table: 'pos_orders', select: 'id,mesa,mesero,personas,status,subtotal,iva,total,descuento,propina,metodo_pago,turno_id,closed_at', order: 'closed_at.desc', limit: 5000 },
}

// Excel "a la antigüita": tabla HTML con MIME de Excel → se abre como hoja de
// cálculo (.xls) sin librerías. Es el mismo truco que usan muchos reportes clásicos.
function toXls(rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  if (rows.length === 0) return '<html><body><table></table></body></html>'
  const cols = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set }, new Set<string>()))
  const head = `<tr>${cols.map(c => `<th style="background:#eee;text-align:left">${esc(c)}</th>`).join('')}</tr>`
  const body = rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')
  return `<html><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0">${head}${body}</table></body></html>`
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set }, new Set<string>()))
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.join(',')
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n')
  return `${head}\n${body}`
}

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  const clientId = req.nextUrl.searchParams.get('client_id') || ''
  const dataset = req.nextUrl.searchParams.get('dataset') || ''
  const format = req.nextUrl.searchParams.get('format') || 'csv'
  if (!CLIENT_RE.test(clientId)) return Response.json({ error: 'client_id inválido' }, { status: 400 })
  const def = DATASETS[dataset]
  if (!def) return Response.json({ error: 'dataset no permitido' }, { status: 400 })

  let path = `${def.table}?client_id=eq.${encodeURIComponent(clientId)}&select=${def.select}`
  if (def.order) path += `&order=${def.order}`
  if (def.limit) path += `&limit=${def.limit}`

  const res = await platformServiceFetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) return Response.json({ error: `No se pudo exportar (${res.status})` }, { status: 502 })
  const rows: Record<string, unknown>[] = await res.json().catch(() => [])

  await auditLog(gate.ctx, { action: 'data.export', scope: 'tenant', target_tenant: clientId, detail: { dataset, filas: rows.length } })

  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'json') {
    return new Response(JSON.stringify(rows, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${clientId}-${dataset}-${stamp}.json"` },
    })
  }
  if (format === 'xls' || format === 'excel') {
    return new Response(toXls(rows), {
      headers: { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="${clientId}-${dataset}-${stamp}.xls"` },
    })
  }
  return new Response(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${clientId}-${dataset}-${stamp}.csv"` },
  })
}
