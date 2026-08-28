// Autoconfig: confidence topado (nunca 100% para desconocido), fallback manual siempre,
// confirmación siempre exigida. Autocontenido.
import { describe, it, expect, vi } from 'vitest'
import {
  scoreConfidence, scoreCandidate, buildProposal, type DiscoveryCandidate,
} from '../lib/hardware-capabilities'

const printerDesconocida: DiscoveryCandidate = {
  id: 'p1', kind: 'printer', capability: 'print_escpos', adapter: 'escpos',
  evidence: [
    { signal: 'tcp_9100_open', weight: 0.7 },
    { signal: 'mdns_service', weight: 0.6 },
  ],
}
const printerConocida: DiscoveryCandidate = {
  ...printerDesconocida, id: 'p2', knownModel: true,
  evidence: [{ signal: 'usb_vendor_match', weight: 0.9 }, { signal: 'model_fingerprint', weight: 0.9 }],
}

describe('confidence — nunca 100% para hardware desconocido', () => {
  it('desconocido queda topado (< 0.61)', () => {
    const c = scoreConfidence(printerDesconocida)
    expect(c).toBeLessThanOrEqual(0.6)
    expect(c).toBeGreaterThan(0)
  })
  it('modelo reconocido llega más alto pero sigue topado (< 1.0)', () => {
    const c = scoreConfidence(printerConocida)
    expect(c).toBeGreaterThan(0.6)
    expect(c).toBeLessThanOrEqual(0.95)
    expect(c).toBeLessThan(1) // jamás 100%
  })
  it('sin evidencia → 0 (no se inventa)', () => {
    expect(scoreConfidence({ ...printerDesconocida, evidence: [] })).toBe(0)
  })
  it('determinista: misma entrada → misma confianza', () => {
    expect(scoreConfidence(printerDesconocida)).toBe(scoreConfidence(printerDesconocida))
  })
  it('cada candidato trae una explicación (propuesta explicable)', () => {
    expect(scoreCandidate(printerDesconocida).explanation).toMatch(/no identificado con certeza/)
    expect(scoreCandidate(printerConocida).explanation).toMatch(/reconocido/)
  })
})

describe('propuesta — fallback manual + confirmación siempre', () => {
  it('ordena por confianza y expone alternativas', () => {
    const p = buildProposal([printerDesconocida, printerConocida])
    expect(p.best?.id).toBe('p2') // el reconocido gana
    expect(p.alternatives.map((a) => a.id)).toEqual(['p1'])
  })
  it('SIEMPRE incluye fallback manual y exige confirmación', () => {
    const p = buildProposal([printerConocida])
    expect(p.manualFallback.adapter).toBe('manual')
    expect(p.requiresConfirmation).toBe(true)
  })
  it('cero candidatos → best null, sólo queda el manual', () => {
    const p = buildProposal([])
    expect(p.best).toBeNull()
    expect(p.manualFallback.adapter).toBe('manual')
    expect(p.requiresConfirmation).toBe(true)
  })
})

// ── API stateless ──
vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { email: 'a@fullsite.mx' } })),
}))
import { POST } from '@/app/api/platform/hardware/propose/route'
function post(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}

describe('API propose — sólo propone, no guarda', () => {
  it('devuelve una propuesta con confirmación exigida', async () => {
    const res = await POST(post({ candidates: [printerDesconocida] }))
    const j = await res.json() as { proposal: { requiresConfirmation: boolean; manualFallback: { adapter: string } } }
    expect(j.proposal.requiresConfirmation).toBe(true)
    expect(j.proposal.manualFallback.adapter).toBe('manual')
  })
  it('sin candidatos válidos → propuesta con manual, sin best', async () => {
    const res = await POST(post({ candidates: 'no-es-lista' }))
    const j = await res.json() as { proposal: { best: unknown } }
    expect(j.proposal.best).toBeNull()
  })
})
