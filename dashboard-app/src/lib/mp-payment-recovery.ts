/**
 * MP Point payment recovery — first concrete implementation of RecoverableOperation.
 *
 * Extends the base with the MP-specific external reference (intentId) and
 * the full 7-state machine for the payment capture → record gap.
 *
 * For other payment terminals (Clip, Stripe, Getnet API), create a parallel
 * module that extends RecoverableOperation<T> with that terminal's external ID.
 */

import type { RecoverableOperation } from './recoverable-operation'
import {
  loadRecoverableOp,
  persistRecoverableOp,
  clearRecoverableOp,
} from './recoverable-operation'

export type MpPaymentState =
  | 'MP_STARTED'
  | 'MP_APPROVED'
  | 'FULLSITE_PENDING'
  | 'FULLSITE_RECORDED'
  | 'RECONCILIATION_REQUIRED'
  | 'RECONCILED'
  | 'FAILED_MANUAL_REVIEW'

/**
 * States that surface on mount and block new payments on the same mesa.
 *
 * MP_APPROVED on reload = app exited after MP captured but before Fullsite confirmed.
 * Treated as RECONCILIATION_REQUIRED since the outcome is unknown.
 */
const ATTENTION_STATES = [
  'MP_APPROVED',
  'RECONCILIATION_REQUIRED',
  'FAILED_MANUAL_REVIEW',
] as const satisfies readonly MpPaymentState[]

export interface MpPaymentRecovery extends RecoverableOperation<MpPaymentState> {
  /** MP's payment intent ID — the external reference for this terminal type. */
  intentId: string
}

const key = (mesa: number) => `mp_recovery_${mesa}`

export function loadMpRecovery(mesa: number): MpPaymentRecovery | null {
  return loadRecoverableOp<MpPaymentRecovery>(key(mesa), ATTENTION_STATES)
}

export function persistMpRecovery(r: MpPaymentRecovery): void {
  persistRecoverableOp(key(r.mesa), r)
}

export function clearMpRecovery(mesa: number): void {
  clearRecoverableOp(key(mesa))
}

export function needsOperatorAttention(r: MpPaymentRecovery | null): boolean {
  return !!r && (ATTENTION_STATES as readonly string[]).includes(r.state)
}
