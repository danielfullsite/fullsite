/**
 * POS DB proxy — Fase B del anti-hack.
 *
 * Las terminales POS entran con PIN → shiftToken (NO es JWT de Supabase), así que
 * NO pueden pegar directo a /rest/v1 tras el lockdown de RLS. Este proxy es el único
 * camino autenticado para esas terminales:
 *   1. Valida el shiftToken (withPOSAuth) → clientId + role.
 *   2. Allowlist de tablas del POS (nada fuera de aquí).
 *   3. Inyecta client_id del token en filtro (reads) y body (writes) → imposible
 *      tocar otro tenant, aunque el cliente mande otro client_id.
 *   4. Acciones sensibles requieren rol gerente/admin.
 *   5. Escribe/lee con service_role (bypassa RLS) y regresa la respuesta tal cual.
 *
 * El dashboard (usuario con sesión de Supabase) NO usa este proxy — sigue por RLS
 * directo con su JWT. Solo las terminales POS (shiftToken) se rutean aquí.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withPOSAuth } from '@/lib/api-auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Tablas que el POS puede LEER/ESCRIBIR vía proxy. Todo lo demás se rechaza.
const ALLOW = new Set<string>([
  'pos_orders', 'pos_turnos', 'pos_cierres', 'pos_cash_movements', 'pos_attendance',
  'pos_staff_shifts', 'pos_staff_audit', 'pos_audit_log', 'pos_sessions', 'pos_print_jobs',
  'pos_customers', 'pos_customer_notes', 'pos_customer_visits', 'pos_facturas', 'pos_cfdi_requests',
  'pos_inventory', 'pos_inventory_movements', 'pos_market_stock', 'pos_market_movements',
  'pos_mesas', 'pos_menu_categories', 'pos_menu_items', 'pos_modifiers', 'pos_modifier_groups',
  'pos_item_modifier_groups', 'pos_category_modifiers', 'pos_combos', 'pos_promos', 'pos_promotions',
  'pos_payment_methods', 'pos_staff', 'pos_recipes', 'pos_recipe_details', 'pos_ingredients',
  'pos_gastos', 'reservaciones', 'amalay_reservaciones',
])

// Tablas SIN columna client_id → no se inyecta scope (globales/child de bajo riesgo).
const NO_CID = new Set<string>(['pos_purchase_order_items', 'pos_sub_recipe_ingredients'])

// Escrituras sensibles: requieren gerente/admin.
const MANAGER_ONLY_TABLES = new Set<string>(['pos_cash_movements', 'pos_cierres'])

function isManager(role: string) { return role === 'admin' || role === 'gerente' || role === 'dueño' }

// Extrae el nombre de tabla del path PostgREST: "pos_orders?mesa=eq.5" → "pos_orders"
function tableOf(path: string): string {
  return path.split('?')[0].split('/')[0].trim()
}

async function handle(request: NextRequest, method: string) {
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // El cliente manda el path PostgREST original en ?path= (url-encoded).
  const path = request.nextUrl.searchParams.get('path') || ''
  if (!path) return NextResponse.json({ error: 'missing path' }, { status: 400 })

  const table = tableOf(path)
  if (!ALLOW.has(table)) return NextResponse.json({ error: `table not allowed: ${table}` }, { status: 403 })

  const isWrite = method !== 'GET'
  if (isWrite && MANAGER_ONLY_TABLES.has(table) && !isManager(auth.role)) {
    return NextResponse.json({ error: 'manager required' }, { status: 403 })
  }

  // Tenant scope: fuerza client_id del token en el query (reads y writes).
  let target = path
  if (!NO_CID.has(table)) {
    const sep = target.includes('?') ? '&' : '?'
    target = `${target}${sep}client_id=eq.${encodeURIComponent(auth.clientId)}`
  }

  const headers: Record<string, string> = {
    apikey: SB_SERVICE,
    Authorization: `Bearer ${SB_SERVICE}`,
  }
  // Passthrough de headers PostgREST relevantes (Prefer, Content-Type, Range).
  const prefer = request.headers.get('prefer'); if (prefer) headers['Prefer'] = prefer
  const range = request.headers.get('range'); if (range) headers['Range'] = range

  let body: string | undefined
  if (isWrite) {
    const raw = await request.text()
    if (raw) {
      // Inyecta client_id del token en el body (objeto o array) para writes.
      try {
        const parsed = JSON.parse(raw)
        const stamp = (o: Record<string, unknown>) => (!NO_CID.has(table) ? { ...o, client_id: auth.clientId } : o)
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed))
      } catch {
        body = raw
      }
      headers['Content-Type'] = 'application/json'
    }
  }

  const res = await fetch(`${SB_URL}/rest/v1/${target}`, { method, headers, body, cache: 'no-store' })
  const text = await res.text()
  const out = new NextResponse(text, { status: res.status })
  const ct = res.headers.get('content-type'); if (ct) out.headers.set('content-type', ct)
  const cr = res.headers.get('content-range'); if (cr) out.headers.set('content-range', cr)
  return out
}

export async function GET(request: NextRequest) { return handle(request, 'GET') }
export async function POST(request: NextRequest) { return handle(request, 'POST') }
export async function PATCH(request: NextRequest) { return handle(request, 'PATCH') }
export async function DELETE(request: NextRequest) { return handle(request, 'DELETE') }
