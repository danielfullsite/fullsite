// Print Queue — cola de impresión con retry automático.
// localStorage = hot cache (sync API, survives reloads).
// IDB (print_jobs store v4) = durable backup (survives localStorage wipe & Electron restart).
//
// State machine:
//   pending → retrying → printed           (happy path, bridge UP)
//   pending → bridge_unavailable           (bridge DOWN, no retries consumed)
//   bridge_unavailable → pending → printed (bridge comes back within 120s)
//   bridge_unavailable → needs_attention   (bridge DOWN >120s, comanda only)
//   retrying → needs_attention             (5 real retries failed, comanda only)
//   retrying → failed                      (5 real retries failed, ticket/other)
//
// Retries only count real print attempts. Bridge-down skips don't consume retries.

import { getBridgeUrl } from './bridge-url'

export interface PrintJob {
  id: string
  station: string
  data: string          // base64 ESC/POS bytes
  type: 'comanda' | 'ticket' | 'preticket' | 'drawer'
  status: 'pending' | 'retrying' | 'printed' | 'failed' | 'needs_attention' | 'bridge_unavailable'
  retries: number
  maxRetries: number
  createdAt: string
  lastAttempt: string | null
  error: string | null
  // BUG-019-E: print-intent identity. comanda_batch_id + reprint_seq make a comanda
  // job's identity semantic (order/station/batch/reprint) rather than timestamp-random,
  // so reload/retry/reconnect/replay regenerate the SAME job.id (idempotent cloud upsert).
  comanda_batch_id?: string | null
  reprint_seq?: number
  meta?: {
    mesa?: number
    mesero?: string
    orderId?: string
  }
}

// BUG-019-E: deterministic id for a canonical comanda print intent. order_id and
// comanda_batch_id are UUIDs (opaque, not sensitive) so the exact tuple is used —
// collision-free by construction, unlike a hash. reprint_seq differs for reprints,
// yielding a distinct id. Non-comanda / batch-less jobs keep timestamp ids.
export function comandaJobId(orderId: string, station: string, comandaBatchId: string, reprintSeq: number): string {
  return `pjc-${orderId}-${station}-${comandaBatchId}-${reprintSeq}`
}

// BUG-019-E: next reprint sequence for an existing (order,station,batch) — pure helper.
export function nextReprintSeq(existingSeqs: number[]): number {
  return existingSeqs.length === 0 ? 1 : Math.max(...existingSeqs) + 1
}

const STORAGE_KEY = 'pos_print_queue'
let _processing = false
const MAX_RETRIES = 5
const RETRY_INTERVAL_MS = 15_000 // 15 seconds
const BRIDGE_HEALTH_TIMEOUT_MS = 800
const BRIDGE_UNAVAILABLE_ESCALATION_MS = 120_000 // 2 minutes → needs_attention

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
  // IDB write-through — fire and forget, keeps IDB in sync without blocking sync callers
  _syncQueueToIDB(queue)
}

function _syncQueueToIDB(queue: PrintJob[]) {
  import('@/lib/pos-offline-db').then(({ saveIDBPrintJob, deleteIDBPrintJob }) => {
    for (const job of queue) {
      saveIDBPrintJob({
        id: job.id,
        station: job.station,
        data: job.data,
        type: job.type,
        status: job.status,
        retries: job.retries,
        maxRetries: job.maxRetries,
        createdAt: job.createdAt,
        lastAttempt: job.lastAttempt,
        error: job.error,
        meta: job.meta,
      }).catch(() => {/* IDB unavailable */})
    }
    // Clean printed jobs from IDB (they are complete — no need to keep the payload)
    const printedIds = queue.filter(j => j.status === 'printed').map(j => j.id)
    for (const id of printedIds) deleteIDBPrintJob(id).catch(() => {/* */})
  }).catch(() => {/* dynamic import failed */})
}

/** On startup: if localStorage queue is empty, restore pending jobs from IDB. */
export async function recoverFromIDB(): Promise<void> {
  try {
    const local = loadQueue()
    if (local.length > 0) return // localStorage has data — trust it

    const { getIDBPrintJobs } = await import('@/lib/pos-offline-db')
    const idbJobs = await getIDBPrintJobs()
    const pending = idbJobs.filter(j => j.status === 'pending' || j.status === 'retrying' || j.status === 'bridge_unavailable')
    if (pending.length === 0) return

    // Restore as PrintJob objects — reset bridge_unavailable → pending on restart
    const restored: PrintJob[] = pending.map(j => ({
      id: j.id,
      station: j.station,
      data: j.data,
      type: j.type as PrintJob['type'],
      status: j.status === 'bridge_unavailable' ? 'pending' : j.status as PrintJob['status'],
      retries: j.retries,
      maxRetries: j.maxRetries,
      createdAt: j.createdAt,
      lastAttempt: j.lastAttempt,
      error: j.error,
      meta: j.meta,
    }))
    saveQueue(restored)
    console.log(`[print-queue] Recovered ${restored.length} job(s) from IDB after restart`)
  } catch { /* IDB unavailable — no recovery */ }
}

// ── Queue operations ────────────────────────────────────────────────────

export function enqueue(job: Omit<PrintJob, 'id' | 'status' | 'retries' | 'maxRetries' | 'createdAt' | 'lastAttempt' | 'error'>): PrintJob {
  const queue = loadQueue()
  // BUG-019-E: canonical comanda intents get a deterministic id; a re-enqueue of the
  // same intent (reload/retry/replay) collapses onto the same row instead of creating
  // a duplicate. If that intent is already queued locally, return the existing job.
  const canonical = job.type === 'comanda' && job.meta?.orderId && job.comanda_batch_id
  const id = canonical
    ? comandaJobId(job.meta!.orderId!, job.station, job.comanda_batch_id!, job.reprint_seq ?? 0)
    : `pj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  if (canonical) {
    const existing = queue.find(j => j.id === id)
    if (existing) { console.log(`[print-queue] Idempotent comanda intent, reusing ${id}`); return existing }
  }
  const newJob: PrintJob = {
    ...job,
    id,
    reprint_seq: job.reprint_seq ?? 0,
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
  return loadQueue().filter(j =>
    j.status === 'pending' || j.status === 'retrying' || j.status === 'bridge_unavailable'
  ).length
}

export function getNeedsAttentionCount(): number {
  return loadQueue().filter(j => j.status === 'needs_attention').length
}

export function getNeedsAttentionJobs(): PrintJob[] {
  return loadQueue().filter(j => j.status === 'needs_attention')
}

export function getBridgeUnavailableCount(): number {
  return loadQueue().filter(j => j.status === 'bridge_unavailable').length
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
  if (job && (job.status === 'needs_attention' || job.status === 'failed' || job.status === 'bridge_unavailable')) {
    job.status = 'pending'
    job.retries = 0
    job.error = null
    saveQueue(queue)
    processQueue()
  }
}

/** Retry all needs_attention + bridge_unavailable jobs at once. */
export function retryAllStuck() {
  const queue = loadQueue()
  let changed = false
  for (const job of queue) {
    if (job.status === 'needs_attention' || job.status === 'bridge_unavailable') {
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

// Keep old name as alias for backward compat with UI code
export const retryAllNeedsAttention = retryAllStuck

// ── Cloud sync (optional persistence to Supabase) ──────────────────────

async function syncJobToCloud(job: PrintJob) {
  try {
    const sbUrl = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_URL : undefined
    const sbKey = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined
    if (!sbUrl || !sbKey) return

    const res = await fetch(`${sbUrl}/rest/v1/pos_print_jobs`, {
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
        // BUG-019-E: carry the intent identity so DB uniqueness is the final boundary.
        comanda_batch_id: job.comanda_batch_id ?? null,
        reprint_seq: job.reprint_seq ?? 0,
        meta: job.meta || null,
        created_at: job.createdAt,
        printed_at: job.status === 'printed' ? job.lastAttempt : null,
        updated_at: new Date().toISOString(),
      }),
    })
    // BUG-019-E: a 409 means the canonical print intent already exists (another writer
    // won the race). That is idempotent SUCCESS, not an operational failure.
    if (res.status === 409) console.log(`[print-queue] Print intent already exists (idempotent) ${job.id}`)
  } catch {
    console.warn(`[print-queue] Cloud sync failed for ${job.id}`)
  }
}

// ── Bridge health check ────────────────────────────────────────────────

let _bridgeUp: boolean | null = null
let _bridgeCheckedAt = 0
const BRIDGE_HEALTH_TTL_MS = 10_000

async function isBridgeHealthy(): Promise<boolean> {
  const now = Date.now()
  if (_bridgeUp !== null && now - _bridgeCheckedAt < BRIDGE_HEALTH_TTL_MS) {
    return _bridgeUp
  }
  _bridgeCheckedAt = now
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), BRIDGE_HEALTH_TIMEOUT_MS)
    const res = await fetch(`${getBridgeUrl()}/health`, { signal: ctrl.signal })
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
      const res = await fetch(`${getBridgeUrl()}/drawer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station: job.station }),
      })
      return res.ok
    }

    const res = await fetch(`${getBridgeUrl()}/print`, {
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
  if (_processing) return
  _processing = true
  try {
    await _processQueueInner()
  } finally {
    _processing = false
  }
}

async function _processQueueInner() {
  const queue = loadQueue()
  // processQueue runs every 15s — only log when there's something to do
  const bridgeUp = await isBridgeHealthy()
  const now = Date.now()
  let changed = false

  // ── Phase 1: Handle bridge_unavailable jobs ─────────────────────────
  for (const job of queue) {
    if (job.status === 'bridge_unavailable') {
      if (bridgeUp) {
        // Bridge came back — return to pending for real retry
        job.status = 'pending'
        job.error = null
        // Bridge recovered — job returns to pending silently
        changed = true
      } else {
        // Still down — check if we've waited long enough to escalate
        const waitingMs = now - new Date(job.createdAt).getTime()
        if (job.type === 'comanda' && waitingMs >= BRIDGE_UNAVAILABLE_ESCALATION_MS) {
          job.status = 'needs_attention'
          job.error = `Bridge no disponible por ${Math.floor(waitingMs / 1000)}s — requiere atención`
          console.warn(`[print-queue] ⚠ COMANDA ${job.station} needs attention — bridge down >2min (${job.id}) — mesa ${job.meta?.mesa ?? '?'}`)
          syncJobToCloud(job)
          changed = true
        } else if (job.type !== 'comanda' && waitingMs >= BRIDGE_UNAVAILABLE_ESCALATION_MS) {
          job.status = 'failed'
          job.error = `Bridge no disponible por ${Math.floor(waitingMs / 1000)}s`
          console.warn(`[print-queue] ✗ ${job.type} ${job.station} FAILED — bridge down >2min (${job.id})`)
          syncJobToCloud(job)
          changed = true
        }
      }
    }
  }

  // ── Phase 2: Handle needs_attention auto-recovery ───────────────────
  if (bridgeUp) {
    for (const job of queue) {
      if (job.status === 'needs_attention') {
        job.status = 'pending'
        job.retries = 0
        job.error = null
        console.log(`[print-queue] Bridge back — recovering ${job.type} ${job.station}`)
        changed = true
      }
    }
  }

  // ── Phase 3: Process pending/retrying jobs ──────────────────────────
  const pending = queue.filter(j => j.status === 'pending' || j.status === 'retrying')

  if (pending.length > 0 && !bridgeUp) {
    // Bridge is down — transition pending to bridge_unavailable (no retries consumed)
    for (const job of pending) {
      job.status = 'bridge_unavailable'
      job.error = 'Bridge no disponible'
      changed = true
    }
    console.log(`[print-queue] Bridge DOWN — ${pending.length} job(s) marked bridge_unavailable`)
  } else if (pending.length > 0 && bridgeUp) {
    // Bridge is up — attempt real prints (retries count here)
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
        bridgeUnavailable: getBridgeUnavailableCount(),
      },
    }))
  }
}

// ── Auto-retry loop ─────────────────────────────────────────────────────

let retryInterval: ReturnType<typeof setInterval> | null = null

export function startRetryLoop() {
  if (retryInterval) return
  // Recover any jobs that were in IDB but not in localStorage (e.g. after Electron restart)
  recoverFromIDB().then(() => processQueue()).catch(() => processQueue())
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

export function enqueueFailedPrint(
  bytes: Uint8Array,
  station: string,
  type: PrintJob['type'],
  meta?: PrintJob['meta'],
  // BUG-019-E: for comanda jobs, the intent identity. reprintSeq defaults to 0
  // (automatic send); technical retries reuse the same values → same job id.
  comandaBatchId?: string | null,
  reprintSeq: number = 0,
) {
  const data = typeof btoa !== 'undefined'
    ? btoa(String.fromCharCode(...bytes))
    : Buffer.from(bytes).toString('base64')

  return enqueue({ station, data, type, meta, comanda_batch_id: comandaBatchId ?? null, reprint_seq: reprintSeq })
}

// BUG-019-E: underlying audited operator reprint of a comanda. Produces a NEW row
// with reprint_seq = previous max + 1 (distinct deterministic id), so it prints again
// intentionally without violating the automatic-send uniqueness. Visible UX is
// deferred; call sites should emit an audit event (action: 'comanda_reprinted').
export function enqueueComandaReprint(
  bytes: Uint8Array,
  station: string,
  orderId: string,
  comandaBatchId: string,
  existingReprintSeqs: number[],
  meta?: PrintJob['meta'],
): PrintJob {
  const seq = nextReprintSeq(existingReprintSeqs)
  return enqueueFailedPrint(bytes, station, 'comanda', { ...meta, orderId }, comandaBatchId, seq)
}
