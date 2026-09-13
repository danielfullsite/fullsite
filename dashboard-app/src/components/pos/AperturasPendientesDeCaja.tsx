'use client'
import { useEffect, useRef, useState } from 'react'
import { operacionesPendientesCaja } from '@/lib/pedro-comandos'
import { recuperarCajonCaja } from '@/lib/pedro-cajon'
import { autorizarOperacionConHuellaEnCaja, autorizarOperacionConPinEnCaja, type SesionDeCaja } from '@/lib/pedro-actor'
import AutorizacionPinOHuella from './AutorizacionPinOHuella'
import { useEstadoHuellaCaja } from './useEstadoHuellaCaja'

const pendientes = () => operacionesPendientesCaja().filter(({ command }) =>
  ['PAYMENT_DRAWER_OPEN', 'DRAWER_OPEN', 'DRAWER_UNCERTAIN_RESOLVE'].includes(command.command_type))
/** Survives navigation and a closed shift. Queue disappearance never proves a
 * lost command failed: recover its durable receipt, not a new print request. */
export default function AperturasPendientesDeCaja() {
  const [pending, setPending] = useState<ReturnType<typeof pendientes>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [message, setMessage] = useState('')
  const huella = useEstadoHuellaCaja()
  useEffect(() => {
    const refresh = () => setPending(pendientes())
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('pos:comandos-pendientes', refresh)
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('pos:comandos-pendientes', refresh) }
  }, [])
  const recover = async (operation: string, actor?: SesionDeCaja) => {
    if (working.current) return
    working.current = true; setBusy(true); setMessage('')
    try {
      setPin('')
      await recuperarCajonCaja(operation, actor)
      setSelected(null)
      setMessage('Solicitud original recuperada. No se envió una solicitud nueva. Verifica el cajón; no se confirma su posición física.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Caja no confirmó la solicitud del cajón.') }
    finally { working.current = false; setBusy(false); setPending(pendientes()) }
  }
  if (!pending.length && !message) return null
  return <section aria-label="Solicitudes del cajón pendientes" className="border-b border-amber-700 bg-amber-950 p-4 text-sm text-amber-100">
    {pending.length > 0 && <p>Hay solicitudes del cajón sin confirmar. Recupera el intento original aunque el turno esté cerrado.</p>}
    {pending.map(({ operation, command }) => <button key={operation} disabled={busy} className="mr-2 mt-2 min-h-[56px] rounded border px-3 py-2 disabled:opacity-50"
      onClick={() => command.command_type !== 'PAYMENT_DRAWER_OPEN' ? (setSelected(operation), setPin(''), setMessage('')) : void recover(operation)}>
      Recuperar {command.command_type === 'DRAWER_UNCERTAIN_RESOLVE' ? 'verificación' : command.command_type === 'DRAWER_OPEN' ? 'apertura manual' : 'apertura de abono'} · {String(command.order_id ?? command.job_id ?? command.turno_id).slice(0, 16)}
    </button>)}
    {selected && <div className="mt-3 space-y-3">
      <AutorizacionPinOHuella label="Autorizar recuperación del cajón" pin={pin} onPinChange={setPin}
        pinLabel="PIN para recuperar el cajón" pinButtonLabel="Recuperar solicitud original del cajón"
        huellaButtonLabel="Recuperar solicitud original con huella"
        onPin={autorizarOperacionConPinEnCaja} onHuella={autorizarOperacionConHuellaEnCaja}
        onAuthorized={actor => recover(selected, actor)} huellaDisponible={huella.disponible}
        motivoHuellaNoDisponible={huella.motivo} disabled={busy} />
      <button disabled={busy} className="min-h-[56px] w-full rounded border px-3 py-2 font-semibold disabled:opacity-50" onClick={() => { setSelected(null); setPin('') }}>Cerrar</button>
    </div>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>
}
