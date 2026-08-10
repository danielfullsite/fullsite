// BUG-019-C — server-side turno resolution for QR-draft adoption.
//
// A public QR order is born server-side as a draft: status='abierta', id 'qr-<hex>',
// turno_id=NULL (the narrowest exception allowed by pos_orders_turno_id_check). It has
// NO operational effects. On the FIRST authenticated staff action that transitions it out
// of 'abierta' (enviar/cobrar/imprimir/afectar inventario), the server MUST obtain the
// turno_id from the caller's own session — server-side — and assign it atomically in the
// same save. A client-supplied turno_id is NEVER trusted for a QR draft.
//
// FAIL-CLOSED (sub-case 8): the DB does not guarantee a single open turno per restaurant
// (pos_turnos has no partial-unique on client_id WHERE closed_at IS NULL). So when more
// than one eligible open turno exists and the server cannot unambiguously identify the
// caller's, it REFUSES rather than silently pick one — a wrong turno corrupts the corte.

/** A server-owned QR draft id is namespaced 'qr-'. Real POS orders are uuids. */
export function isQrDraftId(orderId: string): boolean {
  return typeof orderId === 'string' && orderId.startsWith('qr-')
}

export type TurnoResolution =
  | { ok: true; turnoId: string }
  | { ok: false; reason: 'none' | 'ambiguous' | 'error' }

/**
 * Resolve the caller's OPEN turno for `clientId`, server-side, fail-closed:
 *  - exactly one turno opened by the caller → use it (their session's turno);
 *  - caller opened none but the tenant has exactly one open turno → use it;
 *  - caller opened more than one, OR ≥2 open turnos none of which is the caller's → 'ambiguous';
 *  - no open turno → 'none'; read failure → 'error'.
 * Reads with the service key server-side; never trusts the client.
 */
export async function resolveOpenTurno(
  sbUrl: string,
  key: string | { apikey: string; token: string },
  clientId: string,
  staffId?: string,
  fetchFn: typeof fetch = fetch,
): Promise<TurnoResolution> {
  // Accept a single key (legacy service_role) OR distinct {apikey, token} so DB reads
  // can run under the caller's Supabase JWT (RLS-scoped) with the anon apikey.
  const apikey = typeof key === 'string' ? key : key.apikey
  const token = typeof key === 'string' ? key : key.token
  const ecid = encodeURIComponent(clientId)
  let rows: Array<{ id: string; opened_by: string }>
  try {
    const res = await fetchFn(
      `${sbUrl}/rest/v1/pos_turnos?client_id=eq.${ecid}&closed_at=is.null&select=id,opened_by,opened_at&order=opened_at.desc`,
      { headers: { apikey, Authorization: `Bearer ${token}` }, cache: 'no-store' as RequestCache },
    )
    if (!res.ok) return { ok: false, reason: 'error' }
    const j = await res.json().catch(() => null)
    if (!Array.isArray(j)) return { ok: false, reason: 'error' }
    rows = j as Array<{ id: string; opened_by: string }>
  } catch {
    return { ok: false, reason: 'error' }
  }
  if (rows.length === 0) return { ok: false, reason: 'none' }
  if (staffId) {
    const own = rows.filter(r => r.opened_by === staffId)
    if (own.length === 1) return { ok: true, turnoId: own[0].id }
    if (own.length > 1) return { ok: false, reason: 'ambiguous' }
  }
  // Caller opened no turno of their own: only safe if the restaurant has exactly one open.
  if (rows.length === 1) return { ok: true, turnoId: rows[0].id }
  return { ok: false, reason: 'ambiguous' }
}
