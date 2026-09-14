'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Tile de producto del POS real — primer componente del port del rediseño.
//
// Contrato duro: con la bandera apagada devuelve EXACTAMENTE el marcado que
// había en pos/page.tsx. Misma clase, mismo orden, mismo onClick. Apagarla es
// el rollback; no hay nada que revertir.
//
// El color NO se traduce a un mapa de código: llega tal cual del catálogo
// (`bg-rose-700`, `bg-yellow-500`…), que alimenta el dashboard. Agregar una
// categoría nueva no debe requerir tocar este archivo.
//
// No confundir con ProductTile de PosKit.tsx: ése es la muestra del catálogo
// de diseño (/pos/ui-kit) y su color viene de un enum de 6 llaves, que no
// existe en los datos reales.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useSyncExternalStore } from 'react'

const FLAG_KEY = 'pos_v2'

// Almacen externo minimo: la bandera vive en el equipo, no en el arbol de React.
// Se lee con useSyncExternalStore y no con useState dentro de un efecto, para
// que el render del servidor (siempre apagada) y la hidratacion no peleen.
const suscriptores = new Set<() => void>()
function suscribir(fn: () => void) {
  suscriptores.add(fn)
  window.addEventListener('storage', fn)
  return () => { suscriptores.delete(fn); window.removeEventListener('storage', fn) }
}
/**
 * Restaurantes donde el rediseno viene prendido de fabrica, por variable de
 * entorno y no cableado: `NEXT_PUBLIC_POS_V2_TENANTS=amalay,otro`.
 *
 * Existe porque AMALAY todavia NO opera sobre Fullsite —cero movimientos de
 * caja en toda su historia—, asi que ahi el rediseno se ve operandolo, no
 * escribiendo un hash. Un restaurante en operacion real no entra a esta lista
 * hasta que su matriz este en verde.
 */
function porOmisionAqui(): boolean {
  const lista = (process.env.NEXT_PUBLIC_POS_V2_TENANTS || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  if (lista.length === 0) return false
  try {
    const actual = (localStorage.getItem('fullsite_client_id')
      || process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || '').toLowerCase().trim()
    return !!actual && lista.includes(actual)
  } catch { return false }
}

function leerCliente(): boolean {
  try {
    const guardado = localStorage.getItem(FLAG_KEY)
    // Lo que la persona eligio manda SIEMPRE sobre el valor de fabrica: quien
    // escribio `#v2=0` en una caja de la lista espera que se quede apagado.
    if (guardado === '1') return true
    if (guardado === '0') return false
    return porOmisionAqui()
  } catch { return false }
}
const leerServidor = () => false

/**
 * Bandera del rediseno. Se prende con `#v2=1` y se apaga con `#v2=0`; queda
 * guardada en el equipo. Apagarla es el rollback: todo vuelve a su marcado
 * anterior sin tocar una linea de codigo.
 *
 * Va en el HASH y no en la query a proposito. `pos/layout.tsx` decide a donde
 * aterrizar despues del PIN con `if (pathname === '/pos' && !location.search)
 * router.push('/pos/mesas')`, y hay 12 lugares mas en app/pos que leen
 * `location.search`. Una bandera de diseno que cambie la navegacion no es una
 * bandera de diseno. El hash no lo lee nadie en el POS.
 */
export function usePosV2(): boolean {
  if (typeof window !== 'undefined') {
    // El hash manda sobre lo guardado, y se aplica antes de leer para que el
    // primer render ya traiga el valor correcto.
    try {
      const m = /(?:^|[#&])v2=([01])(?:&|$)/.exec(window.location.hash)
      const q = m ? m[1] : null
      if (q && localStorage.getItem(FLAG_KEY) !== q) {
        localStorage.setItem(FLAG_KEY, q)
        suscriptores.forEach(fn => fn())
      }
    } catch { /* modo privado o almacenamiento bloqueado: se queda apagada */ }
  }
  return useSyncExternalStore(suscribir, leerCliente, leerServidor)
}

export type PosProductTileProps = {
  name: string
  price: number
  /** Clase de Tailwind de la categoría, tal como viene del catálogo. */
  colorClass: string
  /** Color del diseño (hex). Cuando viene, MANDA sobre `colorClass`.
   *  Las clases del catálogo son morados y turquesas al azar; la paleta del
   *  diseño son nueve tonos apagados, uno por familia. */
  colorHex?: string
  /** Cuántos de este producto lleva ya la cuenta. */
  cuantos?: number
  /** Agotado: se ve, pero sigue siendo tocable para avisar por qué no se puede. */
  isOOS: boolean
  promo?: boolean
  v2: boolean
  onClick: () => void
}

export function PosProductTile({ name, price, colorClass, colorHex, cuantos, isOOS, promo, v2, onClick }: PosProductTileProps) {
  // ── Antes del rediseño ─────────────────────────────────────────────────────
  if (!v2) {
    return (
      <button
        onClick={onClick}
        className={`bg-[var(--surface-2)] hover:bg-[var(--raised)] active:scale-[0.97] border rounded-xl text-left transition-all flex overflow-hidden relative shadow-sm ${
          isOOS
            ? 'border-[color-mix(in_srgb,var(--crit)_40%,transparent)] opacity-50 cursor-not-allowed'
            : promo
            ? 'border-[var(--accent-line)] ring-1 ring-[var(--accent-soft)]'
            : 'border-[var(--line-soft)] hover:border-[var(--accent-line)]'
        }`}
      >
        <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-[var(--crit)]' : colorClass}`} />
        {isOOS && <span className="absolute top-2 right-2 bg-[var(--crit)] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide">Agotado</span>}
        <div className="flex flex-col justify-between px-3 py-2.5 flex-1">
          <span className={`font-semibold text-sm leading-snug ${isOOS ? 'text-[var(--text-4)] line-through' : 'text-[var(--text-1)]'}`}>{name}</span>
          <span className={`font-bold text-base mt-1 font-mono tabular-nums ${isOOS ? 'text-[var(--crit-ink)]' : 'text-[var(--accent-ink)]'}`}>${Math.round(price)}</span>
        </div>
      </button>
    )
  }

  // ── Rediseño ───────────────────────────────────────────────────────────────
  // El color de la categoría pinta el tile entero, no una franja de 6px: a un
  // metro de distancia el color es lo único que se alcanza a distinguir.
  // Encima va un velo oscuro fijo para que el texto blanco aguante también
  // sobre los amarillos y cianes del catálogo, que sin él no contrastan.
  // El mosaico del diseño: un degradado de UN solo tono a 150 grados, el color
  // de su familia. Sin el velo que le había puesto encima — el diseño no lo
  // lleva, y era lo que apagaba los colores y los volvía lodo.
  const fondo = colorHex ? `linear-gradient(150deg, ${colorHex}, ${colorHex}cc)` : undefined

  return (
    <button
      onClick={onClick}
      aria-disabled={isOOS || undefined}
      className={[
        'relative overflow-hidden rounded-[var(--r2,12px)] px-2 py-2.5',
        'flex flex-col items-center justify-center gap-[5px] text-center text-white',
        'shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.4))]',
        'transition-[transform,filter] duration-[130ms] active:scale-[0.94] active:brightness-[1.15]',
        colorHex ? '' : colorClass,
        isOOS ? 'grayscale opacity-45 cursor-not-allowed' : '',
        promo && !isOOS ? 'ring-2 ring-[var(--accent-bright)] ring-offset-2 ring-offset-[var(--bg)]' : '',
      ].filter(Boolean).join(' ')}
      style={fondo ? { background: fondo } : undefined}
    >
      {/* Cuántos llevas ya de este producto. El demo lo trae y evita que el
          mesero cuente renglones en la cuenta para saber si ya lo pidió. */}
      {!!cuantos && cuantos > 0 && (
        <span className="absolute top-[5px] right-[5px] min-w-[19px] h-[19px] px-[5px] rounded-full grid place-items-center font-mono text-[10.5px] font-black bg-black/40">
          {cuantos}
        </span>
      )}
      {isOOS && (
        <span className="absolute top-[5px] left-[6px] text-[8.5px] font-black uppercase tracking-[0.06em] opacity-80">
          Agotado
        </span>
      )}
      <span
        className={`text-[12px] font-extrabold leading-[1.14] tracking-[-0.015em] line-clamp-3 ${isOOS ? 'line-through' : ''}`}
      >
        {name}
      </span>
      <span className="font-mono tabular-nums text-[11.5px] font-bold tracking-[-0.02em] opacity-[0.92]">
        ${Math.round(price)}
      </span>
    </button>
  )
}
