'use client'

import { formatCurrency } from '@/lib/format'

/**
 * El día, contado como lo cuenta un restaurantero.
 *
 * Sustituye tres bloques que hoy se pelean por la misma atención:
 *
 *   · 4 tarjetas KPI, cada una con su mini-gráfica roja y DOS porcentajes
 *   · 3 tarjetas sueltas: Propinas / Descuentos / Brutas
 *   · el banner morado del insight
 *
 * Cuatro problemas concretos de esa versión:
 *
 * 1. TODO EN ROJO. Con 5 órdenes en el día salen -67.9%, -71.8% y -69.4% en
 *    rojo, los tres a la vez. Cuando todo está en rojo, nada está en rojo:
 *    el dueño deja de mirar los colores.
 *
 * 2. EL PROMEDIO NO DICE DE CUÁNTOS. "vs prom. Viernes" se calcula con hasta
 *    4 viernes y no hay mínimo de muestra: con UN solo viernes previo la
 *    pantalla igual escribe "prom.". Aquí el tamaño de la muestra va escrito, y
 *    con menos de 2 días no se compara — se dice que no alcanza.
 *    (El bug hermano, que tomaba los cuatro viernes MÁS VIEJOS en vez de los
 *    más recientes, se corrigió en page.tsx junto con este componente.)
 *
 * 3. BRUTAS ES VENTAS OTRA VEZ. ventas_brutas = ventas + descuentos
 *    (data.ts:549). Con $0 de descuento, "VENTAS DEL DÍA $2,070" y
 *    "BRUTAS $2,070" son el mismo número dos veces, en dos tarjetas.
 *    Aquí las tres cifras vuelven a ser lo que son: un desglose que suma.
 *
 * 4. FALTA LO QUE SÍ SE CUADRA. Nadie mostraba cuánto entró de verdad a la
 *    caja. Verificado contra pos_orders: `total` NO incluye la propina
 *    (subtotal + iva − descuento = total), así que entró = neto + propinas.
 */

export interface ResumenDiaProps {
  /** Fecha mostrada, 'YYYY-MM-DD'. */
  fecha: string | null
  /** true si es el último día con datos y no el de hoy. */
  esUltimoCierre: boolean
  periodo: 'dia' | 'semana' | 'mes'

  ventas: number | null
  ordenes: number | null
  personas: number | null
  ticketPersona: number | null
  ticketOrden: number | null

  propinas: number | null
  descuentos: number | null

  /** Base de comparación y CUÁNTOS días/periodos la forman. */
  promedioMismoDia: number | null
  muestraMismoDia: number
  /**
   * 'promedio' = media de varios días iguales (los viernes). Ahí sí exigimos
   * muestra mínima: promediar un solo viernes no es promediar.
   * 'periodo' = el periodo anterior completo (semana pasada, mes pasado). Con
   * n=1 la comparación es legítima: es un periodo contra otro, no una media.
   */
  tipoComparacion: 'promedio' | 'periodo'
  /** 'Viernes', 'la semana anterior', 'el mes anterior'… */
  etiquetaComparacion: string

  /**
   * El desglose de dinero corresponde al widget 'extra_kpis' del panel de
   * personalización. Se respeta su interruptor: el gerente podía apagar esa
   * fila y tiene que poder seguir apagándola.
   */
  mostrarDinero?: boolean

  /** Notas del día que NO repiten nada de lo de arriba. */
  notas?: string[]
}

const MUESTRA_MINIMA = 2

/** Un dato ausente es un guion, nunca un cero. formatCurrency(null) da '$0'. */
function dinero(v: number | null | undefined): string {
  return v == null ? '—' : formatCurrency(v)
}
function entero(v: number | null | undefined): string {
  return v == null ? '—' : new Intl.NumberFormat('es-MX').format(v)
}

function fechaTitulo(iso: string | null, periodo: ResumenDiaProps['periodo']): string {
  if (periodo === 'semana') return 'Esta semana'
  if (periodo === 'mes') return 'Este mes'
  if (!iso) return 'Sin fecha'
  const d = new Date(`${iso}T12:00:00`)
  if (isNaN(d.getTime())) return 'Sin fecha'
  const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function ResumenDia({
  fecha, esUltimoCierre, periodo,
  ventas, ordenes, personas, ticketPersona, ticketOrden,
  propinas, descuentos,
  promedioMismoDia, muestraMismoDia, tipoComparacion, etiquetaComparacion,
  mostrarDinero = true, notas,
}: ResumenDiaProps) {
  const neto = ventas
  const hayDescuentos = descuentos != null && descuentos > 0
  const bruto = ventas != null && descuentos != null ? ventas + descuentos : null
  const entro = ventas != null && propinas != null ? ventas + propinas : null
  const pctPropina = ventas != null && propinas != null && ventas > 0
    ? (propinas / ventas) * 100
    : null

  // La comparación sólo se dibuja si la muestra la sostiene.
  const minimo = tipoComparacion === 'promedio' ? MUESTRA_MINIMA : 1
  const hayComparacion =
    ventas != null && promedioMismoDia != null && promedioMismoDia > 0 && muestraMismoDia >= minimo
  const delta = hayComparacion ? ((ventas! - promedioMismoDia!) / promedioMismoDia!) * 100 : null

  const operacion = [
    { etiqueta: 'Órdenes', valor: entero(ordenes) },
    { etiqueta: 'Personas', valor: entero(personas) },
    { etiqueta: 'Ticket por persona', valor: dinero(ticketPersona) },
    { etiqueta: 'Ticket por orden', valor: dinero(ticketOrden) },
  ]

  return (
    <section className="mb-5 overflow-hidden rounded-[18px] border border-[var(--line)]" style={{ background: 'var(--bento-card)' }}>
      {/* ── El número, una sola vez y en grande ─────────────────────────── */}
      <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="ds-title text-[22px] font-bold tracking-[-0.02em] text-[var(--text-1)] sm:text-[26px]">
            {fechaTitulo(fecha, periodo)}
          </h2>
          {esUltimoCierre && (
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-3)]">
              último día cerrado
            </span>
          )}
        </div>

        <p
          data-testid="resumen-venta"
          className="ds-cifra mt-2 text-[40px] font-bold leading-none tracking-[-0.03em] text-[var(--text-1)] tnum sm:text-[46px]"
        >
          {dinero(ventas)}
        </p>

        {/* Una comparación, en prosa, con el tamaño de la muestra a la vista. */}
        <p className="mt-2.5 text-[13px] leading-[1.5] text-[var(--text-3)]">
          {hayComparacion ? (
            <>
              <span className={delta! < 0 ? 'font-semibold text-[var(--crit-ink)]' : 'font-semibold text-[var(--ok-ink)]'}>
                {delta! > 0 ? '+' : ''}{delta!.toFixed(0)}%
              </span>
              {' '}contra {etiquetaComparacion.toLowerCase()},{' '}
              {tipoComparacion === 'promedio' ? 'que promedia ' : 'que fue de '}
              <span className="tnum text-[var(--text-2)]">{formatCurrency(promedioMismoDia!)}</span>
              {tipoComparacion === 'promedio' && (
                <span className="text-[var(--text-4)]">
                  {' '}· {muestraMismoDia} {muestraMismoDia === 1 ? 'día' : 'días'}
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--text-4)]">
              {tipoComparacion === 'promedio'
                ? `Sin comparación: hacen falta al menos ${MUESTRA_MINIMA} ${etiquetaComparacion.toLowerCase()} anteriores para sacar un promedio.`
                : 'Sin comparación: todavía no hay un periodo anterior con ventas.'}
            </span>
          )}
        </p>
      </div>

      {/* ── La operación ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
        {operacion.map(o => (
          <div key={o.etiqueta} className="px-5 py-3.5 sm:px-6" style={{ background: 'var(--bento-card)' }}>
            <p className="text-[11px] font-medium text-[var(--text-3)]">{o.etiqueta}</p>
            <p className="mt-0.5 text-[19px] font-semibold tracking-[-0.02em] text-[var(--text-1)] tnum">{o.valor}</p>
          </div>
        ))}
      </div>

      {/* ── El dinero, como se cuadra en la caja ────────────────────────── */}
      {mostrarDinero && <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--line)] px-5 py-3.5 sm:px-6" style={{ background: 'var(--surface-2)' }}>
        {/* Los tres primeros renglones sólo aparecen si HUBO descuentos.
            Sin ellos, bruto === neto === la cifra grande de arriba, y el
            desglose imprimiría el mismo número TRES veces — que es una versión
            peor del defecto que este componente vino a quitar. Verificado en
            producción: las 627 órdenes de Espresso Lab tienen descuento $0. */}
        {hayDescuentos && (
          <>
            <Renglon etiqueta="Venta bruta" valor={dinero(bruto)} />
            <Signo>−</Signo>
            <Renglon etiqueta="Descuentos" valor={dinero(descuentos)} tono="crit" />
            <Signo>=</Signo>
          </>
        )}
        <Renglon etiqueta={hayDescuentos ? 'Venta neta' : 'Venta'} valor={dinero(neto)} />
        <Signo>+</Signo>
        <Renglon
          etiqueta="Propinas"
          valor={dinero(propinas)}
          nota={pctPropina != null ? `${pctPropina.toFixed(1)}%` : undefined}
        />
        <Signo>=</Signo>
        <Renglon etiqueta="Entró a caja" valor={dinero(entro)} fuerte />
      </div>}

      {notas && notas.length > 0 && (
        <div className="border-t border-[var(--line)] px-5 py-3 sm:px-6" style={{ background: 'var(--bento-card)' }}>
          {notas.map((n, i) => (
            <p key={i} className="text-[13px] leading-[1.5] text-[var(--text-2)]">{n}</p>
          ))}
        </div>
      )}
    </section>
  )
}

function Signo({ children }: { children: React.ReactNode }) {
  return <span aria-hidden className="text-[13px] text-[var(--text-4)]">{children}</span>
}

function Renglon({
  etiqueta, valor, nota, tono, fuerte,
}: {
  etiqueta: string
  valor: string
  nota?: string
  tono?: 'crit'
  fuerte?: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11.5px] text-[var(--text-3)]">{etiqueta}</span>
      <span
        className={`text-[14px] tnum ${fuerte ? 'font-bold text-[var(--text-1)]' : 'font-semibold'} ${
          tono === 'crit' ? 'text-[var(--crit-ink)]' : fuerte ? '' : 'text-[var(--text-2)]'
        }`}
      >
        {valor}
      </span>
      {nota && <span className="text-[11px] text-[var(--text-4)]">{nota}</span>}
    </span>
  )
}
