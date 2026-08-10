// BUG-019-C — server-side turno resolution for QR-draft adoption.
//
// A public QR order is born server-side as a draft: status='abierta', id 'qr-<hex>',
// turno_id=NULL (the narrowest exception allowed by pos_orders_turno_id_check). It has
// NO operational effects. On the FIRST authenticated staff action that transitions it out
// of 'abierta' (enviar/cobrar/imprimir/afectar inventario), the server MUST obtain the
// turno_id from the caller's own session — server-side — and assign it atomically in the
// same save. A client-supplied turno_id is NEVER trusted for a QR draft: the browser
// controls nothing authoritative (same principle as createPublicOrder). Without an open
// turno for the tenant, the transition is refused, so an order can never be sent, charged
// or printed off the books.

/** A server-owned QR draft id is namespaced 'qr-'. Real POS orders are uuids. */
export function isQrDraftId(orderId: string): boolean {
  return typeof orderId === 'string' && orderId.startsWith('qr-')
}

/**
 * Resolve the OPEN turno for `clientId` from the server, preferring the one the caller
 * opened. Returns the turno id, or null if the tenant has no open turno (→ caller must
 * refuse the transition). Reads with the service key server-side; never trusts the client.
 */
export async function resolveOpenTurnoId(
  sbUrl: string,
  sbKey: string,
  clientId: string,
  staffId?: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const ecid = encodeURIComponent(clientId)
  const res = await fetchFn(
    `${sbUrl}/rest/v1/pos_turnos?client_id=eq.${ecid}&closed_at=is.null&select=id,opened_by,opened_at&order=opened_at.desc`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' as RequestCache },
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Array<{ id: string; opened_by: string }>
  if (!Array.isArray(rows) || rows.length === 0) return null
  // Prefer the turno the caller opened; otherwise the tenant's most-recent open turno.
  const own = staffId ? rows.find(r => r.opened_by === staffId) : undefined
  return (own ?? rows[0]).id ?? null
}
