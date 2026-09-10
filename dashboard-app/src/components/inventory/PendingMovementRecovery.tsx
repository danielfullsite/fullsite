'use client'
import { useEffect, useState } from 'react'
import { getActiveClientSlug } from '@/lib/data'
import { recordMovement, confirmarMovimientoInventario } from '@/lib/inventory'
import { INVENTORY_PENDING_EVENT, readPendingMovement, type PendingMovement } from '@/lib/inventory-pending'

/** Recovery is available even when a reload emptied the input form. It sends
 * the stored request, never a newly calculated physical-count delta. */
export default function PendingMovementRecovery() {
  const clientId = getActiveClientSlug()
  const [pending, setPending] = useState<PendingMovement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => { readPendingMovement(clientId).then(value => { if (active) setPending(value) }, () => { if (active) setError('No se pudo leer el guardado pendiente de inventario.') }) }
    refresh()
    window.addEventListener(INVENTORY_PENDING_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener(INVENTORY_PENDING_EVENT, refresh); window.removeEventListener('focus', refresh) }
  }, [clientId])
  if (!pending && !error) return null
  const recover = async () => {
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      const result = await recordMovement(pending.request)
      if (result.success) {
        // Fresh balances and a fresh form identity prevent submitting the old
        // physical count again after its receipt has been recovered.
        await confirmarMovimientoInventario(pending.request.client_id, pending.request.idempotency_key)
        window.location.reload()
      } else { setError(result.errors.join(', ')); setBusy(false) }
    } catch { setError('No se pudo finalizar la recuperación. Reintenta el mismo guardado.'); setBusy(false) }
  }
  return <section role="status" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
    {pending ? <>
      <p>Hay un movimiento de inventario pendiente de confirmar ({pending.request.lines.length} renglones). Recupera su resultado antes de guardar otro.</p>
      <p className="mt-1">Se enviarán las cantidades originales y se recargará el formulario con las existencias actuales.</p>
      <details className="mt-2"><summary>Ver cantidades originales</summary>
        <ul className="mt-2 max-h-48 overflow-y-auto">{pending.request.lines.map((line, index) => <li key={index}>{line.ingredient_id}: {line.quantity}{line.notes ? ` — ${line.notes}` : ''}</li>)}</ul>
      </details>
      <button type="button" disabled={busy} onClick={recover} className="mt-3 rounded-lg border border-amber-500 px-4 py-2 font-medium disabled:opacity-50">
        {busy ? 'Recuperando…' : 'Recuperar guardado pendiente'}
      </button>
    </> : null}
    {error ? <p role="alert" className="mt-2">{error}</p> : null}
  </section>
}
