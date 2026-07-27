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
const WS_URL = 'ws://127.0.0.1:7717/ws'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeEvent = {
  type: string
  payload: unknown
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

  constructor(
    private readonly clientId: string,
    private readonly clientType: 'pos' | 'kds' | 'barra' | 'admin' = 'pos',
  ) {}

  connect() {
    if (this.dead) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return
    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        this._connected = true
        this._send({ type: 'SUBSCRIBE', client_id: this.clientId, client_type: this.clientType, last_sequence: 0 })
        this.pingTimer = setInterval(() => this._send({ type: 'PING', client_id: this.clientId }), 25_000)
      }

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMsg
          for (const h of this.handlers) h(msg)
        } catch { /* malformed frame */ }
      }

      this.ws.onclose = () => {
        this._connected = false
        if (this.pingTimer) clearInterval(this.pingTimer)
        if (!this.dead) this.reconnectTimer = setTimeout(() => this.connect(), 3_000)
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

  get connected() { return this._connected }

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
    if (!navigator.userAgent.includes('Electron')) return  // browser-only guard

    const clientId =
      localStorage.getItem('pos_terminal_id') ||
      `web-${Math.random().toString(36).slice(2, 10)}`

    const client = new BridgeClient(clientId, clientType)

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
