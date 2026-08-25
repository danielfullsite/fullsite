/**
 * Política compartida de los proxies `/api/pos/db`.
 *
 * Los dos proxies escriben y leen con **service_role**, o sea que se saltan RLS.
 * Lo único que separa a un mesero del PIN del gerente es lo que diga este archivo.
 *
 * El hueco que lo motiva (auditoría 2026-08-25): el proxy catch-all
 * (`db/[...path]/route.ts`) sólo comprobaba que la tabla empezara con `pos_`.
 * Sin lista blanca y sin control de rol. Con un shift token de mesero:
 *
 *     GET   pos_staff?select=*            → lee el PIN de todo el personal
 *     PATCH pos_staff?id=eq.<gerente>     → le reescribe el PIN
 *
 * y entra como gerente. El aislamiento por tenant sí estaba (se inyecta
 * `client_id`), el de rol no.
 *
 * El hermano `db/route.ts` sí tenía lista blanca, pero `pos_staff` estaba dentro
 * y fuera de MANAGER_ONLY, así que la escritura también pasaba.
 */

/** Tablas que los proxies pueden tocar. Lo que no está aquí, no existe. */
export const ALLOW = new Set<string>([
  'pos_orders',
  'pos_menu_items',
  'pos_menu_categories',
  'pos_modifiers',
  'pos_modifier_groups',
  'pos_item_modifier_groups',
  'pos_category_modifiers',
  'pos_mesas',
  'pos_staff',
  'pos_staff_shifts',
  'pos_turnos',
  'pos_cierres',
  'pos_cash_movements',
  'pos_payment_methods',
  'pos_promotions',
  'pos_print_jobs',
  'pos_save_operations',
  'pos_audit_log',
  'pos_customers',
  'pos_attendance',
  'pos_sessions',
  'pos_terminals',
  'pos_inventory',
  'pos_inventory_movements',
  'pos_recipes',
  'pos_recipe_lines',
  'pos_ingredients',
  'pos_suppliers',
  'pos_purchase_orders',
  'pos_purchase_order_items',
  'pos_sub_recipes',
  'pos_sub_recipe_ingredients',
  'pos_fingerprint_templates',
  'pos_combos',
  'pos_sizes',
  'pos_price_types',
])

/** Tablas donde NO se estampa `client_id` (son hijas y lo heredan del padre). */
export const NO_CID = new Set<string>(['pos_purchase_order_items', 'pos_sub_recipe_ingredients'])

/**
 * Escribir en estas exige rol de gerente.
 *
 * `pos_staff` es la incorporación de hoy y la que cierra la escalada: sin ella,
 * cualquiera con shift token se reescribe el PIN del gerente. `pos_terminals` y
 * `pos_fingerprint_templates` van por lo mismo — dan de alta identidad.
 */
export const MANAGER_ONLY_WRITE = new Set<string>([
  'pos_cash_movements',
  'pos_cierres',
  'pos_staff',
  'pos_terminals',
  'pos_fingerprint_templates',
])

/**
 * Columnas que NUNCA salen por el proxy, pase lo que pase en el `select`.
 *
 * Se filtran del CUERPO de la respuesta, no del query: un `select=*`, un
 * `select=pin`, un embed o un RPC que devuelva la fila entera quedan cubiertos
 * por igual. Filtrar el query string se puede evadir; filtrar la salida no.
 */
export const REDACTED_COLUMNS: Record<string, readonly string[]> = {
  pos_staff: ['pin'],
  pos_fingerprint_templates: ['template', 'template_data'],
}

export function isManager(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'gerente' || role === 'dueño'
}

/** Nombre de tabla a partir de `pos_orders?select=*` o `rest/v1/pos_orders?...`. */
export function tableOf(path: string): string {
  return (path.split('?')[0] || '').replace(/^rest\/v1\//, '').split('/')[0] || ''
}

/**
 * Quita las columnas prohibidas del JSON de respuesta.
 *
 * Devuelve el texto tal cual si no hay nada que redactar o si no es JSON —
 * PostgREST puede devolver CSV, un conteo o un cuerpo vacío, y romperlos aquí
 * dejaría al POS sin datos.
 */
export function redactResponse(table: string, text: string, contentType: string | null): string {
  const cols = REDACTED_COLUMNS[table]
  if (!cols || !text) return text
  if (contentType && !contentType.includes('json')) return text

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return text
  }

  const strip = (row: unknown): unknown => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const out = { ...(row as Record<string, unknown>) }
    for (const c of cols) delete out[c]
    return out
  }

  const cleaned = Array.isArray(data) ? data.map(strip) : strip(data)
  return JSON.stringify(cleaned)
}
