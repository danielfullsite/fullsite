'use client'

// Pantalla del modo voz ("Habla con tu restaurante"), encima del chat.
// Estados visibles: Escuchando / Pensando / Hablando. El círculo grande interrumpe
// mientras habla o piensa; la X termina la conversación. Lo dicho queda en el chat
// como texto (lo agrega ChatWidget con alPreguntar / alResponder).

import { useEffect, useRef } from 'react'
import { AudioLines, Loader2, Mic, X } from 'lucide-react'
import { useModoVoz, type FaseVoz } from '@/hooks/useModoVoz'

/** Subtítulo de la respuesta: sin bloques de gráfica ni asteriscos (el detalle queda en el chat). */
function subtitulo(texto: string): string {
  return texto.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
}

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
  error: 'En pausa',
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

  const { fase, nivel, usuarioHablando, error, ultimaPregunta, ultimaRespuesta } = voz
  const interrumpible = fase === 'hablando' || fase === 'pensando'
  const escala = fase === 'escuchando' ? 1 + nivel * 0.35 : 1

  const pista =
    fase === 'escuchando' ? (usuarioHablando ? 'Te escucho…' : 'Pregunta lo que quieras. Cuando hagas una pausa, te respondo.')
      : fase === 'pensando' ? 'Toca el círculo para cancelar.'
        : fase === 'hablando' ? 'Toca el círculo para interrumpir.'
          : fase === 'preparando' ? 'Midiendo el ruido del lugar…'
            : ''

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

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <button
          type="button"
          onClick={interrumpible ? voz.interrumpir : undefined}
          aria-disabled={!interrumpible}
          aria-label={fase === 'hablando' ? 'Interrumpir respuesta' : fase === 'pensando' ? 'Cancelar pregunta' : ETIQUETA[fase]}
          className={`relative w-40 h-40 sm:w-44 sm:h-44 rounded-full flex items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/60 ${interrumpible ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full transition-transform duration-100 motion-reduce:transition-none motion-reduce:!transform-none ${
              fase === 'hablando' ? 'bg-gradient-to-br from-emerald-300 to-emerald-600 motion-safe:animate-pulse'
                : fase === 'pensando' ? 'bg-gradient-to-br from-white/25 to-white/5'
                  : fase === 'error' ? 'bg-white/10'
                    : 'bg-gradient-to-br from-white to-neutral-300'
            }`}
            style={{ transform: `scale(${escala})` }}
          />
          <span className="relative text-neutral-900" aria-hidden="true">
            {fase === 'pensando' || fase === 'preparando'
              ? <Loader2 size={40} className={`motion-safe:animate-spin ${fase === 'pensando' ? 'text-white' : ''}`} />
              : fase === 'hablando' ? <AudioLines size={44} className="text-white" />
                : fase === 'error' ? <Mic size={40} className="text-white/60" />
                  : <Mic size={40} />}
          </span>
        </button>

        <div className="space-y-1 min-h-[3.5rem]">
          <p className="text-lg font-semibold" aria-live="polite">{ETIQUETA[fase]}</p>
          {error
            ? <p role="alert" className="text-sm text-amber-300 max-w-xs">{error}</p>
            : pista && <p className="text-sm text-white/60 max-w-xs">{pista}</p>}
        </div>

        {(ultimaPregunta || ultimaRespuesta) && (
          <div className="w-full max-w-sm space-y-2 text-left text-sm">
            {ultimaPregunta && <p className="text-white/50 line-clamp-2">“{ultimaPregunta}”</p>}
            {ultimaRespuesta && <p className="text-white/85 line-clamp-4">{subtitulo(ultimaRespuesta)}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-4">
        {fase === 'error' && (
          <button
            type="button"
            onClick={voz.reintentar}
            className="h-12 px-5 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Reintentar
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
