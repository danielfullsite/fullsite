import { describe, it, expect } from 'vitest'
import { FakeConnector, INVALID_FIXTURE } from './fake-connector.js'

const config = { source_instance_id: 'test-instance-001' }

describe('MigrationConnector contract — FakeConnector', () => {
  const connector = new FakeConnector()

  it('metadata() returns a string id and a semver version', () => {
    const meta = connector.metadata()
    expect(typeof meta.id).toBe('string')
    expect(meta.id.length).toBeGreaterThan(0)
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('metadata() lists at least one supported entity', () => {
    const meta = connector.metadata()
    expect(meta.supported_entities.length).toBeGreaterThan(0)
  })

  it('testConnection() resolves { ok: true } with valid config', async () => {
    const result = await connector.testConnection(config)
    expect(result.ok).toBe(true)
  })

  it('testConnection() resolves { ok: false } when connection fails', async () => {
    const failing = new FakeConnector({ failConnection: true })
    const result = await failing.testConnection(config)
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('validateSource() returns { valid: true, errors: [] } with valid config', async () => {
    const result = await connector.validateSource(config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validateSource() returns errors[] when source_instance_id is missing', async () => {
    const result = await connector.validateSource({} as typeof config)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('discover() returns entity list with estimated_count per type', async () => {
    const result = await connector.discover(config)
    expect(result.entities.length).toBeGreaterThan(0)
    for (const entry of result.entities) {
      expect(typeof entry.entity_type).toBe('string')
      expect(typeof entry.estimated_count).toBe('number')
    }
  })

  it('extract() yields at least one batch with batchId and records[]', async () => {
    const batches: import('../../core/contracts/connector.js').ExtractBatch[] = []
    for await (const batch of connector.extract(config, 'CanonicalCategory')) {
      batches.push(batch)
    }
    expect(batches.length).toBeGreaterThan(0)
    const [first] = batches
    expect(typeof first!.batchId).toBe('string')
    expect(Array.isArray(first!.records)).toBe(true)
    expect(first!.records.length).toBeGreaterThan(0)
  })

  it('mapToCanonical() returns { ok: true, source_id, data } for a valid record', () => {
    const raw = { id: 'cat-test', name: 'Test', color: '#fff', sort_order: 0, active: true }
    const result = connector.mapToCanonical(raw, 'CanonicalCategory')
    expect(result.ok).toBe(true)
    expect(result.source_id).toBe('cat-test')
    expect(result.data).not.toBeNull()
    expect(typeof result.source_hash).toBe('string')
  })

  it('mapToCanonical() returns { ok: false, errors[] } for an invalid record', () => {
    const result = connector.mapToCanonical(INVALID_FIXTURE, 'CanonicalCategory')
    expect(result.ok).toBe(false)
    expect(result.data).toBeNull()
    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })
})

// Real connectors: NOT yet implemented. Contract test bodies are intentionally empty.
describe('WansoftConnector — contract compliance', () => {
  it.todo('testConnection() succeeds against staging Netsilver instance')
  it.todo('extract(CanonicalProduct) yields all menu items from Wansoft API')
  it.todo('mapToCanonical handles Wansoft-specific clave_wansoft field')
})

describe('GenericCsvConnector — contract compliance', () => {
  it.todo('extract() parses CSV file with BOM and Latin-1 encoding')
  it.todo('mapToCanonical() maps CSV columns to CanonicalSupplier via column_map config')
})
