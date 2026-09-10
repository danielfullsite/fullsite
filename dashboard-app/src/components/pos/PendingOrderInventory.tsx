'use client'
import { useEffect, useState } from 'react'
import { getPOSAuthHeaders } from '@/lib/pos-data'
import { ORDER_INVENTORY_EVENT, readPendingOrderInventory, clearOrderInventoryIfUnchanged } from '@/lib/order-inventory-pending'

export default function PendingOrderInventory({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<ReturnType<typeof readPendingOrderInventory>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const read = () => setRows(readPendingOrderInventory(clientId))
    read(); window.addEventListener(ORDER_INVENTORY_EVENT, read); window.addEventListener('storage', read)
    return () => { window.removeEventListener(ORDER_INVENTORY_EVENT, read); window.removeEventListener('storage', read) }
  }, [clientId])
  const retry = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      for (const row of rows) {
        const response = await fetch('/api/pos/inventory/reconcile', { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() }, body: JSON.stringify({ order_id: row.order_id }), signal: AbortSignal.timeout(20000) })
        const result = await response.json()
        if (!response.ok || result.inventory_pending !== false || result.inventory_status !== 'COMPLETE') throw new Error('El inventario sigue pendiente. Revisa la configuración de recetas o reintenta al reconectar.')
        clearOrderInventoryIfUnchanged(clientId, row.order_id, row.revision)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Inventario sin confirmar') }
    finally { setBusy(false) }
  }
  if (!rows.length) return null
  return <aside role="status" className="fixed bottom-3 right-3 z-50 max-w-md rounded-xl border border-amber-500 bg-[var(--surface)] p-4 text-[var(--text-1)] shadow-lg">
    <p>Inventario pendiente de conciliar en {rows.length} cuenta{rows.length === 1 ? '' : 's'}{rows.some(row => row.mesa) ? ` · Mesas ${rows.filter(row => row.mesa).map(row => row.mesa).join(', ')}` : ''}.</p>
    <p className="text-sm">Las ventas y comandas confirmadas se conservan.</p>
    {error && <p role="alert" className="my-2 text-sm">{error}</p>}
    <button disabled={busy} onClick={() => void retry()} className="mt-2 rounded-lg border px-4 py-3 disabled:opacity-50">{busy ? 'Consultando inventario…' : 'Reintentar conciliación'}</button>
  </aside>
}
