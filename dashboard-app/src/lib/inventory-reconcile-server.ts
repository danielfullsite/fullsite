/** Server-only reconciliation from committed order rows. Never accept quantities
 * or ingredient targets from a terminal when retrying sale inventory. */
export async function reconciliarInventarioConfirmado(clientId: string, orderId: string) {
  const pending = { inventory_pending: true, inventory_status: 'PENDING' as const }
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return pending
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/r1_reconcile_order`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: clientId, p_order_id: orderId }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return pending
    const rows = await response.json()
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.r_result !== 'string')) return pending
    const complete = rows.every(row => ['RECONCILED', 'NO_MUTATION_APPROVED'].includes(row.r_result))
    return { inventory_pending: !complete,
      inventory_status: complete ? 'COMPLETE' as const : rows.some(row => row.r_result.startsWith('BLOCKED')) ? 'BLOCKED' as const : 'PENDING' as const }
  } catch { return pending }
}
