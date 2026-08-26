/**
 * Traduce la salida cruda de los agentes a español de restaurante.
 *
 * La campana de notificaciones volcaba `agent_results.summary` tal cual:
 *
 *     Hermes           18 issues: 0 critical, 12 high
 *     Alerta de Stock  ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo
 *     Config           1 issues
 *
 * Un restaurantero no sabe qué hacer con eso. No es su idioma, no dice qué pasó
 * en su negocio, y no propone nada. Daniel lo dijo directo: "los clientes no
 * entienden".
 *
 * DOS DECISIONES DE FONDO
 *
 * 1. Lo que no habla del negocio, NO SE MUESTRA. Una auditoría de los 1,025
 *    registros que publicaron los agentes encontró que 839 (81.9%) sólo cuentan
 *    su propia salida: "N issues", "N hallazgos", "N anomalías". Eso es
 *    telemetría de la plataforma. Su lugar es Herramientas → Agentes IA, no la
 *    campana del dueño.
 *
 * 2. Lo que sí habla del negocio se dice con VERBO PRIMERO y con el hecho
 *    completo. Es la misma fórmula del centro de agentes del dashboard, para que
 *    el producto hable de una sola manera.
 *
 * Ojo con el caso de stock: la misma auditoría mostró que "225 sin stock" se
 * repitió 24 días idénticos y "1,353 sin stock" otros 42. Un faltante que no se
 * mueve en seis semanas no es un faltante: es inventario sin capturar. Por eso
 * la traducción dice eso y no "se te acabaron 225 insumos", que sería alarmar
 * con algo falso.
 */

export interface AvisoCrudo {
  agent_id: string
  summary: string
  priority: string
}

export interface AvisoTraducido {
  /** Nombre del agente en cristiano. */
  agente: string
  /** Verbo + hecho. Sin punto final. */
  texto: string
  /** 'alta' pinta rojo; 'media' ámbar; 'info' neutro. */
  severidad: 'alta' | 'media' | 'info'
}

/** Cómo se llama cada agente para alguien que no programó el sistema. */
const NOMBRES: Record<string, string> = {
  'stock-alert': 'Lo que se está acabando',
  'purchase-predictor': 'Qué pedir esta semana',
  auto86: 'Qué bajar del menú',
  'anomaly-detector': 'Ventas fuera de lo normal',
  anomaly: 'Ventas fuera de lo normal',
  'intraday-sales': 'Cómo va la venta ahorita',
  'close-predictor': 'Cómo va a cerrar el día',
  predictor: 'Cómo va a cerrar el día',
  upselling: 'Qué ofrecer para vender más',
  'crm-recompra': 'Clientes que dejaron de venir',
  'antifraud-agent': 'Caja limpia',
  antifraud: 'Caja limpia',
  'fraud-watcher': 'Caja limpia',
  tips: 'Propinas',
  'table-time': 'Tiempos de mesa',
  kitchen: 'Cocina',
  'kitchen-quality': 'Cocina',
}

/**
 * Agentes cuya salida es telemetría de la plataforma, no información del
 * restaurante. No se muestran en la campana bajo ninguna circunstancia.
 */
const SOLO_PLATAFORMA = new Set([
  'hermes',
  'config-validator',
  'smoke-test',
  'uptime-monitor',
  'lab-watchdog',
  'lab-simulator',
])

/**
 * Un resumen que sólo cuenta su propia salida: "1 issues", "5 hallazgos",
 * "3 anomalias detectadas", "0F 1W". No afirma nada comprobable del negocio.
 */
export function esTelemetria(summary: string): boolean {
  const s = (summary || '').trim()
  if (!s) return true
  if (/^\d+F\s+\d+W$/i.test(s)) return true
  if (/no KPI row/i.test(s)) return true
  // "N issues", "N hallazgos", "N oportunidades", "N recomendaciones"…
  if (/^\d+\s+(issues?|hallazgos?|oportunidades?|recomendaciones?|anomal[ií]as?)\b/i.test(s)) return true
  // "18 issues: 0 critical, 12 high"
  if (/^\d+\s+issues?:/i.test(s)) return true
  return false
}

function entero(s: string, re: RegExp): number | null {
  const m = re.exec(s)
  return m ? Number(m[1]) : null
}

export function traducir(aviso: AvisoCrudo): AvisoTraducido | null {
  const id = (aviso.agent_id || '').toLowerCase()
  const s = (aviso.summary || '').trim()

  if (SOLO_PLATAFORMA.has(id)) return null
  if (esTelemetria(s)) return null

  const agente = NOMBRES[id] || 'Tus agentes'
  const grave = aviso.priority === 'critical'

  // ── Inventario en ceros ────────────────────────────────────────────────
  // "ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo"
  if (/sin stock/i.test(s)) {
    const sinStock = entero(s, /(\d+)\s*sin stock/i)
    const criticos = entero(s, /(\d+)\s*cr[ií]tico/i)
    if (sinStock !== null && sinStock > 50 && !criticos) {
      // Un faltante masivo y estable no es un faltante: es captura pendiente.
      return {
        agente,
        texto: `Revísalo: ${sinStock} insumos aparecen en ceros — eso suele ser inventario sin capturar, no faltante real`,
        severidad: 'media',
      }
    }
    if (criticos && criticos > 0) {
      return {
        agente,
        texto: `Pídelo: ${criticos} ${criticos === 1 ? 'insumo está' : 'insumos están'} en crítico y ${sinStock ?? 0} en ceros`,
        severidad: 'alta',
      }
    }
    if (sinStock) {
      return { agente, texto: `Pídelo: te quedaste sin ${sinStock} ${sinStock === 1 ? 'insumo' : 'insumos'}`, severidad: 'media' }
    }
  }

  // ── Platillos que ya no se pueden preparar ─────────────────────────────
  const ochentaiseis = entero(s, /(\d+)\s*platillos?\s*86/i)
  if (ochentaiseis !== null && ochentaiseis > 0) {
    return {
      agente,
      texto: `Ajústalo: ${ochentaiseis} ${ochentaiseis === 1 ? 'platillo no se puede' : 'platillos no se pueden'} preparar — bájalos del menú para que nadie los venda`,
      severidad: 'alta',
    }
  }

  // ── Proyección del cierre ──────────────────────────────────────────────
  // "Proyección: $87,161 (avance 78%)"
  const proy = /Proyecci[óo]n:\s*\$?([\d,]+)/i.exec(s)
  if (proy) {
    return { agente, texto: `Anótalo: el día va rumbo a $${proy[1]}`, severidad: 'info' }
  }

  // ── Riesgo en caja ─────────────────────────────────────────────────────
  const riesgo = entero(s, /RIESGO:\s*(\d+)/i)
  if (riesgo !== null) {
    if (riesgo === 0) return null // "Riesgo 0/100, 0 hallazgos" no es un aviso
    return {
      agente,
      texto: `Cuídalo: la caja del periodo trae señales que vale la pena revisar`,
      severidad: riesgo >= 50 ? 'alta' : 'media',
    }
  }

  // ── Nada que reconozcamos ──────────────────────────────────────────────
  // Si el texto ya está en español y habla de pesos o de porcentajes, se deja
  // pasar tal cual: es mejor un aviso imperfecto que perder uno real. Si no,
  // se calla: preferimos no decir nada antes que decir "0F 1W".
  if (/\$|%|\bventas?\b|\bpropinas?\b|\bmesas?\b|\bclientes?\b/i.test(s)) {
    return { agente, texto: s, severidad: grave ? 'alta' : 'media' }
  }
  return null
}

/** Traduce una tanda y descarta lo que no habla del negocio. */
export function traducirTanda(avisos: AvisoCrudo[]): AvisoTraducido[] {
  return avisos.map(traducir).filter((a): a is AvisoTraducido => a !== null)
}
