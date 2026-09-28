/**
 * Conocimiento nativo del Chat IA: TODO sale de las tablas propias de Fullsite
 * (pos_orders, recetas, insumos, proveedores) vía funciones SQL fs_* — no de Wansoft.
 *
 * Cada función devuelve un bloque de texto YA CALCULADO para el prompt (la IA no suma
 * ni convierte unidades) o '' si no aplica / no hay datos. Nunca lanza: si la base
 * falla, el chat sigue funcionando con lo demás.
 */

import { datoTexto, diasEntre, sumarDiasCalendario } from '@/lib/chat-context'
import { hoyEnZona } from '@/lib/date-mx'
import { contextoDia } from '@/lib/agents/dia-negocio'

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<Record<string, unknown>[] | null>

export function crearRpc(sbUrl: string, sbKey: string): Rpc {
  return async (fn, args) => {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        cache: 'no-store',
      })
      return res.ok ? ((await res.json()) as Record<string, unknown>[]) : null
    } catch {
      return null
    }
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const mxn = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-MX')}`
/** Costos unitarios chicos (por gramo) necesitan decimales: $0.024 no es $0. */
const pesos2 = (n: unknown) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const precio = (n: unknown) => { const v = Number(n) || 0; return v >= 10 ? mxn(v) : `$${v.toFixed(v < 1 ? 3 : 2)}` }

/** Palabras que no nombran un producto/insumo. */
const STOP = new Set([
  'cuantas', 'cuantos', 'cuanta', 'cuanto', 'vendido', 'vendidas', 'vendidos', 'vendieron', 'vendimos', 'vende', 'vendo',
  'venta', 'ventas', 'tienes', 'tiene', 'tengo', 'sobre', 'desde', 'hasta', 'para', 'este', 'esta', 'estos', 'estas',
  'donde', 'como', 'producto', 'productos', 'piezas', 'unidades', 'restaurante', 'market', 'semana', 'inventario',
  'precio', 'precios', 'cuesta', 'costo', 'costos', 'receta', 'recetas', 'lleva', 'llevan', 'gramos', 'gramo', 'kilo',
  'kilos', 'ingrediente', 'ingredientes', 'insumo', 'insumos', 'proveedor', 'proveedores', 'quien', 'surte', 'compra',
  'compramos', 'hacer', 'platillo', 'orden', 'ordenes', 'cada', 'cual', 'cuales', 'dame', 'dime', 'quiero', 'saber',
  'mes', 'hoy', 'ayer', 'año', 'ano', 'meses', 'dias', 'historial', 'subio', 'subido', 'cambio', 'cambiado',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  'usamos', 'usa', 'que', 'del', 'las', 'los', 'una', 'uno', 'por', 'han', 'van', 'hay', 'son', 'fue', 'con', 'sin',
  'mas', 'muy', 'ser', 'era', 'algo', 'todo', 'toda', 'todos', 'nos', 'les', 'mis', 'tus', 'sus', 'orden', 'va',
])

/** Lo que el usuario está buscando: palabras significativas (3+ letras). */
export function terminosBusqueda(mensaje: string): string[] {
  return norm(mensaje).split(/[^a-z0-9ñ]+/).filter(t => t.length >= 3 && !STOP.has(t))
}

export const intencion = (q: string) => {
  const n = norm(q)
  return {
    producto: /(vend|cuant|pieza|unidad|market|precio|historial de precio|subi[oó] el precio)/.test(n),
    receta: /(receta|lleva|gramo|ingrediente|cuanto cuesta hacer|costo de hacer|porcion|ficha tecnica)/.test(n),
    insumo: /(proveedor|surte|insumo|por kilo|el kilo|costo del|costo de la|precio del kilo|quien vende|quien nos vende|a quien le compr)/.test(n),
  }
}

/**
 * Busca con la frase completa; si no pega, reintenta palabra por palabra (de la más
 * larga a la más corta, máx. 3) — "smarty chips jicama" encuentra "SMARTY JICAMA".
 */
async function buscar(rpc: Rpc, fn: string, base: Record<string, unknown>, terms: string[]) {
  const filas = await rpc(fn, { ...base, p_busqueda: terms.join(' ') })
  if (filas && filas.length === 0 && terms.length > 1) {
    for (const t of [...terms].sort((a, b) => b.length - a.length).slice(0, 3)) {
      const r = await rpc(fn, { ...base, p_busqueda: t })
      if (r && r.length > 0) return r
    }
  }
  return filas
}

/** Lo que dice fs_frescura, ya normalizado. `null` = no se pudo leer. */
export interface Frescura {
  /** Instante de la última venta (ISO) o null si el POS nunca registró una. */
  ultima: string | null
  /** DÍA DE VENTA (YYYY-MM-DD, zona e inicio de día del tenant) de la última venta, o null. */
  ultimaFecha: string | null
  ordenesHoy: number
  ventaHoy: number
}

/**
 * @param inicioDia hora de inicio del día de venta del tenant ('05:00'): una venta a
 *   las 00:30 pertenece al día de venta ANTERIOR, igual que `pos_orders.dia_venta`.
 */
export async function leerFrescura(rpc: Rpc, clientId: string, tz: string, inicioDia?: string): Promise<Frescura | null> {
  const filas = await rpc('fs_frescura', { p_client_id: clientId, p_tz: tz })
  if (!filas) return null
  const r = filas[0] || {}
  const ultima = r.ultima_orden_pos ? String(r.ultima_orden_pos) : null
  const t = ultima ? new Date(ultima) : null
  return {
    ultima,
    ultimaFecha: t && !isNaN(t.getTime()) ? contextoDia(t.getTime(), tz, inicioDia).hoy : null,
    ordenesHoy: Number(r.ordenes_pos_hoy) || 0,
    ventaHoy: Number(r.venta_pos_hoy) || 0,
  }
}

/**
 * Cobertura del POS, en palabras. Tres casos que NO son lo mismo:
 *   - hay ventas hoy                     → "hoy van N órdenes por $X"
 *   - no hay ventas hoy, pero ayer sí    → "aún no hay ventas registradas hoy"
 *   - la última venta tiene días / nunca → "SIN COBERTURA DEL POS desde <fecha>"
 * En ningún caso se le dice al modelo "$0" ni "no se vendió": el POS puede no estar
 * en uso (el restaurante cobra en otro sistema) y eso no es vender cero.
 */
export function textoFrescura(f: Frescura | null, tz: string, hoy: string): string {
  if (!f) {
    // Acotado: sólo se desconoce la FRESCURA. Los bloques calculados (hoy vs semana
    // pasada, resúmenes, datos diarios) siguen siendo válidos con sus fechas.
    return '\nFRESCURA DEL POS: no pude verificarla en este momento. No afirmes cuándo fue la última venta registrada; '
      + 'para cifras de hoy usa SÓLO los bloques calculados de abajo (con sus fechas), si los hay.\n'
  }
  if (!f.ultima || !f.ultimaFecha) {
    return '\nFRESCURA DEL POS DE FULLSITE: SIN COBERTURA — el POS no tiene ninguna venta registrada. '
      + 'Si preguntan por ventas de hoy o recientes, di que el POS no tiene ventas registradas (NO digas $0 ni "no se vendió"). '
      + 'Si abajo hay historial importado, úsalo diciendo sus fechas reales.\n'
  }
  const ult = new Date(f.ultima).toLocaleString('es-MX', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })
  if (f.ordenesHoy > 0) {
    return `\nFRESCURA DE DATOS (POS de Fullsite): última venta registrada ${ult}. Hoy van ${f.ordenesHoy} órdenes por ${mxn(f.ventaHoy)} (${hoy}, al momento de la consulta). Si preguntan "cuándo se actualizó", contesta con la hora de la última venta registrada.\n`
  }
  const atraso = diasEntre(f.ultimaFecha, hoy)
  if (atraso >= 2) {
    return `\nFRESCURA DEL POS: SIN COBERTURA DEL POS del ${sumarDiasCalendario(f.ultimaFecha, 1)} al ${hoy}. `
      + `Última venta registrada ${ult} (hace ${atraso} días). Para hoy y esos días NO tienes ventas: di `
      + `"sin cobertura del POS para <periodo>; última venta registrada ${f.ultimaFecha}" — NO digas $0, "no se vendió" ni "no abrieron".\n`
  }
  return `\nFRESCURA DE DATOS (POS de Fullsite): última venta registrada ${ult}. Hoy (${hoy}) aún no hay ventas registradas en el POS — dilo así ("aún no hay ventas registradas hoy"), no como "$0 vendidos".\n`
}

/** Siempre: qué tan al día está el POS de Fullsite. */
export async function contextoFrescura(rpc: Rpc, clientId: string, tz: string, hoy: string = hoyEnZona(tz)): Promise<string> {
  return textoFrescura(await leerFrescura(rpc, clientId, tz), tz, hoy)
}

/** Ventas e historial de precio de cualquier producto (menú o market). */
/**
 * @param ultimaVentaPos día de la última venta del POS (de `leerFrescura`): `null` =
 *   el POS nunca vendió; `undefined` = no se sabe. Sirve para distinguir "no se vendió
 *   ese producto" de "el POS no tiene cobertura en esas fechas".
 */
export async function contextoProducto(rpc: Rpc, clientId: string, mensaje: string, desde: string, hasta: string, tz: string, ultimaVentaPos?: string | null): Promise<string> {
  const terms = terminosBusqueda(mensaje)
  const filas = terms.length
    ? await buscar(rpc, 'fs_ventas_producto', { p_client_id: clientId, p_desde: desde, p_hasta: hasta, p_tz: tz }, terms)
    : await rpc('fs_ventas_producto', { p_client_id: clientId, p_desde: desde, p_hasta: hasta, p_busqueda: '', p_tz: tz })
  if (!filas) return ''
  const titulo = terms.length ? `búsqueda "${terms.join(' ')}"` : 'top del periodo'
  if (filas.length === 0) {
    const cab = `\nVENTAS POR PRODUCTO (POS Fullsite, ${desde} a ${hasta}, ${titulo}): 0 ventas registradas`
    // `undefined` = no se pudo leer la frescura: la cobertura es DESCONOCIDA, no "el POS
    // sí vendió otras cosas".
    if (ultimaVentaPos === undefined) {
      return `${cab} de ese producto; no pude verificar la cobertura del POS en esas fechas. `
        + 'Di que no encontraste ventas registradas de ese producto en el POS para esas fechas (sin afirmar que no se vendió) y ofrece buscar con otro nombre.\n'
    }
    if (ultimaVentaPos === null || (ultimaVentaPos && ultimaVentaPos < desde)) {
      return `${cab} — SIN COBERTURA DEL POS en ese periodo (última venta registrada en el POS: ${ultimaVentaPos || 'nunca'}). `
        + 'NO digas que no se vendió: di que el POS no tiene ventas registradas en esas fechas.\n'
    }
    const parcial = ultimaVentaPos && ultimaVentaPos < hasta ? ` (el POS tiene ventas registradas sólo hasta ${ultimaVentaPos})` : ''
    return `${cab} de ese producto; el POS sí registró otras ventas en el periodo${parcial}. `
      + 'Di que no hay ventas registradas de ese producto en esas fechas y ofrece buscar con otro nombre.\n'
  }
  const lineas = filas.slice(0, 25).map(f => {
    const pm = f.precio_por_mes && typeof f.precio_por_mes === 'object'
      ? Object.entries(f.precio_por_mes as Record<string, number>).map(([m, p]) => `${m}: ${mxn(p)}`).join(', ') : ''
    const cambio = Number(f.precio_min) !== Number(f.precio_max) ? ` (el precio fue de ${mxn(f.precio_min)} a ${mxn(f.precio_max)})` : ''
    return `  ${datoTexto(f.producto)}: ${Number(f.piezas)} pzas, ${mxn(f.venta)}, precio prom ${mxn(f.precio_promedio)}${cambio}, vendido del ${f.primera_venta} al ${f.ultima_venta}${pm ? ` | precio por mes: ${pm}` : ''}`
  })
  return `\nVENTAS POR PRODUCTO (POS Fullsite — incluye menú y market, ${desde} a ${hasta}, ${titulo}; ya calculado):\n${lineas.join('\n')}\nPara "¿aguanta un aumento de precio?" usa el precio por mes vs piezas vendidas: si subió el precio y las piezas no bajaron, aguantó.\n`
}

/** Receta: gramos/ml/piezas por insumo, costo por línea, costo total y margen. */
export async function contextoReceta(rpc: Rpc, clientId: string, mensaje: string): Promise<string> {
  const terms = terminosBusqueda(mensaje)
  if (terms.length === 0) return ''
  const filas = await buscar(rpc, 'fs_receta', { p_client_id: clientId }, terms)
  if (!filas || filas.length === 0) return ''
  const porPlatillo = new Map<string, Record<string, unknown>[]>()
  for (const f of filas) porPlatillo.set(String(f.platillo), [...(porPlatillo.get(String(f.platillo)) || []), f])
  let out = `\nRECETAS (fichas técnicas de Fullsite; cantidades por UNA porción; ya costeado):\n`
  for (const [platillo, ls] of [...porPlatillo.entries()].slice(0, 5)) {
    const costo = ls.reduce((s, l) => s + (Number(l.costo_linea) || 0), 0)
    const pv = Number(ls[0].precio_venta) || 0
    out += `  ${datoTexto(platillo)} — precio ${mxn(pv)}, costo ${mxn(costo)}${pv ? ` (${((costo / pv) * 100).toFixed(1)}% food cost)` : ''}:\n`
    for (const l of ls) {
      const u = String(l.unidad || '').toLowerCase()
      const cant = Number(l.cantidad)
      const legible = u === 'kg' ? `${Math.round(cant * 1000)} g` : u === 'l' || u === 'lt' ? `${Math.round(cant * 1000)} ml` : `${cant} ${l.unidad}`
      out += `    - ${datoTexto(l.insumo)}: ${legible}${l.costo_linea != null ? `, ${pesos2(l.costo_linea)}` : ''}${l.proveedor ? ` (proveedor ${datoTexto(l.proveedor, 60)})` : ''}\n`
    }
  }
  return out
}

/** Insumo: costo por unidad, proveedor con contacto y en qué platillos se usa. */
export async function contextoInsumo(rpc: Rpc, clientId: string, mensaje: string): Promise<string> {
  const terms = terminosBusqueda(mensaje)
  if (terms.length === 0) return ''
  const filas = await buscar(rpc, 'fs_insumo', { p_client_id: clientId }, terms)
  if (!filas || filas.length === 0) return ''
  const lineas = filas.slice(0, 12).map(f => {
    const contacto = [f.proveedor_contacto, f.proveedor_telefono].filter(Boolean).map(c => datoTexto(c, 60)).join(', ')
    const usado = Array.isArray(f.usado_en) && f.usado_en.length ? ` | se usa en: ${(f.usado_en as string[]).slice(0, 8).map(u => datoTexto(u)).join(', ')}` : ''
    return `  ${datoTexto(f.insumo)}: ${precio(f.costo_unitario)} por ${datoTexto(f.unidad, 12)}${f.proveedor ? `, proveedor ${datoTexto(f.proveedor, 60)}` : ', sin proveedor registrado'}${contacto ? ` (${contacto})` : ''}${f.dias_entrega ? `, entrega en ${f.dias_entrega} día(s)` : ''}${usado}`
  })
  return `\nINSUMOS Y PROVEEDORES (catálogo de Fullsite):\n${lineas.join('\n')}\n`
}
