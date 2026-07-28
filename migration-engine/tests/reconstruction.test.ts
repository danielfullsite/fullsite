import { describe, it, expect, beforeEach } from 'vitest'
import { FakeEngine } from './fake-engine.js'
import type { MigrationSession } from '../core/contracts/session.js'
import { MIN_RECONSTRUCTION_CONFIDENCE } from '../core/contracts/session.js'

function makeSession(): MigrationSession {
  return {
    id: 'session-recon-01',
    source_instance_id: 'instance-amalay-legacy',
    migration_type: 'legacy_reconstruction',
    state: 'running',
    client_id: 'amalay',
    started_at: new Date(),
    completed_at: null,
  }
}

describe('Reconstruction — binding vs observation decision', () => {
  let engine: FakeEngine
  let session: MigrationSession

  beforeEach(() => {
    engine = new FakeEngine()
    session = makeSession()
    engine.createSession(session)
  })

  it(`source_id present + confidence ≥ ${MIN_RECONSTRUCTION_CONFIDENCE} + evidence_ref → binding created`, () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalStaff',
      source_id: 'staff-wansoft-42',
      confidence: 0.85,
      evidence_ref: 'wansoft_staff_id:42',
    })

    const binding = engine.getBinding('instance-amalay-legacy', 'CanonicalStaff', 'staff-wansoft-42')
    expect(binding).toBeDefined()
    expect(binding!.reconstruction_type).toBe('legacy_reconstruction')
    expect(binding!.confidence).toBe(0.85)
  })

  it(`confidence < ${MIN_RECONSTRUCTION_CONFIDENCE} → observation with reason=low_confidence`, () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalStaff',
      source_id: 'staff-wansoft-99',
      confidence: 0.4,
      evidence_ref: null,
    })

    const binding = engine.getBinding('instance-amalay-legacy', 'CanonicalStaff', 'staff-wansoft-99')
    expect(binding).toBeUndefined()

    const observations = engine.getObservations()
    expect(observations.length).toBe(1)
    expect(observations[0]!.reason).toBe('low_confidence')
    expect(observations[0]!.source_id).toBe('staff-wansoft-99')
  })

  it('source_id=null → observation with reason=no_source_id_found', () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalIngredient',
      source_id: null,
      confidence: null,
      evidence_ref: null,
    })

    const observations = engine.getObservations()
    expect(observations.length).toBe(1)
    expect(observations[0]!.reason).toBe('no_source_id_found')
    expect(observations[0]!.source_id).toBeNull()
  })

  it('multiple ambiguous Fullsite candidates → observation with reason=ambiguous_match', () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalCategory',
      source_id: 'cat-wansoft-7',
      confidence: 0.7,
      evidence_ref: 'name:Bebidas',
      candidates: 3,   // multiple matches found in Fullsite
    })

    const binding = engine.getBinding('instance-amalay-legacy', 'CanonicalCategory', 'cat-wansoft-7')
    expect(binding).toBeUndefined()

    const observations = engine.getObservations()
    expect(observations.length).toBe(1)
    expect(observations[0]!.reason).toBe('ambiguous_match')
  })

  it('reconstructed binding always has evidence_ref not null', () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalStaff',
      source_id: 'staff-100',
      confidence: 0.9,
      evidence_ref: 'wansoft_staff_id:100',
    })

    const binding = engine.getBinding('instance-amalay-legacy', 'CanonicalStaff', 'staff-100')
    expect(binding).toBeDefined()
    expect(binding!.evidence_ref).not.toBeNull()
    expect(typeof binding!.evidence_ref).toBe('string')
  })

  it('reconstructed binding confidence is in [0.0, 1.0]', () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalSupplier',
      source_id: 'sup-legacy-5',
      confidence: 0.75,
      evidence_ref: 'clave_wansoft:PROV-005',
    })

    const binding = engine.getBinding('instance-amalay-legacy', 'CanonicalSupplier', 'sup-legacy-5')
    expect(binding).toBeDefined()
    expect(binding!.confidence).toBeGreaterThanOrEqual(0.0)
    expect(binding!.confidence).toBeLessThanOrEqual(1.0)
  })

  it('observation with confidence=null has non-null reason', () => {
    engine.reconstruct({
      session,
      source_instance_id: 'instance-amalay-legacy',
      source_entity_type: 'CanonicalProduct',
      source_id: null,
      confidence: null,
      evidence_ref: null,
    })

    const observations = engine.getObservations()
    const obs = observations[0]
    expect(obs).toBeDefined()
    expect(obs!.confidence).toBeNull()
    expect(obs!.reason).not.toBeNull()
    expect(typeof obs!.reason).toBe('string')
  })
})
