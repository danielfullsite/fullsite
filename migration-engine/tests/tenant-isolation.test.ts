import { describe, it, expect, beforeEach } from 'vitest'
import { FakeEngine } from './fake-engine.js'
import type { MigrationSession } from '../core/contracts/session.js'

function makeSession(client_id: string, source_instance_id: string, id: string): MigrationSession {
  return {
    id,
    source_instance_id,
    migration_type: 'full_migration',
    state: 'running',
    client_id,
    started_at: new Date(),
    completed_at: null,
  }
}

describe('Tenant isolation — cross-client data separation', () => {
  let engine: FakeEngine
  let sessionA: MigrationSession
  let sessionB: MigrationSession

  beforeEach(() => {
    engine = new FakeEngine()
    sessionA = makeSession('client-amalay', 'instance-wansoft-amalay', 'session-A')
    sessionB = makeSession('client-noreste', 'instance-wansoft-noreste', 'session-B')
    engine.createSession(sessionA)
    engine.createSession(sessionB)

    // Populate each session with its own data
    engine.processRecord({ session: sessionA, source_id: 'cat-A-01', source_hash: 'hA', entity_type: 'CanonicalCategory', data: { name: 'Entradas AMALAY' } })
    engine.processRecord({ session: sessionB, source_id: 'cat-B-01', source_hash: 'hB', entity_type: 'CanonicalCategory', data: { name: 'Entradas Noreste' } })

    engine.reconstruct({
      session: sessionA,
      source_instance_id: 'instance-wansoft-amalay',
      source_entity_type: 'CanonicalStaff',
      source_id: null,
      confidence: null,
      evidence_ref: null,
    })
    engine.reconstruct({
      session: sessionB,
      source_instance_id: 'instance-wansoft-noreste',
      source_entity_type: 'CanonicalStaff',
      source_id: null,
      confidence: null,
      evidence_ref: null,
    })
  })

  it('bindings of client A are not visible when querying for client B', () => {
    const bindingsA = engine.getBindingsForClient('client-amalay')
    const bindingsB = engine.getBindingsForClient('client-noreste')

    expect(bindingsA.length).toBeGreaterThan(0)
    expect(bindingsB.length).toBeGreaterThan(0)

    const idsA = new Set(bindingsA.map(b => b.source_id))
    const idsB = new Set(bindingsB.map(b => b.source_id))
    // No overlap between binding source_ids of different tenants
    for (const id of idsA) expect(idsB.has(id)).toBe(false)
  })

  it('sessions of client A are not visible when querying for client B', () => {
    const sessionsA = engine.getSessionsForClient('client-amalay')
    const sessionsB = engine.getSessionsForClient('client-noreste')

    expect(sessionsA.every(s => s.client_id === 'client-amalay')).toBe(true)
    expect(sessionsB.every(s => s.client_id === 'client-noreste')).toBe(true)
    expect(sessionsA.some(s => s.client_id === 'client-noreste')).toBe(false)
  })

  it('journal entries are isolated by client_id', () => {
    const journalA = engine.getJournalForClient('client-amalay')
    const journalB = engine.getJournalForClient('client-noreste')

    expect(journalA.every(e => e.client_id === 'client-amalay')).toBe(true)
    expect(journalB.every(e => e.client_id === 'client-noreste')).toBe(true)
    expect(journalA.some(e => e.client_id === 'client-noreste')).toBe(false)
  })

  it('reconstruction observations are isolated by client_id (via session)', () => {
    const obsA = engine.getObservationsForClient('client-amalay')
    const obsB = engine.getObservationsForClient('client-noreste')

    expect(obsA.length).toBeGreaterThan(0)
    expect(obsB.length).toBeGreaterThan(0)

    const sessionIdsA = new Set(engine.getSessionsForClient('client-amalay').map(s => s.id))
    const sessionIdsB = new Set(engine.getSessionsForClient('client-noreste').map(s => s.id))

    expect(obsA.every(o => sessionIdsA.has(o.session_id))).toBe(true)
    expect(obsB.every(o => sessionIdsB.has(o.session_id))).toBe(true)
  })

  it('two source_instances from different clients may share the same source_key without collision', () => {
    // Both sessions are named 'wansoft-main' at their respective restaurants
    const sessionC = makeSession('client-nueva', 'instance-nueva-main', 'session-C')
    const sessionD = makeSession('client-otra', 'instance-otra-main', 'session-D')
    engine.createSession(sessionC)
    engine.createSession(sessionD)

    // Same source_id 'cat-01' in both — different instance_ids prevent collision
    engine.processRecord({ session: sessionC, source_id: 'cat-01', source_hash: 'h-nueva', entity_type: 'CanonicalCategory', data: { name: 'Bebidas' } })
    engine.processRecord({ session: sessionD, source_id: 'cat-01', source_hash: 'h-otra', entity_type: 'CanonicalCategory', data: { name: 'Bebidas' } })

    const bindingC = engine.getBinding('instance-nueva-main', 'CanonicalCategory', 'cat-01')
    const bindingD = engine.getBinding('instance-otra-main', 'CanonicalCategory', 'cat-01')

    expect(bindingC).toBeDefined()
    expect(bindingD).toBeDefined()
    // Different fullsite_ids — no collision
    expect(bindingC!.fullsite_id).not.toBe(bindingD!.fullsite_id)
  })
})
