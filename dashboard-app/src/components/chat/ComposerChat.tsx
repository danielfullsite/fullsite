'use client'

// Barra de escritura del chat, estilo ChatGPT:
//   [ input ............ ] [🎤 nota de voz] [ enviar | modo voz ]
// Con texto escrito el botón redondo es "Enviar"; vacío, es "Habla con tu restaurante".
// Mientras graba una nota, la barra se vuelve: [descartar] ● 0:07 ▁▃▅ [terminar].

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { AudioLines, Loader2, Mic, Send, Square, X } from 'lucide-react'
import { useGrabadora } from '@/hooks/useGrabadora'
import { formatoDuracion } from '@/lib/voz/audio'
import { prepararModoVozEnGesto } from '@/hooks/useModoVoz'

interface Props {
  valor: string
  setValor: Dispatch<SetStateAction<string>>
  alEnviar: (texto: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  cargando: boolean
  alAbrirModoVoz: () => void
}

const BARRAS = 18

export default function ComposerChat({ valor, setValor, alEnviar, inputRef, cargando, alAbrirModoVoz }: Props) {
  const alTexto = useCallback((texto: string) => {
    setValor(prev => {
      const base = prev.trimEnd()
      return base ? `${base} ${texto}` : texto
    })
    // Después de pintar el texto: foco al final para revisarlo/editarlo.
    setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const fin = el.value.length
      try { el.setSelectionRange(fin, fin) } catch { /* */ }
    }, 0)
  }, [inputRef, setValor])

  const nota = useGrabadora({ alTexto })
  const grabando = nota.estado === 'grabando' || nota.estado === 'pidiendo'
  const transcribiendo = nota.estado === 'transcribiendo'
  const hayTexto = valor.trim().length > 0

  const abrirModoVoz = () => {
    prepararModoVozEnGesto() // dentro del toque: iOS
    alAbrirModoVoz()
  }

  return (
    <div className="shrink-0 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[var(--line)]/60 bg-[var(--surface)]">
      {nota.error && (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--text-1)]">
          <span className="flex-1">{nota.error}</span>
          <button type="button" onClick={nota.limpiarError} aria-label="Cerrar aviso" className="shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X size={14} />
          </button>
        </div>
      )}

      {grabando ? (
        <div className="flex items-center gap-2" aria-live="polite">
          <button
            type="button"
            onClick={nota.cancelar}
            aria-label="Descartar nota de voz"
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[var(--text-2)] hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-2 h-10 rounded-full bg-[var(--surface-2)] border border-[var(--line)] px-3">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
            <span className="text-xs tabular-nums text-[var(--text-2)] shrink-0" aria-label={`Grabando, ${nota.segundos} segundos`}>
              {nota.estado === 'pidiendo' ? 'Micrófono…' : formatoDuracion(nota.segundos)}
            </span>
            <div className="flex-1 min-w-0 flex items-center justify-end gap-[3px] h-6 overflow-hidden" aria-hidden="true">
              {Array.from({ length: BARRAS }, (_, i) => {
                // Barras centrales más altas; todas escalan con el nivel del micrófono.
                const forma = 0.35 + 0.65 * Math.sin(((i + 1) / (BARRAS + 1)) * Math.PI)
                const alto = Math.max(3, Math.round(24 * nota.nivel * forma))
                return <span key={i} className="w-[3px] rounded-full bg-emerald-500 transition-[height] duration-100 motion-reduce:transition-none" style={{ height: alto }} />
              })}
            </div>
            <span className="sr-only">Máximo {Math.round(nota.maxSegundos / 60)} minutos</span>
          </div>
          <button
            type="button"
            onClick={nota.detener}
            disabled={nota.estado === 'pidiendo'}
            aria-label="Terminar y transcribir nota de voz"
            className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 hover:bg-emerald-600 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <Square size={14} fill="currentColor" />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); alEnviar(valor) }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                alEnviar(valor)
              }
            }}
            placeholder={transcribiendo ? 'Transcribiendo…' : 'Escribe tu pregunta...'}
            aria-label="Escribe tu pregunta"
            className="flex-1 min-w-0 text-sm bg-[var(--surface-2)] border border-[var(--line)] rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all text-[var(--text-1)] placeholder:text-[var(--text-3)]"
            disabled={cargando}
          />
          <button
            type="button"
            onClick={transcribiendo ? nota.cancelar : () => { void nota.iniciar() }}
            disabled={cargando && !transcribiendo}
            aria-label={transcribiendo ? 'Transcribiendo nota de voz, toca para cancelar' : 'Dictar nota de voz'}
            title={transcribiendo ? 'Transcribiendo…' : 'Dictar'}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            {transcribiendo
              ? <Loader2 size={18} className="motion-safe:animate-spin" />
              : <Mic size={18} />}
          </button>
          {hayTexto ? (
            <button
              type="submit"
              disabled={cargando}
              aria-label="Enviar mensaje"
              className="w-10 h-10 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 transition-all disabled:opacity-30 shadow-sm flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <Send size={16} className="-ml-0.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={abrirModoVoz}
              disabled={cargando || transcribiendo}
              aria-label="Habla con tu restaurante (modo voz)"
              title="Habla con tu restaurante"
              className="w-10 h-10 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center shrink-0 shadow-sm hover:opacity-85 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <AudioLines size={18} />
            </button>
          )}
        </form>
      )}
    </div>
  )
}
