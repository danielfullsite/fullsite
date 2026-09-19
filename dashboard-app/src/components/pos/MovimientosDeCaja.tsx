'use client'
import { useRef, useState } from 'react'
import { registrarMovimientoCaja, type MovimientoDeCaja } from '@/lib/pedro-movimientos'
import { centavosDeTexto, pesosDeCentavos } from '@/lib/pedro-finanzas'

export default function MovimientosDeCaja({ turnoId, connected }: { turnoId: string; connected: boolean }) {
  const [type, setType] = useState<'retiro' | 'deposito'>('retiro')
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<{ movement: MovimientoDeCaja; recovered: boolean } | null>(null)
  const working = useRef(false)
  const submit = async () => {
    if (working.current || !connected) return
    working.current = true; setBusy(true); setError(''); setResult(null)
    try {
      const receipt = await registrarMovimientoCaja(turnoId, type, centavosDeTexto(amount), reason, pin)
      setResult(receipt)
      if (!receipt.recovered) { setAmount(''); setReason('') }
    } catch (e) { setError(e instanceof Error ? e.message : 'Caja no confirmó el movimiento.') }
    finally { setPin(''); working.current = false; setBusy(false) }
  }
  const field = 'mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3'
  return <details className="my-5 rounded-2xl border border-[var(--line)] p-5">
    <summary className="cursor-pointer text-lg font-bold">Depósitos y retiros de efectivo</summary>
    <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void submit() }}>
      <p>Registra sólo el efectivo que verificaste físicamente. Un encargado autoriza cada movimiento; se incluye en el corte.</p>
      <label className="block">Tipo de movimiento<select aria-label="Tipo de movimiento" className={field} value={type} onChange={e => setType(e.target.value as 'retiro' | 'deposito')} disabled={busy}>
        <option value="retiro">Retiro de efectivo</option><option value="deposito">Depósito de efectivo</option>
      </select></label>
      <label className="block">Importe del movimiento<input aria-label="Importe del movimiento" className={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} /></label>
      <label className="block">Motivo del movimiento<input aria-label="Motivo del movimiento" className={field} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
      <label className="block">PIN del encargado<input aria-label="PIN para movimiento" className={field} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} disabled={busy} /></label>
      <button className="min-h-[48px] w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-40" disabled={busy || !connected || !amount || !reason.trim() || !pin}>
        {busy ? 'Confirmando con Caja…' : 'Registrar movimiento verificado'}
      </button>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {result && <p role="status">{result.recovered ? 'Recuperamos el movimiento anterior; revisa este recibo antes de registrar otro.' : 'Movimiento confirmado en Caja.'} {result.movement.type === 'retiro' ? 'Retiro' : 'Depósito'} de {pesosDeCentavos(result.movement.amount_cents)} · {result.movement.reason} · Folio {result.movement.movement_id}</p>}
    </form>
  </details>
}
