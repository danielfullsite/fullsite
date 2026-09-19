import { NextRequest, NextResponse } from 'next/server'
import type { POSAuthContext } from './api-auth'
import { ALLOW, CHILD_SCOPE, DOMAIN_ONLY_WRITE, MANAGER_ONLY_WRITE, SCOPED_REFERENCES, isManager, redactResponse } from './pos-db-policy'

const reject = (message: string, status = 403) => Object.assign(new Error(message), { status })
const safeId = (id: unknown): id is string | number => (typeof id === 'string' && /^[\w.-]{1,160}$/.test(id)) || (typeof id === 'number' && Number.isSafeInteger(id))
const listFilter = (ids: Array<string | number>) => `in.(${ids.map(String).join(',')})`

/** Ambos adaptadores HTTP comparten exactamente esta frontera service-role. */
export async function runPOSDBProxy(request: NextRequest, resource: string, method: string, auth: POSAuthContext) {
  try {
    const [pathname, ...queryParts] = resource.split('?')
    const match = /^(?:rest\/v1\/)?(pos_[a-z0-9_]+)$/.exec(pathname)
    if (!match || queryParts.length > 1 || !ALLOW.has(match[1])) throw reject('tabla o ruta no permitida')
    const table = match[1]
    const isWrite = !['GET', 'HEAD'].includes(method)
    if (isWrite && DOMAIN_ONLY_WRITE.has(table)) throw reject(table === 'pos_staff' ? 'Administra el personal desde Equipo' : 'Usa el dominio de movimientos de inventario')
    if (isWrite && MANAGER_ONLY_WRITE.has(table) && !isManager(auth.role)) throw reject('se requiere rol de gerente')
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !base) throw reject('proxy no configurado', 503)
    const headers: Record<string, string> = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    async function rowsOf(targetTable: string, params: URLSearchParams): Promise<Record<string, unknown>[]> {
      const response = await fetch(`${base}/rest/v1/${targetTable}?${params}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw reject('No se pudo comprobar pertenencia de los datos', 503)
      const rows = await response.json()
      if (!Array.isArray(rows)) throw reject('Respuesta de pertenencia inválida', 503)
      return rows
    }
    const params = new URLSearchParams(queryParts[0] || '')
    // Aliasing a secret (select=secret:pin) bypasses output-key redaction.
    // Filtering/counting on it would also turn the proxy into a PIN oracle.
    for (const [key, value] of params) {
      if (/(^|[^a-z0-9_])(pin|template|template_data)(?=$|[^a-z0-9_])/i.test(`${key} ${value}`)) throw reject('No se permiten consultas sobre credenciales')
    }
    // PostgREST columns= puede descartar el client_id que acabamos de sellar.
    params.delete('columns')
    const child = CHILD_SCOPE[table]
    const conflict = params.get('on_conflict')?.split(',') || []
    if (conflict.length && !(conflict.length === 1 && conflict[0] === 'id') && !conflict.includes(child?.key || 'client_id')) throw reject('La clave de upsert debe incluir la identidad del restaurante/padre')
    let parentIds: Array<string | number> = []
    if (child) {
      for (let offset = 0; ; offset += 500) {
        if (offset >= 10000) throw reject('Demasiados padres; usa la ruta específica del dominio', 503)
        const rows = await rowsOf(child.parent, new URLSearchParams({ client_id: `eq.${auth.clientId}`, select: 'id', order: 'id.asc', limit: '500', offset: String(offset) }))
        parentIds.push(...rows.map(row => row.id).filter(safeId))
        if (rows.length < 500) break
      }
      // AND adicional: conserva los filtros de compra/receta del caller.
      params.append(child.key, parentIds.length ? listFilter(parentIds) : 'is.null')
      params.delete('client_id')
    } else params.set('client_id', `eq.${auth.clientId}`)

    let body: string | undefined
    if (isWrite) {
      const raw = await request.text()
      if (raw) {
        let parsed: unknown
        try { parsed = JSON.parse(raw) } catch { throw reject('JSON inválido', 400) }
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        if (!rows.length || rows.length > 500 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw reject('Body inválido (máximo 500 filas)', 400)
        for (const row of rows as Record<string, unknown>[]) {
          for (const key of ['client_id', 'restaurant_id', 'tenant_id']) {
            if (row[key] !== undefined && row[key] !== auth.clientId) throw reject('La identidad del restaurante es inmutable')
          }
          if (method === 'PATCH' && ['id', 'location_id', 'branch_id', ...(child ? [child.key] : [])].some(key => key in row)) throw reject('La identidad de la fila/sucursal es inmutable')
          if (child && method === 'POST' && !parentIds.some(id => String(id) === String(row[child.key]))) throw reject('El padre no pertenece al restaurante')
          if (table === 'pos_ingredients' && 'cost_per_unit' in row && !(method === 'POST' && row.cost_per_unit === 0)) throw reject('El costo se modifica mediante una entrada de inventario')
          if (row.id !== undefined && !safeId(row.id)) throw reject('ID inválido', 400)
          const references = { ...(SCOPED_REFERENCES[table] || {}), location_id: 'client_locations' }
          if (table === 'pos_sub_recipe_ingredients' && row.ingredient_type === 'sub_recipe') (references as Record<string, string>).ingredient_id = 'pos_sub_recipes'
          for (const [key, parent] of Object.entries(references)) {
            if (row[key] === undefined || row[key] === null) continue
            if (!safeId(row[key])) throw reject('Referencia inválida', 400)
            const found = await rowsOf(parent, new URLSearchParams({ id: `eq.${row[key]}`, client_id: `eq.${auth.clientId}`, select: 'id', limit: '1' }))
            if (!found.length) throw reject('Referencia de otro restaurante')
          }
          if (!child) row.client_id = auth.clientId
          else delete row.client_id
        }
        // POST/upsert con PK conocida también puede reasignar una fila ajena,
        // aunque el filtro del PATCH esté cerrado. Comprobar todos los IDs antes
        // del primer write; no permitir que merge-duplicates cambie el tenant.
        const ids = (rows as Record<string, unknown>[]).map(row => row.id).filter(safeId)
        if (method === 'POST' && ids.length) {
          const existing = await rowsOf(table, new URLSearchParams({ id: listFilter(ids), select: child ? `id,${child.key}` : 'id,client_id', limit: '500' }))
          if (existing.some(row => child ? !parentIds.some(id => String(id) === String(row[child.key])) : row.client_id !== auth.clientId)) throw reject('ID existente pertenece a otro restaurante')
        }
        body = JSON.stringify(Array.isArray(parsed) ? rows : rows[0])
      }
    }
    const prefer = request.headers.get('prefer'); if (prefer) headers.Prefer = prefer
    const range = request.headers.get('range'); if (range) headers.Range = range
    const response = await fetch(`${base}/rest/v1/${table}?${params}`, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(10000) })
    const contentType = response.headers.get('content-type')
    const text = redactResponse(table, await response.text(), contentType)
    const output = new NextResponse([204, 205, 304].includes(response.status) ? null : text, { status: response.status })
    if (contentType) output.headers.set('content-type', contentType)
    const contentRange = response.headers.get('content-range'); if (contentRange) output.headers.set('content-range', contentRange)
    return output
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 502
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error del proxy' }, { status })
  }
}
