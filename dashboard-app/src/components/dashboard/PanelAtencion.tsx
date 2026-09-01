'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { X, Send, Sparkles, ArrowRight } from 'lucide-react'
import { LAYER } from '@/components/ui/layers'
import { useFocusTrap } from '@/components/ui/useFocusTrap'
import { useScrollLock } from '@/components/ui/useScrollLock'
import { pushDialog, popDialog, isTopDialog } from '@/components/ui/dialogStack'
import { formatCurrency } from '@/lib/format'
import type { Atencion, Severidad } from '@/lib/atencion'

/**
 * El detalle de un pendiente de "cosas por atender", en un panel lateral.
 *
 * Hermano de PanelAgente (el de las detecciones "para hoy"): mismo lenguaje
 * visual y los MISMOS primitivos de diálogo (focus trap, scroll lock, pila de
 * diálogos, capas) para que ESC, el foco y el fondo se comporten igual y no se
 * reintroduzcan los defectos que esos primitivos ya resolvieron.
 *
 * Diferencia honesta: un `Atencion` no trae la evidencia en barras que sí trae
 * una `Deteccion`, así que aquí NO hay gráfica. Cada sección aparece sólo si el
 * agente reportó ese dato — nada se inventa para llenar el panel.
 */

const TONO: Record<Severidad, { barra: string; ink: string; texto: string }> = {
  critical: { barra: 'var(--crit)', ink: 'var(--crit-ink)', texto: 'Crítico' },
  warning: { barra: 'var(--warn)', ink: 'var(--warn-ink)', texto: 'Atención' },
  info: { barra: 'var(--info)', ink: 'var(--info-ink)', texto: 'Nota' },
}

export interface PanelAtencionProps {
  atencion: Atencion | null
  onCerrar: () => void
}

export default function PanelAtencion({ atencion, onCerrar }: PanelAtencionProps) {
  const abierto = atencion !== null
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useMemo(() => Symbol('panel-atencion'), [])
  const [borrador, setBorrador] = useState<{ id: string; pregunta: string }>({ id: '', pregunta: '' })

  useScrollLock(abierto, true, panelRef)
  useFocusTrap(abierto, panelRef, { initialFocus: 'first-input', isActive: () => isTopDialog(id) })

  useEffect(() => {
    if (!abierto) return
    pushDialog(id)
    return () => popDialog(id)
  }, [abierto, id])

  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopDialog(id)) onCerrar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [abierto, id, onCerrar])

  if (!atencion) return null

  const tono = TONO[atencion.severidad]
  const pregunta = borrador.id === atencion.id ? borrador.pregunta : ''
  // "Qué pasa" sólo si aporta algo distinto al título.
  const explica = atencion.explicacion && atencion.explicacion !== atencion.titulo ? atencion.explicacion : ''
  // "Qué hacer": preferimos la acción sugerida; si no vino separada, el detalle
  // de la fila (que ya es acción||explicación) cubre, salvo que sea == a "qué pasa".
  const queHacer = atencion.accionSugerida || (atencion.detalle && atencion.detalle !== explica ? atencion.detalle : '')

  return (
    <>
      <div
        className="fixed inset-0 bg-black/45 transition-opacity"
        style={{ zIndex: LAYER.dialog }}
        onClick={onCerrar}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Pendiente por atender: ${atencion.titulo}`}
        className="ag-entra-panel fixed top-0 right-0 flex h-dvh w-full max-w-[440px] flex-col border-l border-[var(--line)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
        style={{ zIndex: LAYER.dialog + 1, background: 'var(--panel)' }}
      >
        {/* Encabezado */}
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
          <span
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
          >
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold tracking-[-0.015em] text-[var(--text-1)]">Pendiente por atender</h2>
            <p className="mt-0.5 text-[12px] font-semibold" style={{ color: tono.ink }}>{tono.texto}</p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] active:bg-[var(--surface-2)]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* 1 — el hecho */}
          <div
            className="rounded-[14px] border-l-[3px] px-4 py-3"
            style={{ background: 'var(--surface-2)', borderLeftColor: tono.barra }}
          >
            <p className="text-[14px] font-semibold leading-[1.5] text-[var(--text-1)]">{atencion.titulo}</p>
          </div>

          {/* 2 — el dinero en juego */}
          {atencion.valor != null && (
            <div className="mt-4 flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
                En juego
              </span>
              <span className="text-[19px] font-bold tnum" style={{ color: tono.ink }}>
                {formatCurrency(atencion.valor)}
              </span>
            </div>
          )}

          {/* 3 — qué pasa */}
          {explica && (
            <>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Qué pasa</p>
              <p className="mt-2 text-[13px] leading-[1.55] text-[var(--text-2)]">{explica}</p>
            </>
          )}

          {/* 4 — qué hacer */}
          {queHacer && (
            <>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Qué hacer</p>
              <p className="mt-2 text-[13px] leading-[1.55] text-[var(--text-2)]">{queHacer}</p>
            </>
          )}

          {/* 5 — confianza del agente */}
          {atencion.confianza != null && (
            <p className="mt-5 text-[12px] text-[var(--text-4)]">
              Confianza del agente: {Math.round(atencion.confianza * 100)}%
            </p>
          )}

          {/* 6 — la acción (a dónde ir) */}
          {atencion.href && atencion.accion && (
            <Link
              href={atencion.href}
              className="mt-5 inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--on-accent, #06120d)' }}
            >
              {atencion.accion} <ArrowRight size={14} />
            </Link>
          )}
        </div>

        {/* 7 — preguntarle (todavía no conecta, se dice en vez de fingir) */}
        <form
          className="border-t border-[var(--line)] px-5 py-3"
          onSubmit={e => { e.preventDefault(); setBorrador({ id: atencion.id, pregunta: '' }) }}
        >
          <label htmlFor="pregunta-atencion" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
            Pregúntale
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="pregunta-atencion"
              value={pregunta}
              onChange={e => setBorrador({ id: atencion.id, pregunta: e.target.value })}
              placeholder="¿Por qué crees que pasó?"
              className="min-w-0 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent-line)]"
            />
            <button
              type="submit"
              disabled
              aria-label="Enviar pregunta"
              title="Todavía no disponible"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--text-4)] disabled:cursor-not-allowed"
            >
              <Send size={15} />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-4)]">
            Conversar con el agente todavía no está listo — por ahora el detalle de arriba es todo lo que sabe.
          </p>
        </form>
      </div>
    </>
  )
}
