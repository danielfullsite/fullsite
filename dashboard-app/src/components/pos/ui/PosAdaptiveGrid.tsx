'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Retícula que se calcula sola.
//
// Hoy el POS adivina la pantalla con cuatro puntos de corte
// (`grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`). Adivinar
// significa que en una pantalla de 1366 sobran huecos y en una de 1024 los
// productos quedan apretados, y que en cualquiera de las dos aparece scroll en
// cuanto la categoría trae 31 platillos.
//
// Aquí la pantalla decide, no el diseño: se mide el contenedor real y se
// calcula cuántas columnas y cuántos renglones caben con una celda que nunca
// baja del mínimo táctil. Lo que no cabe se pagina — nunca se hace scroll.
//
// Se vuelve a medir cuando el contenedor cambia de tamaño Y cuando cambia el
// tamaño de letra, porque subir la letra 30% cambia cuántos productos caben.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useLayoutEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Mínimo táctil del sistema. Una celda nunca puede ser más baja que esto. */
const TAP_MIN = 56

export type Medida = { cols: number; rows: number; porPagina: number; ancho: number; alto: number }

/**
 * Mide el contenedor y calcula la retícula. Devuelve la referencia que hay que
 * colgar del elemento a medir.
 *
 * `minCelda` es el tamaño mínimo deseable de una celda; el alto se sube a 56 px
 * si viene por debajo. Se escala con el tamaño de letra del documento para que
 * un cliente que sube la letra no termine con el texto cortado.
 */
export function useRejillaAdaptativa(
  minCelda: { ancho: number; alto: number } = { ancho: 132, alto: 84 },
  hueco = 8,
) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [m, setM] = useState<Medida>({ cols: 3, rows: 3, porPagina: 9, ancho: 0, alto: 0 })

  const medir = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (width < 1 || height < 1) return

    // La letra del documento escala el mínimo: 16px es la base.
    let escala = 1
    try {
      const base = parseFloat(getComputedStyle(document.documentElement).fontSize)
      if (base > 0) escala = base / 16
    } catch { /* si no se puede leer, se queda en 1 */ }

    const minW = Math.max(64, minCelda.ancho * escala)
    const minH = Math.max(TAP_MIN, minCelda.alto * escala)

    // Cuántas caben: (disponible + hueco) / (celda + hueco), porque el último
    // elemento no lleva hueco después.
    const cols = Math.max(1, Math.floor((width + hueco) / (minW + hueco)))
    const rows = Math.max(1, Math.floor((height + hueco) / (minH + hueco)))

    setM((prev) =>
      prev.cols === cols && prev.rows === rows && prev.ancho === width && prev.alto === height
        ? prev
        : { cols, rows, porPagina: cols * rows, ancho: width, alto: height },
    )
  }, [minCelda.ancho, minCelda.alto, hueco])

  useLayoutEffect(() => {
    medir()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    // La letra puede cambiar sin que cambie el contenedor.
    const mo = new MutationObserver(medir)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [medir])

  return { ref, medida: m, remedir: medir }
}

export function PosAdaptiveGrid<T>({
  items, render, keyOf, minCelda, hueco = 8, className = '', v2,
  fallback,
}: {
  items: T[]
  render: (item: T, i: number) => React.ReactNode
  keyOf: (item: T, i: number) => string
  minCelda?: { ancho: number; alto: number }
  hueco?: number
  className?: string
  v2: boolean
  /** Lo que se pinta con la bandera apagada: el marcado anterior, intacto. */
  fallback: React.ReactNode
}) {
  const { ref, medida } = useRejillaAdaptativa(minCelda, hueco)
  const [pagina, setPagina] = useState(0)

  const paginas = Math.max(1, Math.ceil(items.length / Math.max(1, medida.porPagina)))
  const actual = Math.min(pagina, paginas - 1)
  const desde = actual * medida.porPagina
  const visibles = items.slice(desde, desde + medida.porPagina)

  // Si cambia la cantidad de productos o la retícula, `pagina` puede quedar
  // fuera de rango. No se corrige con setState durante el render —eso pelea con
  // React—: se deriva `actual` y los botones parten de ahí. La hoja siempre
  // pinta algo.

  if (!v2) return <>{fallback}</>

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div
        ref={ref}
        className={`grid min-h-0 flex-1 ${className}`}
        style={{
          gap: hueco,
          gridTemplateColumns: `repeat(${medida.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${medida.rows}, minmax(0, 1fr))`,
        }}
      >
        {visibles.map((it, i) => (
          <React.Fragment key={keyOf(it, desde + i)}>{render(it, desde + i)}</React.Fragment>
        ))}
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 flex-shrink-0">
          <button
            onClick={() => setPagina(Math.max(0, actual - 1))}
            disabled={actual === 0}
            aria-label="Página anterior"
            className="w-[88px] h-[56px] rounded-xl flex items-center justify-center transition-transform active:scale-95 disabled:opacity-25 disabled:pointer-events-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)' }}
          >
            <ChevronLeft size={22} />
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: paginas }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="rounded-full transition-all"
                style={{
                  width: i === actual ? 22 : 7, height: 7,
                  background: i === actual ? 'var(--accent)' : 'var(--line)',
                }}
              />
            ))}
          </div>

          <button
            onClick={() => setPagina(Math.min(paginas - 1, actual + 1))}
            disabled={actual === paginas - 1}
            aria-label="Página siguiente"
            className="w-[88px] h-[56px] rounded-xl flex items-center justify-center transition-transform active:scale-95 disabled:opacity-25 disabled:pointer-events-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)' }}
          >
            <ChevronRight size={22} />
          </button>
        </div>
      )}
    </div>
  )
}
