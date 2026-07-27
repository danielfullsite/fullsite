import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ServerDiscovery, buildDiscoveryConfig } from '@/lib/server-discovery'
import { ServerRegistry } from '@/lib/server-registry'

// ── ServerDiscovery + ServerRegistry ──────────────────────────────────────────
// LAN-03: Descubrimiento robusto del Local Server en Windows.
// Cubre los 13+ escenarios requeridos:
//   TC-01  Preferido responde → found inmediato
//   TC-02  Preferido falla, registry responde → found via fallback
//   TC-03  mDNS no disponible, registry vacío, subnet scan encuentra servidor
//   TC-04  restaurant_id diferente → identity_mismatch
//   TC-05  branch_id diferente → identity_mismatch
//   TC-06  protocol_version incompatible → not_found (protocol_incompatible)
//   TC-07  IP cambió, registry obsoleto, subnet scan encuentra nueva IP
//   TC-08  Servidor reiniciado, reconecta al mismo endpoint
//   TC-09  Timeout en todos los candidatos → not_found
//   TC-10  Sin candidatos → not_found (no_candidates)
//   TC-11  Subnet scan: dos servidores del mismo restaurante → ambiguous
//   TC-12  Subnet scan inhabilitado → no scan (respeta opt-in)
//   TC-13  Múltiples NICs: dos IPs preferidas, segunda válida

// ── Helpers ───────────────────────────────────────────────────────────────────

const REST_ID     = 'rest-amalay-001'
const BRANCH_ID   = 'branch-monterrey-01'
const SERVER_ID   = 'srv-abc123'
const PROTOCOL    = '1.0'
const VERSION     = '2.1.0'

function makeIdentity(overrides: Record<string, unknown> = {}) {
  return {
    ok:               true,
    server_id:        SERVER_ID,
    restaurant_id:    REST_ID,
    branch_id:        BRANCH_ID,
    instance_name:    'AMALAY POS',
    version:          VERSION,
    protocol_version: PROTOCOL,
    capabilities:     ['orders', 'kds', 'printing'],
    lan_ips:          ['192.168.1.71'],
    ts:               Date.now(),
    ...overrides,
  }
}

/** Helper: create a fetch mock that maps endpoint → response. */
function mockFetch(map: Record<string, { status: number; body: unknown } | 'timeout'>) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const key = Object.keys(map).find(k => url.startsWith(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}) }

    const rule = map[key]
    if (rule === 'timeout') {
      // Simulate abort
      if (opts?.signal) {
        await new Promise((_, reject) => {
          ;(opts.signal as AbortSignal).addEventListener('abort', () =>
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
          )
        })
      }
      return { ok: false, status: 0, json: async () => ({}) }
    }

    return {
      ok:   rule.status >= 200 && rule.status < 300,
      status: rule.status,
      json: async () => rule.body,
    }
  })
}

// ── localStorage stub ─────────────────────────────────────────────────────────

let store: Record<string, string> = {}

const localStorageMock = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear:      () => { store = {} },
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store = {}
  vi.stubGlobal('localStorage', localStorageMock)
  vi.stubGlobal('fetch', undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  ServerRegistry.clear(REST_ID)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TC-01 — Preferred endpoint responds → found immediately', () => {
  it('returns found with the preferred endpoint', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': { status: 200, body: makeIdentity() },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('found')
    expect(result.endpoint).toBe('http://192.168.1.71:7717')
    expect(result.identity?.restaurant_id).toBe(REST_ID)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('persists the endpoint in the registry on success', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': { status: 200, body: makeIdentity() },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    await disc.discover()

    const record = ServerRegistry.getBest(REST_ID)
    expect(record).not.toBeNull()
    expect(record!.endpoint).toBe('http://192.168.1.71:7717')
    expect(record!.consecutiveFailures).toBe(0)
  })
})

describe('TC-02 — Preferred fails, registry responds → fallback to last successful', () => {
  it('falls back to registry when preferred endpoint is unreachable', async () => {
    // Seed registry with a previously successful endpoint
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   12,
    })

    vi.stubGlobal('fetch', mockFetch({
      'http://127.0.0.1:7717':  { status: 0, body: {} },
      'http://192.168.1.71:7717': { status: 200, body: makeIdentity() },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://127.0.0.1:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('found')
    expect(result.endpoint).toBe('http://192.168.1.71:7717')
  })
})

describe('TC-03 — mDNS unavailable, registry empty, subnet scan finds server', () => {
  it('finds the server via subnet scan when other sources are empty', async () => {
    // Seed registry so we know the subnet to scan
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.99:7717',   // old IP, now dead
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   8,
    })

    // Only .50 responds (server moved to this IP)
    const fetchMap: Record<string, { status: number; body: unknown }> = {}
    fetchMap['http://192.168.1.50:7717'] = { status: 200, body: makeIdentity({ lan_ips: ['192.168.1.50'] }) }

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const key = Object.keys(fetchMap).find(k => url.startsWith(k))
      if (key) return { ok: true, status: 200, json: async () => fetchMap[key].body }
      return { ok: false, status: 0, json: async () => ({}) }
    }))

    const disc = new ServerDiscovery({
      restaurantId:     REST_ID,
      permitSubnetScan: true,
    })
    const result = await disc.discover()

    expect(result.state).toBe('found')
    expect(result.endpoint).toBe('http://192.168.1.50:7717')
  })
})

describe('TC-04 — restaurant_id mismatch → identity_mismatch', () => {
  it('returns identity_mismatch when server belongs to a different restaurant', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': {
        status: 200,
        body:   makeIdentity({ restaurant_id: 'rest-other-999' }),
      },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('identity_mismatch')
    expect(result.diagnostic).toBe('server_found_wrong_restaurant')
    expect(result.identity?.restaurant_id).toBe('rest-other-999')
  })

  it('increments failure count on restaurant mismatch', async () => {
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   10,
    })

    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': {
        status: 200,
        body:   makeIdentity({ restaurant_id: 'rest-other-999' }),
      },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    await disc.discover()

    const records = ServerRegistry.getAll(REST_ID)
    const record = records.find(r => r.endpoint === 'http://192.168.1.71:7717')
    expect(record?.consecutiveFailures).toBe(1)
  })
})

describe('TC-05 — branch_id mismatch → identity_mismatch', () => {
  it('rejects when branch_id does not match provisioned branch', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': {
        status: 200,
        body:   makeIdentity({ branch_id: 'branch-guadalajara-02' }),
      },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      branchId:           BRANCH_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('identity_mismatch')
    expect(result.diagnostic).toBe('server_found_wrong_branch')
  })

  it('allows connection when branch_id is null on the server side', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': {
        status: 200,
        body:   makeIdentity({ branch_id: null }),
      },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      branchId:           BRANCH_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    // branch_id null on server = not yet configured; allow through
    expect(result.state).toBe('found')
  })
})

describe('TC-06 — protocol_version incompatible → not_found', () => {
  it('rejects when server protocol_version does not match', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': {
        status: 200,
        body:   makeIdentity({ protocol_version: '2.0' }),
      },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('not_found')
    expect(result.diagnostic).toBe('protocol_incompatible')
  })
})

describe('TC-07 — IP change: registry stale, subnet scan finds new IP', () => {
  it('discovers new IP via subnet scan when registered IP moved', async () => {
    // Old IP in registry
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   5,
    })

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Old IP is dead; new IP is .100
      if (url.startsWith('http://192.168.1.100:7717')) {
        return { ok: true, status: 200, json: async () => makeIdentity({ lan_ips: ['192.168.1.100'] }) }
      }
      return { ok: false, status: 0, json: async () => ({}) }
    }))

    const disc = new ServerDiscovery({
      restaurantId:     REST_ID,
      permitSubnetScan: true,
    })
    const result = await disc.discover()

    expect(result.state).toBe('found')
    expect(result.endpoint).toBe('http://192.168.1.100:7717')

    // Registry updated to new IP
    const best = ServerRegistry.getBest(REST_ID)
    expect(best?.endpoint).toBe('http://192.168.1.100:7717')
  })
})

describe('TC-08 — Server restart: reconnects to same endpoint', () => {
  it('reconnects after server restart without re-running full scan', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.1.71:7717': { status: 200, body: makeIdentity() },
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
    })

    // First discovery
    const r1 = await disc.discover()
    expect(r1.state).toBe('found')

    // Simulate server restart: second discovery hits the same endpoint
    const r2 = await disc.discover()
    expect(r2.state).toBe('found')
    expect(r2.endpoint).toBe('http://192.168.1.71:7717')
  })
})

describe('TC-09 — All candidates timeout → not_found', () => {
  it('returns not_found when every candidate times out', async () => {
    // All candidates abort
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts?: RequestInit) => {
      await new Promise((_, reject) => {
        ;(opts?.signal as AbortSignal)?.addEventListener('abort', () =>
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
        )
      })
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.71:7717'],
      timeoutMs:          10,
    })
    const result = await disc.discover()

    expect(result.state).toBe('not_found')
    expect(result.diagnostic).toBe('server_not_discovered')
  })
})

describe('TC-10 — No candidates → not_found (no_candidates)', () => {
  it('returns no_candidates when registry is empty and no preferred endpoints given', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const disc = new ServerDiscovery({
      restaurantId: REST_ID,
      // no preferredEndpoints, no registry, no subnet scan
    })
    const result = await disc.discover()

    expect(result.state).toBe('not_found')
    expect(result.diagnostic).toBe('no_candidates')
  })
})

describe('TC-11 — Subnet scan: two servers for same restaurant → ambiguous', () => {
  it('returns ambiguous when subnet scan finds multiple valid servers', async () => {
    // No registry — infer subnet from preferredEndpoints
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (
        url.startsWith('http://192.168.1.50:7717') ||
        url.startsWith('http://192.168.1.71:7717')
      ) {
        return { ok: true, status: 200, json: async () => makeIdentity() }
      }
      return { ok: false, status: 0, json: async () => ({}) }
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      preferredEndpoints: ['http://192.168.1.1:7717'],   // forces subnet 192.168.1
      permitSubnetScan:   true,
    })
    const result = await disc.discover()

    // Preferred endpoint fails; scan finds .50 and .71 → ambiguous
    expect(result.state).toBe('ambiguous')
    expect(result.diagnostic).toBe('multiple_ambiguous_servers')
    expect(result.candidates?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('TC-12 — Subnet scan disabled by default (opt-in only)', () => {
  it('does not scan subnet unless permitSubnetScan is true', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    // Seed registry so there's a subnet to potentially scan
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   5,
    })

    const disc = new ServerDiscovery({
      restaurantId:     REST_ID,
      permitSubnetScan: false,   // explicitly off
    })
    await disc.discover()

    // Should only probe the one registry endpoint, not 30+ hosts
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('TC-13 — Multiple NICs: first IP fails, second valid', () => {
  it('succeeds when Ethernet IP fails but WiFi IP responds', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'http://192.168.0.71:7717': { status: 0, body: {} },    // Ethernet NIC dead
      'http://192.168.1.71:7717': { status: 200, body: makeIdentity() }, // WiFi NIC ok
    }))

    const disc = new ServerDiscovery({
      restaurantId:       REST_ID,
      // Both IPs listed as preferred (multi-NIC aware)
      preferredEndpoints: ['http://192.168.0.71:7717', 'http://192.168.1.71:7717'],
    })
    const result = await disc.discover()

    expect(result.state).toBe('found')
    expect(result.endpoint).toBe('http://192.168.1.71:7717')
  })
})

// ── ServerRegistry unit tests ─────────────────────────────────────────────────

describe('ServerRegistry', () => {
  it('getBest returns null when registry is empty', () => {
    expect(ServerRegistry.getBest(REST_ID)).toBeNull()
  })

  it('getBest excludes records with MAX_CONSECUTIVE_FAILURES', () => {
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   10,
    })

    const max = ServerRegistry._constants.MAX_CONSECUTIVE_FAILURES
    for (let i = 0; i < max; i++) {
      ServerRegistry.recordFailure(REST_ID, 'http://192.168.1.71:7717')
    }

    expect(ServerRegistry.getBest(REST_ID)).toBeNull()
  })

  it('getBest excludes stale records (> 24h)', () => {
    const staleTime = Date.now() - (ServerRegistry._constants.STALE_AFTER_MS + 1_000)
    // Manually set a stale record
    const key = ServerRegistry._constants.STORAGE_KEY
    localStorage.setItem(key, JSON.stringify({
      [REST_ID]: [{
        endpoint:            'http://192.168.1.71:7717',
        restaurantId:        REST_ID,
        branchId:            BRANCH_ID,
        serverId:            SERVER_ID,
        instanceName:        'AMALAY POS',
        version:             VERSION,
        protocolVersion:     PROTOCOL,
        lastSeen:            staleTime,
        lastLatencyMs:       5,
        consecutiveFailures: 0,
      }],
    }))

    expect(ServerRegistry.getBest(REST_ID)).toBeNull()
  })

  it('recordSuccess resets consecutiveFailures', () => {
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   5,
    })
    ServerRegistry.recordFailure(REST_ID, 'http://192.168.1.71:7717')
    ServerRegistry.recordFailure(REST_ID, 'http://192.168.1.71:7717')

    // Re-record success → resets counter
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   5,
    })

    const record = ServerRegistry.getBest(REST_ID)
    expect(record?.consecutiveFailures).toBe(0)
  })

  it('clear removes all records for a restaurant', () => {
    ServerRegistry.recordSuccess({
      endpoint:        'http://192.168.1.71:7717',
      restaurantId:    REST_ID,
      branchId:        BRANCH_ID,
      serverId:        SERVER_ID,
      instanceName:    'AMALAY POS',
      version:         VERSION,
      protocolVersion: PROTOCOL,
      lastSeen:        Date.now(),
      lastLatencyMs:   5,
    })

    ServerRegistry.clear(REST_ID)
    expect(ServerRegistry.getBest(REST_ID)).toBeNull()
    expect(ServerRegistry.getAll(REST_ID)).toHaveLength(0)
  })
})

// ── buildDiscoveryConfig ──────────────────────────────────────────────────────

describe('buildDiscoveryConfig', () => {
  it('includes pos_bridge_host from localStorage if set', () => {
    localStorage.setItem('pos_bridge_host', '192.168.1.71')
    const cfg = buildDiscoveryConfig(REST_ID)
    expect(cfg.preferredEndpoints).toContain('http://192.168.1.71:7717')
  })

  it('always includes 127.0.0.1 as a preferred endpoint', () => {
    const cfg = buildDiscoveryConfig(REST_ID)
    expect(cfg.preferredEndpoints).toContain('http://127.0.0.1:7717')
  })

  it('deduplicates if pos_bridge_host is 127.0.0.1', () => {
    localStorage.setItem('pos_bridge_host', '127.0.0.1')
    const cfg = buildDiscoveryConfig(REST_ID)
    const count = cfg.preferredEndpoints!.filter(ep => ep === 'http://127.0.0.1:7717').length
    expect(count).toBe(1)
  })
})
