'use client'
import { useEffect, useState } from 'react'
import { getActiveClientSlug } from '@/lib/data'
import { recordMovement, confirmarMovimientoInventario } from '@/lib/inventory'
import { INVENTORY_PENDING_EVENT, readPendingMovement, resolvePendingMovement, type PendingMovement } from '@/lib/inventory-pending'

/**
 * El servidor ya demostro que ESTA request nunca aplicara tal cual: la llave
 * pertenece a otro movimiento, o la capturo el sistema viejo. Reintentarla da lo
 * mismo, y mientras tanto bloquea toda captura de inventario del dispositivo
 * (barrido 2026-09-10, inventario LENTE-4). No se olvida sola —una persona
 * decide— pero se le ofrece la salida.
 */
const SIN_SALIDA_AUTOMATICA = ['MOVEMENT_KEY_REUSED', 'LEGACY_MOVEMENT_REQUIRES_RECONCILIATION']
export function requiereDecisionHumana(errores: string[]): boolean {
  return errores.some(e => SIN_SALIDA_AUTOMATICA.some(codigo => e.includes(codigo)))
}

/** Recovery is available even when a reload emptied the input form. It sends
 * the stored request, never a newly calculated physical-count delta. */
export default function PendingMovementRecovery() {
  const clientId = getActiveClientSlug()
  const [pending, setPending] = useState<PendingMovement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sinSalida, setSinSalida] = useState(false)
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
      } else { setError(result.errors.join(', ')); setSinSalida(requiereDecisionHumana(result.errors)); setBusy(false) }
    } catch { setError('No se pudo finalizar la recuperación. Reintenta el mismo guardado.'); setBusy(false) }
  }
  const descartar = async () => {
    if (!pending || busy) return
    if (!window.confirm('Este guardado no se puede aplicar: la llave ya pertenece a otro movimiento. ¿Descartarlo? Las cantidades NO se registrarán; captúralas de nuevo si hacen falta.')) return
    setBusy(true); setError('')
    try { await resolvePendingMovement(pending.request); window.location.reload() }
    catch { setError('No se pudo descartar el guardado pendiente.'); setBusy(false) }
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
      {sinSalida ? (
        <button type="button" disabled={busy} onClick={descartar} data-testid="descartar-pendiente" className="mt-3 ml-2 rounded-lg border border-red-500 px-4 py-2 font-medium text-red-400 disabled:opacity-50">
          Descartar este guardado
        </button>
      ) : null}
    </> : null}
    {error ? <p role="alert" className="mt-2">{error}</p> : null}
  </section>
}
