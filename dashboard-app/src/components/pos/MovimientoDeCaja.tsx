'use client'
import { useRef, useState } from 'react'
import { registrarMovimientoCaja } from '@/lib/pedro-turnos'
import { autorizarOperacionConPinEnCaja } from '@/lib/pedro-actor'
import { centavosDeTexto, pesosDeCentavos } from '@/lib/pedro-finanzas'

export default function MovimientoDeCaja({ turnoId }: { turnoId: string }) {
  const [type, setType] = useState<'retiro' | 'deposito'>('retiro')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const submit = async () => {
    if (running.current) return
    running.current = true; setBusy(true); setMessage('')
    try {
      const cents = centavosDeTexto(amount)
      if (!cents || !reason.trim()) throw new Error('Indica un importe positivo y el motivo.')
      const actor = await autorizarOperacionConPinEnCaja(pin)
      const { movement, recovered } = await registrarMovimientoCaja(turnoId, type, cents, reason.trim(), actor)
      setPin('')
      setMessage(`${recovered ? 'Se recuperó el movimiento anterior' : 'Movimiento confirmado'}: ${movement.type} de ${pesosDeCentavos(movement.amount_cents)}. ${movement.reason}`)
      // A recovered receipt belongs to the earlier immutable intent. Do not erase
      // newly typed values or silently submit them as another cash movement.
      if (!recovered) { setAmount(''); setReason('') }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Movimiento sin confirmar') }
    finally { running.current = false; setBusy(false) }
  }
  return <section aria-label="Movimientos de efectivo" className="space-y-3 rounded-2xl border border-[var(--line)] p-5">
    <h2 className="text-xl font-semibold">Retiro o depósito</h2>
    <p className="text-sm">Se registra en el turno y se incluye en el efectivo esperado. Requiere autorización.</p>
    <label className="block">Tipo de movimiento<select disabled={busy} value={type} onChange={e => setType(e.target.value as typeof type)} className="ml-2 rounded border bg-[var(--surface)] p-2"><option value="retiro">Retiro</option><option value="deposito">Depósito</option></select></label>
    <label className="block">Importe del movimiento<input disabled={busy} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>
    <label className="block">Motivo del movimiento<input disabled={busy} value={reason} onChange={e => setReason(e.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>
    <label className="block">PIN de autorización<input disabled={busy} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>
    <button disabled={busy || !amount || !reason.trim() || !pin} onClick={() => void submit()} className="rounded-xl bg-blue-600 px-4 py-3 text-white disabled:opacity-40">{busy ? 'Confirmando…' : 'Confirmar movimiento'}</button>
    {message && <p role="status">{message}</p>}
  </section>
}
