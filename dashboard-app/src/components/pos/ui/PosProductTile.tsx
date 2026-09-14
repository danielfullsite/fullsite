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
function leerCliente(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === '1' } catch { return false }
}
const leerServidor = () => false

/**
 * Bandera del rediseno. Se prende con `?v2=1` y se apaga con `?v2=0`; queda
 * guardada en el equipo. Apagarla es el rollback: el tile vuelve a su marcado
 * anterior sin tocar una linea de codigo.
 */
export function usePosV2(): boolean {
  if (typeof window !== 'undefined') {
    // El parametro manda sobre lo guardado, y se aplica antes de leer para que
    // el primer render ya traiga el valor correcto.
    try {
      const q = new URLSearchParams(window.location.search).get('v2')
      if ((q === '1' || q === '0') && localStorage.getItem(FLAG_KEY) !== q) {
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
  /** Agotado: se ve, pero sigue siendo tocable para avisar por qué no se puede. */
  isOOS: boolean
  promo?: boolean
  v2: boolean
  onClick: () => void
}

export function PosProductTile({ name, price, colorClass, isOOS, promo, v2, onClick }: PosProductTileProps) {
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
  return (
    <button
      onClick={onClick}
      aria-disabled={isOOS || undefined}
      className={[
        'relative overflow-hidden rounded-2xl px-2 py-2.5 shadow-[0_2px_10px_rgba(0,0,0,.28)]',
        'flex flex-col items-center justify-center gap-1 text-center text-white',
        'transition-[transform,filter] duration-150 active:scale-[0.94] active:brightness-[1.12]',
        colorClass,
        isOOS ? 'grayscale opacity-45 cursor-not-allowed' : '',
        promo && !isOOS ? 'ring-2 ring-[var(--accent-ink)] ring-offset-2 ring-offset-[var(--surface)]' : '',
      ].filter(Boolean).join(' ')}
    >
      <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-white/[0.14] via-transparent to-black/30" />
      {isOOS && (
        <span className="absolute top-1.5 right-1.5 z-10 bg-[var(--crit)] text-white text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide">
          Agotado
        </span>
      )}
      <span
        className={`relative text-[12px] font-extrabold leading-[1.14] tracking-[-0.015em] line-clamp-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] ${isOOS ? 'line-through' : ''}`}
      >
        {name}
      </span>
      <span className="relative font-mono tabular-nums text-[11.5px] font-bold tracking-[-0.02em] opacity-[0.92] drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
        ${Math.round(price)}
      </span>
    </button>
  )
}
