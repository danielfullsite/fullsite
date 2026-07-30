/**
 * Agent Engine — server-side only.
 * Runs agents, stores events in agent_events table, returns results.
 */
import type { AgentId, AgentEvent, AgentResult } from './types'
import { runOperationsAgent } from './operations'
import { runInventoryAgent } from './inventory'
import { runFraudAgent } from './fraud'
import { runStaffAgent } from './staff'
import { runFinanceAgent } from './finance'

const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function sbGet<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  const url = `${SB_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbGet ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T[]>
}

export async function sbInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const url = `${SB_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbInsert ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
}

export async function sbPatch(table: string, query: string, data: Record<string, unknown>): Promise<void> {
  const url = `${SB_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`sbPatch ${table}: ${res.status} ${body.slice(0, 200)}`)
  }
}

/** Run a single agent, store its events, return the result. */
export async function runAgent(agentId: AgentId, clientId: string): Promise<AgentResult> {
  const start = Date.now()
  let events: AgentEvent[] = []
  let error: string | undefined

  try {
    switch (agentId) {
      case 'operations': events = await runOperationsAgent(clientId, sbGet); break
      case 'inventory':  events = await runInventoryAgent(clientId, sbGet);  break
      case 'fraud':      events = await runFraudAgent(clientId, sbGet);      break
      case 'staff':      events = await runStaffAgent(clientId, sbGet);      break
      case 'finance':    events = await runFinanceAgent(clientId, sbGet);    break
    }

    // Expire stale events for this agent before inserting new ones
    const expireCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() // 6h TTL
    await sbPatch(
      'agent_events',
      `client_id=eq.${encodeURIComponent(clientId)}&agent_id=eq.${agentId}&status=eq.new&created_at=lt.${expireCutoff}`,
      { status: 'resolved' },
    ).catch(() => {/* Non-blocking */})

    // Deduplicate: if same type+severity event exists as 'new' in last 30min, skip insert
    const dedupeWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const existingRaw = await sbGet<{ type: string; severity: string }>(
      'agent_events',
      `client_id=eq.${encodeURIComponent(clientId)}&agent_id=eq.${agentId}&status=eq.new&created_at=gte.${dedupeWindow}&select=type,severity`,
    ).catch(() => [] as { type: string; severity: string }[])
    const existingTypes = new Set(existingRaw.map(r => `${r.type}:${r.severity}`))

    // Insert new events
    const toInsert = events.filter(e => !existingTypes.has(`${e.type}:${e.severity}`))
    await Promise.allSettled(
      toInsert.map(event =>
        sbInsert('agent_events', {
          client_id: event.client_id,
          agent_id: event.agent_id,
          type: event.type,
          severity: event.severity,
          title: event.title,
          explanation: event.explanation,
          evidence: event.evidence,
          suggested_action: event.suggested_action,
          confidence: event.confidence,
          status: 'new',
          estimated_value: event.estimated_value ?? null,
          expires_at: event.expires_at ?? null,
        }),
      ),
    )
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return {
    agent_id: agentId,
    events,
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
    error,
  }
}

/** Run all 5 agents concurrently. */
export async function runAllAgents(clientId: string): Promise<AgentResult[]> {
  const agentIds: AgentId[] = ['operations', 'inventory', 'fraud', 'staff', 'finance']
  return Promise.all(agentIds.map(id => runAgent(id, clientId)))
}

/** Fetch latest events for display. */
export async function fetchEvents(
  clientId: string,
  opts: { status?: string; limit?: number; agentId?: AgentId } = {},
): Promise<AgentEvent[]> {
  const status = opts.status ?? 'new'
  const limit = opts.limit ?? 50
  let query = `client_id=eq.${encodeURIComponent(clientId)}&status=eq.${status}&order=created_at.desc&limit=${limit}&select=*`
  if (opts.agentId) query += `&agent_id=eq.${opts.agentId}`
  return sbGet<AgentEvent>('agent_events', query)
}
