/**
 * Operation Recovery Framework — thin base for flows where an external system
 * captures state BEFORE Fullsite confirms it internally.
 *
 * The invariant: "External party acted → internal record must follow.
 * If internal write fails, recovery is required before any new operation."
 *
 * ─── Belongs here ─────────────────────────────────────────────────────────
 *   ✓ API-integrated payment terminals: MP Point, Clip, Stripe, Getnet API
 *     → Terminal captures funds → Fullsite must record the order.
 *     → If Fullsite write fails, money is taken without record.
 *     → Requires: stable opId, pre-call persistence, blocked state on mount.
 *
 * ─── Does NOT belong here ─────────────────────────────────────────────────
 *   ✗ Print (127.0.0.1:7717 bridge): printer produces paper, captures no state.
 *     Double-print is acceptable. A retry button is sufficient.
 *
 *   ✗ Offline sync / Replay Engine (pos-offline-db.ts): already has dedicated
 *     IndexedDB queue with TRANSIENT_RETRYABLE / STALE_WRITE_CONFLICT /
 *     TERMINAL_NON_RETRYABLE classification. Adding this framework on top
 *     would be over-engineering.
 *
 *   ✗ Turno apertura/cierre: server generates turnoId before client confirms.
 *     Fix: client-generated opId passed as idempotency key to the API (ON CONFLICT
 *     DO NOTHING). The offline queue handles the network gap. No state machine needed.
 *
 *   ✗ Movimientos de caja: same as turno — server-side idempotency key is sufficient.
 *     The offline queue handles network failures.
 *
 *   ✗ Terminal fingerprint: upsert on device_id — naturally idempotent, no gap.
 *
 *   ✗ Getnet standalone: no API integration, no programmatic capture. Manual confirm.
 *
 * ─── Wansoft benchmark ────────────────────────────────────────────────────
 *   Wansoft avoids these gaps by writing to local SQL Server (atomic, LAN-only).
 *   Fullsite introduces asymmetry only when integrating with external payment APIs.
 *   This framework closes that specific gap. For everything else, match Wansoft's
 *   reliability through LAN-first architecture and the existing offline queue.
 *
 * ─── The three shared primitives ──────────────────────────────────────────
 *   1. Pre-call persistence: write a record in localStorage BEFORE the external call.
 *      If the process exits between external capture and internal confirmation,
 *      the record surfaces on next mount for operator resolution.
 *
 *   2. Stable opId: generated ONCE at external confirmation, reused on every retry.
 *      The internal write must accept this as an idempotency key.
 *
 *   3. Blocked state surface: on mount, load records that need operator attention.
 *      Block new operations on the same resource until resolved.
 */

export interface RecoverableOperation<TState extends string> {
  /**
   * Idempotency key — generated ONCE when the external system confirms capture.
   * Never changes across retries. Passed to the internal write (e.g. saveOrder)
   * as save_operation_id to guarantee exactly-once semantics at the DB level.
   */
  opId: string
  state: TState
  /** Internal reference — which Fullsite order this recovery belongs to. */
  orderId: string
  /** Amount in domain units (MXN pesos, not cents). */
  amount: number
  mesa: number
  mesero: string
  /** ISO 8601 — when the external system confirmed capture. */
  timestamp: string
  error?: string
}

export function loadRecoverableOp<T extends RecoverableOperation<string>>(
  storageKey: string,
  attentionStates: readonly string[]
): T | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const r = JSON.parse(raw) as T
    if (attentionStates.includes(r.state)) return r
    return null
  } catch {
    return null
  }
}

export function persistRecoverableOp<T extends RecoverableOperation<string>>(
  storageKey: string,
  op: T
): void {
  try { localStorage.setItem(storageKey, JSON.stringify(op)) } catch {}
}

export function clearRecoverableOp(storageKey: string): void {
  try { localStorage.removeItem(storageKey) } catch {}
}
