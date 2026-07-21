'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient, RealtimeChannel } from '@supabase/supabase-js'
import { getActiveClientSlug } from '@/lib/data'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

interface RealtimeCallbacks {
  onOrderChange?: (payload: RealtimePayload) => void
  onInventoryChange?: (payload: RealtimePayload) => void
  onShiftChange?: (payload: RealtimePayload) => void
}

interface RealtimeState {
  isConnected: boolean
  connectedDevices: number
  subscribe: (callbacks: RealtimeCallbacks) => void
  unsubscribe: () => void
  broadcastOrderUpdate: (orderId: string, data: Record<string, unknown>) => void
}

export function usePosRealtime(): RealtimeState {
  const [isConnected, setIsConnected] = useState(false)
  const [connectedDevices, setConnectedDevices] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const presenceChannelRef = useRef<RealtimeChannel | null>(null)
  const callbacksRef = useRef<RealtimeCallbacks>({})

  const subscribe = useCallback((callbacks: RealtimeCallbacks) => {
    callbacksRef.current = callbacks

    const clientId = typeof window !== 'undefined' ? getActiveClientSlug() : getActiveClientSlug()

    // Orders channel
    const channel = supabase
      .channel('pos-orders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_orders', filter: 'client_id=eq.${clientId}' },
        (payload) => {
          const p: RealtimePayload = {
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            new: (payload.new as Record<string, unknown>) || {},
            old: (payload.old as Record<string, unknown>) || {},
          }
          callbacksRef.current.onOrderChange?.(p)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_inventory', filter: 'client_id=eq.${clientId}' },
        (payload) => {
          const p: RealtimePayload = {
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            new: (payload.new as Record<string, unknown>) || {},
            old: (payload.old as Record<string, unknown>) || {},
          }
          callbacksRef.current.onInventoryChange?.(p)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_staff_shifts', filter: 'client_id=eq.${clientId}' },
        (payload) => {
          const p: RealtimePayload = {
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            new: (payload.new as Record<string, unknown>) || {},
            old: (payload.old as Record<string, unknown>) || {},
          }
          callbacksRef.current.onShiftChange?.(p)
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    // Presence channel for device tracking
    const presenceChannel = supabase
      .channel('pos-presence')
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState()
        setConnectedDevices(Object.keys(state).length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            device_id: getDeviceId(),
            joined_at: new Date().toISOString(),
          })
        }
      })

    presenceChannelRef.current = presenceChannel
  }, [])

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current)
      presenceChannelRef.current = null
    }
    setIsConnected(false)
  }, [])

  const broadcastOrderUpdate = useCallback((orderId: string, data: Record<string, unknown>) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'order_update',
        payload: { orderId, data, from: getDeviceId() },
      })
    }
  }, [])

  useEffect(() => {
    return () => {
      unsubscribe()
    }
  }, [unsubscribe])

  return { isConnected, connectedDevices, subscribe, unsubscribe, broadcastOrderUpdate }
}

// Unique device ID persisted in localStorage
function getDeviceId(): string {
  const key = 'fullsite_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(key, id)
  }
  return id
}
