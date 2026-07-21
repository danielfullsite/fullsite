// Session management for POS — prevents concurrent login on multiple terminals.
// Uses Supabase `pos_sessions` table via REST API.
// Table schema: id (uuid), staff_id (text), staff_name (text), terminal_id (text),
//               client_id (text), started_at (timestamptz), last_heartbeat (timestamptz)

const SB_URL = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL || '' : ''
const SB_KEY = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' : ''
const SB_HEADERS: Record<string, string> = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — session without heartbeat = expired
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Get or create a stable terminal ID for this browser */
export function getTerminalId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem('pos_terminal_id')
  if (!id) {
    id = `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem('pos_terminal_id', id)
  }
  return id
}

import { getActiveClientSlug as getClientId } from '@/lib/data'

/**
 * Check if a staff member has an active session on a DIFFERENT terminal.
 * Returns null if no conflict, or the terminal_id of the conflicting session.
 */
export async function checkActiveSession(staffId: string): Promise<string | null> {
  if (!SB_URL || !SB_KEY) return null // can't check — allow login
  const terminalId = getTerminalId()
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString()
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/pos_sessions?staff_id=eq.${encodeURIComponent(staffId)}&client_id=eq.${encodeURIComponent(getClientId())}&terminal_id=neq.${encodeURIComponent(terminalId)}&last_heartbeat=gte.${encodeURIComponent(cutoff)}&select=terminal_id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0].terminal_id
      }
    }
  } catch {
    // Network error — allow login (offline mode)
  }
  return null
}

/**
 * Register a session for this staff member on this terminal.
 * Upserts: if a session already exists for this terminal+staff, update it.
 */
export async function registerSession(staffId: string, staffName: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return true
  const terminalId = getTerminalId()
  const clientId = getClientId()
  const now = new Date().toISOString()

  try {
    // First, delete any old sessions for this terminal (clean slate)
    await fetch(
      `${SB_URL}/rest/v1/pos_sessions?terminal_id=eq.${encodeURIComponent(terminalId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    )

    // Insert new session
    const res = await fetch(`${SB_URL}/rest/v1/pos_sessions`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({
        staff_id: staffId,
        staff_name: staffName,
        terminal_id: terminalId,
        client_id: clientId,
        started_at: now,
        last_heartbeat: now,
      }),
    })
    return res.ok || res.status === 201
  } catch {
    return true // allow if offline
  }
}

/** Send a heartbeat to keep the session alive */
async function sendHeartbeat(staffId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return
  const terminalId = getTerminalId()
  const clientId = getClientId()
  try {
    await fetch(
      `${SB_URL}/rest/v1/pos_sessions?staff_id=eq.${encodeURIComponent(staffId)}&terminal_id=eq.${encodeURIComponent(terminalId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_heartbeat: new Date().toISOString() }),
      }
    )
  } catch {
    // silent — next heartbeat will try again
  }
}

/** Start heartbeat loop for a staff member */
export function startHeartbeat(staffId: string): void {
  stopHeartbeat()
  // Immediate heartbeat
  sendHeartbeat(staffId)
  heartbeatTimer = setInterval(() => sendHeartbeat(staffId), HEARTBEAT_INTERVAL_MS)
}

/** Stop heartbeat loop */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** Remove session on logout/lock */
export async function removeSession(): Promise<void> {
  if (!SB_URL || !SB_KEY) return
  stopHeartbeat()
  const terminalId = getTerminalId()
  const clientId = getClientId()
  try {
    await fetch(
      `${SB_URL}/rest/v1/pos_sessions?terminal_id=eq.${encodeURIComponent(terminalId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    )
  } catch {
    // best effort
  }
}
