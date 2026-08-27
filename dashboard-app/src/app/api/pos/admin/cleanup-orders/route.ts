import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POS_ROLE_LVL, withPOSAuth, unauthorized } from '@/lib/api-auth'
import { canCleanupAllOrders } from '@/lib/order-cleanup-auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const CONFIRMACION = 'BORRAR TODAS LAS ORDENES'

async function context(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return { error: unauthorized() }
  if ((POS_ROLE_LVL[auth.role] ?? 0) < POS_ROLE_LVL.gerente || !canCleanupAllOrders(auth)) {
    return { error: Response.json({ error: 'Esta limpieza está reservada exclusivamente para Daniel' }, { status: 403 }) }
  }
  return { auth }
}

async function readOrders(clientId: string) {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('Service key unavailable')
  const res = await fetch(`${SB_URL}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Backup failed: HTTP ${res.status}`)
  return { orders: await res.json(), key }
}

function digest(orders: unknown[]) {
  return createHash('sha256').update(JSON.stringify(orders)).digest('hex')
}

type Rpc = { ok?: boolean; error?: string; state?: string; deleted?: number; replay?: boolean }

async function rpc(key: string, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status}`)
  return await res.json() as Rpc
}

/**
 * De dónde vino la petición — lo justo para poder correlacionarla después.
 *
 * Existe por una razón concreta: el borrado del 2026-08-25 fue imposible de correlacionar
 * con una petición real, porque los registros de ejecución de la plataforma guardaban **una
 * línea en 24 horas**. La operación ahora se auto-correlaciona y deja de depender de esa
 * retención.
 *
 * Lo que NO lleva, a propósito: token, cookie, PIN ni IP. Un libro de auditoría que guarda
 * credenciales convierte cada lectura del libro en una fuga.
 */
function metadataDePeticion(request: NextRequest): Record<string, string | null> {
  const h = request.headers
  return {
    request_id: h.get('x-vercel-id'),
    deployment: h.get('x-vercel-deployment-url'),
    user_agent: h.get('user-agent')?.slice(0, 200) ?? null,
    recibida_en: new Date().toISOString(),
  }
}

/** Fase 3. Nunca lanza: si tampoco se puede registrar el fallo, queda un STARTED — y la vista de atoradas lo delata. */
async function marcarFallo(key: string, operationId: string, detalle: string): Promise<Rpc | null> {
  try {
    return await rpc(key, 'r1_cleanup_fail', { p_operation_id: operationId, p_detail: detalle })
  } catch (e) {
    console.error('[cleanup-orders] no se pudo registrar el fallo:', (e as Error).message)
    return null
  }
}

export async function GET(request: NextRequest) {
  const ctx = await context(request)
  if (ctx.error) return ctx.error
  try {
    const { orders, key } = await readOrders(ctx.auth!.clientId)

    // Fase 5 del protocolo: si hay una operación atorada, el operador la ve ANTES de arrancar
    // otra. Una fila aquí con las órdenes ya en cero significa que un borrado ocurrió y su
    // constancia final se perdió — eso hay que mirarlo, no lanzarle otra limpieza encima.
    let atoradas: unknown[] = []
    try {
      const res = await fetch(`${SB_URL}/rest/v1/pos_cleanup_atoradas?client_id=eq.${encodeURIComponent(ctx.auth!.clientId)}&select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
      })
      if (res.ok) atoradas = await res.json()
    } catch { /* el aviso es informativo; no debe impedir bajar el respaldo */ }

    return Response.json({
      client_id: ctx.auth!.clientId,
      count: orders.length,
      digest: digest(orders),
      exported_at: new Date().toISOString(),
      operaciones_atoradas: atoradas,
      orders,
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}

/**
 * El borrado total, en tres fases y tres transacciones.
 *
 * POR QUÉ NO ES UNA SOLA LLAMADA
 *
 * El intento anterior metía `STARTED`, el `DELETE` y `FAILED` en una sola función de base de
 * datos — o sea, una sola transacción. Se veía atómico y correcto. **No lo era:** si la
 * transacción aborta, Postgres revierte todo, incluida la fila `STARTED`, y no queda
 * constancia de que alguien lo intentó siquiera. `FAILED` escrito ahí dentro se revierte por
 * la misma razón.
 *
 * Demostrado, no razonado: con el diseño de una transacción, una caída después del `DELETE`
 * deja **cero** filas en el libro. Con éste, deja el `STARTED`.
 *
 *   La intención se registra en una transacción. El efecto, en otra. El fracaso, en una
 *   tercera. Un registro que comparte transacción con lo que describe no puede describir el
 *   fracaso de esa transacción.
 *
 * EL CASO AMBIGUO, Y POR QUÉ SE RESUELVE SOLO
 *
 * Si la fase 2 se corta por red, no se sabe si borró. La fase 3 lo resuelve sin adivinar:
 * `r1_cleanup_fail` se niega a degradar un `COMMITTED`, así que su respuesta *es* el
 * veredicto. Si contesta `YA_ESTABA_COMMITTED`, el borrado ocurrió y se reporta éxito; si
 * marca `FAILED`, no ocurrió. En ningún caso hay que suponer.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await context(request)
  if (ctx.error) return ctx.error

  let operationId = ''
  let key = ''

  try {
    const body = await request.json()
    if (body?.confirm !== CONFIRMACION || typeof body?.digest !== 'string') {
      return Response.json({ error: 'Confirmación inválida' }, { status: 400 })
    }
    // La llave de idempotencia la pone quien pide. Sin ella no se borra: es lo que hace que
    // un reintento sea seguro y que un corte de red deje de ser ambiguo.
    if (typeof body?.operation_id !== 'string' || body.operation_id.length < 8) {
      return Response.json({ error: 'Falta operation_id' }, { status: 400 })
    }
    operationId = body.operation_id

    const leidas = await readOrders(ctx.auth!.clientId)
    key = leidas.key
    // Verificación en la capa web: confirma que el operador vio exactamente estas órdenes.
    // La que de verdad protege —el SHA-256 sobre las filas— vive dentro de la fase 2.
    if (digest(leidas.orders) !== body.digest) {
      return Response.json({ error: 'Las órdenes cambiaron; descarga un respaldo nuevo' }, { status: 409 })
    }

    // ── Fase 1 · la intención, en su propia transacción ──────────────────────────
    // Si esto falla, no se borra nada. Es la inversión exacta del diseño best-effort: ahí el
    // borrado iba primero y la constancia era una esperanza; aquí la constancia es requisito.
    const inicio = await rpc(key, 'r1_cleanup_begin', {
      p_operation_id: operationId,
      p_client_id: ctx.auth!.clientId,
      p_actor: ctx.auth!.staffName,
      p_staff_id: ctx.auth!.staffId ?? null,
      p_role: ctx.auth!.role,
      p_reason: typeof body?.reason === 'string' ? body.reason : null,
      p_confirmation: body.confirm,
      p_expected_count: leidas.orders.length,
      p_request_metadata: metadataDePeticion(request),
    })
    // Un `replay` sobre una operación ya COMMITTED sí puede seguir: la fase 2 devolverá ese
    // mismo resultado. Cualquier otro `ok:false` detiene la operación aquí.
    if (!inicio.ok && inicio.state !== 'COMMITTED') {
      return Response.json(inicio, { status: inicio.error === 'CONTEO_CAMBIO' ? 409 : 400 })
    }

    // ── Fase 2 · el efecto ──────────────────────────────────────────────────────
    const fin = await rpc(key, 'r1_cleanup_commit', {
      p_operation_id: operationId,
      p_client_id: ctx.auth!.clientId,
    })
    if (!fin.ok) {
      await marcarFallo(key, operationId, `fase 2 rechazó: ${fin.error ?? 'sin detalle'}`)
      const conflicto = fin.error === 'CONTEO_CAMBIO' || fin.error === 'DIGEST_NO_COINCIDE'
      return Response.json(fin, { status: conflicto ? 409 : 400 })
    }
    return Response.json(fin)

  } catch (e) {
    // ── Fase 3 · el fracaso, o el veredicto sobre un corte ambiguo ──────────────
    // Aquí cae el timeout posterior al commit. No se adivina: se le pregunta a la base, que
    // es la única que sabe si el DELETE llegó a confirmar.
    if (operationId && key) {
      const veredicto = await marcarFallo(key, operationId, (e as Error).message)
      if (veredicto?.error === 'YA_ESTABA_COMMITTED') {
        // El borrado sí ocurrió; sólo se perdió la respuesta. Reportarlo como error haría
        // que el operador lo repitiera.
        return Response.json({ ok: true, state: 'COMMITTED', deleted: veredicto.deleted, replay: true })
      }
    }
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
