import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { buildProposal, type DiscoveryCandidate } from '@/lib/hardware-capabilities'

// Autoconfiguración: convierte la evidencia de un escaneo en una PROPUESTA explicable con
// confianza. STATELESS: no guarda nada — sólo propone. La confirmación y el guardado son otro
// paso (nada se persiste sin un humano). Admin-gated (2FA).
//   POST { candidates: DiscoveryCandidate[] } → { proposal }
//
// El escaneo real (LAN/USB/HID) lo hace la caja (local-server) y NO viaja por Vercel: requiere
// instalador. Este endpoint recibe la evidencia ya recolectada y la rankea. Gate:
// factory.autoconfig.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { candidates?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const candidates = Array.isArray(body.candidates) ? (body.candidates as DiscoveryCandidate[]) : []

  // Nunca se guarda aquí: la respuesta es una propuesta que exige confirmación humana.
  const proposal = buildProposal(candidates)
  return NextResponse.json({ proposal })
}
