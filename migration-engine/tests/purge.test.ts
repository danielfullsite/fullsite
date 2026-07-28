import { describe, it, expect, beforeEach } from 'vitest'
import {
  FakeEngine,
  PurgeRequiresTerminalStateError,
  PurgePermissionDeniedError,
  BlockedMutationError,
} from './fake-engine.js'
import type { MigrationSession } from '../core/contracts/session.js'

function makeSession(state: MigrationSession['state'] = 'running'): MigrationSession {
  return {
    id: 'session-purge-01',
    source_instance_id: 'instance-purge-test',
    migration_type: 'full_migration',
    state,
    client_id: 'amalay',
    started_at: new Date(),
    completed_at: state === 'completed' ? new Date() : null,
  }
}

function seedJournal(engine: FakeEngine, session: MigrationSession, count: number) {
  for (let i = 0; i < count; i++) {
    engine.processRecord({
      session,
      source_id: `entity-${i}`,
      source_hash: `hash-${i}`,
      entity_type: 'CanonicalCategory',
      data: { name: `Category ${i}` },
    })
  }
}

describe('Purge — terminal state gate and GUC pattern', () => {
  let engine: FakeEngine

  beforeEach(() => {
    engine = new FakeEngine()
  })

  it('purge() requires terminal session state (completed | failed | rolled_back)', () => {
    const session = makeSession('running')
    engine.createSession(session)
    seedJournal(engine, session, 2)

    expect(() => engine.purge('session-purge-01', 'service_role'))
      .toThrow(PurgeRequiresTerminalStateError)
  })

  it('running session → throws PurgeRequiresTerminalStateError', () => {
    const session = makeSession('running')
    engine.createSession(session)

    let caught: unknown
    try { engine.purge('session-purge-01', 'service_role') }
    catch (e) { caught = e }

    expect(caught).toBeInstanceOf(PurgeRequiresTerminalStateError)
  })

  it('terminal session → audit record created before deletion', () => {
    const session = makeSession('completed')
    engine.createSession(session)
    seedJournal(engine, session, 3)

    engine.purge('session-purge-01', 'service_role')

    const audit = engine.getPurgeAudit()
    expect(audit.length).toBe(1)
    expect(audit[0]!.session_id).toBe('session-purge-01')
    expect(audit[0]!.authorized_by).toBe('service_role')
  })

  it('raw mutation without GUC set → BlockedMutationError (simulates block_raw_mutation trigger)', () => {
    // Directly calling rawInsert without the GUC active should throw
    expect(() => engine.testRawInsert('migration_write_journal', { test: true }))
      .toThrow(BlockedMutationError)
  })

  it('GUC is transaction-scoped: purgeGUC is false before and after purge', () => {
    const session = makeSession('completed')
    engine.createSession(session)
    seedJournal(engine, session, 1)

    expect(engine.isPurgeGUCSet()).toBe(false)
    engine.purge('session-purge-01', 'service_role')
    // After purge (transaction boundary): GUC must be cleared
    expect(engine.isPurgeGUCSet()).toBe(false)
  })

  it('audit.records_before matches journal count before deletion', () => {
    const session = makeSession('failed')
    engine.createSession(session)
    seedJournal(engine, session, 5)

    const journalBeforePurge = engine.getJournal().filter(e => e.session_id === 'session-purge-01').length

    const audit = engine.purge('session-purge-01', 'service_role')
    expect(audit.records_before).toBe(journalBeforePurge)
    expect(audit.records_before).toBe(5)
  })

  it('audit.records_deleted matches actual number of records deleted', () => {
    const session = makeSession('rolled_back')
    engine.createSession(session)
    seedJournal(engine, session, 4)

    const audit = engine.purge('session-purge-01', 'service_role')
    expect(audit.records_deleted).toBe(4)
    expect(audit.records_deleted).toBe(audit.records_before)
  })

  it('authenticated role (non-service_role) → PurgePermissionDeniedError', () => {
    const session = makeSession('completed')
    engine.createSession(session)
    seedJournal(engine, session, 1)

    expect(() => engine.purge('session-purge-01', 'authenticated'))
      .toThrow(PurgePermissionDeniedError)

    expect(() => engine.purge('session-purge-01', 'anon'))
      .toThrow(PurgePermissionDeniedError)
  })
})
