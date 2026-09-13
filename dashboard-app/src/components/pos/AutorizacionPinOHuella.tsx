'use client'

import { useId, useRef, useState, type FormEvent } from 'react'

export interface AutorizacionPinOHuellaProps<Resultado extends object> {
  label?: string
  pin: string
  onPinChange: (pin: string) => void
  onPin: (pin: string) => Promise<Resultado>
  onHuella: () => Promise<Resultado>
  onAuthorized: (resultado: Resultado) => void | Promise<void>
  huellaDisponible: boolean
  motivoHuellaNoDisponible?: string
  pinLabel?: string
  pinButtonLabel?: string
  huellaButtonLabel?: string
  disabled?: boolean
  minPinLength?: number
  maxPinLength?: number
}

/**
 * Selector táctil de un medio de autorización. La confianza pertenece al
 * adaptador que recibe cada callback: este componente no lee credenciales,
 * roles, localStorage ni ejecuta la operación que se está autorizando.
 */
export default function AutorizacionPinOHuella<Resultado extends object>({
  label = 'Autorización requerida',
  pin,
  onPinChange,
  onPin,
  onHuella,
  onAuthorized,
  huellaDisponible,
  motivoHuellaNoDisponible = 'No hay un lector o una huella disponible en esta terminal.',
  pinLabel = 'PIN de autorización',
  pinButtonLabel = 'Autorizar con PIN',
  huellaButtonLabel = 'Autorizar con huella',
  disabled = false,
  minPinLength = 4,
  maxPinLength = 10,
}: AutorizacionPinOHuellaProps<Resultado>) {
  const id = useId()
  const running = useRef(false)
  const [busy, setBusy] = useState<'pin' | 'huella' | null>(null)
  const [error, setError] = useState('')
  const blocked = disabled || busy !== null

  const autorizar = async (metodo: 'pin' | 'huella') => {
    if (running.current || disabled || (metodo === 'huella' && !huellaDisponible)) return
    running.current = true
    setBusy(metodo)
    setError('')
    try {
      const resultado = metodo === 'pin' ? await onPin(pin) : await onHuella()
      await onAuthorized(resultado)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la autorización.')
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pin.length >= minPinLength) void autorizar('pin')
  }

  return <section role="group" aria-label={label} className="rounded-2xl border border-[var(--line)] p-4">
    <p className="font-bold text-[var(--text-1)]">{label}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <button type="button" disabled={blocked || !huellaDisponible} aria-describedby={!huellaDisponible ? `${id}-huella-motivo` : undefined}
        onClick={() => void autorizar('huella')}
        className="min-h-[56px] rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-3 font-bold text-white disabled:border-[var(--line)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)] disabled:opacity-70">
        {busy === 'huella' ? 'Esperando huella…' : huellaButtonLabel}
      </button>

      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="sr-only" htmlFor={`${id}-pin`}>{pinLabel}</label>
        <input id={`${id}-pin`} type="password" inputMode="numeric" autoComplete="off" minLength={minPinLength} maxLength={maxPinLength}
          disabled={blocked} value={pin}
          onChange={event => onPinChange(event.target.value.replace(/\D/g, '').slice(0, maxPinLength))}
          className="min-h-[56px] min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-center text-xl tracking-[0.35em] text-[var(--text-1)]"
          placeholder="PIN" />
        <button type="submit" disabled={blocked || pin.length < minPinLength}
          className="min-h-[56px] rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)] disabled:opacity-70">
          {busy === 'pin' ? 'Autorizando…' : pinButtonLabel}
        </button>
      </form>
    </div>

    {!huellaDisponible && <p id={`${id}-huella-motivo`} className="mt-2 text-sm text-[var(--text-3)]">Huella no disponible: {motivoHuellaNoDisponible}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-[var(--crit-ink)]">{error}</p>}
  </section>
}
