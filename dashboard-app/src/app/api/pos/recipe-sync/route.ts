import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * A1.2 — Recipe unification: proyecta una receta editada en la UI (pos_recipes_old,
 * el sistema flat/legacy que lee food-cost) al sistema normalizado R1
 * (pos_recipe_versions + pos_recipe_lines) que la deducción de stock realmente lee
 * (r1_reconcile_item, 004_functions.sql). Sin esto, el cliente captura una receta y
 * el POS NUNCA descuenta (los dos sistemas estaban desconectados).
 *
 * Contrato:
 *  - Se invoca desde las UIs de recetas (/recetas, /pos/recetas) tras cada edición
 *    (agregar/quitar ingrediente, crear receta).
 *  - Fuente de verdad sigue siendo pos_recipes_old (food-cost intacto); R1 queda
 *    DERIVADO y en sync.
 *  - Guardas de seguridad (protegen AMALAY vivo):
 *      · Legacy (AMALAY/wansoft): en tenants con data_source != 'fullsite' las
 *        versiones R1 fueron construidas por un batch que CURÓ/convirtió las
 *        cantidades (pos_recipes_old derivó de R1, no al revés — validado: 29 líneas
 *        con cantidad distinta, 85 líneas extra). Por eso, si el item YA tiene una
 *        versión activa, NO se reconstruye (skipped='legacy_protected'). Solo se
 *        rellenan huecos (items sin versión). Para clientes nuevos ('fullsite')
 *        pos_recipes_old ES la fuente de verdad → siempre reconstruye.
 *      · Subrecetas: si la receta contiene líneas ingredient_type='sub_recipe' NO se
 *        reconstruye la versión R1 (requiere explosión con yield/unidades que hizo el
 *        batch). Se deja intacta la versión activa existente. skipped='subrecipe'.
 *        Los clientes nuevos capturan ingredientes directos → nunca caen aquí.
 *      · Policy flip: inventory_mode se sube a 'recipe' SOLO si estaba
 *        'unclassified'/'non_inventory' o faltaba. NUNCA pisa 'direct_stock'
 *        (item de market deliberado).
 *  - No-corruptivo: en fallo parcial, a lo más queda una versión INACTIVA huérfana
 *    (inofensiva; la activación es el último paso y es atómica vía RPC).
 */

export const dynamic = 'force-dynamic'

interface SyncResult {
  ok: boolean
  menu_item_id?: string
  version?: number
  lines?: number
  mode?: string
  skipped?: 'subrecipe' | 'empty' | 'legacy_protected'
  error?: string
}

type OldRow = { ingredient_id: string; ingredient_type: string | null; quantity: number; unit: string | null }

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId

    const body = await request.json().catch(() => ({}))
    const menuItemId: string | undefined = body?.menu_item_id
    const actor: string = (typeof body?.actor === 'string' && body.actor) || 'ui_sync'
    if (!menuItemId || typeof menuItemId !== 'string') {
      return Response.json({ ok: false, error: 'INVALID_MENU_ITEM_ID' } satisfies SyncResult, { status: 400 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) {
      return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' } satisfies SyncResult, { status: 500 })
    }
    const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' }
    const cid = encodeURIComponent(clientId)
    const mid = encodeURIComponent(menuItemId)

    // ── 1. Leer la receta flat actual (fuente de verdad de la UI) ──────────────
    const oldRes = await fetch(
      `${sbUrl}/rest/v1/pos_recipes_old?client_id=eq.${cid}&menu_item_id=eq.${mid}` +
      `&select=ingredient_id,ingredient_type,quantity,unit`,
      { headers: H, cache: 'no-store' }
    )
    if (!oldRes.ok) {
      return Response.json({ ok: false, error: `READ_FAILED_${oldRes.status}` } satisfies SyncResult, { status: 502 })
    }
    const rawRows: OldRow[] = await oldRes.json()

    // Filtrar placeholders y líneas en cero: createNewRecipe siembra una fila
    // sentinela (ingredient_id='0', quantity=0) para materializar la receta vacía.
    // Esas NO deben proyectarse a R1 (ingredient_id='0' no es un ingrediente real).
    const oldRows = rawRows.filter(
      r => r.ingredient_id && r.ingredient_id !== '0' && (Number(r.quantity) || 0) > 0
    )

    // Receta vacía o solo placeholder: no reconstruimos R1 — dejamos la versión
    // activa como estaba. (La reversión de policy es un flujo aparte.)
    if (oldRows.length === 0) {
      return Response.json({ ok: true, menu_item_id: menuItemId, skipped: 'empty' } satisfies SyncResult)
    }

    // ── 2. Guarda de subrecetas — protege AMALAY (no reconstruir sin explosión) ─
    const hasSubRecipe = oldRows.some(r => r.ingredient_type === 'sub_recipe')
    if (hasSubRecipe) {
      return Response.json({ ok: true, menu_item_id: menuItemId, skipped: 'subrecipe' } satisfies SyncResult)
    }

    // ── 3. Agregar por ingrediente (respeta UNIQUE(recipe_version_id,ingredient_id)) ─
    const agg = new Map<string, { quantity: number; unit: string | null }>()
    for (const r of oldRows) {
      const q = Number(r.quantity) || 0
      const prev = agg.get(r.ingredient_id)
      if (prev) prev.quantity += q
      else agg.set(r.ingredient_id, { quantity: q, unit: r.unit })
    }

    // ── 4. Versiones existentes + gate legacy ──────────────────────────────────
    const verRes = await fetch(
      `${sbUrl}/rest/v1/pos_recipe_versions?client_id=eq.${cid}&menu_item_id=eq.${mid}` +
      `&select=version,active&order=version.desc`,
      { headers: H, cache: 'no-store' }
    )
    const verRows: { version: number; active: boolean }[] = verRes.ok ? await verRes.json() : []
    const hasActiveVersion = verRows.some(v => v.active)

    // Gate legacy: en tenants no-'fullsite' (AMALAY/wansoft) las versiones R1 fueron
    // curadas por batch. Si ya hay una activa, NO la sobrescribimos (protegemos la
    // deducción viva). Solo rellenamos huecos. Clientes nuevos siempre reconstruyen.
    const dsRes = await fetch(
      `${sbUrl}/rest/v1/clients?id=eq.${cid}&select=data_source`,
      { headers: H, cache: 'no-store' }
    )
    const dsRows: { data_source: string | null }[] = dsRes.ok ? await dsRes.json() : []
    const isLegacy = (dsRows[0]?.data_source ?? 'fullsite') !== 'fullsite'
    if (isLegacy && hasActiveVersion) {
      return Response.json({ ok: true, menu_item_id: menuItemId, skipped: 'legacy_protected' } satisfies SyncResult)
    }

    const nextVersion = (verRows[0]?.version ?? 0) + 1

    // ── 5. Crear versión (inactiva) ────────────────────────────────────────────
    const insVerRes = await fetch(`${sbUrl}/rest/v1/pos_recipe_versions`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({
        client_id: clientId, menu_item_id: menuItemId, version: nextVersion,
        active: false, source: 'ui_sync', created_by: actor,
      }),
      cache: 'no-store',
    })
    if (!insVerRes.ok) {
      const detail = await insVerRes.text().catch(() => '')
      return Response.json({ ok: false, error: `VERSION_INSERT_${insVerRes.status}:${detail.slice(0, 200)}` } satisfies SyncResult, { status: 502 })
    }
    const [ver] = await insVerRes.json() as { id: number }[]
    const versionId = ver?.id
    if (!versionId) {
      return Response.json({ ok: false, error: 'VERSION_ID_MISSING' } satisfies SyncResult, { status: 502 })
    }

    // ── 6. Insertar líneas ─────────────────────────────────────────────────────
    const lineRows = [...agg.entries()].map(([ingredient_id, v]) => ({
      client_id: clientId, recipe_version_id: versionId,
      ingredient_id, quantity: v.quantity, recipe_unit: v.unit,
    }))
    const insLinesRes = await fetch(`${sbUrl}/rest/v1/pos_recipe_lines`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(lineRows),
      cache: 'no-store',
    })
    if (!insLinesRes.ok) {
      const detail = await insLinesRes.text().catch(() => '')
      return Response.json({ ok: false, error: `LINES_INSERT_${insLinesRes.status}:${detail.slice(0, 200)}` } satisfies SyncResult, { status: 502 })
    }

    // ── 7. Activar la versión (atómico: desactiva la anterior) ──────────────────
    const actRes = await fetch(`${sbUrl}/rest/v1/rpc/activate_recipe_version`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        p_client_id: clientId, p_menu_item_id: menuItemId,
        p_new_version: nextVersion, p_actor: actor,
      }),
      cache: 'no-store',
    })
    if (!actRes.ok) {
      const detail = await actRes.text().catch(() => '')
      return Response.json({ ok: false, error: `ACTIVATE_${actRes.status}:${detail.slice(0, 200)}` } satisfies SyncResult, { status: 502 })
    }

    // ── 8. Policy → 'recipe' (regla segura: nunca pisa direct_stock) ────────────
    const polRes = await fetch(
      `${sbUrl}/rest/v1/pos_item_inventory_policy?client_id=eq.${cid}&menu_item_id=eq.${mid}&select=inventory_mode`,
      { headers: H, cache: 'no-store' }
    )
    const polRows: { inventory_mode: string }[] = polRes.ok ? await polRes.json() : []
    const currentMode = polRows[0]?.inventory_mode ?? null
    let finalMode = currentMode ?? 'recipe'
    if (currentMode === null || currentMode === 'unclassified' || currentMode === 'non_inventory') {
      const upRes = await fetch(
        `${sbUrl}/rest/v1/pos_item_inventory_policy?on_conflict=client_id,menu_item_id`,
        {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            client_id: clientId, menu_item_id: menuItemId,
            inventory_mode: 'recipe', approved_by: actor, approved_at: new Date().toISOString(),
          }),
          cache: 'no-store',
        }
      )
      if (upRes.ok) finalMode = 'recipe'
    }

    return Response.json({
      ok: true, menu_item_id: menuItemId, version: nextVersion,
      lines: lineRows.length, mode: finalMode,
    } satisfies SyncResult)
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'INTERNAL' } satisfies SyncResult, { status: 500 })
  }
}
