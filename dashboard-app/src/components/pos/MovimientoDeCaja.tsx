'use client'
import { useRef, useState } from 'react'
import { registrarMovimientoCaja } from '@/lib/pedro-turnos'
import { autorizarOperacionConHuellaEnCaja, autorizarOperacionConPinEnCaja, type SesionDeCaja } from '@/lib/pedro-actor'
import { centavosDeTexto, pesosDeCentavos } from '@/lib/pedro-finanzas'
import AutorizacionPinOHuella from './AutorizacionPinOHuella'
import { useEstadoHuellaCaja } from './useEstadoHuellaCaja'

export default function MovimientoDeCaja({ turnoId }: { turnoId: string }) {
  const [type, setType] = useState<'retiro' | 'deposito'>('retiro')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const huella = useEstadoHuellaCaja()
  const submit = async (actor: SesionDeCaja) => {
    if (running.current) return
    running.current = true; setBusy(true); setMessage('')
    try {
      const cents = centavosDeTexto(amount)
      if (!cents || !reason.trim()) throw new Error('Indica un importe positivo y el motivo.')
      const { movement, recovered } = await registrarMovimientoCaja(turnoId, type, cents, reason.trim(), actor)
      setPin('')
      setMessage(`${recovered ? 'Se recuperó el movimiento anterior' : 'Movimiento confirmado'}: ${movement.type} de ${pesosDeCentavos(movement.amount_cents)}. ${movement.reason}`)
      // A recovered receipt belongs to the earlier immutable intent. Do not erase
      // newly typed values or silently submit them as another cash movement.
      if (!recovered) { setAmount(''); setReason('') }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Movimiento sin confirmar') }
    finally { running.current = false; setBusy(false) }
  }
  const field = 'mt-2 min-h-[56px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3'
  return <section aria-label="Movimientos de efectivo" className="flex h-full flex-col rounded-2xl border border-[var(--line)] p-4">
    <div><h2 className="text-xl font-semibold">Retiro o depósito</h2>
      <p className="mt-1 text-sm text-[var(--text-3)]">Se registra en el turno y se incluye en el efectivo esperado. Requiere autorización.</p></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="block font-medium">Tipo de movimiento<select aria-label="Tipo de movimiento" disabled={busy} value={type} onChange={e => setType(e.target.value as typeof type)} className={field}><option value="retiro">Retiro</option><option value="deposito">Depósito</option></select></label>
      <label className="block font-medium">Importe del movimiento<input disabled={busy} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={field} /></label>
      <label className="block font-medium md:col-span-2">Motivo del movimiento<input disabled={busy} value={reason} onChange={e => setReason(e.target.value)} className={field} /></label>
    </div>
    {message && <p role="status" className="mt-3 rounded-xl bg-[var(--line)]/40 p-3 text-sm">{message}</p>}
    <div className="mt-auto pt-3"><AutorizacionPinOHuella label="Autorizar y confirmar movimiento" pin={pin} onPinChange={setPin}
      onPin={autorizarOperacionConPinEnCaja} onHuella={autorizarOperacionConHuellaEnCaja} onAuthorized={submit}
      huellaDisponible={huella.disponible} motivoHuellaNoDisponible={huella.motivo} disabled={busy || !amount || !reason.trim()} /></div>
  </section>
}
