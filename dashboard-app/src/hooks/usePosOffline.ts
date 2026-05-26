'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { syncAll, getPendingQueue } from '@/lib/pos-offline-db'

interface OfflineState {
  isOnline: boolean
  pendingCount: number
  lastSyncTime: string | null
  isSyncing: boolean
  syncNow: () => Promise<void>
}

export function usePosOffline(): OfflineState {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const syncInterval = useRef<NodeJS.Timeout | null>(null)

  const updatePendingCount = useCallback(async () => {
    try {
      const queue = await getPendingQueue()
      setPendingCount(queue.length)
    } catch {
      // IndexedDB not available
    }
  }, [])

  const syncNow = useCallback(async () => {
    if (isSyncing || !navigator.onLine) return
    setIsSyncing(true)
    try {
      const result = await syncAll()
      if (result.synced > 0) {
        setLastSyncTime(new Date().toISOString())
      }
      await updatePendingCount()
    } catch {
      // sync failed
    }
    setIsSyncing(false)
  }, [isSyncing, updatePendingCount])

  useEffect(() => {
    setIsOnline(navigator.onLine)
    updatePendingCount()

    const handleOnline = () => {
      setIsOnline(true)
      // Auto-sync when connection returns
      syncNow()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Periodic sync check every 30 seconds when online
    syncInterval.current = setInterval(() => {
      if (navigator.onLine) {
        updatePendingCount()
      }
    }, 30000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (syncInterval.current) clearInterval(syncInterval.current)
    }
  }, [syncNow, updatePendingCount])

  return { isOnline, pendingCount, lastSyncTime, isSyncing, syncNow }
}
