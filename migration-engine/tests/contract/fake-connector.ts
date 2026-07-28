// FakeConnector: complete in-memory implementation of MigrationConnector.
// Makes the contract suite always green. Real connectors are test.todo.
import type {
  MigrationConnector,
  ConnectorMetadata,
  ConnectorConfig,
  TestConnectionResult,
  ValidateSourceResult,
  DiscoverResult,
  ExtractBatch,
  MapResult,
} from '../../core/contracts/connector.js'
import type { CanonicalEntityType } from '../../core/contracts/canonical-entities.js'

const SUPPORTED: CanonicalEntityType[] = [
  'CanonicalRestaurant',
  'CanonicalTable',
  'CanonicalCategory',
  'CanonicalProduct',
  'CanonicalSupplier',
  'CanonicalIngredient',
  'CanonicalStaff',
]

// Stable fixture records per entity type
const FIXTURES: Partial<Record<CanonicalEntityType, Array<Record<string, unknown>>>> = {
  CanonicalRestaurant: [
    { id: 'wansoft-restaurant-1', name: 'AMALAY', slug: 'amalay', timezone: 'America/Monterrey', locale: 'es-MX' },
  ],
  CanonicalTable: [
    { id: 'table-1', number: 1, capacity: 4, zone: 'Terraza', x_pct: 22, y_pct: 9, shape: 'round', sort_order: 0, active: true },
    { id: 'table-5', number: 5, capacity: 4, zone: 'Interior', x_pct: 56, y_pct: 9, shape: 'rect-h', sort_order: 5, active: true },
  ],
  CanonicalCategory: [
    { id: 'cat-entradas', name: 'Entradas', color: '#10b981', sort_order: 0, active: true },
    { id: 'cat-bebidas', name: 'Bebidas', color: '#3b82f6', sort_order: 1, active: true },
  ],
  CanonicalProduct: [
    { id: 'prod-tacos', category_id: 'cat-entradas', name: 'Tacos de Canasta', price: 45, sort_order: 0, active: true },
    { id: 'prod-cafe', category_id: 'cat-bebidas', name: 'Café Americano', price: 38, sort_order: 0, active: true },
  ],
  CanonicalSupplier: [
    { id: 'sup-01', name: 'Proveedor Central', phone: '811-000-0000', authorized: true, clave_wansoft: 'PROV-001' },
  ],
  CanonicalIngredient: [
    { id: 'ing-cafe', name: 'Café molido', unit: 'g', cost_per_unit: 0.12, active: true },
    { id: 'ing-tortilla', name: 'Tortilla de maíz', unit: 'pz', cost_per_unit: 0.85, active: true },
  ],
  CanonicalStaff: [
    { id: 'staff-1', name: 'Ana García', role: 'mesero', active: true, requires_credential_enrollment: true },
    { id: 'staff-2', name: 'Jorge López', role: 'cajero', active: true, requires_credential_enrollment: true },
  ],
}

// Invalid fixture that fails mapToCanonical validation
const INVALID_FIXTURE: Record<string, unknown> = { id: null, name: null }

export class FakeConnector implements MigrationConnector {
  private _shouldFailConnection: boolean

  constructor({ failConnection = false }: { failConnection?: boolean } = {}) {
    this._shouldFailConnection = failConnection
  }

  metadata(): ConnectorMetadata {
    return {
      id: 'fake-v1',
      version: '1.0.0',
      supported_entities: SUPPORTED,
    }
  }

  async testConnection(config: ConnectorConfig): Promise<TestConnectionResult> {
    if (this._shouldFailConnection || config['force_fail'] === true) {
      return { ok: false, error: 'Connection refused (fake)' }
    }
    return { ok: true, latency_ms: 0 }
  }

  async validateSource(config: ConnectorConfig): Promise<ValidateSourceResult> {
    const errors: string[] = []
    const warnings: string[] = []
    if (!config.source_instance_id) {
      errors.push('source_instance_id is required')
    }
    return { valid: errors.length === 0, errors, warnings }
  }

  async discover(config: ConnectorConfig): Promise<DiscoverResult> {
    return {
      entities: SUPPORTED.map(entity_type => ({
        entity_type,
        estimated_count: FIXTURES[entity_type]?.length ?? 0,
      })),
    }
  }

  async *extract(config: ConnectorConfig, entity_type: CanonicalEntityType): AsyncIterable<ExtractBatch> {
    const records = FIXTURES[entity_type] ?? []
    if (records.length === 0) return

    // Emit in a single batch for simplicity
    yield {
      batchId: `${entity_type}-batch-0`,
      entity_type,
      records,
    }
  }

  mapToCanonical(raw: Record<string, unknown>, entity_type: CanonicalEntityType): MapResult {
    // Simulate invalid record rejection
    if (raw === INVALID_FIXTURE || (raw['id'] === null && raw['name'] === null)) {
      return {
        ok: false,
        source_id: null,
        entity_type,
        data: null,
        errors: ['id is required', 'name is required'],
        source_hash: stableHash(raw),
      }
    }

    const source_id = typeof raw['id'] === 'string' ? raw['id'] : null

    // Build canonical entity based on type
    const data = buildCanonical(raw, entity_type)
    if (!data) {
      return {
        ok: false,
        source_id,
        entity_type,
        data: null,
        errors: [`No mapping for entity_type: ${entity_type}`],
        source_hash: stableHash(raw),
      }
    }

    return {
      ok: true,
      source_id,
      entity_type,
      data,
      source_hash: stableHash(raw),
    }
  }
}

// Re-export invalid fixture for use in tests
export { INVALID_FIXTURE }

function buildCanonical(raw: Record<string, unknown>, entity_type: CanonicalEntityType) {
  const source_id = raw['id'] as string
  switch (entity_type) {
    case 'CanonicalRestaurant':
      return { source_id, name: raw['name'] as string, slug: raw['slug'] as string, timezone: raw['timezone'] as string, locale: raw['locale'] as string }
    case 'CanonicalTable':
      return { source_id, number: raw['number'] as number, capacity: raw['capacity'] as number, zone: (raw['zone'] as string) ?? null, x_pct: raw['x_pct'] as number, y_pct: raw['y_pct'] as number, shape: raw['shape'] as string, sort_order: raw['sort_order'] as number, active: raw['active'] as boolean }
    case 'CanonicalCategory':
      return { source_id, name: raw['name'] as string, color: raw['color'] as string | undefined, sort_order: raw['sort_order'] as number, active: raw['active'] as boolean }
    case 'CanonicalProduct':
      return { source_id, category_source_id: raw['category_id'] as string, name: raw['name'] as string, price: raw['price'] as number, sort_order: raw['sort_order'] as number, active: raw['active'] as boolean }
    case 'CanonicalSupplier':
      return { source_id, name: raw['name'] as string, phone: raw['phone'] as string | undefined, authorized: raw['authorized'] as boolean, clave_wansoft: raw['clave_wansoft'] as string | undefined }
    case 'CanonicalIngredient':
      return { source_id, name: raw['name'] as string, unit: raw['unit'] as string, cost_per_unit: raw['cost_per_unit'] as number | undefined }
    case 'CanonicalStaff':
      return { source_id, name: raw['name'] as string, role: raw['role'] as string, active: raw['active'] as boolean, requires_credential_enrollment: true as const }
    default:
      return null
  }
}

function stableHash(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}
