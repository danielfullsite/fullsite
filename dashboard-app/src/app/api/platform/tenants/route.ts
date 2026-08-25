import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · /api/platform/tenants ─────────────────────────────────────
// Reproduce lo que src/app/platform/tenants/page.tsx leía con la anon key, pero
// server-side + admin-gated + service_role.
//
// La frescura sale de `ocm_daily`, que es la vista canónica de OCM.
//
// Antes salía de `ops_daily`, con el comentario "(canónico)" — y no lo es:
// `ops_daily` dejó de recibir datos el 2026-08-13 y sólo cubre algunos tenants.
// El efecto, medido el 2026-08-25:
//
//   Laboratorio 24/7  el panel decía 282h    · tenía órdenes de HOY
//   Boruca            el panel decía "sin datos aún" · 240 órdenes, última el 21 ago
//   Café Central      el panel decía "sin datos aún" · 1,203 órdenes
//   Espresso Lab      el panel decía "sin datos aún" · 627 órdenes
//
// O sea que el panel de plataforma reportaba 2 clientes con datos cuando había 5.
// Es la pantalla desde la que se juzga si un restaurante está vivo.

export const dynamic = 'force-dynamic'

/** Tope de filas de ocm_daily por consulta. Hoy hay ~1,414 en total. */
const DAILY_LIMIT = 20000

interface Tenant {
  id: string
  name: string
  lastData: string | null
  hoursAgo: number | null
  openEvents: number
}

function hoursSince(dateStr: string): number {
  const then = new Date(dateStr + 'T23:59:00')
  return Math.max(0, Math.round((Date.now() - then.getTime()) / 3_600_000))
}

async function sb(path: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await platformServiceFetch(path)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  const [clients, daily, events] = await Promise.all([
    sb('clients?select=id,display_name&order=display_name'),
    sb(`ocm_daily?select=client_id,fecha&order=fecha.desc&limit=${DAILY_LIMIT}`),
    sb('agent_events?select=client_id,status&status=eq.open&limit=5000'),
  ])

  const latest = new Map<string, string>()
  for (const r of daily) {
    const cid = r.client_id as string
    if (cid && !latest.has(cid)) latest.set(cid, r.fecha as string)
  }

  // El orden es global por fecha, así que un tenant con muchas filas recientes
  // puede empujar a otro fuera del límite y hacerlo aparecer "sin datos" —
  // exactamente el síntoma que este cambio corrige. Si la respuesta llega llena,
  // el resultado puede estar truncado y hay que saberlo, no adivinarlo.
  if (daily.length >= DAILY_LIMIT) {
    console.warn(
      `[platform/tenants] ocm_daily devolvió ${daily.length} filas (tope ${DAILY_LIMIT}). ` +
        'La frescura de algún tenant puede estar truncada: sube el tope o agrupa server-side.',
    )
  }
  const eventCount = new Map<string, number>()
  for (const e of events) {
    const cid = e.client_id as string
    if (cid) eventCount.set(cid, (eventCount.get(cid) || 0) + 1)
  }

  const tenants: Tenant[] = clients.map(c => {
    const id = c.id as string
    const fecha = latest.get(id) || null
    return {
      id,
      name: (c.display_name as string) || id,
      lastData: fecha,
      hoursAgo: fecha ? hoursSince(fecha) : null,
      openEvents: eventCount.get(id) || 0,
    }
  })

  return Response.json({ tenants })
}
