'use client'
// ── Fullsite BridgeClient ─────────────────────────────────────────────────────
// Connects a web page (POS / KDS / Plano) to the Fullsite Local Server via WS.
// Optional — pages fall back to direct Supabase polling when not in Electron.
//
// Protocol v1.0 (see electron-app/local-server/protocol.js):
//   Client → SUBSCRIBE, COMMAND, PING
//   Server → SNAPSHOT, DELTA, ACK, REJECT, PONG, UPDATE_AVAILABLE

import { useEffect, useRef, useState } from 'react'

const PROTOCOL_VERSION = '1.0'
const LOCAL_PORT = 7717

// Reconnect delay: exponential backoff, 1s → 2s → 4s → … capped at 30s
const RECONNECT_INITIAL_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function getBridgeUrl(): string {
  if (typeof window === 'undefined') return `ws://127.0.0.1:${LOCAL_PORT}/ws`
  // Cross-device: KDS on a different machine points to the POS server's LAN IP
  const stored = localStorage.getItem('pos_bridge_host')
  if (stored) return `ws://${stored}:${LOCAL_PORT}/ws`
  return `ws://127.0.0.1:${LOCAL_PORT}/ws`
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

  constructor(
    private readonly clientId: string,
    private readonly clientType: 'pos' | 'kds' | 'barra' | 'admin' = 'pos',
    private readonly restaurantId?: string,
    lastSequence = 0,
  ) {
    this._lastSequence = lastSequence
  }

  get connected() { return this._connected }
  get lastSequence() { return this._lastSequence }

  connect() {
    if (this.dead) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return
    try {
      this.ws = new WebSocket(getBridgeUrl())

      this.ws.onopen = () => {
        this._connected = true
        this._reconnectDelay = RECONNECT_INITIAL_MS  // reset backoff on successful connection
        this._send({
          type: 'SUBSCRIBE',
          client_id: this.clientId,
          client_type: this.clientType,
          restaurant_id: this.restaurantId,
          last_sequence: this._lastSequence,
        })
        this.pingTimer = setInterval(() => this._send({ type: 'PING', client_id: this.clientId }), 25_000)
      }

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMsg
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
    if (this.ws?.readyState !== WebSocket.OPEN) return null
    const commandId = `${this.clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    this._send({
      type: 'COMMAND',
      restaurant_id: this.restaurantId,
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

/**
 * useBridgeClient — subscribe a page to DELTA events from the local server.
 *
 * Only connects inside Electron (navigator.userAgent includes 'Electron').
 * Safe no-op in regular browsers — existing Supabase polling still works.
 *
 * @param onDelta  callback fired on every ORDER_UPSERTED / MESA_LOCK / etc. event
 * @param clientType  'pos' | 'kds' | 'barra' | 'admin'
 * @returns { connected } — true when WS handshake with local server succeeded
 */
export function useBridgeClient(
  onDelta?: (event: BridgeEvent) => void,
  clientType: 'pos' | 'kds' | 'barra' | 'admin' = 'pos',
): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const onDeltaRef = useRef(onDelta)
  onDeltaRef.current = onDelta

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Connect in Electron OR in any browser with a configured bridge host
    const isElectron = navigator.userAgent.includes('Electron')
    const hasBridgeHost = !!localStorage.getItem('pos_bridge_host')
    if (!isElectron && !hasBridgeHost) return

    const clientId =
      localStorage.getItem('pos_terminal_id') ||
      `web-${Math.random().toString(36).slice(2, 10)}`

    const restaurantId = localStorage.getItem('fullsite_client_id') || undefined

    const client = new BridgeClient(clientId, clientType, restaurantId)

    const unsub = client.on((msg) => {
      if (msg.type === 'SNAPSHOT' || msg.type === 'PONG') setConnected(true)
      if (msg.type === 'DELTA' && onDeltaRef.current) {
        onDeltaRef.current((msg as Extract<ServerMsg, { type: 'DELTA' }>).payload.event)
      }
    })

    client.connect()
    const statusInterval = setInterval(() => setConnected(client.connected), 3_000)

    return () => {
      unsub()
      clearInterval(statusInterval)
      client.disconnect()
    }
  }, [clientType])

  return { connected }
}
