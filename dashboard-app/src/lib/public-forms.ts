// BUG-019-F/G — server-only mediation for the remaining public write surfaces:
// customer survey (/encuesta) and AMALAY reservations (/reservar). Both previously wrote
// tenant tables with the browser anon key + browser-chosen client_id — cross-tenant and
// broken under strict RLS. Here writes go through the service role; tenant identity is
// resolved/validated server-side. Fail-closed if the service key is missing.
import { PublicMenuConfigError } from './public-menu'

function sb(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_KEY || ''
  if (!url || !key) throw new PublicMenuConfigError('SUPABASE_SERVICE_KEY not configured')
  return { url, key }
}
async function sbGet<T>(path: string): Promise<T[]> {
  const { url, key } = sb()
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`read ${res.status}`)
  return (await res.json()) as T[]
}
async function sbPost(path: string, body: unknown): Promise<number> {
  const { url, key } = sb()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  return res.status
}

const CLIENT_SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/

// ─── Survey (/encuesta) ─────────────────────────────────────────────────────
// The survey id in the URL names WHICH survey (a client's survey). It is validated as a
// slug and the config must exist; the server writes only survey-response rows scoped to
// that client. NOTE (non-blocking): the slug is guessable — an opaque survey token would
// remove browser-supplied identity entirely (future hardening).
const MAX_ANSWERS = 60
const MAX_ANSWER_LEN = 2000

export function validateSurveyId(raw: unknown): string | null {
  return typeof raw === 'string' && CLIENT_SLUG.test(raw) ? raw : null
}
export function validateSurveyAnswers(raw: unknown): { ok: true; answers: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_answers' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_ANSWERS) return { ok: false, error: 'invalid_answers' }
  const answers: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || k.length > 120) return { ok: false, error: 'invalid_answers' }
    if (typeof v === 'string') { if (v.length > MAX_ANSWER_LEN) return { ok: false, error: 'invalid_answers' }; answers[k] = v }
    else if (typeof v === 'number' || typeof v === 'boolean') answers[k] = v
    else return { ok: false, error: 'invalid_answers' }
  }
  return { ok: true, answers }
}

export async function getSurveyConfig(surveyId: string): Promise<unknown | null> {
  const rows = await sbGet<{ data: unknown }>(
    `wansoft_data?client_id=eq.${encodeURIComponent(surveyId)}&data_key=eq.survey_config&order=fecha.desc&limit=1&select=data`)
  return rows[0]?.data ?? null
}

export async function submitSurveyResponse(surveyId: string, answers: Record<string, unknown>, userAgent: string, isoNow: string): Promise<{ status: number; body: object }> {
  const config = await getSurveyConfig(surveyId)
  if (config == null) return { status: 404, body: { error: 'not_found' } } // no survey here -> fail closed
  const dataKey = `survey_response_${isoNow.slice(0, 10)}_${isoNow.slice(11, 19).replace(/:/g, '-')}`
  const st = await sbPost('wansoft_data', {
    client_id: surveyId,                 // server-scoped to this survey's client, not a free write
    data_key: dataKey,
    fecha: isoNow.slice(0, 10),
    data: { survey_id: surveyId, timestamp: isoNow, answers, user_agent: userAgent.slice(0, 400) },
  })
  return st >= 200 && st < 300 ? { status: 201, body: { ok: true } } : { status: 502, body: { error: 'save_failed' } }
}

// ─── Reservations (/reservar) ────────────────────────────────────────────────
// AMALAY-only private-events reservations. client_id is the deployment identity resolved
// SERVER-side (never from the browser). A pending reservation is a staff-reviewed request;
// `total` is a customer quote (non-authoritative), bounded numeric.
export interface ReservationInput {
  nombre?: unknown; telefono?: unknown; fecha?: unknown; espacio?: unknown
  horario_inicio?: unknown; horario_fin?: unknown; guests?: unknown; paquete?: unknown
  pastel?: unknown; entradas?: unknown; deco?: unknown; total?: unknown
}
export function reservationClientId(): string {
  return (process.env.LEGACY_PUBLIC_MENU_CLIENT_ID || process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || '').toLowerCase().trim()
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
export function validateReservation(input: ReservationInput): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const nombre = str(input.nombre, 120), telefono = str(input.telefono, 40)
  const fecha = str(input.fecha, 10), espacio = str(input.espacio, 60)
  const hi = str(input.horario_inicio, 8), hf = str(input.horario_fin, 8), paquete = str(input.paquete, 80)
  if (!nombre || !telefono || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !espacio || !hi || !hf || !paquete) return { ok: false, error: 'invalid_reservation' }
  const guests = Number(input.guests)
  if (!Number.isInteger(guests) || guests < 1 || guests > 1000) return { ok: false, error: 'invalid_guests' }
  const total = Number(input.total)
  const row: Record<string, unknown> = {
    codigo_reserva: 'AMA-' + String(1000 + (Math.abs(hashStr(nombre + fecha + hi)) % 9000)),
    nombre, telefono, fecha, espacio, horario_inicio: hi, horario_fin: hf, guests, paquete,
    pastel: typeof input.pastel === 'string' ? input.pastel.slice(0, 120) : null,
    entradas: Array.isArray(input.entradas) ? (input.entradas as unknown[]).slice(0, 20).map(x => str(x, 120)) : null,
    deco: typeof input.deco === 'string' ? input.deco.slice(0, 200) : null,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    status: 'pending',
  }
  return { ok: true, row }
}
function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

export async function createReservation(input: ReservationInput): Promise<{ status: number; body: object }> {
  const clientId = reservationClientId()
  if (!clientId) return { status: 503, body: { error: 'server_misconfigured' } }
  const v = validateReservation(input)
  if (!v.ok) return { status: 400, body: { error: v.error } }
  const st = await sbPost('reservaciones', { client_id: clientId, ...v.row }) // client_id server-set
  return st >= 200 && st < 300
    ? { status: 201, body: { ok: true, codigo_reserva: v.row.codigo_reserva } }
    : { status: 502, body: { error: 'save_failed' } }
}
