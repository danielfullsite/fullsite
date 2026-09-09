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
  // Los precios sólo se editan desde /admin/menu, que es pantalla de gerente. Sin esto,
  // un shift token de mesero podía bajarle el precio a un platillo y cobrarlo barato.
  'pos_menu_items',
])

/**
 * COLUMNAS QUE UN MESERO NO PUEDE ESCRIBIR, aunque la tabla sí sea suya.
 *
 * `pos_orders` no puede ser manager-only: los meseros escriben órdenes todo el día. Pero
 * dentro de esa tabla viven las cifras del dinero, y por el proxy —que corre con
 * service_role y se salta RLS— cualquiera con shift token podía mandar
 *
 *     PATCH pos_orders?id=eq.<orden>   { "total": 1 }
 *
 * y el arqueo cuadraba, porque `pagos == total`. La diferencia se la queda quien cobró.
 * Es el mismo vector de skimming que `/api/pos/save-order` ya detecta recomputando el
 * total desde los renglones — sólo que ese detector vive en la ruta de guardado, y este
 * camino la rodea por completo.
 *
 * Se prohíben por COLUMNA y no por tabla a propósito: una lista de lo prohibido deja pasar
 * cualquier columna legítima que aún no conozcamos, mientras que una lista de lo permitido
 * rompería el POS en cuanto alguien agregue un campo. En un restaurante, un 403 a media
 * comanda cuesta más que el hueco.
 *
 * Verificado el 2026-09-08: las ÚNICAS escrituras del cliente a `pos_orders` que pasan por
 * aquí son `kds_item_status` (cocina marcando, kds/page.tsx:332) y `mesero`
 * (pos/page.tsx:4295). El guardado de órdenes va por APP_API a `/api/pos/save-order`, que
 * recalcula del lado del servidor, y la cola offline lo reproduce por ese mismo camino.
 * Ninguna de estas columnas se escribe legítimamente desde el navegador.
 */
export const CAMPOS_SOLO_DE_GERENTE: Record<string, readonly string[]> = {
  pos_orders: [
    'total', 'subtotal', 'iva', 'descuento', 'propina', 'saldo', 'pagos',
    'payment_status', 'status', 'order_revision', 'turno_id', 'client_id',
  ],
}

/** Tablas donde BORRAR exige gerente, aunque escribir no. Una orden no se borra: se cancela. */
export const MANAGER_ONLY_DELETE = new Set<string>(['pos_orders'])

/**
 * Qué columnas prohibidas trae este cuerpo. Vacío = puede pasar.
 *
 * Un cuerpo ilegible NO se deja pasar por las dudas: si no se puede leer qué escribe, no
 * se puede afirmar que no toca el dinero. Devuelve la marca de ilegible para que quien
 * llama lo rechace con un mensaje claro.
 */
export function camposProhibidos(table: string, role: string | null | undefined, cuerpo: string | undefined): string[] {
  const vetadas = CAMPOS_SOLO_DE_GERENTE[table]
  if (!vetadas || isManager(role)) return []
  if (!cuerpo) return []
  let dato: unknown
  try {
    dato = JSON.parse(cuerpo)
  } catch {
    return ['(cuerpo ilegible)']
  }
  const filas = Array.isArray(dato) ? dato : [dato]
  const encontradas = new Set<string>()
  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') continue
    for (const col of Object.keys(fila as Record<string, unknown>)) {
      if (vetadas.includes(col)) encontradas.add(col)
    }
  }
  return [...encontradas]
}

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
