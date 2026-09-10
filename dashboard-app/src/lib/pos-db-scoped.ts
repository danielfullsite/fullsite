import { NO_CID } from './pos-db-policy'

/** Operations whose ownership cannot be enforced by a simple client_id filter
 * use fixed SQL contracts. No fall back to unrestricted service-role REST when
 * their candidate migrations are unavailable. */
export async function scopedProxyRequest(options: {
  table: string; method: string; params: URLSearchParams; body?: string
  prefer: string | null; range: string | null; clientId: string; url: string; key: string
}): Promise<Response | null> {
  const { table, method, params, body, prefer, range, clientId, url, key } = options
  const child = NO_CID.has(table)
  const merge = method === 'POST' && /(?:^|,)\s*resolution\s*=\s*merge-duplicates\s*(?:,|$)/i.test(prefer || '')
  if (!child && !merge) return null
  const rpc = child ? 'pos_scoped_child' : 'pos_scoped_upsert'
  const args: Record<string, unknown> = { p_table: table, p_client_id: clientId }
  if (child) {
    const parent = table === 'pos_purchase_order_items' ? 'order_id' : 'sub_recipe_id'
    if (merge || range || [...params.keys()].some(k => !['id',parent,'select','limit','offset','order'].includes(k))) {
      return Response.json({ error: 'consulta de tabla hija no permitida' }, { status: 400 })
    }
    const eq = (name: string) => {
      const value = params.get(name)
      if (params.getAll(name).length > 1 || (value !== null && (!value.startsWith('eq.') || value.length <= 3))) throw new Error('INVALID_FILTER')
      return value?.slice(3) ?? null
    }
    try {
      args.p_id = eq('id'); args.p_parent_id = eq(parent)
      args.p_limit = Number(params.get('limit') ?? '1000'); args.p_offset = Number(params.get('offset') ?? '0')
      if (!Number.isSafeInteger(args.p_limit) || Number(args.p_limit) < 1 || Number(args.p_limit) > 1000 || !Number.isSafeInteger(args.p_offset) || Number(args.p_offset) < 0 ||
          (params.has('order') && params.get('order') !== 'id.asc')) throw new Error('INVALID_RANGE')
    } catch { return Response.json({ error: 'filtro de tabla hija inválido' }, { status: 400 }) }
    args.p_method = method
  } else {
    const conflict = (params.get('on_conflict') || 'id').split(',')
    if (!conflict.every(c => /^[a-z_][a-z0-9_]*$/.test(c)) || (conflict.join(',') !== 'id' && !conflict.includes('client_id'))) {
      return Response.json({ error: 'clave de conflicto sin restaurante' }, { status: 403 })
    }
    args.p_conflict = conflict
  }
  if (body) args.p_rows = JSON.parse(body)
  try {
    const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await response.json()
    if (!response.ok) {
      const unavailable = response.status >= 500 || ['PGRST202','42883'].includes(result?.code)
      return Response.json({ error: unavailable ? 'SCOPED_PROXY_UNAVAILABLE' : 'SCOPED_PROXY_REJECTED' }, { status: unavailable ? 503 : 409 })
    }
    let rows = child ? result.rows : result
    if (!Array.isArray(rows)) return Response.json({ error: 'SCOPED_PROXY_UNCONFIRMED' }, { status: 503 })
    const select = params.get('select')
    if (select && select !== '*') {
      const fields = select.split(',')
      rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([field]) => fields.includes(field))))
    }
    // Return rows even when the caller asks for minimal; an ordinary PostgREST
    // consumer may ignore them, but a confirmed receipt never becomes an error.
    return Response.json(rows, { headers: { 'Cache-Control': 'no-store', ...(child && method === 'GET' ? {
      'Content-Range': rows.length ? `${Number(args.p_offset)}-${Number(args.p_offset) + rows.length - 1}/${result.total}` : `*/${result.total}`,
    } : {}) } })
  } catch { return Response.json({ error: 'SCOPED_PROXY_UNCONFIRMED' }, { status: 503 }) }
}
