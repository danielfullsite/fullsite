'use client'
// ── ServerDiscovery ───────────────────────────────────────────────────────────
// Finds the Fullsite Local Server on the LAN using a layered strategy:
//
//   1. Preferred endpoints   (from config.json via localStorage / ?bridge= param)
//   2. Registry              (last successful endpoints for this restaurant)
//   3. Subnet scan           (restricted /24 scan, opt-in only, capped at MAX_SUBNET_HOSTS)
//   4. Manual / fallback     (caller handles: show diagnostic UI, try again with manual IP)
//
// Security: identity is validated via GET /identity before a WS is opened.
//   - mDNS announces the server (discovery hint)
//   - /identity validates the server (security gate)
//   - A terminal NEVER connects to a server with a different restaurant_id
//
// Network terminology used throughout this file:
//   "sin internet"     = no cloud access (Supabase / Vercel unreachable)
//   "sin LAN"          = Local Server unreachable (multi-terminal coordination broken)
//   "sin ambas"        = IDB-only mode (no real-time, no printing)
//
// Note on HTTPS → HTTP: browsers block fetch() to http:// from https:// pages
// (mixed content). Inside Electron this restriction does not apply. For Chrome-
// based KDS clients on the same LAN, discovery works only if the page itself is
// served over HTTP (not HTTPS). This is a known limitation, not a bug.

import { ServerRegistry, type ServerRecord } from './server-registry'

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCAL_PORT = 7717
const IDENTITY_PATH = '/identity'
const EXPECTED_PROTOCOL_VERSION = '1.0'
const DEFAULT_TIMEOUT_MS = 2_000
const SCAN_TIMEOUT_MS = 500      // per-host timeout during subnet scan
const MAX_SUBNET_HOSTS = 30       // hard cap: never scan more than this many hosts per run

// ── Types ─────────────────────────────────────────────────────────────────────

/** The full identity payload returned by GET /identity. */
export interface ServerIdentity {
  ok: boolean
  server_id: string
  restaurant_id: string
  branch_id: string | null
  instance_name: string
  version: string
  protocol_version: string
  capabilities: string[]
  lan_ips: string[]
  ts: number
}

/** Why discovery failed — granular enough for a useful diagnostic UI. */
export type DiscoveryDiagnostic =
  | 'server_not_discovered'         // No candidate responded on port 7717
  | 'server_found_wrong_restaurant' // /identity returned different restaurant_id
  | 'server_found_wrong_branch'     // /identity returned different branch_id
  | 'protocol_incompatible'         // Server protocol_version doesn't match
  | 'no_candidates'                 // No IPs to even try
  | 'multiple_ambiguous_servers'    // Subnet scan found valid servers for different restaurants

export interface DiscoveredServer {
  endpoint: string          // 'http://192.168.1.71:7717'
  identity: ServerIdentity
}

export interface DiscoveryResult {
  state: 'found' | 'not_found' | 'identity_mismatch' | 'ambiguous'
  /** Set when state === 'found' */
  endpoint?: string
  /** Set when state === 'found' */
  identity?: ServerIdentity
  /** Round-trip to /identity in ms. Set when state === 'found'. */
  latencyMs?: number
  /** Precise failure reason. Set when state !== 'found'. */
  diagnostic?: DiscoveryDiagnostic
  /** Set when state === 'ambiguous' — caller must resolve. */
  candidates?: DiscoveredServer[]
}

export interface DiscoveryConfig {
  restaurantId: string
  /** Optional: if provided, the server's branch_id must match. */
  branchId?: string
  /**
   * Ordered list of HTTP base-URLs to try first.
   * Format: 'http://192.168.1.71:7717'
   * Typically built from localStorage('pos_bridge_host') + '127.0.0.1'.
   */
  preferredEndpoints?: string[]
  /**
   * Scan the /24 subnet of the last known server IP as a last resort.
   * Off by default. Enable for terminals that may roam between subnets.
   */
  permitSubnetScan?: boolean
  /** Per-candidate timeout in ms. Default: 2000ms. */
  timeoutMs?: number
}

// ── ServerDiscovery ───────────────────────────────────────────────────────────

export class ServerDiscovery {
  private readonly restaurantId: string
  private readonly branchId: string | undefined
  private readonly preferredEndpoints: string[]
  private readonly permitSubnetScan: boolean
  private readonly timeoutMs: number

  constructor(config: DiscoveryConfig) {
    this.restaurantId = config.restaurantId
    this.branchId = config.branchId
    this.preferredEndpoints = config.preferredEndpoints ?? []
    this.permitSubnetScan = config.permitSubnetScan ?? false
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Run the full discovery sequence. Returns as soon as the first valid server is found.
   * Never throws — always returns a DiscoveryResult.
   *
   * Strategy order:
   *   1. Preferred endpoints (from caller — config / ?bridge= / localStorage)
   *   2. Registry records (last successful for this restaurant)
   *   3. Subnet scan (if permitSubnetScan === true)
   */
  async discover(): Promise<DiscoveryResult> {
    const tried = new Set<string>()

    // ── 1. Preferred endpoints (provisioned config / ?bridge= / localhost) ──
    for (const endpoint of this.preferredEndpoints) {
      if (tried.has(endpoint)) continue
      tried.add(endpoint)
      const result = await this._validateEndpoint(endpoint)
      if (result) return result
    }

    // ── 2. Registry (previous successful connections) ──────────────────────
    const records = ServerRegistry.getAll(this.restaurantId)
    for (const record of records) {
      if (tried.has(record.endpoint)) continue
      tried.add(record.endpoint)
      const result = await this._validateEndpoint(record.endpoint)
      if (result) return result
    }

    // ── 3. Subnet scan (opt-in, restricted) ───────────────────────────────
    if (this.permitSubnetScan) {
      const scanResult = await this._subnetScan(tried)
      if (scanResult) return scanResult
    }

    // ── Nothing found ─────────────────────────────────────────────────────
    return {
      state: 'not_found',
      diagnostic: tried.size === 0 ? 'no_candidates' : 'server_not_discovered',
    }
  }

  /**
   * Validate a single endpoint by fetching its /identity.
   *
   * Returns:
   *   - DiscoveryResult with state='found' → valid server, registry updated
   *   - DiscoveryResult with state='identity_mismatch' → reachable but wrong restaurant
   *   - null → unreachable (timeout / port closed / malformed response)
   */
  async _validateEndpoint(endpoint: string): Promise<DiscoveryResult | null> {
    const t0 = Date.now()
    const identity = await this._fetchIdentity(endpoint, this.timeoutMs)
    const latencyMs = Date.now() - t0

    if (!identity) return null  // timeout / port closed — skip silently

    // Protocol version check (strict equality for now; relaxed in future with semver)
    if (identity.protocol_version !== EXPECTED_PROTOCOL_VERSION) {
      return { state: 'not_found', diagnostic: 'protocol_incompatible' }
    }

    // restaurant_id must match the provisioned config
    if (identity.restaurant_id !== this.restaurantId) {
      ServerRegistry.recordFailure(this.restaurantId, endpoint)
      return {
        state: 'identity_mismatch',
        endpoint,
        identity,
        diagnostic: 'server_found_wrong_restaurant',
      }
    }

    // branch_id check (future-ready; skip if either side is null)
    if (this.branchId && identity.branch_id && identity.branch_id !== this.branchId) {
      ServerRegistry.recordFailure(this.restaurantId, endpoint)
      return {
        state: 'identity_mismatch',
        endpoint,
        identity,
        diagnostic: 'server_found_wrong_branch',
      }
    }

    // All checks pass — persist and return
    ServerRegistry.recordSuccess({
      endpoint,
      restaurantId: identity.restaurant_id,
      branchId: identity.branch_id,
      serverId: identity.server_id,
      instanceName: identity.instance_name,
      version: identity.version,
      protocolVersion: identity.protocol_version,
      lastSeen: Date.now(),
      lastLatencyMs: latencyMs,
    })

    return { state: 'found', endpoint, identity, latencyMs }
  }

  /**
   * Fetch /identity from an endpoint. Returns null on any failure (timeout,
   * network error, non-200, malformed JSON, missing required fields).
   */
  async _fetchIdentity(endpoint: string, timeoutMs: number): Promise<ServerIdentity | null> {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(`${endpoint}${IDENTITY_PATH}`, {
        signal: controller.signal,
        cache: 'no-store',
      }).finally(() => clearTimeout(t))

      if (!res.ok) return null

      const data = await res.json()
      // Validate required fields before returning
      if (
        !data?.ok ||
        typeof data?.server_id !== 'string' ||
        typeof data?.restaurant_id !== 'string' ||
        typeof data?.protocol_version !== 'string'
      ) return null

      return data as ServerIdentity
    } catch {
      return null
    }
  }

  /**
   * Probe all host IPs in the /24 subnet of the last known server.
   * Runs all probes in parallel with a short per-host timeout.
   * Returns:
   *   - DiscoveryResult with state='found' if exactly one valid server found
   *   - DiscoveryResult with state='ambiguous' if multiple found (caller must resolve)
   *   - null if nothing found
   */
  private async _subnetScan(alreadyTried: Set<string>): Promise<DiscoveryResult | null> {
    const subnet = this._inferSubnet()
    if (!subnet) return null

    const hosts = this._subnetHosts(subnet, alreadyTried)
    if (hosts.length === 0) return null

    const probes = await Promise.all(
      hosts.map(async (host): Promise<DiscoveredServer | null> => {
        const endpoint = `http://${host}:${LOCAL_PORT}`
        const identity = await this._fetchIdentity(endpoint, SCAN_TIMEOUT_MS)
        if (!identity) return null
        if (identity.protocol_version !== EXPECTED_PROTOCOL_VERSION) return null
        if (identity.restaurant_id !== this.restaurantId) return null
        return { endpoint, identity }
      })
    )

    const found = probes.filter((r): r is DiscoveredServer => r !== null)

    if (found.length === 0) return null

    if (found.length === 1) {
      // Single result — run through full validation to update registry
      return this._validateEndpoint(found[0].endpoint)
    }

    // Multiple valid servers for this restaurant — ambiguous, needs human resolution
    return {
      state: 'ambiguous',
      candidates: found,
      diagnostic: 'multiple_ambiguous_servers',
    }
  }

  /**
   * Infer the /24 subnet to scan from the registry or preferred endpoints.
   * Returns 'X.Y.Z' (three octets) or null if no known IP.
   */
  private _inferSubnet(): string | null {
    const best: ServerRecord | null = ServerRegistry.getBest(this.restaurantId)
    if (best) {
      const m = best.endpoint.match(/http:\/\/(\d+\.\d+\.\d+)\.\d+:/)
      if (m) return m[1]
    }
    for (const ep of this.preferredEndpoints) {
      const m = ep.match(/http:\/\/(\d+\.\d+\.\d+)\.\d+:/)
      if (m) return m[1]
    }
    return null
  }

  /**
   * Build a prioritized, capped list of IPs to scan in a /24 subnet.
   * Probes common server addresses first, then sequential fill.
   */
  private _subnetHosts(subnet: string, alreadyTried: Set<string>): string[] {
    const PRIORITY = [1, 2, 10, 20, 50, 71, 100, 150, 200, 254]  // .71 common in AMALAY-class setups
    const result: string[] = []
    const prioritySet = new Set(PRIORITY)

    for (const n of PRIORITY) {
      const ip = `${subnet}.${n}`
      if (!alreadyTried.has(`http://${ip}:${LOCAL_PORT}`)) result.push(ip)
    }
    for (let n = 1; n <= 254 && result.length < MAX_SUBNET_HOSTS; n++) {
      if (prioritySet.has(n)) continue
      const ip = `${subnet}.${n}`
      if (!alreadyTried.has(`http://${ip}:${LOCAL_PORT}`)) result.push(ip)
    }
    return result.slice(0, MAX_SUBNET_HOSTS)
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Build a DiscoveryConfig from what's available in localStorage.
 * Used by useBridgeClient to wire discovery into the WS connection loop.
 *
 * Preferred endpoint order:
 *   1. pos_bridge_host (set by ?bridge= param or manual config)
 *   2. 127.0.0.1 (for the SERVER1 machine running the Local Server)
 */
export function buildDiscoveryConfig(restaurantId: string, opts?: {
  branchId?: string
  permitSubnetScan?: boolean
  timeoutMs?: number
}): DiscoveryConfig {
  const endpoints: string[] = []

  if (typeof localStorage !== 'undefined') {
    const storedHost = localStorage.getItem('pos_bridge_host')
    if (storedHost) {
      endpoints.push(`http://${storedHost}:${LOCAL_PORT}`)
    }
  }

  const localEndpoint = `http://127.0.0.1:${LOCAL_PORT}`
  if (!endpoints.includes(localEndpoint)) {
    endpoints.push(localEndpoint)
  }

  return {
    restaurantId,
    branchId: opts?.branchId,
    preferredEndpoints: endpoints,
    permitSubnetScan: opts?.permitSubnetScan ?? false,
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export { MAX_SUBNET_HOSTS, EXPECTED_PROTOCOL_VERSION }
