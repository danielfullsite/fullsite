// Print Queue — cola de impresión offline con retry automático.
// Si el bridge o la impresora fallan, el job se encola y se reintenta
// automáticamente. Persiste en localStorage para sobrevivir recargas.

export interface PrintJob {
  id: string
  station: string
  data: string          // base64 ESC/POS bytes
  type: 'comanda' | 'ticket' | 'preticket' | 'drawer'
  status: 'pending' | 'retrying' | 'printed' | 'failed'
  retries: number
  maxRetries: number
  createdAt: string
  lastAttempt: string | null
  error: string | null
  meta?: {
    mesa?: number
    mesero?: string
    orderId?: string
  }
}

const STORAGE_KEY = 'pos_print_queue'
const MAX_RETRIES = 5
const RETRY_INTERVAL_MS = 15_000 // 15 seconds
const BRIDGE_URL = 'http://127.0.0.1:7717'

// ── Storage ─────────────────────────────────────────────────────────────

function loadQueue(): PrintJob[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

function saveQueue(queue: PrintJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch { /* private mode */ }
}

// ── Queue operations ────────────────────────────────────────────────────

export function enqueue(job: Omit<PrintJob, 'id' | 'status' | 'retries' | 'maxRetries' | 'createdAt' | 'lastAttempt' | 'error'>): PrintJob {
  const queue = loadQueue()
  const newJob: PrintJob = {
    ...job,
    id: `pj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'pending',
    retries: 0,
    maxRetries: MAX_RETRIES,
    createdAt: new Date().toISOString(),
    lastAttempt: null,
    error: null,
  }
  queue.push(newJob)
  saveQueue(queue)
  console.log(`[print-queue] Enqueued ${newJob.type} for ${newJob.station} (${newJob.id})`)
  return newJob
}

export function getQueue(): PrintJob[] {
  return loadQueue()
}

export function getPendingCount(): number {
  return loadQueue().filter(j => j.status === 'pending' || j.status === 'retrying').length
}

export function clearCompleted() {
  const queue = loadQueue().filter(j => j.status !== 'printed')
  saveQueue(queue)
}

export function clearAll() {
  saveQueue([])
}

export function removeJob(id: string) {
  const queue = loadQueue().filter(j => j.id !== id)
  saveQueue(queue)
}

// ── Cloud sync (optional persistence to Supabase) ──────────────────────

async function syncJobToCloud(job: PrintJob) {
  try {
    const sbUrl = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_URL : undefined
    const sbKey = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined
    if (!sbUrl || !sbKey) return

    await fetch(`${sbUrl}/rest/v1/pos_print_jobs`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: job.id,
        order_id: job.meta?.orderId || null,
        station: job.station,
        type: job.type,
        status: job.status,
        retries: job.retries,
        error: job.error,
        meta: job.meta || null,
        created_at: job.createdAt,
        printed_at: job.status === 'printed' ? job.lastAttempt : null,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    // Cloud sync is best-effort — never block local queue
    console.warn(`[print-queue] Cloud sync failed for ${job.id}`)
  }
}

// ── Retry engine ────────────────────────────────────────────────────────

async function attemptPrint(job: PrintJob): Promise<boolean> {
  try {
    if (job.type === 'drawer') {
      const res = await fetch(`${BRIDGE_URL}/drawer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station: job.station }),
      })
      return res.ok
    }

    const res = await fetch(`${BRIDGE_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: job.station, data: job.data }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function processQueue() {
  const queue = loadQueue()
  const pending = queue.filter(j => j.status === 'pending' || j.status === 'retrying')

  if (pending.length === 0) return

  let changed = false
  for (const job of pending) {
    job.status = 'retrying'
    job.lastAttempt = new Date().toISOString()
    job.retries++

    const success = await attemptPrint(job)

    if (success) {
      job.status = 'printed'
      job.error = null
      console.log(`[print-queue] ✓ ${job.type} ${job.station} printed (${job.id}, attempt ${job.retries})`)
      syncJobToCloud(job)
    } else if (job.retries >= job.maxRetries) {
      job.status = 'failed'
      job.error = `Failed after ${job.retries} attempts`
      console.warn(`[print-queue] ✗ ${job.type} ${job.station} FAILED permanently (${job.id})`)
      syncJobToCloud(job)
    } else {
      job.status = 'pending'
      job.error = `Attempt ${job.retries}/${job.maxRetries} failed`
      console.log(`[print-queue] ↻ ${job.type} ${job.station} retry ${job.retries}/${job.maxRetries} (${job.id})`)
    }
    changed = true
  }

  if (changed) saveQueue(queue)

  // Notify listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('print-queue-updated', { detail: { pending: getPendingCount() } }))
  }
}

// ── Auto-retry loop ─────────────────────────────────────────────────────

let retryInterval: ReturnType<typeof setInterval> | null = null

export function startRetryLoop() {
  if (retryInterval) return
  // Process immediately on start
  processQueue()
  // Then every RETRY_INTERVAL_MS
  retryInterval = setInterval(processQueue, RETRY_INTERVAL_MS)
  console.log(`[print-queue] Retry loop started (every ${RETRY_INTERVAL_MS / 1000}s)`)
}

export function stopRetryLoop() {
  if (retryInterval) {
    clearInterval(retryInterval)
    retryInterval = null
  }
}

// ── Integration with printer.ts ─────────────────────────────────────────
// When bridgePrint fails, call enqueueFailedPrint to add to retry queue.

export function enqueueFailedPrint(
  bytes: Uint8Array,
  station: string,
  type: PrintJob['type'],
  meta?: PrintJob['meta'],
) {
  // Convert bytes to base64
  const data = typeof btoa !== 'undefined'
    ? btoa(String.fromCharCode(...bytes))
    : Buffer.from(bytes).toString('base64')

  return enqueue({ station, data, type, meta })
}
