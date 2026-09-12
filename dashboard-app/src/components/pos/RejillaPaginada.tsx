'use client'

// EN LA CAJA NO HAY RATÓN, Y UNA REJILLA QUE CRECE HACIA ABAJO SE VUELVE INVISIBLE.
//
// Mesas, catálogo y tablero de cocina tienen el mismo problema: una rejilla de
// largo desconocido dentro de una caja de alto fijo. Hoy se resuelve con
// `overflow-y-auto`, que en una tableta obliga a arrastrar el dedo sobre la
// lista —y en 1024×768 esconde más de la mitad (medido el 2026-09-12: la comanda
// mostraba 297px de 724).
//
// Esta rejilla mide cuánto espacio hay de verdad, calcula cuántas filas caben y
// reparte el resto en páginas. Si todo cabe, no aparece ningún control: una
// pantalla con doce mesas se ve exactamente igual que antes.
//
// No decide nada del negocio. Recibe elementos ya construidos y sólo elige
// cuáles se pintan.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props<T> {
  elementos: T[]
  /** Clave estable por elemento; sin ella React repinta de más al pasar de página. */
  claveDe: (elemento: T, indice: number) => string
  pintar: (elemento: T, indice: number) => ReactNode
  /** Alto MÍNIMO de una celda en px. Es con lo que se calculan las filas; si
   *  sobran pixeles las filas crecen a partes iguales en vez de dejar la mitad
   *  de la pantalla en negro, que es lo que pasaba con un alto fijo. */
  altoDeCelda: number
  /** Clases de la rejilla — columnas, gap, lo que ya usaba cada pantalla. */
  clasesDeRejilla: string
  /** Separación vertical entre filas, en px, para que el cálculo cuadre con el gap. */
  separacion?: number
  /** Qué se nombra en el control de página: «mesas», «platillos», «comandas». */
  nombreDeElementos?: string
  vacio?: ReactNode
}

export default function RejillaPaginada<T>({
  elementos, claveDe, pintar, altoDeCelda, clasesDeRejilla,
  separacion = 10, nombreDeElementos = 'elementos', vacio,
}: Props<T>) {
  const caja = useRef<HTMLDivElement>(null)
  const [porPagina, setPorPagina] = useState(0)
  const [pagina, setPagina] = useState(0)

  // Cuántas filas caben y cuántas columnas hay de verdad. Las columnas salen de
  // la rejilla ya pintada (`grid-template-columns`), no de repetir aquí los
  // puntos de quiebre de Tailwind: si mañana cambian allá, esto sigue cuadrando.
  const medir = useCallback(() => {
    const el = caja.current
    if (!el) return
    const alto = el.clientHeight
    const columnas = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1
    const filas = Math.max(1, Math.floor((alto + separacion) / (altoDeCelda + separacion)))
    setPorPagina(filas * columnas)
  }, [altoDeCelda, separacion])

  useLayoutEffect(() => {
    medir()
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [medir])

  // Si la lista se encoge (una mesa se libera, una categoría se filtra) la página
  // actual puede dejar de existir. Se resuelve al pintar, no con un efecto que
  // corrija el estado después: un efecto llegaría un cuadro tarde y ese cuadro
  // sería una rejilla vacía sin explicación.
  const paginas = porPagina > 0 ? Math.max(1, Math.ceil(elementos.length / porPagina)) : 1
  const actual = Math.min(pagina, paginas - 1)
  // Antes de la primera medición se pinta todo: así el primer cuadro nunca sale
  // vacío, y la medición siguiente lo recorta.
  const visibles = porPagina > 0 ? elementos.slice(actual * porPagina, (actual + 1) * porPagina) : elementos
  const hayPaginas = paginas > 1

  const boton = 'flex h-14 min-w-14 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-1)] disabled:opacity-35 active:scale-95 transition-transform'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={caja} className={`min-h-0 flex-1 ${clasesDeRejilla}`} style={{ gridAutoRows: `minmax(${altoDeCelda}px, 1fr)` }}>
        {visibles.map((elemento, i) => (
          <div key={claveDe(elemento, actual * porPagina + i)}>{pintar(elemento, actual * porPagina + i)}</div>
        ))}
      </div>
      {elementos.length === 0 && vacio}
      {hayPaginas && (
        <div className="flex flex-shrink-0 items-center justify-center gap-3" role="group" aria-label={`Páginas de ${nombreDeElementos}`}>
          <button type="button" className={boton} onClick={() => setPagina(p => Math.max(0, p - 1))}
            disabled={actual === 0} aria-label={`Página anterior de ${nombreDeElementos}`}>
            <ChevronLeft size={24} />
          </button>
          <span className="font-mono text-base font-bold tabular-nums text-[var(--text-2)]" aria-live="polite">
            {actual + 1} / {paginas}
            <span className="ml-2 text-sm font-normal text-[var(--text-3)]">{elementos.length} {nombreDeElementos}</span>
          </span>
          <button type="button" className={boton} onClick={() => setPagina(p => Math.min(paginas - 1, p + 1))}
            disabled={actual === paginas - 1} aria-label={`Página siguiente de ${nombreDeElementos}`}>
            <ChevronRight size={24} />
          </button>
        </div>
      )}
    </div>
  )
}
