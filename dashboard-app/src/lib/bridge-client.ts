'use client'
// ── Fullsite BridgeClient ─────────────────────────────────────────────────────
// Connects a web page (POS / KDS / Plano) to the Fullsite Local Server via WS.
// Optional — pages fall back to direct Supabase polling when not in Electron.
//
// Protocol v1.0 (see electron-app/local-server/protocol.js):
//   Client → SUBSCRIBE, COMMAND, PING
//   Server → SNAPSHOT, DELTA, ACK, REJECT, PONG, UPDATE_AVAILABLE
//
// LAN-03: the hook (useBridgeClient) runs ServerDiscovery before connecting.
//   Discovery validates the server's identity (restaurant_id, protocol_version)
//   via GET /identity before opening the WebSocket. The discovered endpoint is
//   persisted in the ServerRegistry for faster subsequent connections.

import { currentKitchenScope, type KitchenReadScope } from './kitchen-read-scope'
import { useEffect, useRef, useState } from 'react'
import { credencialDeLaRedLocal } from './local-network-fetch'
import { getBridgeUrl as getHttpBridgeUrl } from './bridge-url'
import { actorDeCaja } from './pedro-actor'
import { ServerDiscovery, buildDiscoveryConfig, type DiscoveryDiagnostic } from './server-discovery'

const PROTOCOL_VERSION = '1.0'
const LOCAL_PORT = 7717

// Reconnect delay: exponential backoff, 1s → 2s → 4s → … capped at 30s
const RECONNECT_INITIAL_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function getBridgeUrl(wsUrlOverride?: string): string {
  if (wsUrlOverride) return wsUrlOverride
  if (typeof window === 'undefined') return `ws://127.0.0.1:${LOCAL_PORT}/ws`
  if (localStorage.getItem('FULLSITE_BRIDGE_URL')) return httpToWs(getHttpBridgeUrl())
  const stored = localStorage.getItem('pos_bridge_host')
  if (stored) return `ws://${stored}:${LOCAL_PORT}/ws`
  return `ws://127.0.0.1:${LOCAL_PORT}/ws`
}

/** Convert a discovered HTTP endpoint to the WS URL. */
function httpToWs(httpEndpoint: string): string {
  return httpEndpoint.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '') + '/ws'
}

/** Call once (e.g. from ?bridge= URL param) to register the POS server IP for this device */
export function setPosServerHost(ip: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('pos_bridge_host', ip)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeEvent = {
  id?: string
  type: string
  payload: Record<string, unknown>
  ts?: number
  sequence?: number
}

type ServerMsg =
  | { type: 'SNAPSHOT'; sequence: number; payload: { state: unknown; deltas: BridgeEvent[] } }
  | { type: 'DELTA';    sequence: number; payload: { event: BridgeEvent } }
  | { type: 'ACK';      payload: { command_id: string; duplicate?: boolean } }
  | { type: 'REJECT';   payload: { command_id?: string; reason: string } }
  | { type: 'PONG';     sequence: number }
  | { type: 'UPDATE_AVAILABLE'; payload: { version: string; notes: string } }

type MsgHandler = (msg: ServerMsg) => void

// ── BridgeClient class ────────────────────────────────────────────────────────

export class BridgeClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MsgHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private _connected = false
  private dead = false
  private _reconnectDelay = RECONNECT_INITIAL_MS
  private _lastSequence: number
  private _reconnectCount = 0

  constructor(
    private readonly clientId: string,
    private readonly clientType: 'pos' | 'kds' | 'barra' | 'admin' = 'pos',
    private readonly restaurantId?: string,
    lastSequence = 0,
    /** If set, overrides the URL derived from localStorage. Provided by discovery. */
    private readonly _wsUrl?: string,
    private readonly credentials = credencialDeLaRedLocal(),
  ) {
    this._lastSequence = lastSequence
  }

  get connected() { return this._connected }
  get lastSequence() { return this._lastSequence }
  get reconnectCount() { return this._reconnectCount }

  connect() {
    if (this.dead) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return
    try {
      this.ws = new WebSocket(getBridgeUrl(this._wsUrl))

      this.ws.onopen = () => {
        this._connected = false
        this._reconnectDelay = RECONNECT_INITIAL_MS  // reset backoff on successful connection
        this._send({
          type: 'SUBSCRIBE',
          lan_secret: this.credentials['x-fullsite-lan'],
          location_id: this.credentials['x-fullsite-sucursal'],
          client_id: this.clientId,
          terminal_id: this.credentials['x-fullsite-terminal'],
          client_type: this.clientType,
          restaurant_id: this.restaurantId,
          last_sequence: this._lastSequence,
        })
        this.pingTimer = setInterval(() => this._send({ type: 'PING', client_id: this.clientId }), 25_000)
      }

      this.ws.onmessage = (ev) => {
        try {
          if (this.dead || JSON.stringify(this.credentials) !== JSON.stringify(credencialDeLaRedLocal())) return
          const msg = JSON.parse(ev.data as string) as ServerMsg
          if (msg.type === 'SNAPSHOT') this._connected = true
          // Track the highest sequence seen for catch-up on reconnect
          const seq = (msg as { sequence?: number }).sequence
          if (typeof seq === 'number' && seq > this._lastSequence) {
            this._lastSequence = seq
          }
          for (const h of this.handlers) h(msg)
        } catch { /* malformed frame */ }
      }

      this.ws.onclose = () => {
        this._connected = false
        this._reconnectCount++
        if (this.pingTimer) clearInterval(this.pingTimer)
        if (!this.dead) {
          this.reconnectTimer = setTimeout(() => {
            this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS)
            this.connect()
          }, this._reconnectDelay)
        }
      }

      this.ws.onerror = () => { this.ws?.close() }
    } catch { /* WebSocket not available (SSR) */ }
  }

  disconnect() {
    this.dead = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
  }

  /** Subscribe to all server messages. Returns an unsubscribe function. */
  on(handler: MsgHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Send a COMMAND to the local server. Returns the generated command_id.
   * Caller can match ACK/REJECT responses by command_id.
   * No-op (returns null) if the WS is not open.
   */
  sendCommand(commandType: string, payload: Record<string, unknown>): string | null {
    if (JSON.stringify(this.credentials) !== JSON.stringify(credencialDeLaRedLocal())) return null
    if (!this._connected || this.ws?.readyState !== WebSocket.OPEN) return null
    const commandId = typeof payload.command_id === 'string' ? payload.command_id : crypto.randomUUID()
    this._send({
      type: 'COMMAND',
      restaurant_id: this.restaurantId,
      actor_token: actorDeCaja()?.actor_token,
      payload: {
        command_id: commandId,
        command_type: commandType,
        client_id: this.clientId,
        ...payload,
      },
    })
    return commandId
  }

  private _send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, ...data }))
    }
  }
}

// ── React hook ────────────────────────────────────────────────────────────────

export type DiscoveryState = 'idle' | 'discovering' | 'found' | 'not_found' | 'identity_mismatch' | 'ambiguous'

/**
 * useBridgeClient — subscribe a page to DELTA events from the local server.
 *
 * LAN-03: before opening the WebSocket, runs ServerDiscovery to validate the
 * server's identity (restaurant_id + protocol_version) via GET /identity.
 * Only connects to a server whose identity matches the provisioned restaurant.
 *
 * Safe no-op in regular browsers without a configured bridge host.
 *
 * @param onDelta     callback fired on every ORDER_UPSERTED / MESA_LOCK / etc.
 * @param clientType  'pos' | 'kds' | 'barra' | 'admin'
 * @returns { connected, discoveryState, discoveryDiagnostic }
 */
export function useBridgeClient(
  onDelta?: (event: BridgeEvent, scope?: KitchenReadScope) => void,
  clientType: 'pos' | 'kds' | 'barra' | 'admin' = 'pos',
): { connected: boolean; discoveryState: DiscoveryState; discoveryDiagnostic: DiscoveryDiagnostic | undefined } {
  const [connected, setConnected] = useState(false)
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>('idle')
  const [discoveryDiagnostic, setDiscoveryDiagnostic] = useState<DiscoveryDiagnostic | undefined>()
  const [identityKey, setIdentityKey] = useState('')
  useEffect(() => {
    const refresh = () => setIdentityKey(JSON.stringify([currentKitchenScope(), credencialDeLaRedLocal()]))
    refresh()
    const timer = setInterval(refresh, 500)
    window.addEventListener('storage', refresh)
    return () => { clearInterval(timer); window.removeEventListener('storage', refresh) }
  }, [])
  const onDeltaRef = useRef(onDelta)
  onDeltaRef.current = onDelta

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isElectron = navigator.userAgent.includes('Electron')
    const hasBridgeHost = !!(localStorage.getItem('FULLSITE_BRIDGE_URL') || localStorage.getItem('pos_bridge_host'))
    if (!isElectron && !hasBridgeHost) return

    setConnected(false)
    const credentials = credencialDeLaRedLocal()
    const capturedScope = currentKitchenScope()
    const stillCurrent = () => JSON.stringify(credentials) === JSON.stringify(credencialDeLaRedLocal()) && JSON.stringify(capturedScope) === JSON.stringify(currentKitchenScope())
    const restaurantId = localStorage.getItem('fullsite_client_id') || undefined
    if (!restaurantId) return

    const clientId =
      localStorage.getItem('pos_terminal_id') ||
      `web-${Math.random().toString(36).slice(2, 10)}`

    let client: BridgeClient | null = null
    let statusInterval: ReturnType<typeof setInterval> | null = null
    let unsub: (() => void) | null = null
    let cancelled = false
    let rediscovering = false

    async function setup() {
      setDiscoveryState('discovering')

      const discovery = new ServerDiscovery(buildDiscoveryConfig(restaurantId!))
      const result = await discovery.discover()

      if (cancelled || !stillCurrent()) return

      if (result.state !== 'found') {
        setDiscoveryState(result.state as DiscoveryState)
        setDiscoveryDiagnostic(result.diagnostic)
        return
      }

      const identity = result.identity
      const deliveryScope = credentials['x-fullsite-lan'] && identity?.restaurant_id === capturedScope.clientId &&
        (identity.branch_id || '') === capturedScope.locationId ? capturedScope : undefined
      setDiscoveryState('found')
      setDiscoveryDiagnostic(undefined)

      // Convert the discovered HTTP endpoint to a WS URL
      const wsUrl = httpToWs(result.endpoint!)

      // Restore last known sequence so the server only sends events we haven't seen.
      // Without this, every page load replays the full event history (KDS-03 fix).
      const seqKey = `pos_bridge_last_seq_${clientType}_${encodeURIComponent(restaurantId!)}_${encodeURIComponent(capturedScope.locationId)}`
      const savedSeq = parseInt(localStorage.getItem(seqKey) || '0', 10) || 0

      client = new BridgeClient(clientId, clientType, restaurantId, savedSeq, wsUrl, credentials)

      unsub = client.on((msg) => {
        if (cancelled || !stillCurrent()) return
        if (msg.type === 'SNAPSHOT' || msg.type === 'PONG') setConnected(true)
        if (msg.type === 'DELTA' && onDeltaRef.current) {
          onDeltaRef.current((msg as Extract<ServerMsg, { type: 'DELTA' }>).payload.event, deliveryScope)
        }
        // Persist lastSequence so next page load resumes from here, not from 0.
        const seq = (msg as { sequence?: number }).sequence
        if (typeof seq === 'number' && seq > 0) {
          try { localStorage.setItem(seqKey, String(seq)) } catch {}
        }
      })

      client.connect()
      if (statusInterval) clearInterval(statusInterval)
      statusInterval = setInterval(() => {
        setConnected(client?.connected ?? false)
        // Re-run full discovery when the server IP may have changed (DHCP renew, server restart).
        // After 5 failed reconnects the current WS URL is likely stale — re-discover before continuing.
        if (!rediscovering && client && !client.connected && client.reconnectCount > 5) {
          rediscovering = true
          client.disconnect()
          if (unsub) { unsub(); unsub = null }
          client = null
          setDiscoveryState('discovering')
          setup()
            .catch(() => { if (!cancelled) setDiscoveryState('not_found') })
            .finally(() => { rediscovering = false })
        }
      }, 3_000)
    }

    setup().catch(() => {
      if (!cancelled) setDiscoveryState('not_found')
    })

    return () => {
      cancelled = true
      if (unsub) unsub()
      if (statusInterval) clearInterval(statusInterval)
      client?.disconnect()
    }
  }, [clientType, identityKey])

  return { connected, discoveryState, discoveryDiagnostic }
}
