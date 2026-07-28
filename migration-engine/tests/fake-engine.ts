// In-memory implementation of the migration session engine.
// Used by all test suites to exercise behavioral contracts without network or DB.
import type {
  MigrationSession,
  SourceInstanceBinding,
  WriteJournalEntry,
  MigrationEntityMapEntry,
  ReconstructionObservation,
  RollbackRun,
  RollbackEntry,
  PurgeAuditRecord,
  MigrationAction,
  WriteOperation,
  EntryState,
} from '../core/contracts/session.js'
import {
  TERMINAL_SESSION_STATES,
  MIN_RECONSTRUCTION_CONFIDENCE,
} from '../core/contracts/session.js'

export class PurgeRequiresTerminalStateError extends Error {}
export class PurgePermissionDeniedError extends Error {}
export class BlockedMutationError extends Error {}

interface ReconstructInput {
  session: MigrationSession
  source_instance_id: string
  source_entity_type: string
  source_id: string | null
  confidence: number | null
  evidence_ref: string | null
  candidates?: number
}

interface ProcessRecordInput {
  session: MigrationSession
  source_id: string | null
  source_hash: string
  entity_type: string
  data: Record<string, unknown>
  name?: string
}

export class FakeEngine {
  // keyed by `${source_instance_id}:${entity_type}:${source_id}`
  private bindings = new Map<string, SourceInstanceBinding>()
  // keyed by `${client_id}:${entity_type}:${name}` for MERGE detection
  private fullsiteByName = new Map<string, { id: string; data_hash: string }>()
  // keyed by `${entity_type}:${fullsite_id}` for downstream ref simulation
  private downstreamRefs = new Map<string, string[]>()
  private journal: WriteJournalEntry[] = []
  private journalSeq = 0
  private sessions = new Map<string, MigrationSession>()
  private entityMapEntries: MigrationEntityMapEntry[] = []
  private observations: ReconstructionObservation[] = []
  private rollbackRuns = new Map<string, RollbackRun>()
  private rollbackEntries: RollbackEntry[] = []
  private purgeAudit: PurgeAuditRecord[] = []
  // Simulates SET LOCAL app.purge_authorized='true' (transaction-scoped GUC)
  private purgeGUC = false
  private rawStore = new Map<string, Record<string, unknown>[]>()

  // CONFLICT tracking: records the last source_hash written by each session for each binding.
  // Key: `${session_id}:${bindingKey}` → last hash this session wrote.
  // CONFLICT fires only when THIS session previously wrote to a binding and the current
  // binding hash (modified by a different session) no longer matches.
  private sessionLastHash = new Map<string, string>()

  // ── Session management ──────────────────────────────────────────────────────

  createSession(session: MigrationSession): void {
    this.sessions.set(session.id, { ...session })
  }

  getSession(id: string): MigrationSession | undefined {
    return this.sessions.get(id)
  }

  completeSession(id: string): void {
    const s = this.sessions.get(id)
    if (s) this.sessions.set(id, { ...s, state: 'completed', completed_at: new Date() })
  }

  failSession(id: string): void {
    const s = this.sessions.get(id)
    if (s) this.sessions.set(id, { ...s, state: 'failed' })
  }

  // ── Downstream ref simulation ───────────────────────────────────────────────

  addDownstreamRef(entity_type: string, fullsite_id: string, ref: string): void {
    const key = `${entity_type}:${fullsite_id}`
    const existing = this.downstreamRefs.get(key) ?? []
    this.downstreamRefs.set(key, [...existing, ref])
  }

  // ── Raw store (simulates DB table with block_raw_mutation trigger) ──────────

  private rawInsert(table: string, record: Record<string, unknown>): void {
    if (!this.purgeGUC) throw new BlockedMutationError('block_raw_mutation: GUC not set')
    const rows = this.rawStore.get(table) ?? []
    this.rawStore.set(table, [...rows, record])
  }

  // Expose rawInsert for tests that need to exercise the trigger block
  testRawInsert(table: string, record: Record<string, unknown>): void {
    this.rawInsert(table, record)
  }

  rawCount(table: string): number {
    return this.rawStore.get(table)?.length ?? 0
  }

  // ── Core: process a source record ──────────────────────────────────────────

  processRecord(input: ProcessRecordInput): MigrationAction {
    const { session, source_id, source_hash, entity_type, data, name } = input

    // No source_id → create observation, never a binding
    if (source_id === null) {
      this.observations.push({
        session_id: session.id,
        source_instance_id: session.source_instance_id,
        source_entity_type: entity_type,
        source_id: null,
        reason: 'no_source_id_found',
        confidence: null,
        evidence_ref: null,
        observed_at: new Date(),
      })
      // Engine still creates the Fullsite entity, but the test for this case
      // verifies no binding is stored (which is already handled by no binding write below)
      return 'CREATE'
    }

    const bindingKey = `${session.source_instance_id}:${entity_type}:${source_id}`
    const existing = this.bindings.get(bindingKey)

    if (existing) {
      if (existing.source_hash === source_hash) {
        // Identical record → SKIP
        this.entityMapEntries.push({
          session_id: session.id,
          source_instance_id: session.source_instance_id,
          source_entity_type: entity_type,
          source_id,
          fullsite_id: existing.fullsite_id,
          action: 'SKIP',
          source_hash,
          resolved_at: new Date(),
        })
        return 'SKIP'
      }

      // Hash changed — check if this session previously wrote to this binding
      // and whether another session changed it in the meantime.
      const sessionHashKey = `${session.id}:${bindingKey}`
      const myLastHash = this.sessionLastHash.get(sessionHashKey)

      if (myLastHash !== undefined && myLastHash !== existing.source_hash) {
        // This session previously wrote hash X; current binding hash was changed by
        // a different session to Y; we're now trying to write Z → CONFLICT
        this.entityMapEntries.push({
          session_id: session.id,
          source_instance_id: session.source_instance_id,
          source_entity_type: entity_type,
          source_id,
          fullsite_id: existing.fullsite_id,
          action: 'CONFLICT',
          source_hash,
          resolved_at: new Date(),
        })
        return 'CONFLICT'
      }

      // Normal update: hash changed, no cross-session conflict
      const lastJournalEntry = [...this.journal]
        .reverse()
        .find(e => e.fullsite_id === existing.fullsite_id && e.operation !== 'DELETE')
      const before = lastJournalEntry?.after_data ?? {}
      this.journal.push({
        id: ++this.journalSeq,
        session_id: session.id,
        client_id: session.client_id,
        fullsite_entity_type: entity_type,
        fullsite_id: existing.fullsite_id,
        table_name: entityTable(entity_type),
        operation: 'UPDATE',
        before_data: before,
        after_data: data,
        written_at: new Date(),
      })
      // Update binding hash and record this session's write
      this.bindings.set(bindingKey, { ...existing, source_hash })
      this.sessionLastHash.set(sessionHashKey, source_hash)
      this.entityMapEntries.push({
        session_id: session.id,
        source_instance_id: session.source_instance_id,
        source_entity_type: entity_type,
        source_id,
        fullsite_id: existing.fullsite_id,
        action: 'UPDATE',
        source_hash,
        resolved_at: new Date(),
      })
      return 'UPDATE'
    }

    // No binding — check for name-based MERGE candidate
    if (name) {
      const nameKey = `${session.client_id}:${entity_type}:${name}`
      const candidate = this.fullsiteByName.get(nameKey)
      if (candidate) {
        this.bindings.set(bindingKey, {
          source_instance_id: session.source_instance_id,
          source_entity_type: entity_type,
          source_id,
          fullsite_id: candidate.id,
          source_hash,
          confidence: 0.8,
          evidence_ref: null,
          reconstruction_type: 'name_match',
          created_at: new Date(),
        })
        this.sessionLastHash.set(`${session.id}:${bindingKey}`, source_hash)
        this.entityMapEntries.push({
          session_id: session.id,
          source_instance_id: session.source_instance_id,
          source_entity_type: entity_type,
          source_id,
          fullsite_id: candidate.id,
          action: 'MERGE',
          source_hash,
          resolved_at: new Date(),
        })
        return 'MERGE'
      }
    }

    // CREATE: new entity — fullsite_id includes source_instance_id to prevent cross-instance collision
    const fullsite_id = `fs_${entity_type.toLowerCase()}_${session.source_instance_id}_${source_id}`
    this.bindings.set(bindingKey, {
      source_instance_id: session.source_instance_id,
      source_entity_type: entity_type,
      source_id,
      fullsite_id,
      source_hash,
      confidence: 1.0,
      evidence_ref: null,
      reconstruction_type: 'direct',
      created_at: new Date(),
    })
    this.sessionLastHash.set(`${session.id}:${bindingKey}`, source_hash)
    this.journal.push({
      id: ++this.journalSeq,
      session_id: session.id,
      client_id: session.client_id,
      fullsite_entity_type: entity_type,
      fullsite_id,
      table_name: entityTable(entity_type),
      operation: 'INSERT',
      before_data: null,
      after_data: data,
      written_at: new Date(),
    })
    if (name) {
      const nameKey = `${session.client_id}:${entity_type}:${name}`
      this.fullsiteByName.set(nameKey, { id: fullsite_id, data_hash: source_hash })
    }
    this.entityMapEntries.push({
      session_id: session.id,
      source_instance_id: session.source_instance_id,
      source_entity_type: entity_type,
      source_id,
      fullsite_id,
      action: 'CREATE',
      source_hash,
      resolved_at: new Date(),
    })
    return 'CREATE'
  }

  // ── Rollback ────────────────────────────────────────────────────────────────

  computeRollback(session_id: string, rollback_run_id: string): RollbackRun {
    const session = this.sessions.get(session_id)!
    const sessionJournal = [...this.journal]
      .filter(e => e.session_id === session_id)
      .reverse()  // reverse write order

    const run: RollbackRun = {
      id: rollback_run_id,
      original_session_id: session_id,
      client_id: session.client_id,
      state: 'running',
      started_at: new Date(),
      completed_at: null,
    }
    this.rollbackRuns.set(rollback_run_id, run)

    for (const entry of sessionJournal) {
      let state: EntryState = 'pending'
      let skip_reason: string | null = null

      if (entry.operation === 'INSERT') {
        const refs = this.downstreamRefs.get(`${entry.fullsite_entity_type}:${entry.fullsite_id}`)
        if (refs && refs.length > 0) {
          state = 'skipped'
          skip_reason = `downstream refs: ${refs.join(', ')}`
        }
      }

      this.rollbackEntries.push({
        rollback_run_id,
        journal_entry_id: entry.id,
        reverse_operation: reverseOperation(entry.operation),
        skip_reason,
        state,
        executed_at: null,
      })
    }

    return run
  }

  executeRollback(rollback_run_id: string): RollbackRun {
    const run = this.rollbackRuns.get(rollback_run_id)!
    const entries = this.rollbackEntries.filter(e => e.rollback_run_id === rollback_run_id)

    for (const entry of entries) {
      if (entry.state === 'skipped') continue
      const journalEntry = this.journal.find(j => j.id === entry.journal_entry_id)!

      if (entry.reverse_operation === 'DELETE') {
        // Reverse an INSERT: mark the entity as deleted (no new journal write needed for simulation)
        entry.state = 'executed'
        entry.executed_at = new Date()
      } else if (entry.reverse_operation === 'UPDATE') {
        // Reverse an UPDATE: restore before_data
        this.journal.push({
          id: ++this.journalSeq,
          session_id: run.id,
          client_id: run.client_id,
          fullsite_entity_type: journalEntry.fullsite_entity_type,
          fullsite_id: journalEntry.fullsite_id,
          table_name: journalEntry.table_name,
          operation: 'UPDATE',
          before_data: journalEntry.after_data,
          after_data: journalEntry.before_data,  // restore the before state
          written_at: new Date(),
        })
        entry.state = 'executed'
        entry.executed_at = new Date()
      } else if (entry.reverse_operation === 'INSERT') {
        // Reverse a DELETE: restore using before_data — NEVER after_data
        this.journal.push({
          id: ++this.journalSeq,
          session_id: run.id,
          client_id: run.client_id,
          fullsite_entity_type: journalEntry.fullsite_entity_type,
          fullsite_id: journalEntry.fullsite_id,
          table_name: journalEntry.table_name,
          operation: 'INSERT',
          before_data: null,
          after_data: journalEntry.before_data,  // restore: use before_data, never after_data
          written_at: new Date(),
        })
        entry.state = 'executed'
        entry.executed_at = new Date()
      }
    }

    const refreshed = this.rollbackEntries.filter(e => e.rollback_run_id === rollback_run_id)
    const allDone = refreshed.every(e => e.state === 'executed' || e.state === 'skipped')
    const anySkipped = refreshed.some(e => e.state === 'skipped')
    const finalState: RollbackRun['state'] = allDone
      ? anySkipped ? 'partial' : 'completed'
      : 'failed'

    const completed = { ...run, state: finalState, completed_at: new Date() }
    this.rollbackRuns.set(rollback_run_id, completed)
    const sess = this.sessions.get(run.original_session_id)
    if (sess) this.sessions.set(sess.id, { ...sess, state: 'rolled_back' })
    return completed
  }

  // ── Reconstruction ──────────────────────────────────────────────────────────

  reconstruct(input: ReconstructInput): void {
    const { session, source_instance_id, source_entity_type, source_id, confidence, evidence_ref, candidates } = input

    if (source_id === null) {
      this.observations.push({
        session_id: session.id,
        source_instance_id,
        source_entity_type,
        source_id: null,
        reason: 'no_source_id_found',
        confidence: null,
        evidence_ref: null,
        observed_at: new Date(),
      })
      return
    }

    if ((candidates ?? 0) > 1) {
      this.observations.push({
        session_id: session.id,
        source_instance_id,
        source_entity_type,
        source_id,
        reason: 'ambiguous_match',
        confidence,
        evidence_ref,
        observed_at: new Date(),
      })
      return
    }

    if (confidence === null || confidence < MIN_RECONSTRUCTION_CONFIDENCE) {
      this.observations.push({
        session_id: session.id,
        source_instance_id,
        source_entity_type,
        source_id,
        reason: 'low_confidence',
        confidence,
        evidence_ref: null,
        observed_at: new Date(),
      })
      return
    }

    // confidence >= 0.6 with verifiable source_id → create binding
    const fullsite_id = `fs_${source_entity_type.toLowerCase()}_reconstructed_${source_id}`
    const bindingKey = `${source_instance_id}:${source_entity_type}:${source_id}`
    this.bindings.set(bindingKey, {
      source_instance_id,
      source_entity_type,
      source_id,
      fullsite_id,
      source_hash: stableHash({ source_id }),
      confidence,
      evidence_ref,
      reconstruction_type: 'legacy_reconstruction',
      created_at: new Date(),
    })
  }

  // ── Purge ───────────────────────────────────────────────────────────────────

  purge(session_id: string, caller_role: string): PurgeAuditRecord {
    if (caller_role !== 'service_role') {
      throw new PurgePermissionDeniedError(`DENY: role ${caller_role} cannot execute purge`)
    }

    const session = this.sessions.get(session_id)
    if (!session || !TERMINAL_SESSION_STATES.includes(session.state)) {
      throw new PurgeRequiresTerminalStateError(
        `Session ${session_id} must be in terminal state (completed/failed/rolled_back)`
      )
    }

    const sessionJournal = this.journal.filter(e => e.session_id === session_id)
    const records_before = sessionJournal.length

    // Audit record created BEFORE deletion
    const audit: PurgeAuditRecord = {
      session_id,
      purged_at: new Date(),
      records_before,
      records_deleted: 0,
      authorized_by: 'service_role',
    }

    // SET LOCAL app.purge_authorized='true' — clears when "transaction" ends
    this.purgeGUC = true
    let deleted = 0
    try {
      for (const entry of sessionJournal) {
        this.rawInsert('migration_write_journal', entry as unknown as Record<string, unknown>)
        deleted++
      }
    } finally {
      // SET LOCAL: always clears after transaction boundary
      this.purgeGUC = false
    }

    audit.records_deleted = deleted
    this.purgeAudit.push(audit)
    return audit
  }

  // ── Tenant isolation queries ────────────────────────────────────────────────

  getBindingsForClient(client_id: string): SourceInstanceBinding[] {
    const instanceIds = new Set(
      [...this.sessions.values()]
        .filter(s => s.client_id === client_id)
        .map(s => s.source_instance_id)
    )
    return [...this.bindings.values()].filter(b => instanceIds.has(b.source_instance_id))
  }

  getSessionsForClient(client_id: string): MigrationSession[] {
    return [...this.sessions.values()].filter(s => s.client_id === client_id)
  }

  getJournalForClient(client_id: string): WriteJournalEntry[] {
    return this.journal.filter(e => e.client_id === client_id)
  }

  getObservationsForClient(client_id: string): ReconstructionObservation[] {
    const sessionIds = new Set(
      [...this.sessions.values()]
        .filter(s => s.client_id === client_id)
        .map(s => s.id)
    )
    return this.observations.filter(o => sessionIds.has(o.session_id))
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getBinding(source_instance_id: string, entity_type: string, source_id: string) {
    return this.bindings.get(`${source_instance_id}:${entity_type}:${source_id}`)
  }

  getJournal(): WriteJournalEntry[] { return [...this.journal] }

  getJournalEntry(id: number): WriteJournalEntry | undefined {
    return this.journal.find(e => e.id === id)
  }

  getEntityMapEntries(): MigrationEntityMapEntry[] { return [...this.entityMapEntries] }

  getObservations(): ReconstructionObservation[] { return [...this.observations] }

  getRollbackRun(id: string): RollbackRun | undefined { return this.rollbackRuns.get(id) }

  getRollbackEntries(run_id: string): RollbackEntry[] {
    return this.rollbackEntries.filter(e => e.rollback_run_id === run_id)
  }

  getPurgeAudit(): PurgeAuditRecord[] { return [...this.purgeAudit] }

  isPurgeGUCSet(): boolean { return this.purgeGUC }

  rawStoreCount(table: string): number { return this.rawCount(table) }

  seedFullsiteEntity(client_id: string, entity_type: string, name: string, id: string, data_hash: string): void {
    this.fullsiteByName.set(`${client_id}:${entity_type}:${name}`, { id, data_hash })
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stableHash(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

function reverseOperation(op: WriteOperation): 'INSERT' | 'UPDATE' | 'DELETE' {
  if (op === 'INSERT') return 'DELETE'
  if (op === 'UPDATE') return 'UPDATE'
  return 'INSERT'
}

function entityTable(entity_type: string): string {
  const map: Record<string, string> = {
    CanonicalRestaurant: 'clients',
    CanonicalTable: 'pos_mesas',
    CanonicalCategory: 'pos_menu_categories',
    CanonicalProduct: 'pos_menu_items',
    CanonicalModifierGroup: 'pos_item_modifier_groups',
    CanonicalModifier: 'pos_modifiers',
    CanonicalSupplier: 'pos_suppliers',
    CanonicalIngredient: 'pos_ingredients',
    CanonicalUnit: 'pos_unit_conversions',
    CanonicalRecipe: 'pos_recipe_versions',
    CanonicalFiscalConfig: 'clients',
    CanonicalStaff: 'pos_staff',
    CanonicalStockBalance: 'pos_inventory_products',
  }
  return map[entity_type] ?? 'unknown'
}
