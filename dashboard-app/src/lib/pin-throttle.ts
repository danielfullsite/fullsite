// PIN brute-force throttle — the wall that makes "mil pruebas de PIN" imposible.
//
// Keyed by clientId:ip so guessing MANY different PINs from one source shares a
// single budget (the old limiter keyed by ip:pin, so enumerating 0000,0001,…
// each got a fresh counter and never tripped — that hole is closed here).
//
// Primary store: Postgres RPC `pos_pin_throttle` (atomic, cross-instance — works
// across all Vercel lambdas). Fallback: in-memory per-lambda, still keyed by
// clientId:ip so it's strictly better than before even if the RPC isn't deployed
// yet. Once the SQL handoff is applied the limit becomes global and bulletproof.

const FAIL_MAX = 8            // failed attempts within the window before lockout
const WINDOW_SECS = 900       // 15 min rolling window for counting failures
const LOCK_SECS = 900         // base lockout; multiplies per repeat strike (cap 8×)

export type GateResult = { allowed: boolean; retryAfter?: number }

// ── In-memory fallback (per-lambda) ──────────────────────────────────────────
type Entry = { fails: number; windowStart: number; lockedUntil: number; strikes: number }
const mem = new Map<string, Entry>()

function memGate(key: string, now: number): GateResult {
  const e = mem.get(key)
  if (!e) return { allowed: true }
  if (e.lockedUntil > now) return { allowed: false, retryAfter: Math.ceil((e.lockedUntil - now) / 1000) }
  if (now - e.windowStart > WINDOW_SECS * 1000) { e.fails = 0; e.windowStart = now }
  return { allowed: true }
}

function memRecord(key: string, ok: boolean, now: number): void {
  if (ok) { mem.delete(key); return }
  const e = mem.get(key) ?? { fails: 0, windowStart: now, lockedUntil: 0, strikes: 0 }
  if (now - e.windowStart > WINDOW_SECS * 1000) { e.fails = 0; e.windowStart = now }
  e.fails++
  if (e.fails >= FAIL_MAX) {
    e.strikes++
    e.lockedUntil = now + LOCK_SECS * 1000 * Math.min(e.strikes, 8)
    e.fails = 0
    e.windowStart = now
  }
  mem.set(key, e)
}

// ── Persistent store (atomic RPC) ────────────────────────────────────────────
// Returns null when the store is unavailable (env missing / function not yet
// deployed) so the caller falls back to the in-memory limiter.
async function rpc(action: 'check' | 'fail' | 'reset', key: string): Promise<GateResult | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_KEY
  if (!url || !svc) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/pos_pin_throttle`, {
      method: 'POST',
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_key: key, p_action: action,
        p_max: FAIL_MAX, p_window_secs: WINDOW_SECS, p_lock_secs: LOCK_SECS,
      }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    return { allowed: !!data?.allowed, retryAfter: data?.retry_after ?? undefined }
  } catch {
    return null
  }
}

/** Check whether this source may attempt a PIN right now. */
export async function pinGate(key: string): Promise<GateResult> {
  const r = await rpc('check', key)
  if (r) return r
  return memGate(key, Date.now())
}

/** Record the outcome of a PIN attempt. Success resets the counter/lockout. */
export async function pinRecord(key: string, ok: boolean): Promise<void> {
  const r = await rpc(ok ? 'reset' : 'fail', key)
  if (r === null) memRecord(key, ok, Date.now())
}
