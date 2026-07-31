/**
 * MP Point payment recovery state machine.
 *
 * Gap being closed: MP Point can mark a payment FINISHED (money captured at bank) while
 * Fullsite's handlePayment() fails before persisting to DB. Without this module, the
 * discrepancy is silent — money taken, no Fullsite record.
 *
 * States and valid transitions:
 *
 *   MP_STARTED ──► MP_APPROVED ──► FULLSITE_PENDING ──► FULLSITE_RECORDED (→ cleared)
 *                                          │
 *                                          ▼
 *                               RECONCILIATION_REQUIRED ──► RECONCILED (→ cleared)
 *                                          │
 *                                          ▼
 *                                  FAILED_MANUAL_REVIEW (operator resolves in MP/Wansoft)
 *
 * Persistence contract:
 * - MP_APPROVED is persisted to localStorage the moment MP confirms. If the app exits
 *   between MP_APPROVED and FULLSITE_RECORDED, it surfaces as RECONCILIATION_REQUIRED
 *   on the next mount so the operator can retry.
 * - opId is generated ONCE at MP_APPROVED and never changes. Every retry reuses it,
 *   making saveOrder idempotent at the DB level (save_operation_id deduplication).
 */

export type MpPaymentState =
  | 'MP_STARTED'
  | 'MP_APPROVED'
  | 'FULLSITE_PENDING'
  | 'FULLSITE_RECORDED'
  | 'RECONCILIATION_REQUIRED'
  | 'RECONCILED'
  | 'FAILED_MANUAL_REVIEW'

export interface MpPaymentRecovery {
  state: MpPaymentState
  intentId: string
  orderId: string
  /** Generated ONCE at MP_APPROVED. Reused on every retry for idempotent DB write. */
  opId: string
  amount: number
  mesa: number
  mesero: string
  timestamp: string // ISO 8601
  error?: string
}

const key = (mesa: number) => `mp_recovery_${mesa}`

/**
 * Load a recovery record that requires operator attention.
 * MP_APPROVED found on mount = app exited after MP captured but before Fullsite confirmed.
 * That is treated the same as RECONCILIATION_REQUIRED.
 */
export function loadMpRecovery(mesa: number): MpPaymentRecovery | null {
  try {
    const raw = localStorage.getItem(key(mesa))
    if (!raw) return null
    const r = JSON.parse(raw) as MpPaymentRecovery
    if (
      r.state === 'MP_APPROVED' ||
      r.state === 'RECONCILIATION_REQUIRED' ||
      r.state === 'FAILED_MANUAL_REVIEW'
    ) return r
    return null
  } catch {
    return null
  }
}

export function persistMpRecovery(r: MpPaymentRecovery): void {
  try { localStorage.setItem(key(r.mesa), JSON.stringify(r)) } catch {}
}

export function clearMpRecovery(mesa: number): void {
  try { localStorage.removeItem(key(mesa)) } catch {}
}

/** True when the record requires operator interaction to resolve. */
export function needsOperatorAttention(r: MpPaymentRecovery | null): boolean {
  if (!r) return false
  return (
    r.state === 'MP_APPROVED' ||
    r.state === 'RECONCILIATION_REQUIRED' ||
    r.state === 'FAILED_MANUAL_REVIEW'
  )
}
