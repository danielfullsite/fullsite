/**
 * Lo que necesita a alguien, ahora.
 *
 * El dashboard abre con una lista de cosas que atender, ordenadas por lo que
 * cuesta ignorarlas. Es lo contrario de un panel de KPIs: no responde "¿cómo
 * vamos?" sino "¿qué hago?".
 *
 * REGLA DURA: todo lo de aquí sale de datos reales o no aparece. Este dashboard
 * venía mostrando "Venta por mesa $39,505" porque dividía entre un dato ausente,
 * y "Total nómina $4,197" para una semana con cero turnos. Una lista de
 * pendientes inventados es peor que no tener lista: enseña a ignorarla.
 *
 * Por eso no hay ningún cálculo con fallback. Si el dato no está, el renglón no
 * existe.
 */

export type Severidad = 'critical' | 'warning' | 'info'

export interface Atencion {
  id: string
  severidad: Severidad
  titulo: string
  detalle: string
  /** Pesos que están en juego, si el agente lo estimó. */
  valor: number | null
  /** 0–1. Debajo de UMBRAL_CONFIANZA no se muestra. */
  confianza: number | null
  /** A dónde va el botón. */
  href?: string
  accion?: string
  // ── Detalle para el panel al picar el renglón ──────────────────────────────
  // `detalle` es una sola línea para la fila (acción sugerida O explicación). El
  // panel muestra las DOS por separado —qué pasa y qué hacer— cuando existen, sin
  // inventar nada: si el agente no lo reportó, la sección no aparece. Opcionales
  // para no romper a quien construya un Atencion a mano.
  /** Por qué pasa (explanation del agente). */
  explicacion?: string
  /** Qué hacer (suggested_action del agente). */
  accionSugerida?: string
  /** Tipo de detección, por si el panel quiere etiquetarlo. */
  tipo?: string | null
}

/** Fila cruda de `agent_events`. */
export interface EventoAgente {
  id: string
  severity: string | null
  title: string | null
  explanation: string | null
  suggested_action: string | null
  estimated_value: number | null
  confidence: number | null
  status: string | null
  created_at: string | null
  expires_at: string | null
  type: string | null
  /** Cuáles son las órdenes o insumos del hallazgo, si el agente los guardó. */
  evidence?: unknown
}

/**
 * Debajo de esto el agente no está seguro, y un pendiente dudoso arriba de la
 * pantalla vale menos que nada. 0.7 sale de los datos actuales: las 12
 * detecciones existentes van de 0.74 a 0.93, así que el umbral no las corta —
 * corta las que vengan peor.
 */
export const UMBRAL_CONFIANZA = 0.7

/** Estados que significan "ya no hay nada que hacer con esto". */
const RESUELTOS = new Set(['resolved', 'dismissed', 'closed', 'ignored', 'acted'])

const ORDEN: Record<Severidad, number> = { critical: 0, warning: 1, info: 2 }

function normalizaSeveridad(s: string | null): Severidad {
  if (s === 'critical' || s === 'warning' || s === 'info') return s
  // Un evento sin severidad reconocida NO se promueve a crítico: se trata como
  // informativo. Inflar la severidad es la forma más rápida de que la lista
  // pierda credibilidad.
  return 'info'
}

/** Rutas por tipo de detección. Un tipo desconocido simplemente no lleva botón. */
const DESTINOS: Record<string, { href: string; accion: string }> = {
  out_of_stock: { href: '/inventario', accion: 'Ver inventario' },
  low_stock: { href: '/inventario', accion: 'Ver inventario' },
  cancel_concentration: { href: '/cancelaciones', accion: 'Revisar' },
  skimming_suspect: { href: '/cancelaciones', accion: 'Revisar' },
  understaffed: { href: '/meseros', accion: 'Ver equipo' },
  peak_load: { href: '/meseros', accion: 'Ver equipo' },
  top_performer: { href: '/meseros', accion: 'Ver meseros' },
  ticket_declining: { href: '/ventas', accion: 'Ver ventas' },
  low_ticket: { href: '/ventas', accion: 'Ver ventas' },
  sales_vs_dow: { href: '/tendencias', accion: 'Ver tendencia' },
  dow_insight: { href: '/tendencias', accion: 'Ver tendencia' },
  food_cost: { href: '/food-cost', accion: 'Ver food cost' },
}

/** Fila cruda de `agent_results`, el otro cajón. */
export interface ResultadoAgente {
  id: string
  agent_id: string | null
  fecha: string | null
  summary: string | null
  priority: string | null
  updated_at: string | null
}

/**
 * Los agentes que hablan del SISTEMA, no del restaurante.
 *
 * Vigilan que los demás agentes corran, que la configuración esté bien, que las
 * tareas no fallen. Su trabajo importa —de hecho uno de ellos venía avisando que
 * cuatro agentes fallaban— pero no es un pendiente para quien administra un
 * restaurante. Meterlos aquí convierte la lista en una bitácora de servidores.
 */
const AGENTES_DE_INFRAESTRUCTURA = new Set(['hermes', 'config-validator', 'lab-watchdog', 'prediction-resolver'])

/**
 * Agentes cuyo hallazgo es CONTEXTO, no un pendiente.
 *
 * `climate` es el caso: marca sus días como `warning` y su resumen dice cosas
 * como «Light drizzle, 4 eventos hoy». El detalle que guarda adentro sí sirve
 * («temporada de frappes, asegura hielo y frutas»), pero el resumen no dice qué
 * hacer, y en una lista que se llama «cosas por atender» un renglón del que no
 * se puede hacer nada es relleno. La lista pierde credibilidad por el renglón
 * más flojo, no por el mejor.
 *
 * No es que el agente sobre: es que su salida pertenece a otro lugar de la
 * pantalla. Cuando su resumen diga la acción, se quita de aquí.
 */
const AGENTES_DE_CONTEXTO = new Set(['climate'])

/**
 * Un resultado deja de ser noticia. `stock-alert` escribe todos los días; el de
 * hace tres semanas no es un pendiente, es historia. `agent_events` resuelve
 * esto con `expires_at`, que `agent_results` no tiene, así que se acota por
 * frescura.
 */
const DIAS_VIGENTE = 3

/**
 * El segundo cajón.
 *
 * Diecinueve agentes escriben en `agent_results` y la pantalla de inicio sólo
 * leía `agent_events`, donde escriben cinco. Mil cien hallazgos guardados que
 * nadie veía desde la pantalla que se abre a diario.
 *
 * Pero volcarlos todos sería peor que no traerlos. Ahí adentro conviven «225 sin
 * stock» con «Sin problemas de calidad» y con avisos de nuestra propia
 * infraestructura. Una lista de pendientes con relleno enseña a ignorarla, que
 * es exactamente lo que este archivo dice en su encabezado.
 *
 * Por eso pasan cuatro filtros: sólo lo que el agente marcó como crítico o de
 * atención, sólo lo reciente, sólo el último de cada agente —escriben a diario y
 * no se necesita el historial—, y nada de los que hablan del sistema.
 *
 * Sin valor en pesos ni confianza: `agent_results` no los guarda. Se dejan en
 * null en vez de inventarlos, así que estos renglones ordenan después de los que
 * sí traen dinero estimado.
 */
export function desdeResultados(
  resultados: ResultadoAgente[],
  ahora: Date = new Date(),
): Atencion[] {
  const limite = ahora.getTime() - DIAS_VIGENTE * 86400000
  const masRecientePorAgente = new Map<string, ResultadoAgente>()

  for (const r of resultados) {
    if (!r.summary?.trim() || !r.agent_id) continue
    if (AGENTES_DE_INFRAESTRUCTURA.has(r.agent_id) || AGENTES_DE_CONTEXTO.has(r.agent_id)) continue
    // Sólo lo que el propio agente marcó como digno de atención. `info` es su
    // forma de decir «revisé y no hay nada».
    if (r.priority !== 'critical' && r.priority !== 'warning') continue
    const cuando = r.updated_at ?? r.fecha
    if (!cuando || new Date(cuando).getTime() < limite) continue
    const previo = masRecientePorAgente.get(r.agent_id)
    if (!previo || new Date(cuando) > new Date(previo.updated_at ?? previo.fecha ?? 0)) {
      masRecientePorAgente.set(r.agent_id, r)
    }
  }

  return [...masRecientePorAgente.values()].map(r => {
    const destino = r.agent_id ? DESTINOS_POR_AGENTE[r.agent_id] : undefined
    return {
      id: `resultado:${r.id}`,
      severidad: r.priority === 'critical' ? 'critical' as const : 'warning' as const,
      titulo: r.summary!.trim(),
      detalle: destino?.detalle ?? '',
      valor: null,
      confianza: null,
      href: destino?.href,
      accion: destino?.accion,
      explicacion: '',
      accionSugerida: '',
      tipo: r.agent_id,
    }
  })
}

/** A dónde lleva el hallazgo de cada agente. Sin entrada, el renglón no lleva botón. */
const DESTINOS_POR_AGENTE: Record<string, { href: string; accion: string; detalle: string }> = {
  'stock-alert':      { href: '/inventario', accion: 'Ver inventario', detalle: 'Insumos por debajo de su mínimo' },
  'auto86':           { href: '/auto86', accion: 'Ver platillos', detalle: 'Platillos que no se pueden preparar' },
  'purchase-predictor': { href: '/inventario-real/orden-compra', accion: 'Ver compra', detalle: 'Compra sugerida para los próximos días' },
  'suppliers':        { href: '/proveedores', accion: 'Ver proveedores', detalle: 'Movimiento en precios o entregas' },
  'waste':            { href: '/inventario', accion: 'Ver merma', detalle: 'Merma detectada' },
  'cost-variance':    { href: '/food-cost', accion: 'Ver food cost', detalle: 'El costo se movió respecto a lo esperado' },
  'menu-engineering': { href: '/platillos', accion: 'Ver carta', detalle: 'Platillos que conviene revisar de precio o quitar' },
  'staffing':         { href: '/meseros', accion: 'Ver equipo', detalle: 'La plantilla no cuadra con la venta esperada' },
  'tips':             { href: '/propinas', accion: 'Ver propinas', detalle: 'Diferencias de propina entre el equipo' },
  'upselling':        { href: '/meseros', accion: 'Ver meseros', detalle: 'Oportunidad de venta que se está dejando pasar' },
  'table-time':       { href: '/tendencias', accion: 'Ver tendencia', detalle: 'El ritmo de mesas cambió respecto al histórico' },
  'kitchen':          { href: '/cocina', accion: 'Ver cocina', detalle: 'Calidad o tiempos en cocina' },
  'crm-recompra':     { href: '/clientes', accion: 'Ver clientes', detalle: 'Clientes que dejaron de venir' },
  'anomaly':          { href: '/ventas', accion: 'Ver ventas', detalle: 'Movimiento fuera de lo normal' },
  'antifraud':        { href: '/cancelaciones', accion: 'Revisar', detalle: 'Patrón que conviene revisar' },
}

/**
 * Convierte las detecciones de los agentes en renglones de la lista.
 *
 * @param ahora fecha de referencia, inyectable para que las pruebas no dependan
 *              del reloj de quien las corre.
 */
export function desdeEventos(eventos: EventoAgente[], ahora: Date = new Date()): Atencion[] {
  return eventos
    .filter(e => {
      if (!e.title) return false
      if (e.status && RESUELTOS.has(e.status)) return false
      // Una detección vencida ya no es un pendiente: es historia.
      if (e.expires_at && new Date(e.expires_at).getTime() < ahora.getTime()) return false
      // Sin confianza declarada se deja pasar: el agente no la reportó, no es
      // que la haya reportado baja.
      if (e.confidence != null && e.confidence < UMBRAL_CONFIANZA) return false
      return true
    })
    .map(e => {
      const destino = e.type ? DESTINOS[e.type] : undefined
      return {
        id: e.id,
        severidad: normalizaSeveridad(e.severity),
        titulo: e.title!,
        detalle: e.suggested_action || e.explanation || '',
        valor: typeof e.estimated_value === 'number' && e.estimated_value > 0 ? e.estimated_value : null,
        confianza: typeof e.confidence === 'number' ? e.confidence : null,
        href: destino?.href,
        accion: destino?.accion,
        explicacion: e.explanation || '',
        accionSugerida: e.suggested_action || '',
        tipo: e.type ?? null,
      }
    })
    // Se devuelve ordenado: es el contrato de esta función desde antes y hay
    // pruebas que lo fijan. `ordenar` es idempotente, así que combinar los dos
    // orígenes y volver a ordenar no cuesta nada.
    .sort(porGravedadYDinero)
}

/**
 * El orden de la lista: primero por gravedad, y dentro de la misma gravedad por
 * dinero en juego.
 *
 * Vivía dentro de `desdeEventos`. Se saca para que ordene los DOS orígenes
 * juntos: si cada uno se ordenara por su lado, un aviso informativo del primer
 * cajón quedaría por encima de uno crítico del segundo sólo por venir antes.
 */
function porGravedadYDinero(a: Atencion, b: Atencion): number {
  const s = ORDEN[a.severidad] - ORDEN[b.severidad]
  if (s !== 0) return s
  return (b.valor ?? 0) - (a.valor ?? 0)
}

export function ordenar(items: Atencion[]): Atencion[] {
  return [...items].sort(porGravedadYDinero)
}

/** Pesos totales en juego, para el encabezado de la lista. */
export function valorEnJuego(items: Atencion[]): number {
  return items.reduce((s, i) => s + (i.valor ?? 0), 0)
}
