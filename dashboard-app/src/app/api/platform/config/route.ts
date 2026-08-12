import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · GET /api/platform/config ─────────────────────────────────
// Lectura admin-gated de las filas COMPLETAS de feature_flags + platform_settings
// (incluye description, rollout, updated_by/at) para la consola de super-admin.
// La lectura pública ligera vive en getPlatformConfig() (anon); esta es la versión
// completa server-side + service_role para la UI de administración.

export const dynamic = 'force-dynamic'

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

  const [flags, settings, clients] = await Promise.all([
    sb('feature_flags?select=key,enabled,rollout,description,updated_by,updated_at&order=key'),
    sb('platform_settings?select=key,value,description,updated_by,updated_at&order=key'),
    sb('clients?select=id,display_name&order=display_name'),
  ])

  return Response.json({ flags, settings, clients })
}
