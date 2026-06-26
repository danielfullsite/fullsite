// Print Queue — cola de impresión offline con retry automático.
// Si el bridge o la impresora fallan, el job se encola y se reintenta
// automáticamente. Persiste en localStorage para sobrevivir recargas.
//
// Comandas de cocina/barra son P0: nunca se marcan como 'failed'.
// Después de agotar retries pasan a 'needs_attention' y dejan de
// golpear el bridge hasta que alguien las reintente manualmente o
// el bridge vuelva online (health check).

export interface PrintJob {
  id: string
  station: string
  data: string          // base64 ESC/POS bytes
  type: 'comanda' | 'ticket' | 'preticket' | 'drawer'
  status: 'pending' | 'retrying' | 'printed' | 'failed' | 'needs_attention'
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
const BRIDGE_HEALTH_TIMEOUT_MS = 800

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

export function getNeedsAttentionCount(): number {
  return loadQueue().filter(j => j.status === 'needs_attention').length
}

export function getNeedsAttentionJobs(): PrintJob[] {
  return loadQueue().filter(j => j.status === 'needs_attention')
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

/** Retry a specific job (manual retry from UI). Resets status to pending. */
export function retryJob(id: string) {
  const queue = loadQueue()
  const job = queue.find(j => j.id === id)
  if (job && (job.status === 'needs_attention' || job.status === 'failed')) {
    job.status = 'pending'
    job.retries = 0
    job.error = null
    saveQueue(queue)
    // Trigger immediate processing
    processQueue()
  }
}

/** Retry all needs_attention jobs at once (e.g. after bridge comes back). */
export function retryAllNeedsAttention() {
  const queue = loadQueue()
  let changed = false
  for (const job of queue) {
    if (job.status === 'needs_attention') {
      job.status = 'pending'
      job.retries = 0
      job.error = null
      changed = true
    }
  }
  if (changed) {
    saveQueue(queue)
    processQueue()
  }
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

// ── Bridge health check ────────────────────────────────────────────────
// Cached to avoid hammering the bridge every processQueue() cycle.

let _bridgeUp: boolean | null = null
let _bridgeCheckedAt = 0
const BRIDGE_HEALTH_TTL_MS = 10_000 // cache health for 10s

async function isBridgeHealthy(): Promise<boolean> {
  const now = Date.now()
  if (_bridgeUp !== null && now - _bridgeCheckedAt < BRIDGE_HEALTH_TTL_MS) {
    return _bridgeUp
  }
  _bridgeCheckedAt = now
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), BRIDGE_HEALTH_TIMEOUT_MS)
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    _bridgeUp = res.ok
  } catch {
    _bridgeUp = false
  }
  return _bridgeUp
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
  // Only process pending/retrying — needs_attention waits for manual retry or bridge recovery
  const pending = queue.filter(j => j.status === 'pending' || j.status === 'retrying')

  if (pending.length === 0) {
    // If bridge came back up and there are needs_attention comandas, auto-recover them
    const stuck = queue.filter(j => j.status === 'needs_attention')
    if (stuck.length > 0 && await isBridgeHealthy()) {
      console.log(`[print-queue] Bridge is back — recovering ${stuck.length} needs_attention job(s)`)
      retryAllNeedsAttention()
    }
    notifyListeners()
    return
  }

  // Don't attempt prints if bridge is down — avoids useless requests
  const bridgeUp = await isBridgeHealthy()
  if (!bridgeUp) {
    console.log(`[print-queue] Bridge DOWN — skipping ${pending.length} job(s), will retry when healthy`)
    notifyListeners()
    return
  }

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
      if (job.type === 'comanda') {
        // Comandas are P0 — never silently fail. Escalate to needs_attention.
        job.status = 'needs_attention'
        job.error = `${job.retries} intentos fallidos — requiere atención`
        console.warn(`[print-queue] ⚠ COMANDA ${job.station} needs attention (${job.id}) — mesa ${job.meta?.mesa ?? '?'}`)
      } else {
        job.status = 'failed'
        job.error = `Failed after ${job.retries} attempts`
        console.warn(`[print-queue] ✗ ${job.type} ${job.station} FAILED permanently (${job.id})`)
      }
      syncJobToCloud(job)
    } else {
      job.status = 'pending'
      job.error = `Attempt ${job.retries}/${job.maxRetries} failed`
      console.log(`[print-queue] ↻ ${job.type} ${job.station} retry ${job.retries}/${job.maxRetries} (${job.id})`)
    }
    changed = true
  }

  if (changed) saveQueue(queue)
  notifyListeners()
}

function notifyListeners() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('print-queue-updated', {
      detail: {
        pending: getPendingCount(),
        needsAttention: getNeedsAttentionCount(),
      },
    }))
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
