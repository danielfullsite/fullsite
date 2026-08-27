'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Check, Clock, Trash2, Send, Sparkles } from 'lucide-react'
import { LAYER } from '@/components/ui/layers'
import { useFocusTrap } from '@/components/ui/useFocusTrap'
import { useScrollLock } from '@/components/ui/useScrollLock'
import { pushDialog, popDialog, isTopDialog } from '@/components/ui/dialogStack'
import GraficaEvidencia from '@/components/agentes/GraficaEvidencia'
import type { Deteccion } from '@/lib/agentes/detectar'

/**
 * El detalle de una detección, en un panel lateral.
 *
 * La idea de fondo: un agente que sólo dice "algo anda mal" obliga a creerle.
 * Este panel enseña QUÉ MIRÓ y CON QUÉ NÚMEROS, para que el dueño pueda no
 * creerle. Un agente auditable se usa; uno que hay que obedecer a ciegas se
 * ignora a la tercera vez que se equivoca.
 *
 * De ahí el orden de las secciones, que no es decorativo:
 *   1. el hecho          — qué encontró
 *   2. el impacto        — cuánto cuesta, en pesos
 *   3. qué analizó       — la ventana, contra qué comparó, cuántos días
 *   4. la evidencia      — los números, en barras
 *   5. la recomendación  — qué hacer, y las tres salidas
 *   6. el chat           — preguntarle
 *
 * Reusa los primitivos de diálogo que ya existen (`useFocusTrap`,
 * `useScrollLock`, `dialogStack`, `LAYER`) en vez de registrar sus propios
 * listeners: esos primitivos nacieron de dos defectos reales —ESC cerrando dos
 * diálogos a la vez y focus traps peleándose— y volver a escribirlos aquí sería
 * reintroducirlos.
 */

export type AccionAgente = 'aplicar' | 'recordar' | 'descartar'

export interface PanelAgenteProps {
  deteccion: Deteccion | null
  onCerrar: () => void
  onAccion?: (id: string, accion: AccionAgente) => void
}

const pesos = (n: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(n))

export default function PanelAgente({ deteccion, onCerrar, onAccion }: PanelAgenteProps) {
  const abierto = deteccion !== null
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useMemo(() => Symbol('panel-agente'), [])
  // El estado guarda PARA QUÉ detección es. Así abrir otra lo reinicia solo, sin
  // un efecto que llame a setState —que el React Compiler marca como error— y
  // sin arrastrar la pregunta a medias ni el "listo" de la anterior.
  const [borrador, setBorrador] = useState<{ id: string; pregunta: string; resuelta: AccionAgente | null }>(
    { id: '', pregunta: '', resuelta: null },
  )

  useScrollLock(abierto, true, panelRef)
  useFocusTrap(abierto, panelRef, { initialFocus: 'first-input', isActive: () => isTopDialog(id) })

  useEffect(() => {
    if (!abierto) return
    pushDialog(id)
    return () => popDialog(id)
  }, [abierto, id])

  // ESC sólo lo atiende el panel que está hasta arriba de la pila.
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopDialog(id)) onCerrar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [abierto, id, onCerrar])

  if (!deteccion) return null

  const vigente = borrador.id === deteccion.id
  const pregunta = vigente ? borrador.pregunta : ''
  const resuelta = vigente ? borrador.resuelta : null

  const negativo = (deteccion.impacto ?? 0) < 0

  function accionar(a: AccionAgente) {
    setBorrador({ id: deteccion!.id, pregunta: '', resuelta: a })
    onAccion?.(deteccion!.id, a)
  }

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
        aria-label={`${deteccion.agente}: ${deteccion.linea}`}
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
            <h2 className="text-[16px] font-bold tracking-[-0.015em] text-[var(--text-1)]">{deteccion.agente}</h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{deteccion.agenteQueHace}</p>
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
            style={{
              background: 'var(--surface-2)',
              borderLeftColor: deteccion.severidad === 'alta' ? 'var(--crit)' : deteccion.severidad === 'media' ? 'var(--warn)' : 'var(--accent)',
            }}
          >
            <p className="text-[14px] leading-[1.5] text-[var(--text-1)]">
              <span className="font-bold">{deteccion.verbo}:</span> {deteccion.linea}.
            </p>
          </div>

          {/* 2 — el impacto */}
          {deteccion.impacto !== null && deteccion.impacto !== 0 && (
            <div className="mt-4 flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
                Impacto estimado
              </span>
              <span
                className="text-[19px] font-bold tnum"
                style={{ color: negativo ? 'var(--crit-ink)' : 'var(--ok-ink)' }}
              >
                {negativo ? '−' : '+'}{pesos(deteccion.impacto)}
                {deteccion.impactoNota && (
                  <span className="ml-1 text-[12px] font-medium text-[var(--text-4)]">{deteccion.impactoNota}</span>
                )}
              </span>
            </div>
          )}

          {/* 3 — qué analizó */}
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Qué analizó</p>
          <ul className="mt-2 space-y-1.5">
            {deteccion.queAnalizo.map((q, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-[1.5] text-[var(--text-2)]">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>{q}</span>
              </li>
            ))}
          </ul>

          {/* 4 — la evidencia */}
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Evidencia</p>
          <div className="mt-2">
            <GraficaEvidencia puntos={deteccion.evidencia} />
            <p className="mt-1.5 text-[11.5px] text-[var(--text-4)]">{deteccion.evidenciaNota}</p>
          </div>

          {/* 5 — la recomendación */}
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">Qué haría yo</p>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--text-2)]">{deteccion.recomendacion}</p>

          {resuelta ? (
            <p
              className="mt-4 rounded-[12px] border px-3.5 py-2.5 text-[13px]"
              style={{ background: 'var(--ok-soft)', borderColor: 'var(--ok-soft)', color: 'var(--ok-ink)' }}
              role="status"
            >
              {resuelta === 'aplicar' && 'Listo, queda anotado como atendido.'}
              {resuelta === 'recordar' && 'Va, te lo recuerdo mañana.'}
              {resuelta === 'descartar' && 'Entendido, no te lo vuelvo a sacar.'}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => accionar('aplicar')}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', color: 'var(--on-accent, #06120d)' }}
              >
                <Check size={14} /> Ya lo atendí
              </button>
              <button
                onClick={() => accionar('recordar')}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-3.5 py-2 text-[13px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <Clock size={14} /> Recuérdamelo
              </button>
              <button
                onClick={() => accionar('descartar')}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-3.5 py-2 text-[13px] font-semibold text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <Trash2 size={14} /> No aplica
              </button>
            </div>
          )}
        </div>

        {/* 6 — preguntarle */}
        <form
          className="border-t border-[var(--line)] px-5 py-3"
          onSubmit={e => {
            e.preventDefault()
            // Todavía no hay conversación de verdad. Se dice, en vez de fingir
            // que se mandó: un chat que traga la pregunta en silencio es peor
            // que no tener chat.
            setBorrador({ id: deteccion.id, pregunta: '', resuelta })
          }}
        >
          <label htmlFor="pregunta-agente" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
            Pregúntale
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="pregunta-agente"
              value={pregunta}
              onChange={e => setBorrador({ id: deteccion.id, pregunta: e.target.value, resuelta })}
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
