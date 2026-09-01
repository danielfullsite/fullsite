'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import PanelAtencion from '@/components/dashboard/PanelAtencion'
import type { Atencion, Severidad } from '@/lib/atencion'

/**
 * Lo primero de la pantalla: qué necesita a alguien, ahora.
 *
 * Dos decisiones que sostienen el componente:
 *
 * 1. **Si no hay nada que atender, no se renderiza nada.** Un panel que siempre
 *    muestra cinco alertas enseña a ignorarlas. Cuando el turno va limpio, la
 *    pantalla empieza directo en las cifras — y esa ausencia también es
 *    información.
 *
 * 2. **La franja lateral carga la gravedad, no el fondo.** Una tarjeta con fondo
 *    rojo entero se pelea con el texto y con el resto de la pantalla; la franja
 *    de 3px se ve de reojo y deja el contenido en su contraste normal. Es el
 *    mismo recurso que el semáforo de tiempo del KDS.
 */

const TONO: Record<Severidad, { barra: string; chip: string; texto: string }> = {
  critical: { barra: 'var(--crit)', chip: 'bg-[var(--crit-soft)] text-[var(--crit-ink)]', texto: 'Crítico' },
  warning: { barra: 'var(--warn)', chip: 'bg-[var(--warn-soft)] text-[var(--warn-ink)]', texto: 'Atención' },
  info: { barra: 'var(--info)', chip: 'bg-[var(--info-soft)] text-[var(--info-ink)]', texto: 'Nota' },
}

export default function ListaAtencion({
  items,
  cargando = false,
}: {
  items: Atencion[]
  cargando?: boolean
}) {
  // Picar un renglón abre su detalle en un panel lateral (mismo gesto que las
  // detecciones "para hoy"). El botón de acción (Ver inventario…) sigue siendo
  // un atajo aparte: no abre el panel, va directo a su pantalla.
  const [abierta, setAbierta] = useState<Atencion | null>(null)

  // Mientras carga no se muestra un esqueleto: aparecer y desaparecer arriba de
  // la pantalla es más molesto que llegar un segundo después.
  if (cargando) return null
  if (items.length === 0) return null

  const criticos = items.filter(i => i.severidad === 'critical').length

  return (
    <section className="mb-5" aria-label="Pendientes de atención">
      <div className="flex items-baseline gap-2.5 mb-2.5">
        <h2 className="text-[15px] font-bold text-[var(--text-1)]">
          {items.length === 1 ? '1 cosa por atender' : `${items.length} cosas por atender`}
        </h2>
        {criticos > 0 && (
          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--crit-soft)] text-[var(--crit-ink)]">
            {criticos} {criticos === 1 ? 'crítica' : 'críticas'}
          </span>
        )}
      </div>

      <div className="rounded-[12px] border border-[var(--line)] overflow-hidden divide-y divide-[var(--line)]">
        {items.map(i => (
          <div key={i.id} className="flex items-center bg-[var(--panel)] pl-4">
            <span
              aria-hidden="true"
              className="w-[3px] self-stretch rounded-full flex-none"
              style={{ background: TONO[i.severidad].barra }}
            />
            {/* Todo el renglón (menos el botón de acción) abre el detalle. */}
            <button
              type="button"
              onClick={() => setAbierta(i)}
              aria-label={`Ver detalle: ${i.titulo}`}
              className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="sr-only">{TONO[i.severidad].texto}:</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-[var(--text-1)] leading-snug">{i.titulo}</span>
                {i.detalle && (
                  <span className="block text-[12.5px] text-[var(--text-3)] mt-0.5 leading-snug">{i.detalle}</span>
                )}
              </span>
              {/* El dinero en juego es lo que convierte un aviso en una prioridad. */}
              {i.valor != null && (
                <span className="hidden sm:block text-[13px] font-bold text-[var(--text-2)] tabular-nums flex-none">
                  {formatCurrency(i.valor)}
                </span>
              )}
              <ChevronRight size={16} className="flex-none text-[var(--text-4)]" aria-hidden="true" />
            </button>
            {i.href && i.accion && (
              <Link
                href={i.href}
                className="flex-none ml-1 mr-4 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--accent-line)] transition-colors"
              >
                {i.accion}
              </Link>
            )}
          </div>
        ))}
      </div>

      <PanelAtencion atencion={abierta} onCerrar={() => setAbierta(null)} />
    </section>
  )
}
