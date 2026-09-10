'use client'
import { useEffect, useRef, useState } from 'react'
import { abrirCajonManualCaja, abrirCajonPorPagoCaja, leerAperturasCaja } from '@/lib/pedro-cajon'
import { autorizarOperacionConPinEnCaja } from '@/lib/pedro-actor'

export default function CajonDeCaja({ turnoId, orderId, paymentId }: { turnoId: string; orderId?: string; paymentId?: string }) {
  const [ready, setReady] = useState(!paymentId)
  const [requested, setRequested] = useState(false)
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  useEffect(() => {
    if (!paymentId) return
    let alive = true
    setReady(false); setRequested(false)
    void leerAperturasCaja().then(operations => {
      if (!alive) return
      setRequested(operations.some(operation => operation.kind === 'payment' && operation.order_id === orderId && operation.payment_id === paymentId))
      setReady(true)
    }).catch(error => { if (alive) setMessage(error.message) })
    return () => { alive = false }
  }, [orderId, paymentId])
  const request = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setMessage('')
    try {
      const receipt = paymentId && orderId ? await abrirCajonPorPagoCaja(orderId, paymentId, turnoId)
        : await abrirCajonManualCaja(turnoId, reason, await autorizarOperacionConPinEnCaja(pin))
      setPin(''); setReason('')
      if (paymentId) setRequested(true)
      setMessage(`${receipt.recovered ? 'Solicitud original recuperada' : 'Apertura solicitada'}. Verifica el cajón; la confirmación no acredita su posición física.`)
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Caja no confirmó la apertura.'}${paymentId ? ' El abono confirmado se conserva.' : ''}`) }
    finally { working.current = false; setBusy(false) }
  }
  return <section aria-label={paymentId ? 'Cajón para el abono' : 'Apertura manual del cajón'} className="space-y-2 rounded border p-3 text-sm">
    {paymentId ? <p>{requested ? 'La apertura para este abono ya fue solicitada. Revisa el cajón antes de cualquier otro pulso.' : 'El abono está confirmado. Abrir el cajón es una acción separada.'}</p>
      : <><label className="block">Motivo de apertura<input className="ml-2 rounded border bg-transparent p-2" disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label className="block">PIN para abrir el cajón<input className="ml-2 rounded border bg-transparent p-2" type="password" inputMode="numeric" autoComplete="off" disabled={busy} value={pin} onChange={event => setPin(event.target.value)} /></label></>}
    <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !ready || requested || !turnoId || (!paymentId && (!reason.trim() || !pin))} onClick={() => void request()}>
      {busy ? 'Solicitando apertura…' : paymentId ? 'Solicitar apertura para este abono' : 'Solicitar apertura manual'}</button>
    {!ready && <button className="ml-2 underline" disabled={busy} onClick={() => void leerAperturasCaja().then(operations => {
      setRequested(operations.some(operation => operation.kind === 'payment' && operation.order_id === orderId && operation.payment_id === paymentId)); setReady(true)
    }).catch(error => setMessage(error.message))}>Consultar solicitud en Caja</button>}
    {message && <p role="status">{message}</p>}
  </section>
}
