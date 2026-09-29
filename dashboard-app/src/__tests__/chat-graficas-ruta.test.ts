// /api/chat y las gráficas: el prompt ya NO le pide al modelo escribir datos de
// gráfica; le lista IDs del catálogo. La ruta sustituye marcadores por specs del
// servidor, descarta bloques con datos del modelo, y auto-inyecta con el catálogo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { separarGraficas } from '@/lib/grafica-spec'

const capturado: { messages: { role: string; content: string }[] }[] = []
let respuestaModelo = 'Vas bien.'
vi.mock('@/lib/groq', () => ({
  groqChat: async (o: { messages: { role: string; content: string }[] }) => { capturado.push(o); return respuestaModelo },
}))
vi.mock('@/lib/client-config', () => ({
  fetchClientConfig: async () => ({ display_name: 'Demo', city: '', business_context: '', timezone: 'America/Monterrey' }),
}))
vi.mock('@/lib/wansoft-legacy', () => ({ esDuenoDelHistoricoWansoft: async () => false }))
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth')>()),
  requireTenant: async () => ({ clientId: 'demo', staffId: `graf-${Math.random()}`, staffName: 'x', role: 'dueno', authType: 'supabase_session' }),
}))

function dias(hasta: string, n: number) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(`${hasta}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i)
    out.push({ fecha: d.toISOString().slice(0, 10), ventas_dia: 1000 + i, personas_restaurant: 10, tickets_count: 5 })
  }
  return out
}

const req = (body: unknown) => ({
  headers: new Headers(), cookies: { get: () => undefined }, json: async () => body,
}) as unknown as import('next/server').NextRequest

let chatLogs: { ai_response: string }[] = []

beforeEach(() => {
  capturado.length = 0
  chatLogs = []
  respuestaModelo = 'Vas bien.'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  process.env.GROQ_API_KEY = 'g'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T19:00:00Z'))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/rest/v1/chat_logs')) chatLogs.push(JSON.parse(String(init?.body || '{}')))
    const body = String(url).includes('/rest/v1/wansoft_daily') ? dias('2026-09-27', 45) : []
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function preguntar(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/chat/route')
  const res = await POST(req(body))
  const msgs = capturado[capturado.length - 1]?.messages || []
  const system = msgs.find(m => m.role === 'system')?.content || ''
  return { json: await res.json() as { response: string }, system, msgs }
}

const graficasDe = (t: string) => separarGraficas(t).flatMap(p => (p.tipo === 'grafica' ? [p.spec] : []))

describe('prompt', () => {
  it('ya no pide escribir datos de gráfica; lista IDs con su rango real', async () => {
    const { system } = await preguntar({ message: 'hazme una gráfica de ventas del mes' })
    expect(system).not.toMatch(/"data":\[\{"label"/)
    expect(system).not.toContain('<!--chart\n{')
    expect(system).toContain('TÚ NO ESCRIBES SUS DATOS')
    expect(system).toContain('<!--grafica:ID-->')
    expect(system).toMatch(/- ventas_diarias_30d: .*2026-08-30 a 2026-09-28/)
    expect(system).toContain('- ventas_por_mes: ')
    // Sin datos de meseros no se ofrece la gráfica de meseros.
    expect(system).not.toContain('- meseros:')
  })
})

describe('respuesta', () => {
  it('el marcador del modelo se sustituye por el spec del servidor (datos reales)', async () => {
    respuestaModelo = 'Septiembre va arriba.\n<!--grafica:ventas_por_mes-->'
    const { json } = await preguntar({ message: 'gráfica por mes' })
    const gs = graficasDe(json.response)
    expect(gs.map(g => g.id)).toEqual(['ventas_por_mes'])
    const sep = gs[0].filas.find(f => f.x === '2026-09')!
    // 27 días de septiembre con datos: 1000..1026 → suma real
    expect(sep.v.ventas).toBe(Array.from({ length: 27 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0))
    expect(sep.parcial).toBe(true)
  })

  it('un <!--chart con datos inventados se descarta; y como se pidió gráfica, se inyecta la del catálogo', async () => {
    respuestaModelo = 'Mira.\n<!--chart\n{"type":"bar","title":"Ventas","data":[{"label":"lun","value":777777},{"label":"mar","value":5}]}\nchart-->'
    const { json } = await preguntar({ message: 'hazme una grafica de ventas' })
    expect(json.response).not.toContain('777777')
    expect(graficasDe(json.response).map(g => g.id)).toEqual(['ventas_diarias_30d'])
  })

  it('IDs desconocidos se quitan; sin pedir gráfica no se inyecta nada', async () => {
    respuestaModelo = 'Vas bien. <!--grafica:ventas_inventadas-->'
    const { json } = await preguntar({ message: '¿cuánto vendí ayer?' })
    expect(json.response).toBe('Vas bien.')
  })

  it('el log guarda el marcador compacto, no el JSON', async () => {
    respuestaModelo = 'Ok.\n<!--grafica:ventas_diarias_30d-->'
    await preguntar({ message: 'gráfica' })
    await new Promise(r => setTimeout(r, 0))
    expect(chatLogs.at(-1)?.ai_response).toBe('Ok.\n<!--grafica:ventas_diarias_30d-->')
  })

  it('voz: nunca gráficas, aunque el modelo ponga marcador', async () => {
    respuestaModelo = 'Vas bien. <!--grafica:ventas_diarias_30d-->'
    const { json } = await preguntar({ message: 'hazme una grafica', modo: 'voz' })
    expect(json.response).toBe('Vas bien.')
  })

  it('el historial llega al modelo con las gráficas compactadas a su marcador', async () => {
    respuestaModelo = 'Ok.\n<!--grafica:ventas_diarias_30d-->'
    const primera = (await preguntar({ message: 'gráfica' })).json.response
    const { msgs } = await preguntar({ message: '¿y ayer?', history: [{ role: 'user', content: 'gráfica' }, { role: 'assistant', content: primera }] })
    const asistente = msgs.find(m => m.role === 'assistant')!
    expect(asistente.content).toMatch(/^Ok\.\s+<!--grafica:ventas_diarias_30d-->$/)
    expect(asistente.content).not.toContain('"filas"')
  })
})

describe('límite por minuto', () => {
  it('modo voz: 30 por minuto (turnos cortos y seguidos); el chat escrito sigue en 20', async () => {
    const auth = await import('@/lib/api-auth')
    const id = `lim-${Math.random()}`
    const spy = vi.spyOn(auth, 'requireTenant').mockResolvedValue({ clientId: 'demo', staffId: id, staffName: 'x', role: 'dueno', authType: 'supabase_session' } as never)
    const { POST } = await import('@/app/api/chat/route')
    const estados: number[] = []
    for (let i = 0; i < 31; i++) estados.push((await POST(req({ message: 'hola', modo: 'voz' }))).status)
    expect(estados.slice(0, 30).every(x => x === 200)).toBe(true)
    expect(estados[30]).toBe(429)
    const id2 = `lim-${Math.random()}`
    spy.mockResolvedValue({ clientId: 'demo', staffId: id2, staffName: 'x', role: 'dueno', authType: 'supabase_session' } as never)
    const texto: number[] = []
    for (let i = 0; i < 21; i++) texto.push((await POST(req({ message: 'hola' }))).status)
    expect(texto[19]).toBe(200)
    expect(texto[20]).toBe(429)
    spy.mockRestore()
  })
})

