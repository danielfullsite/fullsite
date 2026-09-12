import { NextRequest } from 'next/server'
import { esCuentaDeCobroDeSplit } from '@/lib/liquidacion-de-orden'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyManagerApproval } from '@/lib/manager-approval'
import { hasPermission } from '@/lib/pos-permissions'

/**
 * R2D1 + R2 Final + R2D — Revision-aware order save + R1 reconciliation boundary
 * + exactly-once save operation idempotency.
 *
 * Transaction semantics:
 * - Order save and reconciliation are SEPARATE operations
 * - If save succeeds but reconciliation fails, the order is committed
 *   and the revision remains PENDING (discoverable for retry)
 * - A successful save does NOT imply inventory COMPLETE
 *
 * R2D Idempotency:
 * - If save_operation_id is provided, uses r1_save_order_idempotent
 * - Replay of same operation returns original committed result without re-executing save
 * - Inventory status is derived dynamically from current lineage, never frozen
 * - Legacy requests without save_operation_id bypass idempotency (OCC-protected only)
 */

interface SaveResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  error?: string
  expected_revision?: number
  current_revision?: number
  inventory_status?: 'COMPLETE' | 'BLOCKED' | 'PENDING' | 'SKIPPED'
  inventory_results?: Array<{ r_item_id: string; r_result: string; r_applied: number; r_delta: number }>
  first_execution?: boolean
  idempotent_replay?: boolean
}

interface ExistingOrderAuthority {
  mesero?: unknown
  descuento?: unknown
  items?: unknown
  status?: unknown
}

type TurnoResolution =
  | { ok: true; turnoId: string; reassigned: boolean }
  | { ok: false; error: 'TURN_NOT_FOUND' | 'TURN_CLOSED_NO_ACTIVE' | 'TURN_CLOSED_CONFLICT' }

/**
 * Resolve the shift at the application boundary before an offline save reaches the RPC.
 *
 * A queued order can carry a shift that was open when captured but closed before replay.
 * New orders are moved only to the currently-open shift. Existing writes and updates fail
 * closed so money is never silently moved between cash closures. A previously committed
 * idempotent operation is allowed through unchanged; the RPC will return its original
 * result without executing the write again.
 *
 * INCIDENTE 2026-08-31 — este select pedia `location_id`, que NO EXISTE en pos_turnos.
 * PostgREST responde 400 ante una columna inexistente, `turnoRes.ok` era false, y la
 * funcion devolvia TURN_NOT_FOUND -> HTTP 409 en CADA orden, con turno abierto o sin el.
 * El POS de AMALAY quedo sin poder enviar comandas. Columnas reales de pos_turnos:
 *   id, client_id, opened_by, fondo_inicial, opened_at,
 *   closed_by, fondo_final, efectivo_sistema, diferencia, closed_at, notas
 * Por eso el filtro por sucursal se retira: esa columna no existe en esta tabla (si en
 * pos_orders). Cuando pos_turnos tenga location_id, se vuelve a agregar CON su prueba.
 */

/** Columnas que este endpoint pide de pos_turnos. Deben existir de verdad — ver
 *  `src/__tests__/pos-turnos-columnas.test.ts`, que las contrasta con el esquema real. */
export const TURNO_SELECT_COLUMNS = ['id', 'closed_at'] as const
async function resolveTurnoForSave(
  body: Record<string, unknown>,
  clientId: string,
  sbUrl: string,
  headers: Record<string, string>,
): Promise<TurnoResolution> {
  const requestedTurnoId = typeof body.turno_id === 'string' ? body.turno_id : ''
  if (!requestedTurnoId) return { ok: false, error: 'TURN_NOT_FOUND' }

  const turnoRes = await fetch(
    `${sbUrl}/rest/v1/pos_turnos?id=eq.${encodeURIComponent(requestedTurnoId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}&select=${TURNO_SELECT_COLUMNS.join(',')}&limit=1`,
    { headers },
  )
  if (!turnoRes.ok) return { ok: false, error: 'TURN_NOT_FOUND' }
  const turnos = await turnoRes.json() as Array<{ id: string; closed_at: string | null }>
  const requested = turnos[0]
  if (!requested) return { ok: false, error: 'TURN_NOT_FOUND' }
  if (!requested.closed_at) return { ok: true, turnoId: requested.id, reassigned: false }

  const operationId = typeof body.save_operation_id === 'string' ? body.save_operation_id : ''
  const orderId = typeof body.order_id === 'string' ? body.order_id : ''
  if (operationId && orderId) {
    const opRes = await fetch(
      `${sbUrl}/rest/v1/pos_save_operations?client_id=eq.${encodeURIComponent(clientId)}` +
        `&order_id=eq.${encodeURIComponent(orderId)}` +
        `&save_operation_id=eq.${encodeURIComponent(operationId)}&state=eq.COMMITTED&select=state&limit=1`,
      { headers },
    )
    if (opRes.ok) {
      const operations = await opRes.json() as Array<{ state: string }>
      if (operations.length > 0) {
        return { ok: true, turnoId: requested.id, reassigned: false }
      }
    }
  }

  // Only a brand-new order may move to the replacement shift. Updates/cobros require
  // an operator-visible conflict because changing their accounting period is material.
  if (body.expected_revision !== 0) return { ok: false, error: 'TURN_CLOSED_CONFLICT' }

  // Reassignment is safe only when the captured timestamp proves the sale happened
  // after the old shift closed. A late sync captured before closure belongs to the old
  // accounting period and needs explicit manager reconciliation instead.
  const capturedMs = typeof body.captured_at === 'string' ? Date.parse(body.captured_at) : Number.NaN
  const closedMs = Date.parse(requested.closed_at)
  if (!Number.isFinite(capturedMs) || !Number.isFinite(closedMs) || capturedMs <= closedMs) {
    return { ok: false, error: 'TURN_CLOSED_CONFLICT' }
  }

  // Sin filtro por sucursal: pos_turnos no tiene location_id (ver nota del incidente
  // arriba). Filtrar por una columna inexistente devolvia 400 y rompia todo el endpoint.
  const activeRes = await fetch(
    `${sbUrl}/rest/v1/pos_turnos?client_id=eq.${encodeURIComponent(clientId)}` +
      `&closed_at=is.null&select=id&order=opened_at.desc&limit=1`,
    { headers },
  )
  if (!activeRes.ok) return { ok: false, error: 'TURN_CLOSED_NO_ACTIVE' }
  const active = await activeRes.json() as Array<{ id: string }>
  if (!active[0]?.id) return { ok: false, error: 'TURN_CLOSED_NO_ACTIVE' }

  return { ok: true, turnoId: active[0].id, reassigned: true }
}

/**
 * Tasa de IVA del tenant, resuelta SIEMPRE del servidor.
 *
 * No se lee del body a propósito: si la tasa viniera del cliente, bastaría con mandar una
 * falsa para que el total rebajado cuadrara y el detector de skimming se callara.
 *
 * Cacheada por instancia — la tasa cambia con la configuración del restaurante, no con la
 * orden, y este camino corre al cerrar cada cuenta. Devuelve `null` si no se puede resolver;
 * el llamador entonces NO audita (ver el comentario de la detección).
 */
const _ivaRateCache = new Map<string, number>()
async function ivaRateFor(
  clientId: string,
  sbUrl: string,
  headers: Record<string, string>,
): Promise<number | null> {
  const cached = _ivaRateCache.get(clientId)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=iva_rate&limit=1`,
      { headers },
    )
    if (!res.ok) return null
    // PostgREST devuelve numeric como STRING — de ahí el Number().
    const rows = await res.json() as Array<{ iva_rate?: number | string | null }>
    const raw = rows?.[0]?.iva_rate
    if (raw === undefined || raw === null) return null
    const rate = Number(raw)
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null
    _ivaRateCache.set(clientId, rate)
    return rate
  } catch {
    return null
  }
}

function sameStaffName(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('es-MX')
  return normalize(left) !== '' && normalize(left) === normalize(right)
}

function orderItems(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null
  } catch {
    return null
  }
}

/**
 * Rebuild aggregate money fields for a waiter from the line snapshot that is about
 * to be saved. This prevents an unprivileged caller from sending the real items but
 * independently declaring a $1 subtotal/total.
 *
 * SECURITY LIMIT (intentional and tracked): line-level `precio`, `precioExtra` and
 * `subtotal` are still a client snapshot. Repricing them from today's catalog would
 * corrupt legitimate offline orders after a menu-price change, and even-split child
 * accounts deliberately carry all parent lines with only a fraction of the total.
 * Closing that remaining gap requires versioned price/promotion evidence, not a
 * best-effort lookup of the current catalog. The existing post-save price audit stays
 * active until that authority exists.
 */
async function waiterFinancialAuthority(opts: {
  body: Record<string, unknown>
  existing: ExistingOrderAuthority | null
  signedStaffName: string
  clientId: string
  sbUrl: string
  headers: Record<string, string>
}): Promise<
  | { ok: true; mesero: string; descuento: number; subtotal: number; iva: number; total: number }
  | { ok: false; status: number; error: string }
> {
  const signedName = opts.signedStaffName.trim()
  if (!signedName) return { ok: false, status: 403, error: 'SIGNED_STAFF_REQUIRED' }

  const currentWaiter = String(opts.existing?.mesero ?? '').trim()
  if (currentWaiter && !sameStaffName(currentWaiter, signedName)) {
    return { ok: false, status: 403, error: 'ORDER_NOT_OWNED' }
  }

  const items = orderItems(opts.body.items) ?? orderItems(opts.existing?.items)
  if (!items) return { ok: false, status: 400, error: 'INVALID_ITEMS' }

  let subtotalCents = 0
  for (const item of items) {
    if (item?.cancelled) continue
    const line = Number(item?.subtotal)
    if (!Number.isFinite(line) || line < 0) {
      return { ok: false, status: 400, error: 'INVALID_ITEM_SUBTOTAL' }
    }
    subtotalCents += Math.round(line * 100)
  }

  // A waiter cannot create or alter an order discount. If a manager/cashier already
  // saved one, subsequent waiter updates preserve that server value exactly.
  const currentDiscount = Number(opts.existing?.descuento ?? 0)
  const discountCents = Number.isFinite(currentDiscount)
    ? Math.min(subtotalCents, Math.max(0, Math.round(currentDiscount * 100)))
    : 0

  const ivaRate = await ivaRateFor(opts.clientId, opts.sbUrl, opts.headers)
  if (ivaRate === null) return { ok: false, status: 503, error: 'IVA_RATE_UNAVAILABLE' }
  const taxableCents = Math.max(0, subtotalCents - discountCents)
  const ivaCents = Math.round(taxableCents * ivaRate)

  return {
    ok: true,
    mesero: currentWaiter || signedName,
    descuento: discountCents / 100,
    subtotal: subtotalCents / 100,
    iva: ivaCents / 100,
    total: (taxableCents + ivaCents) / 100,
  }
}

/**
 * ¿El total que quedó escrito corresponde a los renglones que quedaron escritos?
 *
 * Se llama DESPUÉS del RPC y lee la fila, nunca el cuerpo de la petición. Ésa es toda
 * la diferencia: el cuerpo lo dicta quien cobra, y podía omitir `items` para apagar la
 * comprobación entera, o inflar `descuento` para que la resta cuadrara sola.
 *
 * No bloquea ni lanza. Un rechazo aquí viajaría al replay de la cola offline, donde un
 * 400 es terminal y el cobro se perdería para siempre.
 */
async function auditarCierreContraLaFila(o: {
  orderId: string
  clientId: string
  sbUrl: string
  headers: Record<string, string>
  actor: string
  rolSolicitante?: string
}): Promise<void> {
  try {
    const ivaRate = await ivaRateFor(o.clientId, o.sbUrl, o.headers)
    // Sin tasa resoluble no se audita: preferimos no reportar a reportar de más.
    if (ivaRate === null) return

    const res = await fetch(
      `${o.sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(o.orderId)}` +
      `&client_id=eq.${encodeURIComponent(o.clientId)}&select=items,total,descuento,mesero,status&limit=1`,
      { headers: o.headers, cache: 'no-store' },
    )
    if (!res.ok) return
    const rows = await res.json() as Array<Record<string, unknown>>
    const fila = rows?.[0]
    if (!fila) return

    const items = typeof fila.items === 'string'
      ? JSON.parse(fila.items) as Array<Record<string, unknown>>
      : (fila.items as Array<Record<string, unknown>> | null)
    // Una orden cerrada SIN renglones no es un cierre normal, pero tampoco se puede
    // afirmar un faltante: no hay contra qué comparar. Se deja pasar.
    if (!Array.isArray(items) || items.length === 0) return

    // UNA CUENTA DE SPLIT PAREJO ACUSA A UN MESERO HONESTO, y por eso no se audita sola.
    //
    // En `parejo`, `payingItems` NO se reasigna (pos/page.tsx:3814): cada cuenta guarda
    // TODOS los renglones de la mesa y sólo cambia el total a 1/N. Así que la comparación
    // de abajo ve, en una mesa de $2,816 dividida entre cuatro:
    //
    //     sum(items) = 281600¢   contra   total = 70400¢   →  faltante de $2,112
    //
    // Cuatro veces, una por cuenta. Y el agente antifraude reporta POR MESERO, así que el
    // acusado sería quien dividió la cuenta bien. Es el mismo envenenamiento del falso
    // positivo del IVA de agosto: quince eventos, todos falsos, que taparon el caso real.
    //
    // La suma sólo tiene sentido contra la MADRE, y ese punto existe desde hoy: al
    // liquidarse se escribe con estado 'dividida', y ahí abajo se compara su total contra
    // lo que de verdad cobraron sus cuentas.
    if (esCuentaDeCobroDeSplit(o.orderId)) return

    const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)
    const sumItems = items
      .filter(it => !it?.cancelled)
      .reduce((s, it) => s + cents(it?.subtotal ?? 0), 0)
    const descuento = cents(fila.descuento ?? 0)
    const base = sumItems - descuento
    const expectedTotal = base + Math.round(base * ivaRate)

    // LA MESA DIVIDIDA SE MIDE CONTRA LO QUE COBRARON SUS CUENTAS, no contra su propia
    // fila: la madre queda con el total de la mesa pero NO cobró nada — el dinero entró
    // por `{orden}-C1..CN`. Comparar contra su `total` sería medir el cobro contra sí
    // mismo y no detectaría nada.
    //
    // Aquí sí sirve: si alguien divide en cuatro y registra sólo dos cuentas, la suma de
    // lo cobrado queda corta contra los renglones servidos, y eso es exactamente el
    // faltante. Es la variante que no deja rastro en el corte porque la mesa parece
    // "cancelada por cliente que se fue".
    let declaredTotal = cents(fila.total ?? 0)
    if (String(fila.status) === 'dividida') {
      const cuentas = await fetch(
        `${o.sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(o.clientId)}` +
        `&id=like.${encodeURIComponent(o.orderId + '-C')}*&select=total,status`,
        { headers: o.headers, cache: 'no-store' },
      )
      if (!cuentas.ok) return   // sin poder leerlas no se puede afirmar un faltante
      const filas = await cuentas.json() as Array<{ total?: unknown; status?: unknown }>
      if (!Array.isArray(filas) || filas.length === 0) return
      declaredTotal = filas
        .filter(c => c.status === 'cerrada' || c.status === 'completada')
        .reduce((s, c) => s + cents(c.total), 0)
    }

    // ── EL ANCLA QUE FALTABA: EL PRECIO DEL MENU ────────────────────────────
    //
    // Todo lo de arriba compara `sum(items[].subtotal)` contra `total`. LAS DOS CIFRAS
    // LAS ESCRIBIO EL CLIENTE. Detecta al que baja el total y deja los renglones -- que
    // es el vector comun, porque bajar el total es un campo y editar los renglones son
    // varios -- pero NO al que baja los dos a la vez: la resta da cero y todo cuadra.
    //
    // El unico dato que el POS no dicta es el precio del catalogo. Se compara contra el.
    //
    // ESTO SE MIDIO ANTES DE ESCRIBIRLO, porque un detector ruidoso ya costo caro dos
    // veces en este repo (los quince falsos del IVA en agosto, y las cuentas de split
    // esta manana). Sobre los 94 renglones que existen en `pos_orders` de AMALAY:
    //
    //     sin menuItemId ............ 0
    //     sin fila en el menu ....... 0
    //     precio por DEBAJO ......... 0
    //     precio por ARRIBA ......... 0
    //
    // Cero falsos positivos sobre los datos reales de hoy.
    //
    // LO QUE NO PUEDE DISTINGUIR, y por eso es conservador: un precio de menu que SUBIO
    // despues de que se cobro la orden se ve igual que un precio editado a la baja. No
    // hay historial de precios. Mitigacion: solo cuenta un renglon cuando su precio esta
    // por debajo del 90% del catalogo -- una actualizacion normal no llega ahi, partir a
    // la mitad un corte de carne si.
    let faltantePorPrecio = 0
    const renglonesEditados: Array<{ menu_item_id: string; precio_cobrado: number; precio_menu: number; cantidad: number }> = []
    try {
      const ids = [...new Set(items
        .filter(it => !it?.cancelled)
        .map(it => String(it?.menuItemId ?? ''))
        .filter(Boolean))]
      if (ids.length > 0) {
        const cat = await fetch(
          `${o.sbUrl}/rest/v1/pos_menu_items?client_id=eq.${encodeURIComponent(o.clientId)}` +
          `&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,price`,
          { headers: o.headers, cache: 'no-store' },
        )
        // Sin catalogo legible NO se acusa. Mismo principio que con la tasa de IVA.
        if (cat.ok) {
          const precios = new Map<string, number>()
          for (const m of (await cat.json()) as Array<{ id?: unknown; price?: unknown }>) {
            if (typeof m?.id === 'string' && Number.isFinite(Number(m.price))) {
              precios.set(m.id, Number(m.price))
            }
          }
          for (const it of items) {
            if (it?.cancelled) continue
            const id = String(it?.menuItemId ?? '')
            const delMenu = precios.get(id)
            // Un renglon que no esta en el catalogo (producto abierto, item viejo) se
            // salta: no hay contra que compararlo y adivinar seria inventar.
            if (delMenu === undefined || !(delMenu > 0)) continue
            const cobrado = Number(it?.precio) || 0
            if (cobrado >= delMenu * 0.9) continue
            const cantidad = Math.max(0, Number(it?.cantidad) || 0)
            faltantePorPrecio += Math.round((delMenu - cobrado) * cantidad * 100)
            renglonesEditados.push({
              menu_item_id: id, precio_cobrado: cobrado, precio_menu: delMenu, cantidad,
            })
          }
        }
      }
    } catch { /* el ancla de precio es un extra: nunca impide la deteccion de arriba */ }

    if (faltantePorPrecio > 100 && renglonesEditados.length > 0) {
      console.warn('[price-edit-suspect]', o.orderId, { faltantePorPrecio, renglonesEditados })
      // Accion PROPIA, no `skimming_suspect`: son dos vectores distintos y mezclarlos
      // impediria medir cual esta ocurriendo. El agente antifraude agrupa por accion.
      await fetch(`${o.sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: { ...o.headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: o.clientId, order_id: o.orderId,
          action: 'price_edit_suspect',
          actor: o.actor,
          details: {
            diff_cents: faltantePorPrecio,
            renglones: renglonesEditados,
            solicitante_rol: o.rolSolicitante ?? null,
            mesero_declarado: typeof fila.mesero === 'string' ? fila.mesero : null,
            fuente: 'catalogo_pos_menu_items',
            umbral_pct: 0.9,
          },
        }),
      })
    }

    const diff = expectedTotal - declaredTotal

    // Sólo la dirección del fraude: cobrar MENOS que los renglones. Un total mayor no
    // es skimming —no hay faltante que embolsarse— y marcarlo duplicaba los falsos
    // positivos. Tolerancia de $1 por redondeo, combos y promociones.
    if (diff <= 100) return

    console.warn('[skimming-suspect]', o.orderId,
      { sumItems, descuento, ivaRate, expectedTotal, declaredTotal, diffCents: diff })
    await fetch(`${o.sbUrl}/rest/v1/pos_audit_log`, {
      method: 'POST',
      headers: { ...o.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: o.clientId, order_id: o.orderId,
        action: 'skimming_suspect',
        // El actor sale del shift token FIRMADO. Antes era `body.mesero`, que lo ponía
        // el mismo que cobraba: la sospecha quedaba a nombre de quien él quisiera.
        actor: o.actor,
        details: {
          sum_items_cents: sumItems,
          descuento_cents: descuento,
          iva_rate: ivaRate,
          expected_total_cents: expectedTotal,
          declared_total_cents: declaredTotal,
          diff_cents: diff,
          solicitante_rol: o.rolSolicitante ?? null,
          mesero_declarado: typeof fila.mesero === 'string' ? fila.mesero : null,
          // Deja constancia de que se midió contra la fila: si algún día alguien
          // vuelve a evaluar el cuerpo, los eventos viejos y nuevos no se confunden.
          fuente: 'fila_escrita',
        },
      }),
    })
  } catch { /* detección best-effort — NUNCA bloquea ni rompe el guardado */ }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId
    const body = await request.json()

    const { order_id, expected_revision } = body
    if (!order_id || typeof order_id !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_ORDER_ID' } satisfies SaveResult, { status: 400 })
    }
    if (typeof expected_revision !== 'number' || expected_revision < 0) {
      return Response.json({ ok: false, error: 'INVALID_REVISION' } satisfies SaveResult, { status: 400 })
    }

    if ((body.status === 'cerrada' || body.status === 'dividida') && !hasPermission(auth.role, 'cerrar_cuentas')) {
      return Response.json({ ok: false, error: 'CLOSE_ORDER_FORBIDDEN' } satisfies SaveResult, { status: 403 })
    }

    if (body.status === 'cancelada' && !hasPermission(auth.role, 'cancelar_ordenes')) {
      const approval = await verifyManagerApproval({
        approvalToken: body.approval_token,
        clientId,
        minLevel: 4,
        solicitanteRol: auth.role,
      })
      // The separate signed approver token is part of the idempotent payload, so a
      // cancellation approved online but queued after a network failure can replay.
      // A browser-only/offline_approved assertion never grants this authority.
      if (!approval.ok || !approval.mode.startsWith('online:')) {
        return Response.json({ ok: false, error: 'CANCEL_ORDER_FORBIDDEN' } satisfies SaveResult, { status: 403 })
      }
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' } satisfies SaveResult, { status: 500 })
    }

    const headers = {
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }

    let authoritativeMesero = body.mesero ?? null
    let authoritativeDiscount = body.descuento ?? null
    let authoritativeSubtotal = body.subtotal ?? null
    let authoritativeIva = body.iva ?? null
    let authoritativeTotal = body.total ?? null

    // The waiter-scoped profile is intentionally narrow: it may create/update its
    // own operational order, but cannot choose the owner, discounts or aggregate
    // money. Use capabilities rather than a literal role so the canonical `staff`
    // alias (and any unknown fail-safe role) cannot bypass this boundary.
    const waiterScoped = hasPermission(auth.role, 'ver_cuentas_propias')
      && !hasPermission(auth.role, 'ver_todas_cuentas')
    if (waiterScoped) {
      const existingRes = await fetch(
        `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}` +
          `&client_id=eq.${encodeURIComponent(clientId)}&select=mesero,descuento,items,status&limit=1`,
        { headers, cache: 'no-store' },
      )
      if (!existingRes.ok) {
        return Response.json({ ok: false, error: 'ORDER_AUTHORITY_UNAVAILABLE' } satisfies SaveResult, { status: 503 })
      }
      const existingRows = await existingRes.json() as ExistingOrderAuthority[]
      const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null
      const authority = await waiterFinancialAuthority({
        body, existing, signedStaffName: auth.staffName, clientId, sbUrl, headers,
      })
      if (!authority.ok) {
        return Response.json({ ok: false, error: authority.error } satisfies SaveResult, { status: authority.status })
      }
      authoritativeMesero = authority.mesero
      authoritativeDiscount = authority.descuento
      authoritativeSubtotal = authority.subtotal
      authoritativeIva = authority.iva
      authoritativeTotal = authority.total
    }

    if (body.conflict_resolution === true) {
      const approval = await verifyManagerApproval({
        approvalToken: body.approval_token,
        clientId,
        minLevel: 4,
      })
      // Conflict rebases overwrite a newer server revision. Unlike the gradual
      // rollout used by legacy sensitive actions, this path is strict from day one:
      // only a fresh, signed online manager token may authorize it.
      if (!approval.ok || !approval.mode.startsWith('online:')) {
        return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' } satisfies SaveResult, { status: 403 })
      }
    }

    // R1 reconciliation server-side (P0 dinero): el invariante sum(pagos)==total+propina
    // solo se validaba en el cliente (pos-data.ts); el replay offline de la cola y
    // cualquier caller directo lo saltaban -> se commiteaban cierres con pagos que no
    // cuadran = descuadre silencioso en arqueo. Se replica EXACTO (centavos) aqui porque
    // este route corre en TODO write, incluido el replay.
    if (body.status === 'cerrada' && Array.isArray(body.pagos) && body.pagos.length > 0) {
      const toCents = (n: unknown) => Math.round((Number(n) || 0) * 100)
      const pagosSum = body.pagos.reduce((s: number, p: { monto?: number }) => s + toCents(p?.monto ?? 0), 0)
      const expected = toCents(body.total) + toCents(body.propina ?? 0)
      if (pagosSum !== expected) {
        return Response.json({ ok: false, error: 'PAYMENT_MISMATCH' } satisfies SaveResult, { status: 400 })
      }
    }

    // ── Detección de skimming (Fase 1 · log-only · CERO riesgo) ──
    // r1_save_order guarda el `total` que manda el cliente (COALESCE(p_total, total)). El
    // vector: bajar el `total` dejando los items → sum(items) − descuento ≠ total; el arqueo
    // cuadra (pagos==total) y la diferencia se embolsa. Aquí recomputamos desde los items y
    // AUDITAMOS la discrepancia — NO rechazamos (Fase 2 rechazará vía flag tras observar).
    //
    // El total que arma el POS es `subtotal_tras_descuento * (1 + iva_rate)` (pos/page.tsx:2889).
    // La version anterior comparaba la suma de items SIN IVA contra ese total CON IVA, asi que
    // disparaba en cada ticket cerrado de cualquier restaurante con iva_rate > 0 — 5 de los 8
    // tenants, AMALAY incluido. Los 15 eventos que habia en pos_audit_log al 2026-08-26 eran
    // todos ese falso positivo (1888 -> 2190.08 = x1.16 exacto).
    //
    // Un detector log-only que dispara siempre no es conservador: es ruido que tapa el caso real.
    // ── DOS HUECOS QUE TENIA ESTA DETECCION, cerrados el 2026-09-08 ──────────
    //
    // Los dos salen de lo mismo: se evaluaba con los insumos que manda el CLIENTE.
    //
    // HUECO 1 — omitir `items` apagaba el detector entero. La guarda era
    // `Array.isArray(body.items) && body.items.length > 0`, y `Array.isArray(undefined)`
    // es false, asi que este bloque completo no corria. Ni un console.warn, ni una fila
    // en pos_audit_log. Cero rastro. Y `r1_save_order` hace `items = coalesce(NULL,
    // items)`, o sea que los renglones reales se CONSERVAN: la orden queda presentable
    // —platillos correctos, mesero correcto, hora correcta— con `total = 1.00`. El
    // arqueo espera $1 por esa mesa y el resto se lo queda quien cobro. Es
    // estrictamente mejor para quien roba que bajar el total con descuento, porque no
    // deja ni la linea de descuentos en el corte Z.
    //
    // HUECO 2 — el `descuento` tambien lo pone el cliente, y se restaba ANTES de
    // comparar: `base = sumItems - cents(body.descuento)`. Mandar `descuento: 1000`
    // hacia que la aritmetica cuadrara sola. El robo se escondia justo en el campo que
    // sirve de excusa.
    //
    // EL ARREGLO ES LEER LA FILA, NO EL CUERPO. Despues del RPC se relee `items`,
    // `total` y `descuento` de `pos_orders` y se recomputa sobre eso. Omitir `items`
    // deja de ser una salida —el servidor usa los que ya tiene— y el descuento que se
    // resta es el que quedo ESCRITO, que es el que el corte va a cobrar.
    //
    // ADEMAS ARREGLA UN FALSO POSITIVO: cocina manda cierres sin `total` ni `subtotal`
    // (pos/cocina/page.tsx:332), y con `cents(undefined) = 0` el detector veia un
    // faltante del 100%. Leyendo la fila, el total es el real y no dispara.
    //
    // SIGUE SIN BLOQUEAR, a proposito. Un 400 en el replay de la cola se clasifica
    // terminal (pos-offline-db.ts): el cobro se perderia para siempre. Fase 2 rechaza,
    // y solo despues de observar el log.

    // ── Shift validation: replay must never write into a closed cash period ──
    const hasOperationId = typeof body.save_operation_id === 'string' && body.save_operation_id.length > 0
    const turno = await resolveTurnoForSave(body, clientId, sbUrl, headers)
    if (!turno.ok) {
      return Response.json(
        { ok: false, conflict: true, error: turno.error } satisfies SaveResult,
        { status: 409 },
      )
    }
    if (turno.reassigned) {
      console.warn('[save-order] offline order reassigned from closed turno', {
        orderId: order_id,
        previousTurnoId: body.turno_id,
        activeTurnoId: turno.turnoId,
      })
    }

    // ── Step 1: Save order via idempotent wrapper (or legacy direct) ──
    const rpcName = hasOperationId ? 'r1_save_order_idempotent' : 'r1_save_order'

    const rpcParams: Record<string, unknown> = {
      p_client_id: clientId,
      p_order_id: order_id,
      p_expected_revision: expected_revision,
      p_mesa: body.mesa ?? null,
      p_customer_name: body.customer_name ?? null,
      p_mesero: authoritativeMesero,
      p_personas: body.personas ?? null,
      p_status: body.status ?? null,
      p_subtotal: authoritativeSubtotal,
      p_iva: authoritativeIva,
      p_total: authoritativeTotal,
      p_descuento: authoritativeDiscount,
      p_propina: body.propina ?? null,
      p_metodo_pago: body.metodo_pago ?? null,
      p_pagos: body.pagos ?? null,
      p_turno_id: turno.turnoId,
      p_notas: body.notas ?? null,
      p_items: body.items ?? null,
      p_closed_at: body.closed_at ?? null,
    }

    if (hasOperationId) {
      rpcParams.p_save_operation_id = body.save_operation_id
    }

    const saveRes = await fetch(`${sbUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcParams),
    })

    if (!saveRes.ok) {
      const errText = await saveRes.text()
      console.error('[save-order] RPC error:', saveRes.status, errText)
      return Response.json({ ok: false, error: 'RPC_FAILED' } satisfies SaveResult, { status: 502 })
    }

    const saveResult = await saveRes.json()

    // If save was rejected (stale/not found/payload corruption), return immediately
    if (!saveResult.ok) {
      return Response.json(saveResult satisfies SaveResult)
    }

    // ── Detección de skimming (Fase 1 · log-only) ────────────────────────────
    // Se evalúa contra LA FILA YA ESCRITA, no contra el cuerpo. Ver el bloque largo de
    // arriba: leer el cuerpo permitía apagar el detector omitiendo `items`, y restaba
    // un `descuento` que también dictaba el cliente.
    // Se ESPERA, no se dispara y olvida: en serverless el trabajo que queda pendiente
    // después de responder se corta, y la auditoría podría no escribirse nunca —
    // justo en el caso que interesa. La función nunca lanza ni bloquea el guardado,
    // que ya está commiteado en este punto; lo único que cuesta es latencia en el
    // cierre.
    // 'dividida' también se audita: es el cierre de una mesa que se cobró por partes, y
    // el único punto donde la suma de los renglones tiene con qué compararse.
    if (body.status === 'cerrada' || body.status === 'dividida') {
      await auditarCierreContraLaFila({
        orderId: order_id, clientId, sbUrl, headers,
        actor: auth.staffName || auth.staffId || 'POS',
        rolSolicitante: auth.role,
      })
    }

    // Persist fields that predate the RPC signature. captured_at is client supplied but
    // accepted only as a valid timestamp no more than five minutes in the future.
    const capturedMs = typeof body.captured_at === 'string' ? Date.parse(body.captured_at) : Number.NaN
    const capturedAt = Number.isFinite(capturedMs) && capturedMs <= Date.now() + 5 * 60_000
      ? new Date(capturedMs).toISOString()
      : null
    const supplementalPatch: Record<string, unknown> = {}
    if (body.comanda_batches) supplementalPatch.comanda_batches = body.comanda_batches
    // captured_at is immutable provenance: only the create operation may set it.
    if (capturedAt && body.expected_revision === 0) supplementalPatch.captured_at = capturedAt

    // Written as a separate PATCH to avoid breaking the deployed RPC signature.
    if (Object.keys(supplementalPatch).length > 0) {
      try {
        await fetch(`${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(supplementalPatch),
        })
      } catch (err) { console.error('[save-order] supplemental patch error (non-blocking):', err) }
    }

    // ── Step 2: Reconciliation ──
    // FIRST_EXECUTION: always invoke reconciliation
    // IDEMPOTENT_REPLAY: invoke only if inventory not yet processed for committed revision
    const isFirstExecution = saveResult.first_execution === true
    const isIdempotentReplay = saveResult.idempotent_replay === true
    const committedRevision = saveResult.revision

    // UNA CUENTA DE SPLIT NO CONSUME COMIDA: la consumio la orden madre.
    //
    // `r1_reconcile_order` recorre los items de ESTA orden y escribe en
    // `pos_reconciliation_results`, cuya clave unica es
    // (client_id, order_id, order_item_id). Como cada cuenta trae su propio
    // `order_id` (`{orden}-C1`..`-CN`), estrenaba linaje y descontaba otra vez. En el
    // split PAREJO cada cuenta lleva TODOS los renglones, asi que una mesa de 4
    // descontaba cinco veces la misma comida: la madre al enviar a cocina, mas las
    // cuatro cuentas al cobrar.
    //
    // No sale del cajon: sale del inventario y del numero que gobierna las compras.
    const esCobroDeSplit = esCuentaDeCobroDeSplit(order_id)

    let shouldReconcile = isFirstExecution && !esCobroDeSplit

    if (isIdempotentReplay && committedRevision != null && !esCobroDeSplit) {
      // Check current inventory lineage for catch-up determination
      try {
        const lineageRes = await fetch(
          `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=last_inventory_processed_revision`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        )
        if (lineageRes.ok) {
          const lineageRows = await lineageRes.json()
          if (Array.isArray(lineageRows) && lineageRows.length > 0) {
            const processedRev = lineageRows[0].last_inventory_processed_revision
            shouldReconcile = processedRev == null || processedRev < committedRevision
          } else {
            shouldReconcile = true // can't determine — attempt reconciliation
          }
        }
      } catch {
        // Can't read lineage — attempt reconciliation as catch-up (idempotent)
        shouldReconcile = true
      }
    }

    let inventoryStatus: SaveResult['inventory_status'] = 'PENDING'
    let inventoryResults: SaveResult['inventory_results'] = []

    if (shouldReconcile) {
      try {
        const reconRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_reconcile_order`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_client_id: clientId,
            p_order_id: order_id,
          }),
        })

        if (reconRes.ok) {
          const reconRows = await reconRes.json()
          inventoryResults = Array.isArray(reconRows) ? reconRows : []

          const hasBlocked = inventoryResults.some(r => r.r_result?.startsWith('BLOCKED'))
          const allComplete = inventoryResults.every(r =>
            r.r_result === 'RECONCILED' || r.r_result === 'NO_MUTATION_APPROVED'
          )

          if (inventoryResults.length === 0) {
            inventoryStatus = 'SKIPPED'
          } else if (allComplete) {
            inventoryStatus = 'COMPLETE'
          } else if (hasBlocked) {
            inventoryStatus = 'BLOCKED'
          } else {
            inventoryStatus = 'PENDING'
          }
        } else {
          const errText = await reconRes.text()
          console.error('[save-order] Reconciliation RPC error:', reconRes.status, errText)
          inventoryStatus = 'PENDING'
        }
      } catch (reconErr) {
        console.error('[save-order] Reconciliation exception:', reconErr)
        inventoryStatus = 'PENDING'
      }
    } else {
      // Derive inventory status from current lineage (no reconciliation call)
      try {
        const statusRes = await fetch(
          `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=last_inventory_processed_revision,last_inventory_complete_revision`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        )
        if (statusRes.ok) {
          const statusRows = await statusRes.json()
          if (Array.isArray(statusRows) && statusRows.length > 0) {
            const row = statusRows[0]
            const processedRev = row.last_inventory_processed_revision
            const completeRev = row.last_inventory_complete_revision
            if (completeRev != null && completeRev >= committedRevision) {
              inventoryStatus = 'COMPLETE'
            } else if (processedRev != null && processedRev >= committedRevision) {
              inventoryStatus = 'BLOCKED' // processed but not complete
            } else {
              inventoryStatus = 'PENDING'
            }
          }
        }
      } catch {
        inventoryStatus = 'PENDING'
      }
    }

    const result: SaveResult = {
      ok: true,
      revision: committedRevision,
      conflict: false,
      inventory_status: inventoryStatus,
      inventory_results: inventoryResults.length > 0 ? inventoryResults : undefined,
      first_execution: isFirstExecution,
      idempotent_replay: isIdempotentReplay,
    }

    return Response.json(result)
  } catch (err) {
    console.error('[save-order] Unexpected error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' } satisfies SaveResult, { status: 500 })
  }
}
