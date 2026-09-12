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
  'pos_staff',
  'pos_terminals',
  'pos_fingerprint_templates',
  // Los precios sólo se editan desde /admin/menu, que es pantalla de gerente. Sin esto,
  // un shift token de mesero podía bajarle el precio a un platillo y cobrarlo barato.
  'pos_menu_items',
  'pos_menu_categories', 'pos_modifiers', 'pos_modifier_groups',
  'pos_item_modifier_groups', 'pos_category_modifiers', 'pos_sizes',
  'pos_price_types', 'pos_combos', 'pos_promotions', 'pos_payment_methods',
  'pos_inventory', 'pos_inventory_movements', 'pos_ingredients',
  'pos_recipes', 'pos_recipe_lines', 'pos_sub_recipes',
  'pos_sub_recipe_ingredients', 'pos_suppliers', 'pos_purchase_orders',
  'pos_purchase_order_items',
])

// ── LA CAJA LA OPERA UN CAJERO, Y NO PODÍA CERRARLA ─────────────────────────
//
// `pos_cash_movements` y `pos_cierres` estaban en MANAGER_ONLY_WRITE desde el
// 2026-08-25 (commit 02ce02c2). El efecto, encontrado el 2026-09-08:
//
//   · Una terminal POS con shift token y SIN sesión de Supabase se rutea por
//     `/api/pos/db` (supabase-fetch-patch.ts) — o sea, TODA caja de kiosco.
//   · `isManager` es admin | gerente | dueño. `cajero` NO está.
//   · Entonces el retiro de caja y el Corte Z de una caja logueada como cajero
//     mueren en 403. Y un 403 en el replay de la cola se clasifica terminal
//     (pos-offline-db.ts): no se reintenta jamás. El dinero del turno no sube nunca,
//     y la terminal muestra el corte hecho.
//
// AMALAY tiene CUATRO cajeros activos (consultado en pos_staff). Los ocho cierres que
// existen se guardaron bien porque los hizo Daniel, que es admin — por eso no se había
// visto. El día del cutover lo ve el primer cajero que cierre.
//
// POR QUÉ SE BAJA A CAJERO Y NO SE RESUELVE CON UNA APROBACIÓN FIRMADA. El wizard ya
// tiene el token firmado del gerente (`consumeManagerApproval`) y lo natural sería
// mandarlo en una cabecera. No sirve: el cierre se ENCOLA, y el replay reproduce la
// operación sin cabeceras. Quedaría igual de roto justo en el caso offline, que es el
// que más importa.
//
// QUÉ SE PIERDE Y QUÉ NO. El que no debe poder inventar un cierre ni un retiro es el
// MESERO, y sigue sin poder. Un cajero moviendo la caja que él mismo opera es la
// operación normal — y su control real no es este proxy sino el arqueo, más el PIN de
// gerente que `CierreCajaWizard` exige (`hasPermission(role, 'corte_z')`) antes de
// llegar aquí. Este candado estaba duplicando ese control con el rol equivocado: el de
// la sesión, no el de quien autoriza.
const NIVEL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, 'dueño': 5 }

/** Nivel mínimo para ESCRIBIR, cuando no basta con la lista de gerente. */
export const NIVEL_MINIMO_DE_ESCRITURA: Record<string, number> = {
  pos_cash_movements: NIVEL.cajero,
  pos_cierres: NIVEL.cajero,
}

/** ¿Este rol alcanza para escribir en esta tabla? */
export function puedeEscribirEn(table: string, role: string | null | undefined): boolean {
  if (MANAGER_ONLY_WRITE.has(table)) return isManager(role)
  const minimo = NIVEL_MINIMO_DE_ESCRITURA[table]
  if (minimo === undefined) return true
  return (NIVEL[String(role)] || 0) >= minimo
}

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
 * El proxy no es una API de guardado: para roles operativos sólo admite
 * kds_item_status y mesero. Nuevas columnas de consumo o finanzas deben usar
 * el contrato de guardado, no heredar autorización por estar ausentes de una lista.
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

/**
 * EL DINERO DEL TURNO TAMBIÉN ES DINERO, Y NO ESTABA PROTEGIDO.
 *
 * `CAMPOS_SOLO_DE_GERENTE` sólo cubría `pos_orders`. Sobre `pos_turnos` lo único
 * prohibido a un rol bajo era poner `closed_at` en null (reabrir). Todo lo demás
 * pasaba entero, así que con un shift token de mesero:
 *
 *     PATCH pos_turnos?id=eq.<turno>   { "efectivo_sistema": 4200, "diferencia": 0 }
 *
 * y el arqueo del turno cuadra después de sacar efectivo del cajón. (Barrido de
 * permisos, 2026-09-12.)
 *
 * NO se puede exigir gerente: el Corte Z lo cierra la caja, que opera como
 * `cajero`, y su PATCH lleva justo esas columnas. Un candado de gerente mataría
 * el corte en 403 y —por la clasificación terminal del replay— el turno no
 * subiría nunca. Por eso el candado es por NIVEL: cajero sí, mesero no.
 */
export const CAMPOS_POR_NIVEL_MINIMO: Record<string, { columnas: readonly string[]; nivel: number }> = {
  pos_turnos: {
    columnas: ['efectivo_sistema', 'diferencia', 'fondo_final', 'fondo_inicial', 'total_ventas', 'closed_by', 'client_id'],
    nivel: 2, // cajero
  },
  pos_cierres: {
    columnas: ['total_contado', 'efectivo_sistema', 'diferencia', 'total_ventas', 'propinas', 'client_id'],
    nivel: 2, // cajero
  },
  pos_cash_movements: {
    columnas: ['amount', 'type', 'client_id'],
    nivel: 2, // cajero
  },
}

/** Tablas donde BORRAR exige gerente, aunque escribir no. Una orden no se borra: se cancela. */
export const MANAGER_ONLY_DELETE = new Set<string>(['pos_orders'])

/**
 * BORRAR ES LA EXCEPCIÓN, NO LA REGLA.
 *
 * `MANAGER_ONLY_DELETE` es una lista de prohibiciones, y por eso cada tabla que
 * entra a `ALLOW` nace BORRABLE por un shift token de mesero. Medido el
 * 2026-09-12 sobre las 37 tablas de la lista: sólo `pos_orders` estaba cubierta,
 * así que un mesero podía mandar
 *
 *     DELETE pos_audit_log?client_id=eq.<tenant>
 *
 * y llevarse la bitácora donde caen `order_reopened`, `skimming_suspect` y
 * `legacy_no_approval` — justo la evidencia que los flags en modo grace están
 * recolectando para poder endurecerlos. El cuerpo de un DELETE va vacío, así que
 * el candado por columnas ni siquiera llega a evaluarse.
 *
 * Se invierte el default: un rol operativo sólo borra donde alguien lo escribió
 * aquí a propósito. Hoy la lista está vacía porque ninguna pantalla de servicio
 * borra por el proxy (las de catálogo son de gerente y van por MANAGER_ONLY_WRITE).
 * Si mañana una pantalla necesita borrar, se agrega con su razón, y eso deja
 * constancia de la decisión en vez de heredarla por omisión.
 */
export const BORRADO_PERMITIDO_A_ROL_OPERATIVO = new Set<string>([])

/** ¿Este rol alcanza para BORRAR en esta tabla? */
export function puedeBorrarEn(table: string, role: string | null | undefined): boolean {
  if (isManager(role)) return true
  return BORRADO_PERMITIDO_A_ROL_OPERATIVO.has(table) && puedeEscribirEn(table, role)
}

/**
 * LA BITÁCORA SE ESCRIBE, NO SE CORRIGE.
 *
 * `pos_audit_log` tiene que aceptar INSERT de cualquier terminal: ahí caen las
 * cancelaciones, las reaperturas y los avisos de sospecha, y si un mesero no
 * pudiera insertar, la evidencia se perdería justo cuando importa. Pero un
 * PATCH sobre una fila ya escrita sirve para UNA sola cosa: cambiarle el `actor`
 * a la cancelación que uno hizo. Nadie lo necesita.
 */
export const SOLO_SE_INSERTA = new Set<string>(['pos_audit_log', 'pos_save_operations'])

/**
 * Qué columnas prohibidas trae este cuerpo. Vacío = puede pasar.
 *
 * Un cuerpo ilegible NO se deja pasar por las dudas: si no se puede leer qué escribe, no
 * se puede afirmar que no toca el dinero. Devuelve la marca de ilegible para que quien
 * llama lo rechace con un mensaje claro.
 */
/**
 * REABRIR NO ES ESCRIBIR, Y POR ESO NO BASTA CON PROHIBIR LA TABLA.
 *
 * `pos_turnos` no está en MANAGER_ONLY_WRITE, y no puede estarlo: el cierre de caja se
 * ENCOLA (CierreCajaWizard.tsx:315) y la cola lo reproduce con el shift token de quien
 * esté logueado. Si esa terminal opera con rol `cajero` —que es lo normal en una caja—
 * un candado por tabla haría que el corte Z muriera en 403 y no llegara nunca a la nube.
 * Cerrar el hueco por ahí abriría uno peor: el dinero del turno sin subir.
 *
 * Pero dejar la tabla abierta permite esto con un shift token de mesero:
 *
 *     PATCH pos_turnos?id=eq.<turno>   { "closed_at": null }
 *
 * y el turno ya cortado vuelve a estar abierto. Se cobra dentro de él, después del Z, y
 * esas ventas quedan fuera del corte que ya se imprimió y se entregó.
 *
 * La asimetría es la clave: CERRAR un turno es una operación de todos los días que la cola
 * tiene que poder reproducir; REABRIRLO es una corrección administrativa. Se prohíbe el
 * valor, no la columna — poner `closed_at` con una fecha sigue pasando.
 */
export const REABRIR_SOLO_GERENTE: Record<string, string> = {
  pos_turnos: 'closed_at',
}

/** ¿Este cuerpo intenta reabrir algo cerrado? */
function intentaReabrir(table: string, fila: Record<string, unknown>): boolean {
  const col = REABRIR_SOLO_GERENTE[table]
  return !!col && col in fila && fila[col] === null
}

export function camposProhibidos(table: string, role: string | null | undefined, cuerpo: string | undefined): string[] {
  const vetadas = CAMPOS_SOLO_DE_GERENTE[table]
  const porNivel = CAMPOS_POR_NIVEL_MINIMO[table]
  // Un rol que ya alcanza el nivel de esas columnas no tiene nada que vetar ahí.
  const vetadasPorNivel = porNivel && (NIVEL[String(role)] || 0) < porNivel.nivel ? porNivel.columnas : null
  const puedeReabrir = !(table in REABRIR_SOLO_GERENTE)
  if ((!vetadas && !vetadasPorNivel && puedeReabrir) || isManager(role)) return []
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
    const obj = fila as Record<string, unknown>
    if (intentaReabrir(table, obj)) encontradas.add(`${REABRIR_SOLO_GERENTE[table]} (reabrir)`)
    if (vetadasPorNivel) for (const col of Object.keys(obj)) if (vetadasPorNivel.includes(col)) encontradas.add(col)
    if (!vetadas) continue
    for (const col of Object.keys(obj)) {
      if (vetadas.includes(col) || (table === 'pos_orders' && !['kds_item_status', 'mesero'].includes(col))) encontradas.add(col)
    }
  }
  return [...encontradas]
}

/**
 * Columnas que NUNCA salen por el proxy, pase lo que pase en el `select`.
 *
 * Las consultas genéricas sólo admiten selección plana; alias, embeddings y
 * filtros sobre secretos se rechazan. La salida se redacta además para cubrir
 * select=* y los recibos de escritura de las rutas fijas.
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
  const resource = (path.split('?')[0] || '').replace(/^rest\/v1\//, '')
  return /^[a-z][a-z0-9_]*$/.test(resource) && !path.includes('#') ? resource : ''
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

/** Validate caller fields before adding server-owned scope. PATCH identity is
 * immutable for every role. POST retains new IDs but stamps the authenticated
 * tenant. Both proxy entrypoints must use this contract before any write. */
export function prepararCuerpoProxy(table: string, role: string | null | undefined,
  method: string, raw: string, clientId: string):
  { body?: string; error?: undefined } | { error: string; status: 400 | 403 } {
  if (!raw) return { body: undefined }
  let data: unknown
  try { data = JSON.parse(raw) } catch { return { error: 'cuerpo JSON inválido', status: 400 } }
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)
  const rows = Array.isArray(data) ? data : [data]
  if (!rows.length || !rows.every(object) || (method !== 'POST' && !object(data))) {
    return { error: 'se requiere un objeto; sólo POST admite lotes de objetos', status: 400 }
  }
  if (method === 'PATCH' && rows.some(row => 'id' in row || 'client_id' in row)) {
    return { error: 'id y client_id son inmutables', status: 403 }
  }
  // POST scope supplied by a caller is replaced, never used as authorization.
  const callerRows = rows.map(row => {
    const copy = { ...row }
    if (method === 'POST') delete copy.client_id
    return copy
  })
  const forbidden = camposProhibidos(table, role, JSON.stringify(callerRows))
  if (forbidden.length) return { error: `estas columnas requieren rol de gerente: ${forbidden.join(', ')}`, status: 403 }
  const stamped = callerRows.map(row => method === 'POST' && !NO_CID.has(table) ? { ...row, client_id: clientId } : row)
  return { body: JSON.stringify(Array.isArray(data) ? stamped : stamped[0]) }
}

/** The generic POS proxy supports flat columns only. Aliases/embeds must use a
 * domain endpoint with its own field and relationship authorization. Existing
 * POS callers use flat selections; identity secrets cannot be renamed around
 * response redaction or tested through filters/counts. */
export function consultaProxyValida(table: string, params: URLSearchParams): boolean {
  if (params.getAll('select').length > 1) return false
  const select = params.get('select')
  if (select !== null && !/^(?:\*|[a-z_][a-z0-9_]*)(?:,(?:\*|[a-z_][a-z0-9_]*))*$/i.test(select)) return false
  const secrets = REDACTED_COLUMNS[table] || []
  return !secrets.some(column => new RegExp(`\\b${column}\\b`, 'i').test(Array.from(params.entries()).flat().join(' ')))
}
