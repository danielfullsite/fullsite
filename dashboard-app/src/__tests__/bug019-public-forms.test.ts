// BUG-019-F/G — survey + reservation server-mediation (pure validators + endpoint I/O).
/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateSurveyId, validateSurveyAnswers, validateReservation } from '@/lib/public-forms'

describe('validateSurveyId', () => {
  it('accepts slugs, rejects junk/injection', () => {
    expect(validateSurveyId('amalay')).toBe('amalay')
    expect(validateSurveyId('coffee-shop')).toBe('coffee-shop')
    expect(validateSurveyId("amalay' OR 1=1")).toBeNull()
    expect(validateSurveyId('a')).toBeNull()        // too short
    expect(validateSurveyId(123)).toBeNull()
  })
})

describe('validateSurveyAnswers', () => {
  it('accepts bounded string/number/bool answers', () => {
    const r = validateSurveyAnswers({ q1: 5, q2: 'ok', q3: true })
    expect(r.ok).toBe(true)
  })
  it('rejects empty, oversized, or non-primitive answers', () => {
    expect(validateSurveyAnswers({}).ok).toBe(false)
    expect(validateSurveyAnswers({ q: 'x'.repeat(5000) }).ok).toBe(false)
    expect(validateSurveyAnswers({ q: { nested: 1 } }).ok).toBe(false)
    expect(validateSurveyAnswers([1, 2] as any).ok).toBe(false)
  })
})

describe('validateReservation', () => {
  const base = { nombre: 'Ana', telefono: '8110000000', fecha: '2026-09-01', espacio: 'jardin', horario_inicio: '18:00', horario_fin: '22:00', guests: 30, paquete: 'Oro' }
  it('accepts a valid reservation and sets status=pending + codigo', () => {
    const r = validateReservation(base)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.row.status).toBe('pending'); expect(String(r.row.codigo_reserva)).toMatch(/^AMA-\d{4}$/) }
  })
  it('never lets the browser set client_id/status (they are not read from input)', () => {
    const r = validateReservation({ ...base, client_id: 'evil', status: 'confirmed' } as any)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.row.status).toBe('pending'); expect('client_id' in r.row).toBe(false) }
  })
  it('rejects bad date / missing fields / absurd guests', () => {
    expect(validateReservation({ ...base, fecha: 'nope' }).ok).toBe(false)
    expect(validateReservation({ ...base, nombre: '' }).ok).toBe(false)
    expect(validateReservation({ ...base, guests: 0 }).ok).toBe(false)
    expect(validateReservation({ ...base, guests: 99999 }).ok).toBe(false)
  })
})

describe('createReservation — server sets client_id (not browser)', () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks() })
  it('inserts with the deployment client_id via service role', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'amalay'
    let inserted: any = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts?: any) => { inserted = JSON.parse(opts.body); return { ok: true, status: 201, json: async () => [] } as any }))
    const { createReservation } = await import('@/lib/public-forms')
    const res = await createReservation({ nombre: 'Ana', telefono: '811', fecha: '2026-09-01', espacio: 'jardin', horario_inicio: '18:00', horario_fin: '22:00', guests: 30, paquete: 'Oro', total: 9999 })
    expect(res.status).toBe(201)
    expect(inserted.client_id).toBe('amalay')  // server-set, not browser
    expect(inserted.status).toBe('pending')
  })
})
