'use client'

// Gráfica de una respuesta del chat IA. Recibe un `GraficaSpec` que armó el SERVIDOR
// (lib/graficas-chat.ts) — nunca datos escritos por el modelo. Un spec inválido no
// dibuja nada (el chat nunca truena por una gráfica).
//
// Diseño (skill dataviz): forma por trabajo (columnas para tendencia, ranking
// horizontal, dos líneas en UN eje para comparar, apilada sólo para parte-del-todo,
// dona sólo con ≤5 partes); color por trabajo (serie principal en slot 1, periodo de
// contexto en gris); marcas delgadas (líneas 2px, barras ≤24px con punta redondeada
// de 4px); texto siempre en tokens de texto; leyenda con ≥2 series; etiquetas
// directas selectivas; tooltip en hover/foco; tabla como gemela accesible.
// Colores: tokens --viz-* de globals.css (validados en claro y oscuro).

import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  etiquetaEje, etiquetaLarga, validarSpec, valorCompleto, valorCorto,
  type GraficaSpec, type SerieGrafica,
} from '@/lib/grafica-spec'

const SLOTS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)']
const CONTEXTO = 'var(--viz-ctx)'
const ALTO = 180
const EJE_X = 22
/** Debajo de esto el ranking pone el nombre arriba de la barra (burbuja del chat). */
const ANCHO_RANKING_EN_EJE = 400
/** Debajo de esto la leyenda de la dona va abajo, a todo el ancho. */
const ANCHO_DONA_LADO = 340

/** "Tarjeta de crédito" → "Tarjeta…crédito": conserva lo que distingue (el final). */
export function truncarEnMedio(s: string, max: number): string {
  if (s.length <= max) return s
  const fin = Math.ceil((max - 1) / 2)
  const ini = max - 1 - fin
  return `${s.slice(0, ini).trimEnd()}…${s.slice(s.length - fin).trimStart()}`
}

/** Color por ROL: las principales toman slots en orden fijo; el contexto va en gris. */
function coloresDeSeries(series: SerieGrafica[]): Record<string, string> {
  const out: Record<string, string> = {}
  let slot = 0
  for (const s of series) out[s.clave] = s.rol === 'contexto' ? CONTEXTO : SLOTS[slot++ % SLOTS.length]
  return out
}

/** Ancho real del contenedor (widget de 420px, móvil a pantalla completa). */
function useAncho(ref: React.RefObject<HTMLDivElement | null>, inicial = 300) {
  const [ancho, setAncho] = useState(inicial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => { const w = Math.floor(el.getBoundingClientRect().width); if (w > 0) setAncho(w) }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return ancho
}

type Dato = { x: string; parcial?: boolean; nota?: string } & Record<string, unknown>

function aDatos(s: GraficaSpec): Dato[] {
  return s.filas.map(f => ({ x: f.x, parcial: !!f.parcial, nota: f.nota, ...f.v }))
}

/** Resumen para lectores de pantalla (aria-label). */
export function resumenAccesible(s: GraficaSpec): string {
  const u = (n: number | null) => valorCompleto(n, s.unidad)
  const lbl = (x: string) => etiquetaLarga(x, s.ejeX)
  const partes = [`Gráfica: ${s.titulo}, ${s.rango}.`]
  if (s.tipo === 'comparacion' || s.tipo === 'barra_agrupada') {
    const ult = [...s.filas].reverse().find(f => s.series.every(se => f.v[se.clave] !== null))
    if (ult) partes.push(s.series.map(se => `${se.nombre}: ${u(ult.v[se.clave])}`).join('; ') + ` (${lbl(ult.x)}).`)
  } else if (s.tipo === 'ranking' || s.tipo === 'dona') {
    const k = s.series[0].clave
    const top = s.filas.slice(0, 3).map(f => `${f.x} ${u(f.v[k])}`).join('; ')
    partes.push(`${s.filas.length} elementos. Primeros: ${top}.`)
  } else if (s.tipo === 'barra_apilada') {
    partes.push(s.filas.map(f => `${f.x}: ${s.series.map(se => `${se.nombre} ${u(f.v[se.clave])}`).join(', ')}`).join('; ') + '.')
  } else {
    const k = s.series[0].clave
    const con = s.filas.filter(f => f.v[k] !== null)
    const max = con.reduce((a, b) => ((b.v[k] as number) > (a.v[k] as number) ? b : a), con[0])
    const ult = con[con.length - 1]
    if (max) partes.push(`Máximo ${u(max.v[k])} (${lbl(max.x)}).`)
    if (ult) partes.push(`Último ${u(ult.v[k])} (${lbl(ult.x)}${ult.parcial ? ', en curso' : ''}).`)
  }
  if (s.huecos) partes.push(`${s.huecos} sin datos.`)
  partes.push(`Fuente: ${s.fuente}; datos hasta ${s.datosHasta}.`)
  return partes.join(' ')
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

interface EntradaTooltip { dataKey?: unknown; value?: unknown; payload?: Dato }

function ContenidoTooltip({ active, payload, spec, colores }: {
  active?: boolean; payload?: EntradaTooltip[]; spec: GraficaSpec; colores: Record<string, string>
}) {
  if (!active || !payload || payload.length === 0) return null
  const dato = payload[0]?.payload
  if (!dato) return null
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 shadow-lg text-[11px] leading-snug min-w-[140px]">
      <p className="text-[var(--text-3)] mb-1">{etiquetaLarga(dato.x, spec.ejeX)}</p>
      {spec.series.map(se => {
        const v = dato[se.clave]
        return (
          <div key={se.clave} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-[2px] rounded-full" style={{ background: colores[se.clave] }} />
            <span className="font-semibold text-[var(--text-1)] tabular-nums">{valorCompleto(typeof v === 'number' ? v : null, spec.unidad)}</span>
            {spec.series.length > 1 && <span className="text-[var(--text-3)] truncate">{se.nombre}</span>}
          </div>
        )
      })}
      {dato.nota && <p className="text-[var(--text-3)] mt-1">{dato.nota}</p>}
    </div>
  )
}

// ── Leyenda ─────────────────────────────────────────────────────────────────

function Leyenda({ spec, colores, forma }: { spec: GraficaSpec; colores: Record<string, string>; forma: 'barra' | 'linea' }) {
  if (spec.series.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-2)] mb-1" aria-label="Leyenda">
      {spec.series.map(se => (
        <li key={se.clave} className="flex items-center gap-1.5">
          <span aria-hidden className={forma === 'linea' ? 'inline-block w-3 h-[2px] rounded-full' : 'inline-block w-2.5 h-2.5 rounded-[3px]'} style={{ background: colores[se.clave] }} />
          {se.nombre}
        </li>
      ))}
    </ul>
  )
}

// ── Tabla gemela ────────────────────────────────────────────────────────────

function TablaDatos({ spec, id }: { spec: GraficaSpec; id: string }) {
  return (
    <div id={id} className="mt-2 max-h-56 overflow-auto rounded-lg border border-[var(--line)]">
      <table className="w-full text-[11px]">
        <caption className="sr-only">{`${spec.titulo}, ${spec.rango}`}</caption>
        <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-3)]">
          <tr>
            <th scope="col" className="text-left font-medium px-2 py-1">{spec.ejeX === 'fecha' ? 'Fecha' : spec.ejeX === 'mes' ? 'Mes' : spec.ejeX === 'hora' ? 'Hora' : 'Concepto'}</th>
            {spec.series.map(se => <th key={se.clave} scope="col" className="text-right font-medium px-2 py-1">{se.nombre}</th>)}
            <th scope="col" className="text-left font-medium px-2 py-1">Nota</th>
          </tr>
        </thead>
        <tbody className="text-[var(--text-2)]">
          {spec.filas.map(f => (
            <tr key={f.x} className="border-t border-[var(--line)]">
              <th scope="row" className="text-left font-normal px-2 py-1 whitespace-nowrap">{f.x}</th>
              {spec.series.map(se => (
                <td key={se.clave} className="text-right px-2 py-1 tabular-nums whitespace-nowrap">{valorCompleto(f.v[se.clave], spec.unidad)}</td>
              ))}
              <td className="px-2 py-1 text-[var(--text-3)]">{[f.parcial ? 'parcial' : '', f.nota || ''].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Etiquetas directas (selectivas) ─────────────────────────────────────────

interface PropsEtiqueta { x?: unknown; y?: unknown; width?: unknown; height?: unknown; index?: unknown; value?: unknown }
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

// ── Etiquetas directas de columnas (máximo + "en curso") ──────────────────────

interface PropsForma { x?: unknown; y?: unknown; width?: unknown; height?: unknown; payload?: Dato }

const ANCHO_EJE_Y = 46
const ANCHO_CARACTER = 5.2

/**
 * Qué etiquetas directas van en una gráfica de columnas, sin que choquen:
 *   - "en curso" va en la fila de arriba sobre la barra parcial (con una guía fina),
 *     porque la barra parcial suele ser más baja que sus vecinas;
 *   - el máximo (sólo entre periodos COMPLETOS) va sobre su barra, salvo que choque
 *     con "en curso" — entonces lo cargan el eje, el tooltip y la tabla.
 */
export function etiquetasColumnas(spec: GraficaSpec, ancho: number, margen: { left: number; right: number }) {
  const k = spec.series[0].clave
  const filas = spec.filas
  const nF = filas.length
  const izq = margen.left + ANCHO_EJE_Y
  const banda = (ancho - margen.right - izq) / Math.max(1, nF)
  const centro = (i: number) => izq + banda * (i + 0.5)
  // La etiqueta va en el ÚLTIMO parcial (hoy / mes en curso). Un primer mes
  // incompleto también es tenue, pero no está "en curso".
  let iParcial = -1
  filas.forEach((f, i) => { if (f.parcial && f.v[k] !== null) iParcial = i })
  const textoParcial = iParcial >= 0 && !/en curso/.test(filas[iParcial].nota || '') && filas[iParcial].nota ? 'parcial' : 'en curso'
  let iMax = -1
  filas.forEach((f, i) => {
    if (f.parcial || f.v[k] === null) return
    if (iMax < 0 || (f.v[k] as number) > (filas[iMax].v[k] as number)) iMax = i
  })
  let mostrarMax = iMax >= 0
  if (mostrarMax && iParcial >= 0) {
    const txtMax = valorCorto(filas[iMax].v[k] as number, spec.unidad).length * ANCHO_CARACTER
    const cp = centro(iParcial)
    const finP = cp + 24 > ancho - 2 ? cp + banda / 2 : cp + 24
    const iniP = finP - textoParcial.length * ANCHO_CARACTER
    const cm = centro(iMax)
    if (cm + txtMax / 2 + 2 > iniP && cm - txtMax / 2 - 2 < finP) mostrarMax = false
  }
  return { maxX: iMax >= 0 ? filas[iMax].x : null, mostrarMax, parcialX: iParcial >= 0 ? filas[iParcial].x : null, textoParcial }
}

// ── Componente ──────────────────────────────────────────────────────────────

function GraficaChat({ spec: raw }: { spec: unknown }) {
  const spec = useMemo(() => validarSpec(raw), [raw])
  const ref = useRef<HTMLDivElement>(null)
  const ancho = useAncho(ref)
  const [verTabla, setVerTabla] = useState(false)
  const idTabla = useId()
  if (!spec) return null

  const colores = coloresDeSeries(spec.series)
  const datos = aDatos(spec)
  const conAnio = spec.ejeX === 'mes' && new Set(spec.filas.map(f => f.x.slice(0, 4))).size > 1
  const tickX = (x: string) => etiquetaEje(String(x), spec.ejeX, conAnio)
  const tickY = (v: number) => valorCorto(Number(v), spec.unidad)
  const tooltip = <Tooltip content={<ContenidoTooltip spec={spec} colores={colores} />} cursor={spec.tipo === 'comparacion' || spec.tipo === 'linea' || spec.tipo === 'area' ? { stroke: 'var(--text-4)', strokeWidth: 1 } : undefined} isAnimationActive={false} />
  const grid = <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
  const ejeX = <XAxis dataKey="x" tickFormatter={tickX} tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={14} height={EJE_X} />
  const ejeY = <YAxis tickFormatter={tickY} tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} width={46} />
  const margen = { top: 16, right: 8, bottom: 0, left: 0 }
  const k0 = spec.series[0].clave
  let grafica: ReactNode = null
  let forma: 'barra' | 'linea' = 'barra'

  if (spec.tipo === 'barra') {
    const { maxX, mostrarMax, parcialX, textoParcial } = etiquetasColumnas(spec, ancho, margen)
    // La forma recibe el PAYLOAD de su propio punto: las etiquetas siguen a su barra
    // aunque haya huecos (LabelList numera sólo las barras dibujadas).
    const forma = (p: PropsForma) => {
      const d = p.payload
      const x = n(p.x), y = n(p.y), w = n(p.width), h = n(p.height)
      if (!d || w <= 0 || h <= 0) return <g />
      const r = Math.min(4, w / 2, h)
      const cuerpo = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
      const cx = x + w / 2
      const yFila = margen.top - 4
      return (
        <g className="grafica-columna">
          <path d={cuerpo} fill={colores[k0]} fillOpacity={d.parcial ? 0.4 : 1} />
          {d.x === parcialX && (
            <>
              <line x1={cx} x2={cx} y1={yFila + 3} y2={y - 2} stroke="var(--text-4)" strokeWidth={1} />
              <text x={cx + 20 > ancho - 2 ? x + w : cx} y={yFila} textAnchor={cx + 20 > ancho - 2 ? 'end' : 'middle'} fontSize={10} fill="var(--text-2)">{textoParcial}</text>
            </>
          )}
          {mostrarMax && d.x === maxX && (
            <text x={cx} y={y - 4} textAnchor="middle" fontSize={10} fill="var(--text-2)">{valorCorto(n(d[k0]), spec.unidad)}</text>
          )}
        </g>
      )
    }
    grafica = (
      <BarChart width={ancho} height={ALTO + EJE_X} data={datos} margin={margen} barCategoryGap={datos.length > 20 ? 1 : '18%'}>
        {grid}{ejeX}{ejeY}{tooltip}
        <Bar dataKey={k0} name={spec.series[0].nombre} fill={colores[k0]} maxBarSize={24} isAnimationActive={false} shape={forma} />
      </BarChart>
    )
  } else if (spec.tipo === 'barra_agrupada') {
    grafica = (
      <BarChart width={ancho} height={ALTO + EJE_X} data={datos} margin={margen} barGap={2} barCategoryGap="22%">
        {grid}{ejeX}{ejeY}{tooltip}
        {spec.series.map(se => (
          <Bar key={se.clave} dataKey={se.clave} name={se.nombre} fill={colores[se.clave]} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        ))}
      </BarChart>
    )
  } else if (spec.tipo === 'barra_apilada') {
    const ultima = spec.series[spec.series.length - 1].clave
    grafica = (
      <BarChart width={ancho} height={ALTO + EJE_X} data={datos} margin={margen} barCategoryGap="28%">
        {grid}
        <XAxis dataKey="x" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval={0} height={EJE_X} />
        {ejeY}{tooltip}
        {spec.series.map(se => (
          // Separación de 2px en color de superficie entre segmentos (no un borde).
          <Bar key={se.clave} dataKey={se.clave} name={se.nombre} stackId="a" fill={colores[se.clave]} stroke="var(--surface)" strokeWidth={2}
            radius={se.clave === ultima ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        ))}
      </BarChart>
    )
  } else if (spec.tipo === 'ranking' && ancho < ANCHO_RANKING_EN_EJE) {
    // Burbuja del chat (~250–330px): el nombre va ARRIBA de su barra a todo el ancho;
    // en un eje lateral quedaba "Hector Enrique …" irreconocible.
    const max = Math.max(...datos.map(d => n(d[k0])), 1)
    grafica = (
      <ol className="space-y-1.5 py-0.5" data-ranking="apilado">
        {datos.map(d => {
          const v = n(d[k0])
          return (
            <li key={d.x} className="grafica-fila" title={`${d.x}: ${valorCompleto(v, spec.unidad)}${d.nota ? ` · ${d.nota}` : ''}`}>
              <p className="text-[11px] leading-tight text-[var(--text-2)] break-words">{d.x}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex-1 min-w-0">
                  <div className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: colores[k0] }} />
                </div>
                <span className="w-12 shrink-0 text-right text-[10.5px] text-[var(--text-2)] tabular-nums">{valorCorto(v, spec.unidad)}</span>
              </div>
            </li>
          )
        })}
      </ol>
    )
  } else if (spec.tipo === 'ranking') {
    const anchoEtiqueta = Math.min(Math.round(ancho * 0.38), 160)
    const maxChars = Math.max(8, Math.floor(anchoEtiqueta / 6))
    const alto = datos.length * 26 + 8
    grafica = (
      <BarChart width={ancho} height={alto} data={datos} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="x" width={anchoEtiqueta} tickLine={false} axisLine={false} interval={0}
          tick={{ fontSize: 10, fill: 'var(--text-2)' }}
          tickFormatter={(x: string) => truncarEnMedio(String(x), maxChars)} />
        {tooltip}
        <Bar dataKey={k0} name={spec.series[0].nombre} fill={colores[k0]} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
          <LabelList dataKey={k0} position="right" formatter={(v: unknown) => valorCorto(n(v), spec.unidad)} style={{ fontSize: 10, fill: 'var(--text-2)' }} />
        </Bar>
      </BarChart>
    )
  } else if (spec.tipo === 'comparacion' || spec.tipo === 'linea') {
    forma = 'linea'
    const principal = spec.series.find(s => s.rol !== 'contexto') ?? spec.series[0]
    const iUlt = datos.length - 1
    grafica = (
      <LineChart width={ancho} height={ALTO + EJE_X} data={datos} margin={{ ...margen, right: 14 }}>
        {grid}{ejeX}{ejeY}{tooltip}
        {/* El contexto se dibuja primero: la serie principal queda encima. */}
        {[...spec.series].sort((a, b) => (a.rol === 'contexto' ? -1 : b.rol === 'contexto' ? 1 : 0)).map(se => (
          <Line key={se.clave} type="monotone" dataKey={se.clave} name={se.nombre} stroke={colores[se.clave]} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" connectNulls={false} isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number }) => (p.index === iUlt && typeof p.cy === 'number' && Number.isFinite(p.cy)
              ? <circle key={`d-${se.clave}`} cx={p.cx} cy={p.cy} r={4} fill={colores[se.clave]} stroke="var(--surface)" strokeWidth={2} />
              : <g key={`n-${se.clave}-${p.index}`} />)}
            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}>
            {se.clave === principal.clave && (
              <LabelList dataKey={se.clave} content={(p: PropsEtiqueta) => (n(p.index) === iUlt && p.value !== null && p.value !== undefined
                ? <text x={n(p.x) - 6} y={n(p.y) - 9} textAnchor="end" fontSize={10} fontWeight={600} fill="var(--text-1)">{valorCorto(n(p.value), spec.unidad)}</text>
                : null)} />
            )}
          </Line>
        ))}
      </LineChart>
    )
  } else if (spec.tipo === 'area') {
    forma = 'linea'
    grafica = (
      <AreaChart width={ancho} height={ALTO + EJE_X} data={datos} margin={margen}>
        {grid}{ejeX}{ejeY}{tooltip}
        <Area type="monotone" dataKey={k0} name={spec.series[0].nombre} stroke={colores[k0]} strokeWidth={2} fill={colores[k0]} fillOpacity={0.1}
          connectNulls={false} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    )
  } else if (spec.tipo === 'dona') {
    const total = datos.reduce((s, d) => s + n(d[k0]), 0)
    // Angosto: la leyenda va DEBAJO a todo el ancho ("Tarjeta de crédito" y "Tarjeta
    // de débito" se distinguen completas); ancho: a un lado.
    const apilada = ancho < ANCHO_DONA_LADO
    const lado = apilada ? Math.min(140, Math.round(ancho * 0.5)) : Math.min(150, Math.max(110, Math.round(ancho * 0.42)))
    grafica = (
      <div className={apilada ? 'flex flex-col items-center gap-2' : 'flex items-center gap-3'} data-leyenda={apilada ? 'abajo' : 'lado'}>
        <PieChart width={lado} height={lado}>
          <Pie data={datos} dataKey={k0} nameKey="x" innerRadius={lado * 0.3} outerRadius={lado * 0.47} startAngle={90} endAngle={-270}
            stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
            {datos.map((d, i) => <Cell key={d.x} fill={SLOTS[i % SLOTS.length]} />)}
          </Pie>
          {tooltip}
        </PieChart>
        {/* Leyenda con valor y %: identidad por la muestra de color, nunca por el texto. */}
        <ul className={`${apilada ? 'w-full' : 'flex-1 min-w-0'} space-y-1 text-[11px]`} aria-label="Leyenda">
          {datos.map((d, i) => (
            <li key={d.x} className="flex items-center gap-1.5 min-w-0" title={`${d.x}: ${valorCompleto(n(d[k0]), spec.unidad)}`}>
              <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: SLOTS[i % SLOTS.length] }} />
              <span className={`text-[var(--text-2)] ${apilada ? 'break-words' : 'truncate'}`}>{apilada ? d.x : truncarEnMedio(d.x, 18)}</span>
              <span className="ml-auto pl-2 text-[var(--text-1)] font-medium tabular-nums">{total > 0 ? `${Math.round((n(d[k0]) / total) * 100)}%` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const hayParcial = spec.filas.some(f => f.parcial) && (spec.tipo === 'barra')
  return (
    <figure className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2.5" data-grafica={spec.id} data-tipo={spec.tipo}>
      <figcaption className="mb-1.5">
        <p className="text-[12px] font-semibold text-[var(--text-1)] leading-tight">{spec.titulo}</p>
        <p className="text-[10.5px] text-[var(--text-3)]">{spec.rango}</p>
      </figcaption>
      <Leyenda spec={spec} colores={colores} forma={forma} />
      <div ref={ref} role="img" aria-label={resumenAccesible(spec)} className="w-full overflow-hidden">
        {grafica}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p className="text-[10px] text-[var(--text-3)] leading-snug">
          {`Fuente: ${spec.fuente} · datos hasta ${spec.datosHasta}`}
          {spec.huecos ? ` · ${spec.huecos} sin datos (hueco, no cero)` : ''}
          {hayParcial ? ` · barra tenue = ${spec.filas.filter(f => f.parcial).length > 1 ? 'periodo en curso o incompleto' : 'en curso'}` : ''}
          {spec.aviso ? <><br />{spec.aviso}</> : null}
        </p>
        <button type="button" onClick={() => setVerTabla(v => !v)} aria-expanded={verTabla} aria-controls={idTabla}
          className="shrink-0 text-[10.5px] font-medium text-[var(--accent-ink)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded">
          {verTabla ? 'Ocultar tabla' : 'Ver tabla'}
        </button>
      </div>
      {verTabla && <TablaDatos spec={spec} id={idTabla} />}
    </figure>
  )
}

/** Memo: con el mismo objeto spec (cache de `separarGraficas`) no se re-dibuja. */
export default memo(GraficaChat)
