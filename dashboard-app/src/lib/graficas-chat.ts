// ── Contrato de dominio · Gráficas del chat IA ──────────────────────────────────
//
// PROBLEMA QUE CIERRA: el prompt le pedía al modelo que ESCRIBIERA el JSON de la
// gráfica con sus datos (`<!--chart {"data":[...]}-->`). Los números de la gráfica
// podían ser inventados aunque el texto fuera correcto.
//
// CONTRATO:
//   1. `construirCatalogo` arma las gráficas SÓLO con datos que la ruta ya leyó
//      (filas diarias POS-primero, órdenes de hoy/semana pasada, franjas, productos,
//      meseros, pagos, horas). Si el dato no existe para el tenant, la gráfica no
//      entra al catálogo. Días sin datos = hueco (null), NUNCA cero. Hoy = parcial.
//   2. El prompt lista los IDs disponibles (`lineasCatalogoParaPrompt`); el modelo
//      sólo escribe `<!--grafica:ID-->` (máx. 2).
//   3. `aplicarGraficas` sustituye los marcadores por el spec completo, descarta IDs
//      desconocidos, y QUITA cualquier bloque `<!--chart` escrito por el modelo
//      (salvo que sus valores coincidan exactamente con una gráfica del servidor, en
//      cuyo caso se usa la del servidor).
//   4. `elegirGraficaPorPregunta` es el auto-inyectado: si el usuario pidió gráfica y
//      el modelo no marcó ninguna, se elige la más adecuada del catálogo.
//
// Funciones puras: sin fetch. El render vive en components/chat/GraficaChat.tsx y el
// formato compartido en lib/grafica-spec.ts.

import { datoTexto, diasEntre, sumarDiasCalendario, ETIQUETAS_NO_MESERO } from '@/lib/chat-context'
import type { DaypartsConfig, FilaFranja } from '@/lib/dayparts'
import { MIN_ORDENES_REPRESENTATIVO } from '@/lib/dayparts'
import {
  bloqueDeSpec, RE_BLOQUE_CHART, RE_MARCADOR, VERSION_SPEC,
  type FilaGrafica, type GraficaSpec, type IdGrafica,
} from '@/lib/grafica-spec'

export const MAX_GRAFICAS_POR_RESPUESTA = 2

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round(n * 100) / 100

function arr(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val !== 'string') return []
  try {
    let p = JSON.parse(val)
    if (typeof p === 'string') p = JSON.parse(p)
    return Array.isArray(p) ? p : []
  } catch { return [] }
}

export type FuenteVentasChat = 'wansoft' | 'fullsite' | 'fullsite+wansoft'

const NOMBRE_FUENTE: Record<FuenteVentasChat, string> = {
  fullsite: 'POS Fullsite',
  wansoft: 'histórico importado',
  'fullsite+wansoft': 'POS Fullsite + histórico importado',
}

export interface EntradaCatalogo {
  /** Día de venta en curso (zona e inicio de día del tenant). */
  hoy: string
  zona: string
  /** HH:MM en que empieza el día de venta. */
  inicioDia: string
  /** Filas diarias (shape wansoft_daily), ya con el merge POS-primero. */
  dias: Record<string, unknown>[]
  fuenteVentas: FuenteVentasChat
  /** false = la lectura de ventas FALLÓ: sin gráficas de ventas. */
  ventasDeterminadas: boolean
  /** Primer día que cubrió la lectura (si se llenó el límite de filas). */
  ventanaDesde?: string
  /** Órdenes cobradas de hoy y del mismo día de la semana pasada. */
  hoyVsSemana?: {
    ordenes: { dia_venta?: unknown; total?: unknown; created_at?: unknown }[]
    semanaPasada: string
    /** instante (ms) equivalente a "ahora" hace 7 días */
    corteSemanaPasada: number
    horaCorte: string
    truncado?: boolean
  } | null
  franjas?: { filas: FilaFranja[]; config: DaypartsConfig; desde: string; hasta: string } | null
  /** Filas de fs_ventas_producto (top del periodo, sin búsqueda). */
  productos?: { filas: Record<string, unknown>[]; desde: string; hasta: string } | null
  /** Filas de wansoft_hourly (snapshots acumulados por hora). */
  horas?: { fecha?: unknown; data?: unknown }[] | null
}

// ── Utilidades de fechas ────────────────────────────────────────────────────

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const dowCorto = (ymd: string) => DIAS_CORTOS[new Date(`${ymd}T12:00:00Z`).getUTCDay()] ?? ''

/** Filas con fecha válida, más reciente primero, una por fecha. */
function filasPorFecha(dias: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>()
  for (const d of dias) {
    const f = typeof d?.fecha === 'string' ? d.fecha.slice(0, 10) : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && !m.has(f)) m.set(f, d)
  }
  return m
}

/** Los últimos 7 días COMPLETOS con datos (sin hoy) — misma ventana que RANKING MESEROS. */
function ultimos7Completos(porFecha: Map<string, Record<string, unknown>>, hoy: string): [string, Record<string, unknown>][] {
  return [...porFecha.entries()].filter(([f]) => f < hoy).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7)
}

const rangoDe = (fechas: string[]) => {
  const o = [...fechas].sort()
  return o.length === 0 ? '' : o[0] === o[o.length - 1] ? o[0] : `${o[0]} a ${o[o.length - 1]}`
}

function base(id: IdGrafica, parcial: Omit<GraficaSpec, 'v' | 'id'>): GraficaSpec {
  return { v: VERSION_SPEC, id, ...parcial }
}

// ── Builders ────────────────────────────────────────────────────────────────

/** Ventas por día, 30 días de calendario. Huecos = null. Hoy = parcial. */
export function graficaVentasDiarias(e: EntradaCatalogo): GraficaSpec | null {
  if (!e.ventasDeterminadas) return null
  const porFecha = filasPorFecha(e.dias)
  if (porFecha.size === 0) return null
  const max = [...porFecha.keys()].sort().pop()!
  // Si el último dato es de hace más de 30 días, la ventana termina en el último dato
  // (el título dice el rango real; no se pinta un mes vacío).
  const fin = diasEntre(max, e.hoy) <= 29 ? e.hoy : max
  const inicio = sumarDiasCalendario(fin, -29)
  const filas: FilaGrafica[] = []
  let huecos = 0
  for (let i = 0; i < 30; i++) {
    const f = sumarDiasCalendario(inicio, i)
    const d = porFecha.get(f)
    const esHoy = f === e.hoy
    if (!d) {
      if (!esHoy) huecos++
      filas.push({ x: f, v: { ventas: null }, ...(esHoy ? { parcial: true, nota: 'en curso · sin datos aún' } : { nota: 'sin datos' }) })
      continue
    }
    filas.push({ x: f, v: { ventas: r2(num(d.ventas_dia)) }, ...(esHoy ? { parcial: true, nota: 'en curso' } : {}) })
  }
  const conDatos = filas.filter(f => f.v.ventas !== null).map(f => f.x)
  if (conDatos.length === 0) return null
  const datosHasta = [...conDatos].sort().pop()!
  return base('ventas_diarias_30d', {
    tipo: 'barra',
    titulo: 'Ventas por día',
    rango: `${inicio} a ${fin}`,
    unidad: 'MXN',
    ejeX: 'fecha',
    series: [{ clave: 'ventas', nombre: 'Ventas', rol: 'principal' }],
    filas,
    fuente: NOMBRE_FUENTE[e.fuenteVentas],
    datosHasta,
    ...(huecos > 0 ? { huecos } : {}),
    ...(diasEntre(datosHasta, e.hoy) > 2 ? { aviso: `Sin ventas registradas después del ${datosHasta}.` } : {}),
  })
}

/** Ventas por mes (≥2 meses). Mes en curso y mes cortado por la ventana = parcial. */
export function graficaVentasPorMes(e: EntradaCatalogo): GraficaSpec | null {
  if (!e.ventasDeterminadas) return null
  const porFecha = filasPorFecha(e.dias)
  const acc = new Map<string, { ventas: number; dias: number; primera: string }>()
  for (const [f, d] of porFecha) {
    const k = f.slice(0, 7)
    const a = acc.get(k) || { ventas: 0, dias: 0, primera: f }
    a.ventas += num(d.ventas_dia); a.dias++
    if (f < a.primera) a.primera = f
    acc.set(k, a)
  }
  if (acc.size < 2) return null
  const meses = [...acc.keys()].sort()
  // Meses intermedios sin datos = hueco, no $0.
  const todos: string[] = []
  for (let k = meses[0]; k <= meses[meses.length - 1];) {
    todos.push(k)
    const [y, m] = k.split('-').map(Number)
    k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  if (todos.length > 36) return null
  const mesHoy = e.hoy.slice(0, 7)
  let huecos = 0
  const filas: FilaGrafica[] = todos.map(k => {
    const a = acc.get(k)
    if (!a) { huecos++; return { x: k, v: { ventas: null }, nota: 'sin datos' } }
    const enCurso = k === mesHoy
    // Primer mes del historial que empieza a medio mes (o cortado por la ventana
    // leída): está incompleto aunque no se sepa por qué — no se compara como completo.
    const desde = e.ventanaDesde && e.ventanaDesde.slice(0, 7) === k && e.ventanaDesde > `${k}-01` ? e.ventanaDesde
      : k === meses[0] && a.primera > `${k}-01` ? a.primera : ''
    const cortado = !!desde
    const nota = `${a.dias} días con datos${enCurso ? ' · en curso' : cortado ? ` · datos desde ${desde}` : ''}`
    return { x: k, v: { ventas: r2(a.ventas) }, nota, ...(enCurso || cortado ? { parcial: true } : {}) }
  })
  const datosHasta = [...porFecha.keys()].sort().pop()!
  return base('ventas_por_mes', {
    tipo: 'barra',
    titulo: 'Ventas por mes',
    rango: `${todos[0]} a ${todos[todos.length - 1]}`,
    unidad: 'MXN',
    ejeX: 'mes',
    series: [{ clave: 'ventas', nombre: 'Ventas', rol: 'principal' }],
    filas,
    fuente: NOMBRE_FUENTE[e.fuenteVentas],
    datosHasta,
    ...(huecos > 0 ? { huecos } : {}),
  })
}

/** Hora local (0–23) de un instante en la zona del tenant, o null. */
function horaLocal(iso: unknown, zona: string): number | null {
  const t = Date.parse(String(iso || ''))
  if (Number.isNaN(t)) return null
  try {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)))
    return Number.isFinite(h) ? h % 24 : null
  } catch { return null }
}

/**
 * Hoy vs el mismo día de la semana pasada, ACUMULADO por hora y cortado a la misma
 * hora (mismas reglas que `compararHoyMismaHora`): dos líneas en UN solo eje.
 */
export function graficaHoyVsSemanaPasada(e: EntradaCatalogo): GraficaSpec | null {
  const hv = e.hoyVsSemana
  if (!hv || !Array.isArray(hv.ordenes)) return null
  const inicioH = Number(e.inicioDia.slice(0, 2)) || 0
  const rel = (h: number) => (h - inicioH + 24) % 24
  const hHoy = new Map<number, number>()
  const hAnt = new Map<number, number>()
  for (const o of hv.ordenes) {
    const h = horaLocal(o.created_at, e.zona)
    if (h === null) continue
    if (o.dia_venta === e.hoy) hHoy.set(rel(h), (hHoy.get(rel(h)) || 0) + num(o.total))
    else if (o.dia_venta === hv.semanaPasada) {
      const t = Date.parse(String(o.created_at || ''))
      if (!Number.isNaN(t) && t <= hv.corteSemanaPasada) hAnt.set(rel(h), (hAnt.get(rel(h)) || 0) + num(o.total))
    }
  }
  if (hHoy.size === 0 && hAnt.size === 0) return null
  const hCorte = Number(hv.horaCorte.slice(0, 2))
  const hasta = Number.isFinite(hCorte) ? rel(hCorte) : Math.max(...hHoy.keys(), ...hAnt.keys())
  const desde = Math.min(...hHoy.keys(), ...hAnt.keys(), hasta)
  const filas: FilaGrafica[] = []
  let aHoy = 0, aAnt = 0
  // Cada punto es el ACUMULADO al cierre de la hora ("10:00" = vendido antes de las
  // 10); el último punto es la hora de corte (ahora).
  for (let r = desde; r <= hasta; r++) {
    aHoy += hHoy.get(r) || 0
    aAnt += hAnt.get(r) || 0
    const x = r === hasta ? hv.horaCorte : `${String((r + inicioH + 1) % 24).padStart(2, '0')}:00`
    if (r === hasta && filas.length > 0 && filas[filas.length - 1].x === x) filas.pop()
    filas.push({ x, v: { hoy: r2(aHoy), semana_pasada: r2(aAnt) }, ...(r === hasta ? { parcial: true, nota: 'ahora (hoy en curso)' } : {}) })
  }
  const dow = dowCorto(e.hoy)
  return base('hoy_vs_semana_pasada', {
    tipo: 'comparacion',
    titulo: `Hoy vs ${dow} pasado, acumulado por hora`,
    rango: `${e.hoy} vs ${hv.semanaPasada}, hasta las ${hv.horaCorte}`,
    unidad: 'MXN',
    ejeX: 'hora',
    series: [
      { clave: 'hoy', nombre: `Hoy (${e.hoy})`, rol: 'principal' },
      { clave: 'semana_pasada', nombre: `${dow} ${hv.semanaPasada}`, rol: 'contexto' },
    ],
    filas,
    fuente: 'POS Fullsite, ventas cobradas',
    datosHasta: `${e.hoy} ${hv.horaCorte}`,
    ...(hv.truncado ? { aviso: 'Se alcanzó el tope de órdenes leídas: las cifras pueden estar incompletas.' } : {}),
  })
}

/** Últimos 7 días completos vs los 7 anteriores, alineados por día (misma ventana que el resumen). */
export function graficaSemanaVsAnterior(e: EntradaCatalogo): GraficaSpec | null {
  if (!e.ventasDeterminadas) return null
  const porFecha = filasPorFecha(e.dias)
  const sDesde = sumarDiasCalendario(e.hoy, -7)
  const pDesde = sumarDiasCalendario(e.hoy, -14)
  if (e.ventanaDesde && pDesde < e.ventanaDesde) return null
  let nS = 0, nP = 0
  const filas: FilaGrafica[] = []
  for (let i = 0; i < 7; i++) {
    const fs = sumarDiasCalendario(sDesde, i)
    const fp = sumarDiasCalendario(pDesde, i)
    const ds = porFecha.get(fs)
    const dp = porFecha.get(fp)
    if (ds) nS++
    if (dp) nP++
    filas.push({ x: fs, v: { reciente: ds ? r2(num(ds.ventas_dia)) : null, anterior: dp ? r2(num(dp.ventas_dia)) : null }, nota: `vs ${dowCorto(fp)} ${fp}` })
  }
  if (nS === 0 || nP === 0) return null
  const sHasta = sumarDiasCalendario(e.hoy, -1)
  const pHasta = sumarDiasCalendario(e.hoy, -8)
  return base('semana_vs_anterior', {
    tipo: 'barra_agrupada',
    titulo: 'Últimos 7 días vs los 7 anteriores',
    rango: `${sDesde} a ${sHasta} vs ${pDesde} a ${pHasta}`,
    unidad: 'MXN',
    ejeX: 'fecha',
    series: [
      { clave: 'reciente', nombre: `${sDesde.slice(5)} a ${sHasta.slice(5)}`, rol: 'principal' },
      { clave: 'anterior', nombre: `${pDesde.slice(5)} a ${pHasta.slice(5)}`, rol: 'contexto' },
    ],
    filas,
    fuente: NOMBRE_FUENTE[e.fuenteVentas],
    datosHasta: sHasta,
    ...(14 - nS - nP > 0 ? { huecos: 14 - nS - nP } : {}),
    ...(nS !== nP ? { aviso: `Cobertura desigual: ${nS} vs ${nP} días con datos.` } : {}),
  })
}

/** Venta por franja (todo el negocio): comida / bebida / otros apilados. */
export function graficaFranjas(e: EntradaCatalogo): GraficaSpec | null {
  const fr = e.franjas
  if (!fr || !Array.isArray(fr.filas) || fr.filas.length === 0) return null
  const orden = [...fr.config.franjas.map(f => f.key), '__fuera__']
  const nombre = (k: string) => datoTexto(fr.config.franjas.find(f => f.key === k)?.nombre ?? 'Fuera de horario', 40)
  const filas: FilaGrafica[] = []
  let ordenes = 0
  let hayOtros = false
  for (const k of orden) {
    const rs = fr.filas.filter(r => r.franja === k)
    if (rs.length === 0) continue
    const venta = rs.reduce((s, r) => s + num(r.venta), 0)
    const comida = rs.reduce((s, r) => s + num(r.venta_comida), 0)
    const bebida = rs.reduce((s, r) => s + num(r.venta_bebida), 0)
    const o = rs.reduce((s, r) => s + num(r.ordenes), 0)
    ordenes += o
    const otros = Math.max(0, venta - comida - bebida)
    if (otros >= 0.5) hayOtros = true
    filas.push({ x: nombre(k), v: { comida: r2(comida), bebida: r2(bebida), otros: r2(otros) }, nota: `${o} órdenes · total ${Math.round(venta).toLocaleString('es-MX')}` })
  }
  if (filas.length === 0 || filas.every(f => !f.v.comida && !f.v.bebida && !f.v.otros)) return null
  const series = [
    { clave: 'comida', nombre: 'Comida', rol: 'principal' as const },
    { clave: 'bebida', nombre: 'Bebida', rol: 'principal' as const },
    ...(hayOtros ? [{ clave: 'otros', nombre: 'Otros', rol: 'principal' as const }] : []),
  ]
  if (!hayOtros) for (const f of filas) delete f.v.otros
  return base('franjas', {
    tipo: 'barra_apilada',
    titulo: 'Venta por horario: comida y bebida',
    rango: fr.desde === fr.hasta ? fr.desde : `${fr.desde} a ${fr.hasta}`,
    unidad: 'MXN',
    ejeX: 'categoria',
    series,
    filas,
    fuente: 'POS Fullsite (hora de apertura de cada orden)',
    datosHasta: fr.hasta,
    ...(ordenes < MIN_ORDENES_REPRESENTATIVO ? { aviso: `Muestra chica (${ordenes} órdenes): los % no representan la operación.` } : {}),
  })
}

const esMesero = (n: string) => !ETIQUETAS_NO_MESERO.some(ex => n.toLowerCase().includes(ex))

/** Top 10 platillos: fs_ventas_producto si existe; si no, platillos_top de los últimos 7 días completos. */
export function graficaTopPlatillos(e: EntradaCatalogo): GraficaSpec | null {
  const p = e.productos
  if (p && Array.isArray(p.filas) && p.filas.length > 0) {
    const top = p.filas
      .map(f => ({ n: datoTexto(f.producto, 60), v: num(f.venta), pz: num(f.piezas) }))
      .filter(f => f.n && f.v > 0)
      .sort((a, b) => b.v - a.v).slice(0, 10)
    if (top.length >= 2) {
      return base('top_platillos', {
        tipo: 'ranking',
        titulo: 'Productos que más venden',
        rango: `${p.desde} a ${p.hasta}`,
        unidad: 'MXN',
        ejeX: 'categoria',
        series: [{ clave: 'venta', nombre: 'Venta', rol: 'principal' }],
        filas: top.map(t => ({ x: t.n, v: { venta: r2(t.v) }, nota: `${Math.round(t.pz).toLocaleString('es-MX')} pzas` })),
        fuente: 'POS Fullsite',
        datosHasta: p.hasta,
      })
    }
  }
  if (!e.ventasDeterminadas) return null
  const dias = ultimos7Completos(filasPorFecha(e.dias), e.hoy)
  const acc = new Map<string, { v: number; pz: number }>()
  for (const [, d] of dias) {
    // En el histórico importado `platillos_top` mezcla meseros y grupos: se excluyen
    // los nombres que ese mismo día aparecen como mesero o como grupo.
    const excluir = new Set([...arr(d.meseros), ...arr(d.ventas_por_grupo)]
      .map(x => datoTexto((x as { nombre?: unknown })?.nombre, 60).toLowerCase()))
    for (const it of arr(d.platillos_top) as { nombre?: unknown; total?: unknown; cantidad?: unknown }[]) {
      const n = datoTexto(it?.nombre, 60)
      if (!n || excluir.has(n.toLowerCase())) continue
      const a = acc.get(n) || { v: 0, pz: 0 }
      a.v += num(it.total); a.pz += num(it.cantidad)
      acc.set(n, a)
    }
  }
  const top = [...acc.entries()].filter(([, a]) => a.v > 0).sort((a, b) => b[1].v - a[1].v).slice(0, 10)
  if (top.length < 2) return null
  const fechas = dias.map(([f]) => f)
  return base('top_platillos', {
    tipo: 'ranking',
    titulo: 'Platillos que más venden',
    rango: rangoDe(fechas),
    unidad: 'MXN',
    ejeX: 'categoria',
    series: [{ clave: 'venta', nombre: 'Venta', rol: 'principal' }],
    filas: top.map(([n, a]) => ({ x: n, v: { venta: r2(a.v) }, ...(a.pz > 0 ? { nota: `${Math.round(a.pz).toLocaleString('es-MX')} pzas` } : {}) })),
    fuente: `${NOMBRE_FUENTE[e.fuenteVentas]} · top diario de platillos`,
    datosHasta: [...fechas].sort().pop()!,
    ...(dias.length < 7 ? { aviso: `Sólo ${dias.length} días con datos.` } : {}),
  })
}

/** Ranking de meseros, últimos 7 días completos con datos (= RANKING MESEROS del prompt). */
export function graficaMeseros(e: EntradaCatalogo): GraficaSpec | null {
  if (!e.ventasDeterminadas) return null
  const dias = ultimos7Completos(filasPorFecha(e.dias), e.hoy)
  const acc = new Map<string, number>()
  for (const [, d] of dias) {
    for (const m of arr(d.meseros) as { nombre?: unknown; total?: unknown }[]) {
      const n = datoTexto(m?.nombre, 40)
      if (!n || !esMesero(n)) continue
      acc.set(n, (acc.get(n) || 0) + num(m.total))
    }
  }
  const top = [...acc.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (top.length < 2) return null
  const fechas = dias.map(([f]) => f)
  return base('meseros', {
    tipo: 'ranking',
    titulo: 'Venta por mesero',
    rango: rangoDe(fechas),
    unidad: 'MXN',
    ejeX: 'categoria',
    series: [{ clave: 'venta', nombre: 'Venta', rol: 'principal' }],
    filas: top.map(([n, v]) => ({ x: n, v: { venta: r2(v) } })),
    fuente: NOMBRE_FUENTE[e.fuenteVentas],
    datosHasta: [...fechas].sort().pop()!,
    ...(acc.size > 10 ? { aviso: `Se muestran los 10 primeros de ${acc.size}.` } : {}),
  })
}

/** Métodos de pago (últimos 7 días completos). Dona si son ≤5; si no, ranking. */
export function graficaMetodosPago(e: EntradaCatalogo): GraficaSpec | null {
  if (!e.ventasDeterminadas) return null
  const dias = ultimos7Completos(filasPorFecha(e.dias), e.hoy)
  const acc = new Map<string, number>()
  for (const [, d] of dias) {
    for (const p of arr(d.pago_metodos ?? d['pago_métodos']) as { nombre?: unknown; total?: unknown }[]) {
      const n = datoTexto(p?.nombre, 40)
      if (!n) continue
      acc.set(n, (acc.get(n) || 0) + num(p.total))
    }
  }
  const partes = [...acc.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (partes.length < 2) return null
  const fechas = dias.map(([f]) => f)
  return base('metodos_pago', {
    tipo: partes.length <= 5 ? 'dona' : 'ranking',
    titulo: 'Cobro por método de pago',
    rango: rangoDe(fechas),
    unidad: 'MXN',
    ejeX: 'categoria',
    series: [{ clave: 'monto', nombre: 'Monto', rol: 'principal' }],
    filas: partes.slice(0, 10).map(([n, v]) => ({ x: n, v: { monto: r2(v) } })),
    fuente: NOMBRE_FUENTE[e.fuenteVentas],
    datosHasta: [...fechas].sort().pop()!,
  })
}

/** Venta por hora del día más reciente con snapshots (diferencia entre acumulados). */
export function graficaVentasPorHora(e: EntradaCatalogo): GraficaSpec | null {
  const filasH = (e.horas || [])
    .map(r => {
      let data: unknown = r.data
      if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = null } }
      return { fecha: String(r.fecha ?? '').slice(0, 10), data: Array.isArray(data) ? data as Record<string, unknown>[] : [] }
    })
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) && r.data.length > 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  const u = filasH[0]
  if (!u) return null
  const snaps = u.data
    .map(h => ({ hora: datoTexto(h.hora, 8), acum: num(h.total ?? h.ventas) }))
    .filter(h => h.hora)
    .sort((a, b) => (parseInt(a.hora, 10) || 0) - (parseInt(b.hora, 10) || 0) || a.hora.localeCompare(b.hora))
  let prev = 0
  const filas: FilaGrafica[] = snaps.map(s => { const v = s.acum - prev; prev = s.acum; return { x: s.hora, v: { ventas: r2(v) } } })
  if (filas.length < 2) return null
  const esHoy = u.fecha === e.hoy
  if (esHoy) { filas[filas.length - 1].parcial = true; filas[filas.length - 1].nota = 'en curso' }
  return base('ventas_por_hora', {
    tipo: 'barra',
    titulo: `Venta por hora · ${dowCorto(u.fecha)} ${u.fecha}`,
    rango: u.fecha,
    unidad: 'MXN',
    ejeX: 'hora',
    series: [{ clave: 'ventas', nombre: 'Ventas', rol: 'principal' }],
    filas,
    fuente: 'histórico importado (snapshots por hora)',
    datosHasta: u.fecha,
  })
}

// ── Catálogo ────────────────────────────────────────────────────────────────

const BUILDERS: [IdGrafica, (e: EntradaCatalogo) => GraficaSpec | null][] = [
  ['ventas_diarias_30d', graficaVentasDiarias],
  ['ventas_por_mes', graficaVentasPorMes],
  ['hoy_vs_semana_pasada', graficaHoyVsSemanaPasada],
  ['semana_vs_anterior', graficaSemanaVsAnterior],
  ['franjas', graficaFranjas],
  ['top_platillos', graficaTopPlatillos],
  ['meseros', graficaMeseros],
  ['metodos_pago', graficaMetodosPago],
  ['ventas_por_hora', graficaVentasPorHora],
]

export type CatalogoGraficas = Map<IdGrafica, GraficaSpec>

/** Sólo las gráficas cuyo dato existe. Un builder que falla no tumba el chat. */
export function construirCatalogo(e: EntradaCatalogo): CatalogoGraficas {
  const cat: CatalogoGraficas = new Map()
  for (const [id, fn] of BUILDERS) {
    try {
      const s = fn(e)
      if (s) cat.set(id, s)
    } catch { /* gráfica opcional */ }
  }
  return cat
}

const DESCRIPCION: Record<IdGrafica, string> = {
  ventas_diarias_30d: 'ventas por día (tendencia, huecos = sin datos)',
  ventas_por_mes: 'ventas por mes',
  hoy_vs_semana_pasada: 'hoy vs el mismo día de la semana pasada, acumulado por hora',
  semana_vs_anterior: 'últimos 7 días vs los 7 anteriores, día por día',
  franjas: 'venta por horario (franjas), comida vs bebida',
  top_platillos: 'ranking de platillos/productos por venta',
  meseros: 'ranking de meseros por venta',
  metodos_pago: 'cobro por método de pago',
  ventas_por_hora: 'venta por hora del día (hora pico)',
}

/** Líneas para el prompt: una por gráfica disponible, con su rango real. */
export function lineasCatalogoParaPrompt(cat: CatalogoGraficas): string {
  if (cat.size === 0) return ''
  return [...cat.values()].map(s => `- ${s.id}: ${DESCRIPCION[s.id]} — ${s.rango}`).join('\n')
}

/**
 * Auto-inyectado: la mejor gráfica del catálogo para la pregunta, o null.
 * El orden importa: lo más específico primero.
 */
export function elegirGraficaPorPregunta(q: string, cat: CatalogoGraficas): IdGrafica | null {
  const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const reglas: [RegExp, IdGrafica][] = [
    [/mesero|quien vend|crack/, 'meseros'],
    [/platillo|producto|mas vendid|que se vende|top/, 'top_platillos'],
    [/metodo|pago|tarjeta|efectivo|transferencia/, 'metodos_pago'],
    [/brunch|lunch|dinner|desayuno|merienda|cena|franja|horario|turno/, 'franjas'],
    [/hora pico|por hora|pico/, 'ventas_por_hora'],
    [/\bhoy\b|como vamos|como van|ahorita/, 'hoy_vs_semana_pasada'],
    [/semana pasada|vs la semana|semana anterior|esta semana|\bsemana\b/, 'semana_vs_anterior'],
    [/\bmes\b|meses|mensual|por mes|\bano\b|anual|historial|\b20\d\d\b/, 'ventas_por_mes'],
  ]
  for (const [re, id] of reglas) if (re.test(n) && cat.has(id)) return id
  if (cat.has('ventas_diarias_30d')) return 'ventas_diarias_30d'
  return cat.keys().next().value ?? null
}

// ── Sustitución de marcadores ───────────────────────────────────────────────

/** Valores en orden de una gráfica de UNA serie (para reconocer un bloque viejo copiado). */
function valoresDe(s: GraficaSpec): number[] | null {
  if (s.series.length !== 1) return null
  const k = s.series[0].clave
  const vals = s.filas.map(f => f.v[k]).filter((v): v is number => v !== null)
  return vals.map(v => Math.round(v))
}

/** Un bloque viejo `{type,data:[{label,value}]}` cuyos valores son EXACTAMENTE los de una gráfica del servidor. */
function specQueCoincide(json: string, cat: CatalogoGraficas): GraficaSpec | null {
  let data: unknown
  try { data = (JSON.parse(json) as { data?: unknown })?.data } catch { return null }
  if (!Array.isArray(data) || data.length < 2) return null
  const vals = data.map(d => (d && typeof d === 'object' ? Number((d as { value?: unknown }).value) : NaN))
  if (vals.some(v => !Number.isFinite(v))) return null
  for (const s of cat.values()) {
    const sv = valoresDe(s)
    if (sv && sv.length === vals.length && sv.every((v, i) => Math.abs(v - Math.round(vals[i])) <= 1)) return s
  }
  return null
}

export interface ResultadoGraficas {
  /** Texto final para el cliente (marcadores → bloques del servidor). */
  texto: string
  /** Mismo texto con marcadores compactos (para logs). */
  textoCompacto: string
  /** IDs que quedaron en la respuesta, en orden. */
  usadas: IdGrafica[]
  /** Bloques `<!--chart` escritos por el modelo que se descartaron. */
  descartadas: number
}

/** Nonce por respuesta: los marcadores internos no se pueden adivinar ni forjar. */
function nonce(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  } catch { /* */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/**
 * Quita TODO comentario HTML del texto del modelo hasta punto fijo: completos,
 * anidados, partidos en líneas, en mayúsculas, y el que queda abierto sin cerrar
 * (se corta desde ahí). Tras esto no queda NINGÚN `<!--` escrito por el modelo, así
 * que ningún bloque `<!--chart` suyo puede sobrevivir ni armarse al borrar otra cosa
 * (p. ej. `<!--<!--grafica:x-->chart {…} chart-->`).
 */
export function quitarComentarios(t: string): { texto: string; quitados: number } {
  let quitados = 0
  let prev: string
  do {
    prev = t
    t = t.replace(/<!--[\s\S]*?-->/g, () => { quitados++; return '' })
    const abierto = t.indexOf('<!--')
    if (abierto >= 0) { t = t.slice(0, abierto); quitados++ }
  } while (t !== prev)
  return { texto: t, quitados }
}

/**
 * Post-proceso de la respuesta del modelo. Garantía: ningún bloque escrito por el
 * modelo llega al cliente.
 *   1. Marcadores `<!--grafica:ID-->` con ID del catálogo, y bloques viejos cuyos
 *      valores coinciden EXACTAMENTE con una gráfica del servidor → marcador interno
 *      `\u0000<nonce>:<n>\u0000` (nonce aleatorio por respuesta; el texto del modelo
 *      pierde todo `\u0000` antes, así que no lo puede escribir).
 *   2. Se quitan TODOS los comentarios restantes hasta punto fijo (`quitarComentarios`).
 *   3. Al final, cada marcador interno sobreviviente se sustituye por el bloque del
 *      servidor: máximo `MAX_GRAFICAS_POR_RESPUESTA`, sin repetir ID.
 *   `sinGraficas` (modo voz): no se reserva nada; sólo se limpia.
 */
export function aplicarGraficas(texto: string, cat: CatalogoGraficas, opts: { sinGraficas?: boolean } = {}): ResultadoGraficas {
  const n = nonce()
  const reservadas: IdGrafica[] = []
  const reservar = (id: IdGrafica) => {
    if (opts.sinGraficas || !cat.has(id)) return ''
    reservadas.push(id)
    return `\u0000${n}:${reservadas.length - 1}\u0000`
  }
  let t = texto.replace(/\u0000/g, '')
  // 1a) Bloques viejos que coinciden con el servidor → reserva. Los demás se quedan
  //     para el paso 2, que los quita.
  t = t.replace(RE_BLOQUE_CHART, (m, json: string) => {
    const s = opts.sinGraficas ? null : specQueCoincide(String(json).trim(), cat)
    if (!s) return m
    return reservar(s.id)
  })
  // 1b) Marcadores → reserva (ID desconocido → nada).
  t = t.replace(RE_MARCADOR, (_m, idRaw: string) => reservar(idRaw.toLowerCase() as IdGrafica))
  // 2) Fuera todo comentario del modelo.
  const limpio = quitarComentarios(t)
  t = limpio.texto
  const descartadas = limpio.quitados

  // 3) Reservas sobrevivientes → bloques del servidor.
  const usadas: IdGrafica[] = []
  const rePh = new RegExp(`\u0000${n}:(\\d+)\u0000`, 'g')
  const partes: { final: string; compacto: string }[] = []
  let ultimo = 0
  for (const m of t.matchAll(rePh)) {
    const antes = t.slice(ultimo, m.index)
    ultimo = (m.index ?? 0) + m[0].length
    const id = reservadas[Number(m[1])]
    const s = id ? cat.get(id) : undefined
    let final = '', compacto = ''
    if (s && !usadas.includes(id) && usadas.length < MAX_GRAFICAS_POR_RESPUESTA) {
      usadas.push(id)
      final = `\n${bloqueDeSpec(s)}\n`
      compacto = `<!--grafica:${id}-->`
    }
    partes.push({ final: antes + final, compacto: antes + compacto })
  }
  const cola = t.slice(ultimo).replace(/\u0000/g, '')
  const final = partes.map(p => p.final).join('') + cola
  const compacto = partes.map(p => p.compacto).join('') + cola
  const limpiar = (s: string) => (s === texto ? s : s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  return { texto: limpiar(final), textoCompacto: limpiar(compacto), usadas, descartadas }
}

/** Agrega al final la gráfica elegida (auto-inyectado). */
export function anexarGrafica(r: ResultadoGraficas, s: GraficaSpec): ResultadoGraficas {
  return {
    ...r,
    texto: `${r.texto}\n\n${bloqueDeSpec(s)}`,
    textoCompacto: `${r.textoCompacto}\n\n<!--grafica:${s.id}-->`,
    usadas: [...r.usadas, s.id],
  }
}

/**
 * Historial que vuelve del cliente: los bloques de gráfica (miles de caracteres de
 * JSON) se compactan a su marcador para no gastar el tope de 2,000 caracteres por
 * mensaje ni enseñarle al modelo a copiar datos. Un bloque viejo (del modelo) se quita.
 */
export function compactarGraficasEnHistorial(history: unknown): unknown {
  if (!Array.isArray(history)) return history
  return history.map(h => {
    if (!h || typeof h !== 'object' || typeof (h as { content?: unknown }).content !== 'string') return h
    const content = (h as { content: string }).content.replace(RE_BLOQUE_CHART, (_m, json: string) => {
      try {
        const id = (JSON.parse(String(json).trim()) as { v?: unknown; id?: unknown })
        if (id?.v === VERSION_SPEC && typeof id.id === 'string' && /^[a-z0-9_]{1,60}$/.test(id.id)) return `<!--grafica:${id.id}-->`
      } catch { /* bloque inválido */ }
      return ''
    })
    return { ...(h as object), content }
  })
}
