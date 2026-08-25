'use client'

import { useEffect, useState } from 'react'
import type { PuntoEvidencia } from '@/lib/agentes/detectar'

/**
 * La evidencia del agente, en barras.
 *
 * Se eligieron barras y no una curva a propósito. La evidencia siempre son cosas
 * CONTABLES y separadas —cuatro viernes, cinco personas, seis días— y una curva
 * entre puntos discretos inventa una continuidad que no existe: sugiere que
 * entre el viernes 3 y el viernes 10 la venta "pasó" por algún lado, y no pasó
 * por ningún lado, no hubo nada en medio.
 *
 * Ese es justo el defecto de las mini-gráficas del dashboard viejo: dibujan las
 * últimas 7 FILAS como si fueran 7 días seguidos, así que dos puntos separados
 * por tres semanas se ven pegados.
 *
 * La barra del día analizado va en el color de acento; las de referencia en un
 * tono neutro. La comparación se lee sin leyenda.
 *
 * La animación entra escalonada de izquierda a derecha, que es el orden en que
 * se lee. Con `prefers-reduced-motion` no hay animación: las barras aparecen ya
 * puestas, porque el movimiento es adorno y el dato no.
 */

export interface GraficaEvidenciaProps {
  puntos: PuntoEvidencia[]
  /** Cómo se formatea el valor en la etiqueta. */
  formato?: (v: number) => string
  alto?: number
}

const pesos = (v: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v)

export default function GraficaEvidencia({ puntos, formato = pesos, alto = 132 }: GraficaEvidenciaProps) {
  // La preferencia se lee UNA vez, en el inicializador perezoso del estado, no
  // dentro de un efecto: llamar a setState de forma síncrona en un efecto
  // encadena renders y el React Compiler lo marca como error. En servidor
  // devuelve false, y como el valor inicial pintado es el mismo en ambos lados
  // (barras en cero), no hay desajuste de hidratación.
  const [quieto] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  const [entro, setEntro] = useState(false)

  // La animación arranca en el siguiente frame: si las barras nacieran ya en su
  // altura final no habría transición que ver. Con `prefers-reduced-motion` no
  // se anima: el movimiento es adorno, el dato no.
  useEffect(() => {
    if (quieto) return
    const id = requestAnimationFrame(() => setEntro(true))
    return () => cancelAnimationFrame(id)
  }, [quieto])

  // Sin animación, las barras se pintan ya puestas.
  const mostrado = entro || quieto

  if (puntos.length === 0) return null

  const max = Math.max(...puntos.map(p => Math.abs(p.valor)), 1)

  return (
    <div
      className="rounded-[14px] border border-[var(--line)] px-4 pt-4 pb-3"
      style={{ background: 'var(--surface-2)' }}
      role="img"
      aria-label={puntos.map(p => `${p.etiqueta}: ${formato(p.valor)}`).join('. ')}
    >
      <div className="flex items-end gap-2" style={{ height: alto }}>
        {puntos.map((p, i) => {
          const prop = Math.abs(p.valor) / max
          return (
            <div key={`${p.etiqueta}-${i}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span
                className={`text-[10.5px] tnum transition-opacity duration-500 ${p.foco ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}
                style={{ opacity: mostrado ? 1 : 0, transitionDelay: quieto ? '0ms' : `${180 + i * 70}ms` }}
              >
                {formato(p.valor)}
              </span>
              <span
                className="w-full rounded-t-[5px]"
                style={{
                  height: `${Math.max(2, prop * 100)}%`,
                  background: p.foco ? 'var(--accent)' : 'var(--text-4)',
                  opacity: p.foco ? 1 : 0.45,
                  // scaleY desde abajo: la barra CRECE, no se desliza.
                  transform: mostrado ? 'scaleY(1)' : 'scaleY(0)',
                  transformOrigin: 'bottom',
                  transition: quieto ? 'none' : 'transform 620ms cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: quieto ? '0ms' : `${i * 70}ms`,
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex gap-2 border-t border-[var(--line)] pt-2">
        {puntos.map((p, i) => (
          <span
            key={`e-${p.etiqueta}-${i}`}
            className={`min-w-0 flex-1 truncate text-center text-[10.5px] ${p.foco ? 'font-semibold text-[var(--text-2)]' : 'text-[var(--text-4)]'}`}
          >
            {p.etiqueta}
          </span>
        ))}
      </div>
    </div>
  )
}
