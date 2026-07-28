import { describe, it, expect, beforeEach } from 'vitest'
import { FakeEngine } from './fake-engine.js'
import type { MigrationSession } from '../core/contracts/session.js'

function makeSession(overrides?: Partial<MigrationSession>): MigrationSession {
  return {
    id: 'session-idempotency-01',
    source_instance_id: 'instance-wansoft-amalay',
    migration_type: 'full_migration',
    state: 'running',
    client_id: 'amalay',
    started_at: new Date(),
    completed_at: null,
    ...overrides,
  }
}

describe('Idempotency — binding and action rules', () => {
  let engine: FakeEngine
  let session: MigrationSession

  beforeEach(() => {
    engine = new FakeEngine()
    session = makeSession()
    engine.createSession(session)
  })

  it('first extraction of a source_id → action CREATE and binding stored', () => {
    const action = engine.processRecord({
      session,
      source_id: 'cat-01',
      source_hash: 'hash-v1',
      entity_type: 'CanonicalCategory',
      data: { name: 'Entradas' },
    })

    expect(action).toBe('CREATE')
    const binding = engine.getBinding('instance-wansoft-amalay', 'CanonicalCategory', 'cat-01')
    expect(binding).toBeDefined()
    expect(binding!.fullsite_id).toMatch(/^fs_/)
    expect(binding!.confidence).toBe(1.0)
  })

  it('same source_id and same hash on second run → action SKIP, no new journal entry', () => {
    engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-v1', entity_type: 'CanonicalCategory', data: { name: 'Entradas' } })
    const journalCountAfterFirst = engine.getJournal().length

    const action = engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-v1', entity_type: 'CanonicalCategory', data: { name: 'Entradas' } })

    expect(action).toBe('SKIP')
    expect(engine.getJournal().length).toBe(journalCountAfterFirst) // no new journal write
  })

  it('same source_id with different hash → action UPDATE with journal entry', () => {
    engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-v1', entity_type: 'CanonicalCategory', data: { name: 'Entradas' } })

    const action = engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-v2', entity_type: 'CanonicalCategory', data: { name: 'Entradas Modificadas' } })

    expect(action).toBe('UPDATE')
    const journal = engine.getJournal()
    const updateEntry = journal.find(e => e.operation === 'UPDATE')
    expect(updateEntry).toBeDefined()
    expect(updateEntry!.before_data).toBeDefined()
    expect(updateEntry!.after_data).not.toBeNull()
  })

  it('no binding + Fullsite entity with matching name → action MERGE', () => {
    // Seed a pre-existing Fullsite entity
    engine.seedFullsiteEntity('amalay', 'CanonicalSupplier', 'Proveedor Central', 'fs-sup-pre', 'existing-hash')

    const action = engine.processRecord({
      session,
      source_id: 'sup-wansoft-001',
      source_hash: 'hash-sup-v1',
      entity_type: 'CanonicalSupplier',
      data: { name: 'Proveedor Central' },
      name: 'Proveedor Central',
    })

    expect(action).toBe('MERGE')
    const binding = engine.getBinding('instance-wansoft-amalay', 'CanonicalSupplier', 'sup-wansoft-001')
    expect(binding).toBeDefined()
    expect(binding!.fullsite_id).toBe('fs-sup-pre')
    expect(binding!.reconstruction_type).toBe('name_match')
  })

  it('binding exists but Fullsite entity was modified externally → action CONFLICT', () => {
    // First import: CREATE
    engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-v1', entity_type: 'CanonicalCategory', data: { name: 'Entradas' } })

    // Simulate external modification of Fullsite entity (different data hash in journal)
    const binding = engine.getBinding('instance-wansoft-amalay', 'CanonicalCategory', 'cat-01')!
    // Manually inject a journal entry that changes the Fullsite data to something different
    const journal = engine.getJournal()
    const createEntry = journal.find(e => e.fullsite_id === binding.fullsite_id)!
    // Simulate external edit by recording an UPDATE via a different session
    const externalSession = makeSession({ id: 'session-external', source_instance_id: 'instance-wansoft-amalay' })
    engine.createSession(externalSession)
    engine.processRecord({
      session: externalSession,
      source_id: 'cat-01',
      source_hash: 'hash-v3-external',  // third hash → external edit
      entity_type: 'CanonicalCategory',
      data: { name: 'Entradas Editadas Externamente' },
    })

    // Now original session tries to import with hash-v2
    const action = engine.processRecord({
      session,
      source_id: 'cat-01',
      source_hash: 'hash-v2',
      entity_type: 'CanonicalCategory',
      data: { name: 'Entradas V2' },
    })

    expect(action).toBe('CONFLICT')
  })

  it('two source_instances with the same source_id produce separate bindings', () => {
    const session2 = makeSession({ id: 'session-02', source_instance_id: 'instance-wansoft-noreste' })
    engine.createSession(session2)

    engine.processRecord({ session, source_id: 'cat-01', source_hash: 'hash-amalay', entity_type: 'CanonicalCategory', data: { name: 'Bebidas' } })
    engine.processRecord({ session: session2, source_id: 'cat-01', source_hash: 'hash-noreste', entity_type: 'CanonicalCategory', data: { name: 'Postres' } })

    const b1 = engine.getBinding('instance-wansoft-amalay', 'CanonicalCategory', 'cat-01')
    const b2 = engine.getBinding('instance-wansoft-noreste', 'CanonicalCategory', 'cat-01')

    expect(b1).toBeDefined()
    expect(b2).toBeDefined()
    expect(b1!.fullsite_id).not.toBe(b2!.fullsite_id)
  })

  it('source_id=null → no binding created, observation recorded instead', () => {
    engine.processRecord({
      session,
      source_id: null,
      source_hash: 'hash-no-id',
      entity_type: 'CanonicalIngredient',
      data: { name: 'Ingrediente Sin ID' },
    })

    const bindings = engine.getEntityMapEntries()
    // No binding stored for null source_id
    const binding = engine.getBinding('instance-wansoft-amalay', 'CanonicalIngredient', '')
    expect(binding).toBeUndefined()

    const observations = engine.getObservations()
    expect(observations.length).toBe(1)
    expect(observations[0]!.reason).toBe('no_source_id_found')
  })

  it('CREATE action writes journal entry with after_data not null', () => {
    engine.processRecord({
      session,
      source_id: 'prod-01',
      source_hash: 'hash-prod',
      entity_type: 'CanonicalProduct',
      data: { name: 'Tacos', price: 45 },
    })

    const journal = engine.getJournal()
    expect(journal.length).toBe(1)
    expect(journal[0]!.operation).toBe('INSERT')
    expect(journal[0]!.after_data).not.toBeNull()
    expect(journal[0]!.before_data).toBeNull()
  })
})
