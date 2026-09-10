/**
 * Qué hacer con la caché `pos_cuenta_<tenant>_mesa:N` cuando la cuenta dejó de
 * estar abierta en Caja.
 *
 * La caché guarda la última cuenta confirmada (`confirmed`), su línea base para
 * el merge (`base`) y el borrador del operador (`draft`). Al cobrar no se
 * limpiaba: la mesa se veía libre en el mapa, pero al abrirla el editor adoptaba
 * el `confirmed.id` de la orden ya liquidada, pintaba sus platillos y la lectura
 * devolvía «cerrada» para siempre. Mover y anular no servían de salida porque
 * exigen una cuenta remota viva, así que la mesa quedaba inservible en esa
 * terminal y con platillos de una orden cerrada en pantalla.
 *
 * La regla: la identidad de una cuenta liquidada NO se conserva. Lo que sí se
 * conserva es el trabajo del operador que todavía no estaba en esa cuenta.
 */

interface RenglonGuardado { id?: unknown }
interface CuentaGuardada { items?: unknown }
export interface CacheDeCuenta {
  confirmed?: { id?: unknown; items?: unknown } | null
  base?: CuentaGuardada | null
  draft?: CuentaGuardada | null
  draftOrderId?: unknown
  confirmedAt?: unknown
}

const idsDe = (cuenta: unknown): Set<string> => {
  const items = (cuenta as CuentaGuardada | null)?.items
  if (!Array.isArray(items)) return new Set()
  return new Set(items.map(i => String((i as RenglonGuardado)?.id ?? '')).filter(Boolean))
}

/**
 * Renglones del borrador que no estaban en la cuenta que se cerró. Son lo único
 * que el operador podría perder: todo lo demás ya se cobró o se anuló.
 */
function renglonesPropios(guardado: CacheDeCuenta): unknown[] {
  const items = (guardado.draft as CuentaGuardada | null)?.items
  if (!Array.isArray(items)) return []
  const yaCerrados = idsDe(guardado.confirmed)
  return items.filter(i => !yaCerrados.has(String((i as RenglonGuardado)?.id ?? '')))
}

/**
 * Decide qué queda en la caché de una mesa cuya cuenta ya no está abierta.
 * Devuelve `null` cuando hay que borrar la llave por completo.
 *
 * `motivo` distingue los dos caminos: al cobrar desde esta terminal no queda
 * nada que conservar, porque lo que se cobró es justamente lo que estaba en
 * pantalla. Al enterarse por Caja de que la cuenta se cerró en otra terminal, sí
 * puede haber renglones tecleados aquí que nadie cobró.
 */
export function cacheTrasElCierre(
  guardado: CacheDeCuenta | null | undefined,
  motivo: 'cobrada-aqui' | 'cerrada-en-caja',
): CacheDeCuenta | null {
  if (!guardado || typeof guardado !== 'object') return null
  if (motivo === 'cobrada-aqui') return null

  const propios = renglonesPropios(guardado)
  if (!propios.length) return null
  // Se conserva el borrador SIN la identidad de la cuenta liquidada: si `confirmed`
  // sobreviviera, el editor volvería a adoptar su id y la mesa seguiría trabada.
  const draft = { ...(guardado.draft as object), items: propios }
  return { draft: draft as CuentaGuardada }
}


/** Select the current account cache before consulting an older storage format. */
export function cachePreferidaAlAbrir(guardado: CacheDeCuenta | null | undefined, migrarLegacy: () => CacheDeCuenta | null | undefined): CacheDeCuenta | null | undefined {
  if (guardado?.confirmed?.id || Array.isArray(guardado?.draft?.items)) return guardado
  return migrarLegacy()
}
