// ¿Este restaurante es dueño de los datos históricos de Wansoft?
//
// Hay tablas heredadas de Wansoft —`wansoft_waiter_categories`, `wansoft_kpis`,
// `wansoft_food_cost`— que NO tienen columna de cliente. No es un descuido que se pueda
// arreglar con RLS: la tabla no sabe de quién es cada fila, así que sólo puede haber UN
// restaurante dueño de ellas, y cualquiera que las lea ve sus datos.
//
// Por eso el código preguntaba `clientId === 'amalay'` en cuatro lugares. Esa
// comparación NO era una bandera de producto: era un guardián que impedía que un
// restaurante viera las ventas y los meseros de otro. Quitarla sin reemplazo abre una
// fuga.
//
// Lo que estaba mal era la pregunta, no la intención. "¿Eres AMALAY?" ata el producto a
// un cliente; "¿eres dueño del histórico de Wansoft?" es una propiedad configurable que
// un restaurante nuevo puede tener el día que migre desde Wansoft, sin tocar código.
//
// La señal es `clients.wansoft_subsidiary_id`: el id de sucursal en Wansoft. Existe
// desde antes, la escribe el alta del cliente, y hoy sólo AMALAY lo tiene — verificado
// contra producción el 2026-08-26. Si mañana migra otro restaurante, se lo pones y
// funciona solo.
//
// FALLA CERRADO. Si la consulta truena, o no hay respuesta, o el slug viene vacío, la
// respuesta es `false`: mejor que el chat no mencione meseros a que le enseñe los de
// otro restaurante. Es la diferencia entre una función incompleta y una fuga.

// Las credenciales se leen DENTRO de la función, no en scope de módulo.
//
// Leerlas al importar hace que el resultado dependa de CUÁNDO se importó: si algo
// carga este módulo antes de que las variables estén puestas, quedan capturadas en
// vacío para siempre y la función devuelve false eternamente. Como falla cerrado, eso
// se ve como "este restaurante no tiene histórico" en vez de como un error — el peor
// tipo de falla, silenciosa y plausible.
//
// Ya mordió una vez: una prueba importó el módulo en su beforeEach antes de asignar
// process.env y el agente de finanzas dejó de correr sin que nada lo dijera.
function credenciales(): { url: string; key: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

interface Entrada { valor: boolean; expira: number }
const cache = new Map<string, Entrada>()
const VIGENCIA_MS = 5 * 60 * 1000

/**
 * `true` sólo si el restaurante tiene `wansoft_subsidiary_id` en `clients`.
 *
 * Se cachea 5 minutos por tenant: se consulta en cada mensaje de chat y de voz, y el
 * dato cambia una vez en la vida de un restaurante (cuando migra).
 */
export async function esDuenoDelHistoricoWansoft(clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false
  const { url: SB_URL, key: SB_KEY } = credenciales()
  if (!SB_URL || !SB_KEY) return false // sin credenciales no se puede comprobar → cerrado

  const ahora = Date.now()
  const previo = cache.get(clientId)
  if (previo && previo.expira > ahora) return previo.valor

  let valor = false
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=wansoft_subsidiary_id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' },
    )
    if (res.ok) {
      const filas = (await res.json()) as { wansoft_subsidiary_id?: string | null }[]
      const id = filas?.[0]?.wansoft_subsidiary_id
      valor = typeof id === 'string' && id.trim() !== ''
    }
  } catch {
    valor = false // red caída → cerrado
  }

  cache.set(clientId, { valor, expira: ahora + VIGENCIA_MS })
  return valor
}

/** Sólo para pruebas: limpia la caché entre casos. */
export function _limpiarCacheWansoft(): void {
  cache.clear()
}
