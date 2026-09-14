'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Panel de venta — la estructura del demo, no un revestimiento.
//
// El POS de hoy llena el panel derecho con 58 categorías y, al tocar una, abre
// los productos en un MODAL. Eso obliga a dos toques para llegar a cualquier
// platillo, tapa la cuenta mientras eliges, y dentro del modal hay scroll.
//
// El demo resuelve la misma pantalla en cinco franjas fijas, todo a la vista:
//
//   1  buscar
//   2  familias      ← 9 botones fijos: colapsan las 58 categorías
//   3  categorías    ← sólo las de la familia elegida
//   4  productos     ← retícula calculada, sin scroll
//   5  paginador
//
// Las familias son el arreglo de fondo: 58 categorías no caben en ninguna
// pantalla, pero 9 sí, y cada una abre un puñado. El nombre de la categoría
// decide su familia por palabras clave, así que un restaurante nuevo no
// configura nada: sus categorías se acomodan solas.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { Search, ScanBarcode, Star, Coffee, CupSoda, Egg, UtensilsCrossed, Croissant, CakeSlice, Wine, ShoppingCart } from 'lucide-react'
import { PosAdaptiveGrid } from './PosAdaptiveGrid'
import { PosProductTile } from './PosProductTile'

type Item = { id: string; name: string; price: number }
type Cat = { id: string; name: string; color?: string; items: Item[] }

export const FAMILIAS = [
  { k: 'top',    n: 'Top',       Ic: Star,            c: '#10b981', match: null },
  { k: 'cafe',   n: 'Café',      Ic: Coffee,          c: '#a8703a', match: ['coffee', 'frappe', 'tea', 'tisana'] },
  { k: 'bebida', n: 'Bebidas',   Ic: CupSoda,         c: '#3b82f6', match: ['jugo', 'smoothie', 'fresh', 'soda', 'bebida', 'agua'] },
  { k: 'desay',  n: 'Desayuno',  Ic: Egg,             c: '#f59e0b', match: ['egg', 'keto', 'chilaquil', 'pancake', 'waffle', 'toast', 'bagel', 'croissants breakfast', 'bowl'] },
  { k: 'cocina', n: 'Cocina',    Ic: UtensilsCrossed, c: '#2e9e5b', match: ['panini', 'pizza', 'pasta', 'soup', 'salad', 'ceviche', 'appetizer', 'special', 'signature', 'munchie', 'kids', 'enchilada'] },
  { k: 'pan',    n: 'Panadería', Ic: Croissant,       c: '#c2410c', match: ['bakery', 'panader'] },
  { k: 'postre', n: 'Postre',    Ic: CakeSlice,       c: '#ec4899', match: ['ice cream', 'postre', 'dulce', 'nieve'] },
  { k: 'barra',  n: 'Barra',     Ic: Wine,            c: '#8b5cf6', match: ['vino', 'cerveza', 'licor', 'bebidas oh'] },
  { k: 'market', n: 'Market',    Ic: ShoppingCart,    c: '#64748b', match: ['market', 'mkt', 'extras', 'envios', 'activacion'] },
] as const

/** A qué familia pertenece una categoría, por su nombre. Si nada coincide,
 *  cae en Cocina — que es donde vive la mayoría en un restaurante. */
export function familiaDe(nombreCategoria: string): string {
  const low = nombreCategoria.toLowerCase()
  const f = FAMILIAS.find(x => x.match && x.match.some(k => low.includes(k)))
  return f ? f.k : 'cocina'
}

/* ── Los más vendidos de ESTA terminal ─────────────────────────────────────
   No hay ranking de ventas en el catálogo, así que «Top» se gana con el uso:
   cada producto que se toca suma uno, y los 20 más tocados encabezan. Una
   terminal de barra y una de mostrador acaban con Tops distintos, que es lo
   correcto. Vive en el equipo; no viaja ni se sincroniza. */
const LLAVE_TOP = 'pos_top_taps'
const VACIO: Record<string, number> = {}
let cacheTop: Record<string, number> = VACIO
const suscritos = new Set<() => void>()

function leerTop(): Record<string, number> {
  try {
    const crudo = localStorage.getItem(LLAVE_TOP)
    if (!crudo) return VACIO
    // Se memoiza porque useSyncExternalStore compara por identidad: devolver
    // un objeto nuevo en cada lectura provoca un bucle de renders.
    const parsed = JSON.parse(crudo)
    if (JSON.stringify(cacheTop) !== crudo) cacheTop = parsed
    return cacheTop
  } catch { return VACIO }
}
const leerTopServidor = () => VACIO
function suscribirTop(fn: () => void) {
  suscritos.add(fn)
  return () => { suscritos.delete(fn) }
}

export function contarTap(id: string) {
  try {
    const t = { ...leerTop() }
    t[id] = (t[id] || 0) + 1
    localStorage.setItem(LLAVE_TOP, JSON.stringify(t))
    cacheTop = t
    suscritos.forEach(fn => fn())
  } catch { /* almacenamiento bloqueado: Top simplemente no aprende */ }
}

export function PosVentaPanel({
  categorias, outOfStock, busqueda, onBusqueda, onEscanear, onTocarProducto, v2, fallback,
}: {
  categorias: Cat[]
  outOfStock: Set<string>
  busqueda: string
  onBusqueda: (v: string) => void
  onEscanear: () => void
  onTocarProducto: (item: Item, catId: string) => void
  v2: boolean
  fallback: React.ReactNode
}) {
  const [familia, setFamilia] = useState('top')
  const [catSel, setCatSel] = useState<string | null>(null)
  const taps = useSyncExternalStore(suscribirTop, leerTop, leerTopServidor)

  const conProductos = useMemo(
    () => categorias.filter(c => c.items.some(i => i.price > 0)),
    [categorias],
  )

  /** Cuántas categorías cuelgan de cada familia — para no pintar familias vacías. */
  const porFamilia = useMemo(() => {
    const m: Record<string, Cat[]> = {}
    for (const c of conProductos) (m[familiaDe(c.name)] ||= []).push(c)
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return m
  }, [conProductos])

  const SIN_CATS: Cat[] = useMemo(() => [], [])
  const catsDeFamilia = useMemo(
    () => (familia === 'top' ? SIN_CATS : (porFamilia[familia] || SIN_CATS)),
    [familia, porFamilia, SIN_CATS],
  )

  /** Los 20 más tocados en esta terminal. Sin historial, los de mayor precio
   *  de cada familia — que en la práctica son los que más margen dejan. */
  const top = useMemo(() => {
    const todos = conProductos.flatMap(c => c.items.filter(i => i.price > 0).map(i => ({ i, c })))
    const conTaps = todos.filter(x => taps[x.i.id])
    const base = conTaps.length >= 6
      ? conTaps.sort((a, b) => (taps[b.i.id] || 0) - (taps[a.i.id] || 0))
      : todos.slice().sort((a, b) => b.i.price - a.i.price)
    return base.slice(0, 20)
  }, [conProductos, taps])

  /* Qué productos se pintan: la búsqueda manda sobre todo lo demás. */
  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (t) {
      return conProductos.flatMap(c =>
        c.items.filter(i => i.price > 0 && i.name.toLowerCase().includes(t)).map(i => ({ i, c })))
    }
    if (familia === 'top') return top
    const cats = catSel ? catsDeFamilia.filter(c => c.id === catSel) : catsDeFamilia
    return cats.flatMap(c => c.items.filter(i => i.price > 0).map(i => ({ i, c })))
  }, [busqueda, familia, catSel, catsDeFamilia, conProductos, top])

  if (!v2) return <>{fallback}</>

  const cambiaFamilia = (k: string) => { setFamilia(k); setCatSel(null) }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 1 · Buscar */}
      <div className="px-3 pt-2 pb-1 flex gap-2 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-4)' }} />
          <input
            value={busqueda}
            onChange={e => onBusqueda(e.target.value)}
            placeholder="Buscar platillo…"
            className="w-full h-[56px] pl-11 pr-3 rounded-2xl text-[15px] font-medium focus:outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
          />
        </div>
        <button
          onClick={onEscanear}
          aria-label="Escanear código de barras"
          className="w-[56px] h-[56px] rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform active:scale-95"
          style={{ background: 'var(--warn-soft)', border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)', color: 'var(--warn-ink)' }}
        >
          <ScanBarcode size={22} />
        </button>
      </div>

      {/* 2 · Familias — 9 botones fijos. La posición NUNCA cambia: la memoria
             muscular del mesero depende de eso más que de la etiqueta. */}
      <div className="px-3 pt-1 grid gap-1.5 flex-shrink-0" style={{ gridTemplateColumns: `repeat(${FAMILIAS.length}, minmax(0, 1fr))` }}>
        {FAMILIAS.map(f => {
          const on = familia === f.k && !busqueda.trim()
          const vacia = f.k !== 'top' && !(porFamilia[f.k] || []).length
          const Ic = f.Ic
          return (
            <button
              key={f.k}
              onClick={() => cambiaFamilia(f.k)}
              disabled={vacia}
              className="min-h-[56px] rounded-xl flex flex-col items-center justify-center gap-0.5 font-bold text-[11px] leading-tight transition-transform active:scale-95 disabled:opacity-25 disabled:pointer-events-none px-1"
              style={on
                ? { background: f.c, color: '#fff', border: '1px solid transparent', boxShadow: `0 4px 14px ${f.c}55` }
                : { background: 'var(--surface-2)', color: 'var(--text-2)', border: `1px solid var(--line)`, borderBottom: `2px solid ${f.c}` }}
            >
              <Ic size={17} style={{ opacity: on ? 1 : 0.8 }} />
              <span className="truncate w-full text-center">{f.n}</span>
            </button>
          )
        })}
      </div>

      {/* 3 · Categorías de la familia. «Todas» primero, que es el caso común. */}
      {!busqueda.trim() && catsDeFamilia.length > 0 && (
        <div className="px-3 pt-1.5 flex gap-1.5 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setCatSel(null)}
            className="min-h-[44px] px-3.5 rounded-xl text-[12.5px] font-bold whitespace-nowrap flex-shrink-0 transition-transform active:scale-95"
            style={catSel === null
              ? { background: 'var(--text-1)', color: 'var(--bg)', border: '1px solid transparent' }
              : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--line)' }}
          >
            Todas <span style={{ opacity: .6 }}>{catsDeFamilia.reduce((n, c) => n + c.items.filter(i => i.price > 0).length, 0)}</span>
          </button>
          {catsDeFamilia.map(c => (
            <button
              key={c.id}
              onClick={() => setCatSel(catSel === c.id ? null : c.id)}
              className="min-h-[44px] px-3.5 rounded-xl text-[12.5px] font-bold whitespace-nowrap flex-shrink-0 transition-transform active:scale-95"
              style={catSel === c.id
                ? { background: 'var(--text-1)', color: 'var(--bg)', border: '1px solid transparent' }
                : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--line)' }}
            >
              {c.name} <span style={{ opacity: .6 }}>{c.items.filter(i => i.price > 0).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* 4 y 5 · Productos y paginador. La retícula se calcula midiendo: nunca scroll. */}
      <div className="flex-1 min-h-0 px-3 py-2 flex flex-col">
        {visibles.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2" style={{ color: 'var(--text-3)' }}>
            <Search size={30} style={{ opacity: .4 }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
              {busqueda.trim() ? `Nada se llama «${busqueda.trim()}»` : 'Esta familia no tiene productos'}
            </p>
            {busqueda.trim() && <p className="text-xs">Prueba con menos letras.</p>}
          </div>
        ) : (
          <PosAdaptiveGrid
            v2
            items={visibles}
            keyOf={(x) => x.i.id}
            minCelda={{ ancho: 140, alto: 88 }}
            hueco={8}
            fallback={null}
            render={({ i, c }) => {
              const isOOS = outOfStock.has(i.id)
              return (
                <PosProductTile
                  v2
                  name={i.name}
                  price={i.price}
                  colorClass={c.color || 'bg-emerald-600'}
                  isOOS={isOOS}
                  onClick={() => {
                    if (isOOS) { onTocarProducto(i, c.id); return }
                    contarTap(i.id)
                    onTocarProducto(i, c.id)
                  }}
                />
              )
            }}
          />
        )}
      </div>
    </div>
  )
}
