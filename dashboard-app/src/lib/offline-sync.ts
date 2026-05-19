// Offline sync — save orders to localStorage when no internet, sync when back online

const QUEUE_KEY = 'fullsite_offline_queue'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface QueuedOrder {
  id: string
  table: string // 'pos_orders'
  data: Record<string, unknown>
  timestamp: number
  synced: boolean
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

export function getQueue(): QueuedOrder[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedOrder[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function addToQueue(table: string, data: Record<string, unknown>): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const queue = getQueue()
  queue.push({ id, table, data, timestamp: Date.now(), synced: false })
  saveQueue(queue)
  return id
}

export function getPendingCount(): number {
  return getQueue().filter(q => !q.synced).length
}

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (!isOnline()) return { synced: 0, failed: 0 }

  const queue = getQueue()
  const pending = queue.filter(q => !q.synced)
  let synced = 0
  let failed = 0

  for (const item of pending) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${item.table}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(item.data),
      })
      if (res.ok) {
        item.synced = true
        synced++
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }

  saveQueue(queue)

  // Clean synced items older than 1 hour
  const oneHourAgo = Date.now() - 3600000
  const cleaned = queue.filter(q => !q.synced || q.timestamp > oneHourAgo)
  saveQueue(cleaned)

  return { synced, failed }
}

// Auto-sync when coming back online
export function startAutoSync() {
  if (typeof window === 'undefined') return

  window.addEventListener('online', async () => {
    const result = await syncQueue()
    if (result.synced > 0) {
      console.log(`[offline-sync] Synced ${result.synced} orders`)
    }
  })

  // Also try to sync every 30 seconds
  setInterval(async () => {
    if (isOnline() && getPendingCount() > 0) {
      await syncQueue()
    }
  }, 30000)
}
