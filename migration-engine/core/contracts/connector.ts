import type { CanonicalEntity, CanonicalEntityType } from './canonical-entities.js'

export interface ConnectorMetadata {
  id: string        // e.g. 'fake-v1', 'wansoft-v1'
  version: string   // semver
  supported_entities: CanonicalEntityType[]
}

export interface ConnectorConfig {
  source_instance_id: string
  [key: string]: unknown
}

export interface TestConnectionResult {
  ok: boolean
  latency_ms?: number
  error?: string
}

export interface ValidateSourceResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface DiscoverResult {
  entities: Array<{
    entity_type: CanonicalEntityType
    estimated_count: number
  }>
}

export interface ExtractBatch {
  batchId: string
  entity_type: CanonicalEntityType
  records: Array<Record<string, unknown>>
}

export interface MapResult {
  ok: boolean
  source_id: string | null    // null when source has no stable identifier
  entity_type: CanonicalEntityType
  data: CanonicalEntity | null
  errors?: string[]
  source_hash: string         // stable hash of the raw source record
}

export interface MigrationConnector {
  metadata(): ConnectorMetadata
  testConnection(config: ConnectorConfig): Promise<TestConnectionResult>
  validateSource(config: ConnectorConfig): Promise<ValidateSourceResult>
  discover(config: ConnectorConfig): Promise<DiscoverResult>
  extract(config: ConnectorConfig, entity_type: CanonicalEntityType): AsyncIterable<ExtractBatch>
  mapToCanonical(raw: Record<string, unknown>, entity_type: CanonicalEntityType): MapResult
}
