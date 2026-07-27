'use client'
// ── useKdsWsClient ─────────────────────────────────────────────────────────────
// KDS-02: connects the KDS to the Local Server as PRIMARY data source.
//
// Normal route:
//   KDS starts → BridgeClient connects → SUBSCRIBE (with last_sequence for catch-up)
//   → receives SNAPSHOT (kds_orders array, deltas) → applies locally
//   → listens to DELTA events → updates state without Supabase round-trip
//   → KDS actions → COMMAND to Local Server → ACK → broadcast to POS/KDS
//
// Supabase remains: sync later, cloud backup, fallback when WS down.
//
// Mode lifecycle:
//   OFFLINE      – no Local Server available (browser without bridge host)
//   RECONCILING  – WS connecting; showing IDB-cached orders from prior session
//   LAN_PRIMARY  – WS healthy; SNAPSHOT applied; deltas flowing
//   FALLBACK     – WS was connected but lost; Supabase polling takes over

import { useCallback, useEffect, useRef, useState } from 'react'
import { BridgeClient, type BridgeEvent } from '@/lib/bridge-client'
import type { KitchenOrderFromDB } from '@/lib/pos-data'

export type KdsMode = 'LAN_PRIMARY' | 'RECONCILING' | 'FALLBACK' | 'OFFLINE'

// localStorage keys (one KDS session per device, no collision)
const LS_SEQ_KEY     = 'kds_last_sequence'
const LS_SEEN_KEY    = 'kds_seen_event_ids'
const LS_CACHE_KEY   = 'kds_orders_cache'
const SEEN_MAX       = 256   // sliding dedup window

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadSeq(): number {
  try { return parseInt(localStorage.getItem(LS_SEQ_KEY) || '0', 10) || 0 } catch { return 0 }
}
function saveSeq(s: number) {
  try { localStorage.setItem(LS_SEQ_KEY, String(s)) } catch {}
}
function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN_KEY) || '[]')) } catch { return new Set() }
}
function saveSeen(ids: Set<string>) {
  try {
    const arr = [...ids]
    localStorage.setItem(LS_SEEN_KEY, JSON.stringify(arr.slice(-SEEN_MAX)))
  } catch {}
}
function loadCachedOrders(): KitchenOrderFromDB[] {
  try { return JSON.parse(localStorage.getItem(LS_CACHE_KEY) || '[]') } catch { return [] }
}
function saveCachedOrders(orders: KitchenOrderFromDB[]) {
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(orders)) } catch {}
}

// ── Order normalizer ──────────────────────────────────────────────────────────
// Converts a raw server payload (from SNAPSHOT kds_orders or DELTA payload)
// into the KitchenOrderFromDB shape expected by the KDS page.

function normalizeOrder(raw: Record<string, unknown>, existing?: KitchenOrderFromDB): KitchenOrderFromDB {
  const id = ((raw.id || raw.order_id) as string) ?? ''
  return {
    id,
    mesa:            (raw.mesa as number)  ?? existing?.mesa ?? 0,
    mesero:          (raw.mesero as string) ?? existing?.mesero ?? '',
    status:          (raw.status as string) ?? existing?.status ?? 'enviada',
    items:           typeof raw.items === 'string'   ? raw.items   : (existing?.items ?? '[]'),
    kds_item_status: raw.kds_item_status !== undefined
                       ? (typeof raw.kds_item_status === 'string' ? raw.kds_item_status : JSON.stringify(raw.kds_item_status))
                       : (existing?.kds_item_status ?? null),
    comanda_batches: raw.comanda_batches !== undefined
                       ? (typeof raw.comanda_batches === 'string' ? raw.comanda_batches : JSON.stringify(raw.comanda_batches))
                       : (existing?.comanda_batches ?? null),
    notas:           (raw.notas as string | null) ?? existing?.notas ?? null,
    created_at:      (raw.created_at as string) ?? existing?.created_at ?? new Date().toISOString(),
  }
}

// Active-order filter: orders visible in KDS (not yet fully delivered/closed)
function isActive(o: KitchenOrderFromDB) {
  return o.status !== 'entregada' && o.status !== 'cerrada'
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseKdsWsClientResult {
  /** Current KDS orders (LAN primary when connected, or last-known cache) */
  orders: KitchenOrderFromDB[]
  mode: KdsMode
  lastSequence: number
  connected: boolean
  /**
   * Send a COMMAND to the local server for a KDS action.
   * The caller is responsible for the Supabase dual-write (Phase-1 requirement).
   * Returns the command_id for matching ACK/REJECT, or null if WS is not ready.
   */
  sendCommand: (commandType: string, payload: Record<string, unknown>) => string | null
  /**
   * Replace the orders directly (e.g., when the Supabase fallback poll returns).
   * Ignored when mode is LAN_PRIMARY (Local Server is authoritative in that mode).
   */
  setFallbackOrders: (orders: KitchenOrderFromDB[]) => void
}

export function useKdsWsClient(restaurantId?: string): UseKdsWsClientResult {
  const [mode, setMode]     = useState<KdsMode>('OFFLINE')
  const [connected, setConnected] = useState(false)
  const [lastSequence, setLastSequence] = useState(0)

  // ordersMap is the source of truth; React state is derived.
  // Using ref avoids stale closures in event handlers.
  const ordersMap = useRef<Map<string, KitchenOrderFromDB>>(new Map())
  // Tracks orderIds already received via ORDER_SENT (for second-round detection)
  const sentOrderIds = useRef<Set<string>>(new Set())
  const [orders, setOrders] = useState<KitchenOrderFromDB[]>([])

  const seenIds   = useRef<Set<string>>(new Set())
  const clientRef = useRef<BridgeClient | null>(null)
  const modeRef   = useRef<KdsMode>('OFFLINE')

  // Derived state flush: publish ordersMap → React state + cache
  const flush = useCallback(() => {
    const active = [...ordersMap.current.values()].filter(isActive)
    setOrders(active)
    saveCachedOrders(active)
  }, [])

  // Apply one event to the ordersMap. Returns true if the map changed.
  const applyEvent = useCallback((event: BridgeEvent & { sequence?: number }): boolean => {
    const evId = event.id
    if (evId) {
      if (seenIds.current.has(evId)) return false  // deduplicate
      seenIds.current.add(evId)
      if (seenIds.current.size > SEEN_MAX * 1.5) {
        const arr = [...seenIds.current]
        seenIds.current = new Set(arr.slice(-SEEN_MAX))
      }
      saveSeen(seenIds.current)
    }

    const p = event.payload ?? {}
    const orderId = ((p.order_id || p.id) as string | undefined) ?? ''

    switch (event.type) {
      case 'ORDER_SENT': {
        if (!orderId) break
        const existing = ordersMap.current.get(orderId)
        const merged = normalizeOrder(p, existing)
        // Second round: preserve kds_item_status for already-done items
        if (sentOrderIds.current.has(orderId) && merged.kds_item_status === null && existing) {
          merged.kds_item_status = existing.kds_item_status
        }
        sentOrderIds.current.add(orderId)
        ordersMap.current.set(merged.id, merged)
        break
      }

      case 'ORDER_UPSERTED': {
        if (!orderId) break
        const existing = ordersMap.current.get(orderId)
        if (existing) {
          ordersMap.current.set(orderId, {
            ...existing,
            status:  (p.status as string) ?? existing.status,
            // items only replaced if present in payload (POS resend)
            items:   p.items != null ? (typeof p.items === 'string' ? p.items : JSON.stringify(p.items)) : existing.items,
          })
        } else {
          ordersMap.current.set(orderId, normalizeOrder(p))
        }
        break
      }

      case 'ORDER_CLOSED':
      case 'ORDER_CANCELLED':
        if (orderId) {
          ordersMap.current.delete(orderId)
          sentOrderIds.current.delete(orderId)
        }
        break

      case 'KDS_ITEM_STATUS': {
        if (!orderId) break
        const existing = ordersMap.current.get(orderId)
        if (existing && p.kds_item_status !== undefined) {
          ordersMap.current.set(orderId, {
            ...existing,
            kds_item_status: typeof p.kds_item_status === 'string'
              ? p.kds_item_status
              : JSON.stringify(p.kds_item_status),
          })
        }
        break
      }

      default:
        return false
    }

    if (typeof event.sequence === 'number') {
      setLastSequence(event.sequence)
      saveSeq(event.sequence)
    }
    return true
  }, [])

  const sendCommand = useCallback(
    (commandType: string, payload: Record<string, unknown>): string | null =>
      clientRef.current?.sendCommand(commandType, payload) ?? null,
    [],
  )

  const setFallbackOrders = useCallback((fallback: KitchenOrderFromDB[]) => {
    if (modeRef.current === 'LAN_PRIMARY') return  // Local Server is authoritative
    ordersMap.current.clear()
    for (const o of fallback) ordersMap.current.set(o.id, o)
    setOrders(fallback.filter(isActive))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isElectron = navigator.userAgent.includes('Electron')
    const hasBridgeHost = !!localStorage.getItem('pos_bridge_host')
    if (!isElectron && !hasBridgeHost) {
      setMode('OFFLINE')
      modeRef.current = 'OFFLINE'
      return
    }

    // Seed from localStorage cache while WS connects
    seenIds.current = loadSeen()
    const initSeq = loadSeq()
    setLastSequence(initSeq)
    const cached = loadCachedOrders()
    if (cached.length > 0) {
      ordersMap.current.clear()
      for (const o of cached) ordersMap.current.set(o.id, o)
      setOrders(cached.filter(isActive))
      setMode('RECONCILING')
      modeRef.current = 'RECONCILING'
    }

    const clientId =
      localStorage.getItem('pos_terminal_id') ||
      `kds-${Math.random().toString(36).slice(2, 10)}`

    const rid = restaurantId || localStorage.getItem('fullsite_client_id') || undefined
    const client = new BridgeClient(clientId, 'kds', rid, initSeq)
    clientRef.current = client

    const unsub = client.on((msg) => {
      if (msg.type === 'SNAPSHOT') {
        setConnected(true)
        setMode('LAN_PRIMARY')
        modeRef.current = 'LAN_PRIMARY'

        const snap = (msg.payload as { state?: Record<string, unknown>; deltas?: BridgeEvent[] })
        const state = snap.state as { kds_orders?: Array<Record<string, unknown>> } | undefined

        // Rebuild ordersMap from snapshot kds_orders
        sentOrderIds.current.clear()
        if (state?.kds_orders && Array.isArray(state.kds_orders) && state.kds_orders.length > 0) {
          ordersMap.current.clear()
          for (const raw of state.kds_orders) {
            const o = normalizeOrder(raw)
            ordersMap.current.set(o.id, o)
            sentOrderIds.current.add(o.id)
          }
        } else if (state?.kds_orders && Array.isArray(state.kds_orders)) {
          // Explicit empty snapshot from server: clear stale cache
          ordersMap.current.clear()
        }

        // Apply deltas sent alongside snapshot (catch-up window)
        if (snap.deltas && Array.isArray(snap.deltas)) {
          for (const d of snap.deltas) applyEvent(d)
        }

        setLastSequence(msg.sequence)
        saveSeq(msg.sequence)
        flush()

      } else if (msg.type === 'DELTA') {
        const event = (msg as Extract<typeof msg, { type: 'DELTA' }>).payload.event
        if (applyEvent({ ...event, sequence: msg.sequence })) flush()

      } else if (msg.type === 'PONG') {
        setConnected(true)

      } else if (msg.type === 'REJECT') {
        console.warn('[KDS-WS] Command rejected:', msg.payload)
      }
    })

    client.connect()

    // Poll connection state every 3s and switch mode on loss
    const statusInterval = setInterval(() => {
      const nowConnected = client.connected
      setConnected(nowConnected)
      if (!nowConnected && modeRef.current === 'LAN_PRIMARY') {
        setMode('FALLBACK')
        modeRef.current = 'FALLBACK'
      }
      if (nowConnected && modeRef.current === 'FALLBACK') {
        // WS reconnected — next SNAPSHOT will switch us back to LAN_PRIMARY
        setMode('RECONCILING')
        modeRef.current = 'RECONCILING'
      }
    }, 3_000)

    return () => {
      unsub()
      clearInterval(statusInterval)
      client.disconnect()
      clientRef.current = null
    }
  }, [restaurantId, applyEvent, flush])

  return { orders, mode, lastSequence, connected, sendCommand, setFallbackOrders }
}
