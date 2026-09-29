'use client'

// Pantalla del modo voz ("Habla con tu restaurante"), encima del chat.
// Estados visibles: Escuchando ("Te escucho…", siempre presente) / Pensando / Hablando
// (la frase que suena, resaltada) / En pausa ("¿Seguimos?"). El círculo grande
// interrumpe mientras habla o piensa (con voz natural también se puede interrumpir
// hablando); la X termina la conversación. Lo dicho queda en el chat como texto
// (lo agrega ChatWidget con alPreguntar / alResponder).

import { useEffect, useRef } from 'react'
import { AudioLines, Loader2, Mic, X } from 'lucide-react'
import { useModoVoz, type FaseVoz } from '@/hooks/useModoVoz'
import type { EstadoCargaVoz } from '@/lib/voz/proveedores'

interface Props {
  preguntar: (texto: string, signal: AbortSignal) => Promise<string>
  alPreguntar: (texto: string) => void
  alResponder: (texto: string) => void
  alCerrar: () => void
}

const ETIQUETA: Record<FaseVoz, string> = {
  inactivo: 'Listo',
  preparando: 'Preparando el micrófono…',
  escuchando: 'Escuchando',
  pensando: 'Pensando',
  hablando: 'Hablando',
  pausado: '¿Seguimos?',
  error: 'En pausa',
}

/** "Preparando voz… 42% (solo la primera vez)" mientras baja el modelo; nada si no aplica. */
export function textoCargaVoz(c: EstadoCargaVoz): string | null {
  if (c.estado === 'descargando') {
    const pct = c.total > 0 ? Math.min(99, Math.floor((c.cargado / c.total) * 100)) : 0
    return `Preparando voz… ${pct}% (solo la primera vez)`
  }
  if (c.estado === 'iniciando') return 'Preparando voz…'
  return null
}

export default function ModoVozPanel({ preguntar, alPreguntar, alResponder, alCerrar }: Props) {
  const voz = useModoVoz({ preguntar, alPreguntar, alResponder })
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const { abrir, cerrar } = voz

  // El botón que abrió el panel ya preparó audio y voz dentro del toque; aquí sólo
  // se pide el micrófono y arranca el ciclo.
  useEffect(() => {
    void abrir()
    cerrarRef.current?.focus()
  }, [abrir])

  const terminar = () => { cerrar(); alCerrar() }

  const { fase, nivel, usuarioHablando, error, ultimaPregunta, frases, fraseActual, enVivo, cargaVoz, interrumpePorVoz } = voz
  const interrumpible = fase === 'hablando' || fase === 'pensando'
  const escala = fase === 'escuchando' ? 1 + nivel * 0.35 : 1
  const carga = textoCargaVoz(cargaVoz)
  const pctCarga = cargaVoz.estado === 'descargando' && cargaVoz.total > 0 ? Math.min(100, (cargaVoz.cargado / cargaVoz.total) * 100) : null

  const pista =
    fase === 'escuchando' ? 'Te escucho…'
      : fase === 'pensando' ? 'Toca el círculo para cancelar.'
        : fase === 'hablando' ? (interrumpePorVoz ? 'Habla o toca el círculo para interrumpir.' : 'Toca el círculo para interrumpir.')
          : fase === 'preparando' ? 'Midiendo el ruido del lugar…'
            : fase === 'pausado' ? 'Pausé por silencio. Toca para seguir platicando.'
              : ''

  // Lo que dice el dueño: en vivo mientras habla; la transcripción final después.
  const dicho = fase === 'escuchando' ? (usuarioHablando || enVivo ? enVivo : '') : ultimaPregunta

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Habla con tu restaurante"
      className="absolute inset-0 z-20 flex flex-col bg-neutral-950 text-white pt-[env(safe-area-inset-top)] pb-[max(1rem,env(safe-area-inset-bottom))] animate-widget-in"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <AudioLines size={16} className="text-emerald-400 shrink-0" aria-hidden="true" />
          <h3 className="text-sm font-semibold truncate">Habla con tu restaurante</h3>
        </div>
        <button
          ref={cerrarRef}
          type="button"
          onClick={terminar}
          aria-label="Terminar conversación de voz"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <X size={20} />
        </button>
      </div>

      {carga && (
        <div className="px-6" role="status" aria-live="polite">
          <p className="text-xs text-white/60 text-center">{carga}</p>
          {pctCarga !== null && (
            <div className="mt-1 h-1 w-full max-w-xs mx-auto rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${pctCarga}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <button
          type="button"
          onClick={interrumpible ? voz.interrumpir : fase === 'pausado' ? voz.reintentar : undefined}
          aria-disabled={!interrumpible && fase !== 'pausado'}
          aria-label={fase === 'hablando' ? 'Interrumpir respuesta' : fase === 'pensando' ? 'Cancelar pregunta' : fase === 'pausado' ? 'Seguir conversación' : ETIQUETA[fase]}
          className={`relative w-40 h-40 sm:w-44 sm:h-44 rounded-full flex items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/60 ${interrumpible || fase === 'pausado' ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full transition-transform duration-100 motion-reduce:transition-none motion-reduce:!transform-none ${
              fase === 'hablando' ? 'bg-gradient-to-br from-emerald-300 to-emerald-600 motion-safe:animate-pulse'
                : fase === 'pensando' ? 'bg-gradient-to-br from-white/25 to-white/5'
                  : fase === 'error' || fase === 'pausado' ? 'bg-white/10'
                    : 'bg-gradient-to-br from-white to-neutral-300'
            }`}
            style={{ transform: `scale(${escala})` }}
          />
          <span className="relative text-neutral-900" aria-hidden="true">
            {fase === 'pensando' || fase === 'preparando'
              ? <Loader2 size={40} className={`motion-safe:animate-spin ${fase === 'pensando' ? 'text-white' : ''}`} />
              : fase === 'hablando' ? <AudioLines size={44} className="text-white" />
                : fase === 'error' || fase === 'pausado' ? <Mic size={40} className="text-white/60" />
                  : <Mic size={40} />}
          </span>
        </button>

        <div className="space-y-1 min-h-[3.5rem]">
          <p className="text-lg font-semibold" aria-live="polite">{ETIQUETA[fase]}</p>
          {error
            ? <p role="alert" className="text-sm text-amber-300 max-w-xs">{error}</p>
            : pista && <p className={`text-sm max-w-xs ${fase === 'escuchando' ? 'text-emerald-300/80 motion-safe:animate-pulse' : 'text-white/60'}`}>{pista}</p>}
        </div>

        {(dicho || frases.length > 0) && (
          <div className="w-full max-w-sm space-y-2 text-left text-sm">
            {dicho && <p className="text-white/50 line-clamp-2" data-testid="voz-dicho">“{dicho}”</p>}
            {frases.length > 0 && (
              <p className="line-clamp-5" data-testid="voz-respuesta">
                {frases.map((f, i) => (
                  <span
                    key={i}
                    aria-current={fase === 'hablando' && i === fraseActual ? 'true' : undefined}
                    className={fase !== 'hablando' ? 'text-white/70'
                      : i === fraseActual ? 'text-white font-medium' : i < fraseActual ? 'text-white/60' : 'text-white/35'}
                  >
                    {f}{' '}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-4">
        {(fase === 'error' || fase === 'pausado') && (
          <button
            type="button"
            onClick={voz.reintentar}
            className="h-12 px-5 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {fase === 'pausado' ? 'Seguir' : 'Reintentar'}
          </button>
        )}
        <button
          type="button"
          onClick={terminar}
          aria-label="Terminar conversación de voz y volver al chat"
          className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <X size={24} />
        </button>
      </div>
    </div>
  )
}
