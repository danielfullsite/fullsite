import type { WansoftDaily } from '@/lib/types'

/**
 * Detecciones de los agentes, calculadas del historial del propio restaurante.
 *
 * POR QUÉ SE CALCULAN AQUÍ Y NO SE LEEN DE LA BASE
 * -------------------------------------------------
 * `agent_events` y `agent_results` tienen filas de amalay y de boruca, y CERO de
 * coffee-shop. Un panel de agentes que leyera esas tablas no tendría nada que
 * enseñar en Espresso Lab — y de hecho el bloque anterior acabó enseñando las
 * alertas de AMALAY en el dashboard de otro restaurante (P0 corregido aparte).
 *
 * Estas detecciones salen de `recentData`, que el dashboard ya trae: son del
 * restaurante que estás viendo y de nadie más. No hay consulta nueva y no hay
 * forma de que se cruce un tenant con otro, porque el arreglo de entrada ya
 * viene acotado.
 *
 * LAS REGLAS QUE NO SE ROMPEN
 * ---------------------------
 * 1. Ninguna detección se dispara sin muestra. Comparar contra UN día previo no
 *    es comparar contra un promedio, y decirlo así sería mentir con estadística.
 * 2. El impacto en pesos SE CALCULA, no se estima a ojo: es la diferencia real
 *    contra lo esperado. Si no se puede calcular, no hay chip de dinero.
 * 3. Cada detección lleva su evidencia — los números con los que se sostiene—
 *    para que el dueño pueda no creerle al agente y revisar.
 * 4. El verbo va primero y sale de un conjunto cerrado de seis. Si un hallazgo
 *    no cabe en ninguno, es que todavía no está listo para mostrarse.
 */

export type Verbo = 'Arréglalo' | 'Captúralo' | 'Pídelo' | 'Revísalo' | 'Ajústalo' | 'Cuídalo'
export type Severidad = 'alta' | 'media' | 'info'

export interface PuntoEvidencia {
  etiqueta: string
  valor: number
  /** El punto que corresponde al día analizado, para marcarlo en la gráfica. */
  foco?: boolean
}

export interface Deteccion {
  id: string
  /** Nombre del agente en cristiano, no su id técnico. */
  agente: string
  agenteQueHace: string
  verbo: Verbo
  /** El hecho, después del verbo. Sin punto final: la UI arma la oración. */
  linea: string
  /** Texto corto para la notificación emergente. */
  pushTitulo: string
  pushCuerpo: string
  /** Pesos con signo. null = no se puede calcular, y entonces no se inventa. */
  impacto: number | null
  impactoNota?: string
  severidad: Severidad
  queAnalizo: string[]
  evidencia: PuntoEvidencia[]
  evidenciaNota: string
  recomendacion: string
}

/** Menos de esto no es un promedio. */
export const MUESTRA_MINIMA = 2
/** Debajo de este cambio es ruido del día a día, no una señal. */
const UMBRAL_CAMBIO = 0.15

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function fechaISO(d: WansoftDaily): string {
  return String(d.fecha).slice(0, 10)
}

function diaSemana(iso: string): number | null {
  const d = new Date(`${iso}T12:00:00`)
  return isNaN(d.getTime()) ? null : d.getDay()
}

function etiquetaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

/**
 * Los hasta 4 días previos con el mismo día de la semana.
 *
 * `recentData` viene de más viejo a más nuevo, así que `.slice(-4)` son los más
 * RECIENTES. El dashboard tenía este mismo cálculo con `.slice(0, 4)` —los más
 * viejos— bajo un comentario que prometía "last 4 weeks"; se corrigió en
 * page.tsx y aquí se hace igual a propósito, para que "un viernes normal"
 * signifique lo mismo en toda la pantalla.
 */
function mismosDias(datos: WansoftDaily[], objetivo: WansoftDaily): WansoftDaily[] {
  const iso = fechaISO(objetivo)
  const dow = diaSemana(iso)
  if (dow === null) return []
  return datos
    .filter(d => {
      const i = fechaISO(d)
      return i !== iso && diaSemana(i) === dow && (Number(d.ventas_dia) || 0) > 0
    })
    .slice(-4)
}

function promedio(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function dinero(n: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function pct(n: number): string {
  return `${Math.abs(Math.round(n * 100))}%`
}

// ── Las detecciones ────────────────────────────────────────────────────────

/** La venta del día contra sus mismos días. */
function ventaContraSuDia(datos: WansoftDaily[], dia: WansoftDaily): Deteccion | null {
  const pares = mismosDias(datos, dia)
  if (pares.length < MUESTRA_MINIMA) return null

  const esperado = promedio(pares.map(d => Number(d.ventas_dia) || 0))
  const real = Number(dia.ventas_dia) || 0
  if (esperado <= 0) return null

  const cambio = (real - esperado) / esperado
  if (Math.abs(cambio) < UMBRAL_CAMBIO) return null

  const iso = fechaISO(dia)
  const dow = diaSemana(iso)
  const nombreDia = dow !== null ? DIAS[dow].toLowerCase() : 'ese día'
  const cae = cambio < 0

  const evidencia: PuntoEvidencia[] = [
    ...pares.map(d => ({ etiqueta: etiquetaCorta(fechaISO(d)), valor: Number(d.ventas_dia) || 0 })),
    { etiqueta: etiquetaCorta(iso), valor: real, foco: true },
  ]

  return {
    id: `venta-vs-dia-${iso}`,
    agente: 'Ventas fuera de lo normal',
    agenteQueHace: 'Compara cada día contra tus mismos días de las últimas semanas',
    verbo: cae ? 'Revísalo' : 'Captúralo',
    linea: cae
      ? `la venta cerró ${pct(cambio)} abajo de lo que da un ${nombreDia} normal`
      : `la venta cerró ${pct(cambio)} arriba de lo que da un ${nombreDia} normal`,
    pushTitulo: cae ? `Un ${nombreDia} flojo` : `Un ${nombreDia} muy bueno`,
    pushCuerpo: cae
      ? `Cerraste ${dinero(real)}. Un ${nombreDia} normal son ${dinero(esperado)}.`
      : `Cerraste ${dinero(real)}, ${dinero(real - esperado)} arriba de un ${nombreDia} normal. Vale la pena ver qué salió bien.`,
    impacto: Math.round(real - esperado),
    severidad: cae ? (Math.abs(cambio) >= 0.4 ? 'alta' : 'media') : 'info',
    queAnalizo: [
      `El ${etiquetaCorta(iso)}, contra tus ${pares.length} ${nombreDia}s anteriores.`,
      `Un ${nombreDia} normal son ${dinero(esperado)}.`,
      `Ese día fueron ${dinero(real)}: ${cae ? 'faltaron' : 'sobraron'} ${dinero(Math.abs(real - esperado))}.`,
    ],
    evidencia,
    evidenciaNota: `Tus últimos ${nombreDia}s. El de la derecha es el que se analizó.`,
    recomendacion: cae
      ? `Antes de darlo por malo, checa si ese ${nombreDia} hubo algo fuera de lo común: menos gente en piso, mal clima, o el POS a medias. Si no hubo nada de eso, el día sí se cayó solo.`
      : `Mira qué se vendió ese día y a qué hora. Si encuentras el motivo, lo puedes repetir.`,
  }
}

/** El ticket por persona contra sus mismos días. */
function ticketContraSuDia(datos: WansoftDaily[], dia: WansoftDaily): Deteccion | null {
  const pares = mismosDias(datos, dia)
  if (pares.length < MUESTRA_MINIMA) return null

  const tp = (d: WansoftDaily) => {
    const p = Number(d.personas_restaurant) || 0
    return p > 0 ? (Number(d.ventas_dia) || 0) / p : 0
  }
  const esperado = promedio(pares.map(tp).filter(v => v > 0))
  const real = tp(dia)
  if (esperado <= 0 || real <= 0) return null

  const cambio = (real - esperado) / esperado
  if (cambio > -UMBRAL_CAMBIO) return null

  const iso = fechaISO(dia)
  const dow = diaSemana(iso)
  const nombreDia = dow !== null ? DIAS[dow].toLowerCase() : 'ese día'
  const personas = Number(dia.personas_restaurant) || 0

  return {
    id: `ticket-vs-dia-${iso}`,
    agente: 'Ventas fuera de lo normal',
    agenteQueHace: 'Compara cada día contra tus mismos días de las últimas semanas',
    verbo: 'Captúralo',
    linea: `cada cliente gastó ${pct(cambio)} menos que en un ${nombreDia} normal`,
    pushTitulo: 'Bajó el consumo por cliente',
    pushCuerpo: `${dinero(real)} por persona contra ${dinero(esperado)} de un ${nombreDia} normal. Vino la gente, gastó menos.`,
    // Lo que se dejó de vender: la diferencia por persona, por las personas que sí vinieron.
    impacto: Math.round((real - esperado) * personas),
    severidad: 'media',
    queAnalizo: [
      `El ${etiquetaCorta(iso)}, contra tus ${pares.length} ${nombreDia}s anteriores.`,
      `Normal: ${dinero(esperado)} por persona. Ese día: ${dinero(real)}.`,
      `Con ${personas} personas, son ${dinero(Math.abs((real - esperado) * personas))} que no entraron.`,
    ],
    evidencia: [
      ...pares.map(d => ({ etiqueta: etiquetaCorta(fechaISO(d)), valor: Math.round(tp(d)) })),
      { etiqueta: etiquetaCorta(iso), valor: Math.round(real), foco: true },
    ],
    evidenciaNota: 'Consumo por persona en tus últimos días iguales.',
    recomendacion: 'La gente vino igual pero gastó menos: casi siempre es que no se ofreció el acompañamiento. Prueba proponerlo en barra al cobrar.',
  }
}

/** Toda la venta cargada en una sola persona. */
function concentracion(dia: WansoftDaily): Deteccion | null {
  const lista = Array.isArray(dia.meseros) ? dia.meseros : []
  if (lista.length < 2) return null

  const total = Number(dia.ventas_dia) || lista.reduce((s, m) => s + (Number(m.total) || 0), 0)
  if (total <= 0) return null

  const orden = [...lista].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
  const parte = (Number(orden[0].total) || 0) / total
  if (parte < 0.65) return null

  const iso = fechaISO(dia)
  const nombre = String(orden[0].nombre || '').split(' ')[0] || 'una persona'

  return {
    id: `concentracion-${iso}`,
    agente: 'Cómo va tu equipo',
    agenteQueHace: 'Mira cómo se reparte la venta entre quienes atienden',
    verbo: 'Cuídalo',
    linea: `${nombre} cargó ${pct(parte)} de la venta del día`,
    pushTitulo: `Casi todo lo vendió ${nombre}`,
    pushCuerpo: `${pct(parte)} de la venta del día salió de una sola persona. Si falta, se te cae el día.`,
    // No se le pone precio: no hay forma honesta de calcular cuánto cuesta.
    impacto: null,
    severidad: 'info',
    queAnalizo: [
      `El reparto de la venta del ${etiquetaCorta(iso)} entre ${lista.length} personas.`,
      `${nombre}: ${dinero(Number(orden[0].total) || 0)} de ${dinero(total)}.`,
      'Se marca a partir del 65% en una sola persona.',
    ],
    evidencia: orden.slice(0, 5).map((m, i) => ({
      etiqueta: String(m.nombre || '').split(' ')[0],
      valor: Number(m.total) || 0,
      foco: i === 0,
    })),
    evidenciaNota: 'Cuánto vendió cada quien ese día.',
    recomendacion: `No es un problema hoy, es un riesgo para mañana: el día que ${nombre} no venga, nadie más sabe sostener ese ritmo. Vale la pena emparejar turnos.`,
  }
}

/** La propina del día contra su propio historial. */
function propinaBaja(datos: WansoftDaily[], dia: WansoftDaily): Deteccion | null {
  const tasa = (d: WansoftDaily) => {
    const v = Number(d.ventas_dia) || 0
    return v > 0 ? (Number(d.propinas_total) || 0) / v : 0
  }
  const previos = datos.filter(d => fechaISO(d) !== fechaISO(dia) && (Number(d.ventas_dia) || 0) > 0)
  const conPropina = previos.filter(d => tasa(d) > 0)
  if (conPropina.length < 5) return null

  const esperado = promedio(conPropina.map(tasa))
  const real = tasa(dia)
  if (esperado <= 0 || real <= 0) return null

  const cambio = (real - esperado) / esperado
  if (cambio > -0.25) return null

  const iso = fechaISO(dia)
  const ventas = Number(dia.ventas_dia) || 0

  return {
    id: `propina-${iso}`,
    agente: 'Propinas',
    agenteQueHace: 'Compara la propina del día contra lo que deja tu clientela normalmente',
    verbo: 'Revísalo',
    linea: `la propina fue ${pct(real)} de la venta, contra ${pct(esperado)} de siempre`,
    pushTitulo: 'La propina bajó',
    pushCuerpo: `${pct(real)} de la venta contra el ${pct(esperado)} de siempre. Suele ser servicio, no clientes.`,
    impacto: Math.round((real - esperado) * ventas),
    severidad: 'media',
    queAnalizo: [
      `La propina del ${etiquetaCorta(iso)} contra ${conPropina.length} días anteriores con propina.`,
      `Normal: ${pct(esperado)} de la venta. Ese día: ${pct(real)}.`,
      `Sobre ${dinero(ventas)} de venta, son ${dinero(Math.abs((real - esperado) * ventas))} menos de propina.`,
    ],
    evidencia: [
      ...conPropina.slice(-5).map(d => ({
        etiqueta: etiquetaCorta(fechaISO(d)),
        valor: Math.round(Number(d.propinas_total) || 0),
      })),
      { etiqueta: etiquetaCorta(iso), valor: Math.round(Number(dia.propinas_total) || 0), foco: true },
    ],
    evidenciaNota: 'Propina de los últimos días.',
    recomendacion: 'Una caída de propina casi nunca es la clientela: suele ser tiempo de espera o que la cuenta llegó tarde. Pregunta cómo estuvo el servicio ese día.',
  }
}

// ── Entrada pública ────────────────────────────────────────────────────────

/**
 * Todas las detecciones del día indicado, ordenadas por lo que más cuesta.
 *
 * `datos` tiene que venir ya acotado al restaurante activo. Esta función no
 * consulta nada: si le pasas los días de otro tenant, te da las detecciones de
 * ese otro tenant, y eso es responsabilidad de quien la llama.
 */
export function detectar(datos: WansoftDaily[], dia: WansoftDaily | null): Deteccion[] {
  if (!dia || datos.length === 0) return []

  const todas = [
    ventaContraSuDia(datos, dia),
    ticketContraSuDia(datos, dia),
    concentracion(dia),
    propinaBaja(datos, dia),
  ].filter((d): d is Deteccion => d !== null)

  const orden: Record<Severidad, number> = { alta: 0, media: 1, info: 2 }
  return todas.sort((a, b) => {
    const s = orden[a.severidad] - orden[b.severidad]
    if (s !== 0) return s
    // A misma gravedad, primero lo que más dinero mueve.
    return Math.abs(b.impacto ?? 0) - Math.abs(a.impacto ?? 0)
  })
}

/** El saludo, según la hora y cuántas cosas hay. Nunca "0 cosas" ni "1 cosas". */
export function saludo(n: number, ahora: Date = new Date()): string {
  const h = ahora.getHours()
  const momento = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
  if (n === 0) return `${momento} — nada que atender`
  if (n === 1) return `${momento} — 1 cosa para hoy`
  return `${momento} — ${n} cosas para hoy`
}
