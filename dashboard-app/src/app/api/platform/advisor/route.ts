import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { runAdvisor } from '@/lib/copilot'

// GET /api/platform/advisor — asesor proactivo: recomendaciones de qué falta/mejorar.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const today = new Date().toISOString().slice(0, 10)
  const result = await runAdvisor(today)
  return Response.json(result)
}
