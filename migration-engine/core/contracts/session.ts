export type MigrationAction = 'CREATE' | 'SKIP' | 'UPDATE' | 'CONFLICT' | 'MERGE'
export type SessionState = 'running' | 'completed' | 'failed' | 'rolled_back'
export type RollbackState = 'running' | 'completed' | 'partial' | 'failed'
export type ReconstructionType =
  | 'direct'
  | 'wansoft_key'
  | 'name_match'
  | 'legacy_reconstruction'
export type ObservationReason = 'no_source_id_found' | 'ambiguous_match' | 'low_confidence'
export type WriteOperation = 'INSERT' | 'UPDATE' | 'DELETE'
export type ReverseOperation = 'INSERT' | 'UPDATE' | 'DELETE'
export type EntryState = 'pending' | 'executed' | 'skipped' | 'failed'

export interface SourceInstance {
  id: string              // UUID
  source_key: string      // human-readable: 'wansoft:amalay'
  name: string
  scope: 'restaurant' | 'chain'
  branch_id: string | null
}

// Global durable cross-session idempotency record.
// Key: (source_instance_id, source_entity_type, source_id) → fullsite_id.
// Only created with a verifiable source_id — never for unknown/ambiguous entities.
export interface SourceInstanceBinding {
  source_instance_id: string
  source_entity_type: string
  source_id: string
  fullsite_id: string
  source_hash: string
  confidence: number
  evidence_ref: string | null
  reconstruction_type: ReconstructionType
  created_at: Date
}

export interface MigrationSession {
  id: string
  source_instance_id: string
  migration_type: 'full_migration' | 'incremental' | 'legacy_reconstruction'
  state: SessionState
  client_id: string
  started_at: Date
  completed_at: Date | null
}

export interface MigrationEntityMapEntry {
  session_id: string
  source_instance_id: string
  source_entity_type: string
  source_id: string
  fullsite_id: string | null
  action: MigrationAction
  source_hash: string
  resolved_at: Date
}

// Append-only write journal. Never modified after INSERT — no rolled_back column.
// Rollback is tracked in migration_rollback_runs + migration_rollback_entries.
export interface WriteJournalEntry {
  id: number                            // BIGSERIAL — append-only
  session_id: string
  client_id: string
  fullsite_entity_type: string
  fullsite_id: string
  table_name: string
  operation: WriteOperation
  before_data: Record<string, unknown> | null   // null for INSERT
  after_data: Record<string, unknown> | null    // null for DELETE
  written_at: Date
}

// Entities without a verifiable source_id go here — NOT to unknown bindings.
// Inventing an identity for an unverifiable entity is a data-integrity violation.
export interface ReconstructionObservation {
  session_id: string
  source_instance_id: string
  source_entity_type: string
  source_id: string | null    // null when no_source_id_found
  reason: ObservationReason
  confidence: number | null
  evidence_ref: string | null
  observed_at: Date
}

export interface RollbackRun {
  id: string
  original_session_id: string
  client_id: string
  state: RollbackState
  started_at: Date
  completed_at: Date | null
}

export interface RollbackEntry {
  rollback_run_id: string
  journal_entry_id: number
  reverse_operation: ReverseOperation
  skip_reason: string | null
  state: EntryState
  executed_at: Date | null
}

export interface PurgeAuditRecord {
  session_id: string
  purged_at: Date
  records_before: number
  records_deleted: number
  authorized_by: string   // 'service_role'
}

export const TERMINAL_SESSION_STATES: SessionState[] = ['completed', 'failed', 'rolled_back']
export const MIN_RECONSTRUCTION_CONFIDENCE = 0.6
