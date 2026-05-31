import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface HealthCheck {
  name: string
  status: 'ok' | 'error'
  detail: string
  ms: number
}

async function checkSupabaseConnection(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha&order=fecha.desc&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    const ms = Date.now() - start
    if (!res.ok) return { name: 'supabase', status: 'error', detail: `HTTP ${res.status}`, ms }
    const data = await res.json()
    if (!data || data.length === 0) return { name: 'supabase', status: 'error', detail: 'No data in wansoft_daily', ms }
    return { name: 'supabase', status: 'ok', detail: `Latest: ${data[0].fecha}`, ms }
  } catch (e) {
    return { name: 'supabase', status: 'error', detail: String(e), ms: Date.now() - start }
  }
}

async function checkDataFreshness(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha&order=fecha.desc&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    const ms = Date.now() - start
    if (!res.ok) return { name: 'data_freshness', status: 'error', detail: `HTTP ${res.status}`, ms }
    const data = await res.json()
    if (!data || data.length === 0) return { name: 'data_freshness', status: 'error', detail: 'No data', ms }

    const latestDate = new Date(data[0].fecha + 'T23:59:59Z')
    const now = new Date()
    const hoursOld = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60)

    if (hoursOld > 48) return { name: 'data_freshness', status: 'error', detail: `Data is ${Math.round(hoursOld)}h old (${data[0].fecha})`, ms }
    return { name: 'data_freshness', status: 'ok', detail: `${data[0].fecha} (${Math.round(hoursOld)}h ago)`, ms }
  } catch (e) {
    return { name: 'data_freshness', status: 'error', detail: String(e), ms: Date.now() - start }
  }
}

async function checkAgentsRunning(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_runs?select=agent_id,created_at&order=created_at.desc&limit=5`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    const ms = Date.now() - start
    if (!res.ok) return { name: 'agents', status: 'ok', detail: `Skipped (no service key)`, ms }
    const data = await res.json()
    if (!data || data.length === 0) return { name: 'agents', status: 'ok', detail: 'No runs found (may be RLS)', ms }

    const latestRun = new Date(data[0].created_at)
    const hoursAgo = (Date.now() - latestRun.getTime()) / (1000 * 60 * 60)

    if (hoursAgo > 6) return { name: 'agents', status: 'error', detail: `Last run ${Math.round(hoursAgo)}h ago (${data[0].agent_id})`, ms }
    return { name: 'agents', status: 'ok', detail: `Last: ${data[0].agent_id} (${Math.round(hoursAgo)}h ago)`, ms }
  } catch (e) {
    return { name: 'agents', status: 'error', detail: String(e), ms: Date.now() - start }
  }
}

async function checkAuth(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`)
    const ms = Date.now() - start
    if (!res.ok) return { name: 'auth', status: 'error', detail: `HTTP ${res.status}`, ms }
    return { name: 'auth', status: 'ok', detail: 'Healthy', ms }
  } catch (e) {
    return { name: 'auth', status: 'error', detail: String(e), ms: Date.now() - start }
  }
}

async function checkCosteoData(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wansoft_data?select=fecha,data_key&data_key=eq.costeo_por_platillo&order=fecha.desc&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    const ms = Date.now() - start
    if (!res.ok) return { name: 'costeo', status: 'error', detail: `HTTP ${res.status}`, ms }
    const data = await res.json()
    if (!data || data.length === 0) return { name: 'costeo', status: 'ok', detail: 'No costeo data (optional)', ms }
    return { name: 'costeo', status: 'ok', detail: `Loaded (${data[0].fecha})`, ms }
  } catch (e) {
    return { name: 'costeo', status: 'error', detail: String(e), ms: Date.now() - start }
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkSupabaseConnection(),
    checkDataFreshness(),
    checkAgentsRunning(),
    checkAuth(),
    checkCosteoData(),
  ])

  const allOk = checks.every(c => c.status === 'ok')
  const totalMs = checks.reduce((s, c) => s + c.ms, 0)

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    total_ms: totalMs,
    checks,
  }, { status: allOk ? 200 : 503 })
}
