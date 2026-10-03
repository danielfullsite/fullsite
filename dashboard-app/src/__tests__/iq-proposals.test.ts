// Fullsite IQ: read-only por defecto, allowlist, preview/diff, confirmación, nada autónomo.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  IQ_CASES, findIqCase, buildDiff, buildProposal, type IqFinding,
} from '../lib/iq-proposals'

describe('allowlist de casos + read-only', () => {
  it('empieza por los cinco casos pedidos, todos read-only', () => {
    const ids = IQ_CASES.map((c) => c.id).sort()
    expect(ids).toEqual(['agotados', 'anomalias', 'costos_cero', 'precios', 'turnos_abiertos'])
    for (const c of IQ_CASES) expect(c.readOnly).toBe(true)
  })
  it('findIqCase rechaza cualquier caso fuera de la allowlist', () => {
    expect(findIqCase('borrar_todo')).toBeNull()
    expect(findIqCase(42)).toBeNull()
    expect(findIqCase('precios')?.risk).toBe('high')
  })
})

describe('preview/diff', () => {
  it('sólo reporta los campos que cambian', () => {
    const d = buildDiff({ precio: 100, nombre: 'Latte' }, { precio: 120, nombre: 'Latte' })
    expect(d).toEqual([{ field: 'precio', before: 100, after: 120 }])
  })
  it('sin cambios → diff vacío', () => {
    expect(buildDiff({ a: 1 }, { a: 1 })).toEqual([])
  })
})

describe('propuesta — nada autónomo, siempre confirmación', () => {
  const findings: IqFinding[] = [
    { entity: 'Latte', summary: 'precio bajo', before: { precio: 100 }, after: { precio: 120 } },
    { entity: 'Té', summary: 'sólo informativo' }, // sin after → no genera acción
  ]
  it('cada acción propuesta es NO autónoma y trae su diff', () => {
    const p = buildProposal('precios', findings)
    expect(p.requiresConfirmation).toBe(true)
    expect(p.readOnly).toBe(true)
    expect(p.proposedActions).toHaveLength(1) // sólo el que tiene after
    expect(p.proposedActions[0].autonomous).toBe(false)
    expect(p.proposedActions[0].risk).toBe('high') // precios = alto riesgo, propuesto no ejecutado
    expect(p.proposedActions[0].diff).toEqual([{ field: 'precio', before: 100, after: 120 }])
  })
  it('sin hallazgos → propuesta vacía (no se inventan acciones)', () => {
    const p = buildProposal('agotados', [])
    expect(p.proposedActions).toEqual([])
    expect(p.requiresConfirmation).toBe(true)
  })
})

// ── API ──
vi.mock('@/lib/platform-auth', () => ({
  requirePlatformAdmin2FA: vi.fn(async () => ({ ctx: { email: 'a@fullsite.mx' } })),
}))
const auditSpy = vi.fn(async () => true)
vi.mock('@/lib/platform-writes', () => ({
  auditLog: (ctx: unknown, entry: unknown) => auditSpy(ctx, entry),
  rateLimit: () => null,
}))
import { GET, POST } from '@/app/api/platform/iq/propose/route'
function post(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as unknown as import('next/server').NextRequest
}
function get() {
  return { headers: { get: () => null } } as unknown as import('next/server').NextRequest
}
beforeEach(() => auditSpy.mockClear())

describe('API IQ propose', () => {
  it('GET devuelve la allowlist de casos', async () => {
    const j = await (await GET(get())).json() as { cases: { id: string }[] }
    expect(j.cases.map((c) => c.id)).toEqual(IQ_CASES.map((c) => c.id))
  })
  it('caso fuera de la allowlist → 400, no audita', async () => {
    const res = await POST(post({ clientId: 'diezmex', caseId: 'exec' }))
    expect(res.status).toBe(400)
    expect(auditSpy).not.toHaveBeenCalled()
  })
  it('propuesta válida → 200 read-only, audita la generación (no ejecución)', async () => {
    const res = await POST(post({ clientId: 'diezmex', caseId: 'costos_cero', findings: [] }))
    expect(res.status).toBe(200)
    const j = await res.json() as { proposal: { requiresConfirmation: boolean; readOnly: boolean } }
    expect(j.proposal.requiresConfirmation).toBe(true)
    expect(j.proposal.readOnly).toBe(true)
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })
})
