// "Habla con tu restaurante" usa el MISMO /api/chat que el chat escrito (mismos datos,
// mismo día de venta, mismas guardias). La bandera `modo: 'voz'` sólo cambia la FORMA
// de la respuesta: una instrucción de salida hablada, y sin gráfica inyectada.
// Sin la bandera, nada cambia.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { esModoVoz, instruccionModoVoz, MAX_HISTORIAL_VOZ, MODO_VOZ } from '@/lib/voz/instruccion-voz'
import { FIN_DATOS, INICIO_DATOS } from '@/lib/chat-context'

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
  requireTenant: async () => ({ clientId: 'demo', staffId: `voz-${Math.random()}`, staffName: 'x', role: 'dueno', authType: 'supabase_session' }),
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

beforeEach(() => {
  capturado.length = 0
  respuestaModelo = 'Vas bien.'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  process.env.GROQ_API_KEY = 'g'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T19:00:00Z'))
  vi.stubGlobal('fetch', async (url: string) => {
    const body = String(url).includes('/rest/v1/wansoft_daily') ? dias('2026-09-27', 20) : []
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function preguntar(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/chat/route')
  const res = await POST(req(body))
  const system = capturado[capturado.length - 1]?.messages.find(m => m.role === 'system')?.content || ''
  return { res, json: await res.json() as { response?: string }, system }
}

describe('bandera modo', () => {
  it("sólo 'voz' exacto activa el modo voz", () => {
    expect(MODO_VOZ).toBe('voz')
    expect(esModoVoz('voz')).toBe(true)
    for (const x of ['Voz', 'texto', '', null, undefined, 1, true, { modo: 'voz' }]) expect(esModoVoz(x)).toBe(false)
  })

  it('la instrucción pide 1–3 oraciones con la respuesta directa primero, sin markdown/links/emojis, números con dígitos', () => {
    const i = instruccionModoVoz()
    expect(i).toMatch(/1 a 3 oraciones cortas/)
    expect(i).toMatch(/PRIMERA oración es la respuesta directa/)
    expect(i).toMatch(/español de México natural/)
    expect(i).toMatch(/sin forzar modismos/)
    expect(i).toMatch(/Nunca enumeres más de 3 cosas/)
    expect(i).toContain('¿Te los mando en pantalla?')
    expect(i).toMatch(/pregunta breve de seguimiento SÓLO si de verdad ayuda/)
    expect(i).toMatch(/"¿y ayer\?"/)
    expect(i).toMatch(/tablas/)
    expect(i).toMatch(/markdown/)
    expect(i).toMatch(/links/)
    expect(i).toMatch(/emojis/)
    expect(i).toMatch(/CON DÍGITOS/)
    expect(i).toMatch(/doce mil quinientos pesos/) // lo dice la app (texto-hablado), no el modelo
    // No afloja la honestidad de datos.
    expect(i).toMatch(/si no tienes el dato/i)
  })
})

describe("POST /api/chat con modo 'voz'", () => {
  it('agrega la instrucción de voz al prompt de sistema, FUERA del bloque de datos', async () => {
    const { system } = await preguntar({ message: '¿cómo vamos hoy?', modo: 'voz' })
    expect(system).toContain(instruccionModoVoz())
    const i = system.indexOf(instruccionModoVoz())
    expect(i).toBeLessThan(system.indexOf(INICIO_DATOS))
    // Los datos siguen iguales: mismo día de venta.
    expect(system).toContain('DÍA DE VENTA EN CURSO: 2026-09-28')
    expect(system.split(FIN_DATOS).length).toBe(2)
  })

  it('sin la bandera el prompt es idéntico al de antes (y un modo desconocido = sin bandera)', async () => {
    const sin = (await preguntar({ message: '¿cómo vamos hoy?' })).system
    const otro = (await preguntar({ message: '¿cómo vamos hoy?', modo: 'texto' })).system
    const voz = (await preguntar({ message: '¿cómo vamos hoy?', modo: 'voz' })).system
    expect(sin).not.toContain('MODO VOZ')
    expect(otro).toBe(sin)
    // La ÚNICA diferencia con voz es la instrucción insertada.
    expect(voz.replace(`\n${instruccionModoVoz()}\n`, '')).toBe(sin)
  })

  it('en voz no se inyecta la gráfica automática; en texto sí', async () => {
    const texto = await preguntar({ message: 'hazme una grafica de ventas' })
    expect(texto.json.response).toContain('<!--chart')
    const voz = await preguntar({ message: 'hazme una grafica de ventas', modo: 'voz' })
    expect(voz.json.response).toBe('Vas bien.')
  })

  it('usa el historial de la plática (hasta MAX_HISTORIAL_VOZ mensajes) para seguimientos como "¿y ayer?"', async () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turno-${i}` }))
    await preguntar({ message: '¿y ayer?', modo: 'voz', history })
    const voz = capturado[capturado.length - 1].messages.filter(m => m.role !== 'system')
    expect(MAX_HISTORIAL_VOZ).toBe(10)
    expect(voz.map(m => m.content)).toEqual([...history.slice(-MAX_HISTORIAL_VOZ).map(h => h.content), '¿y ayer?'])
    // El chat escrito se queda como estaba (8).
    await preguntar({ message: '¿y ayer?', history })
    expect(capturado[capturado.length - 1].messages.filter(m => m.role !== 'system')).toHaveLength(9)
  })

  it('misma guardia: sin sesión el modo voz también es 401', async () => {
    const auth = await import('@/lib/api-auth')
    const spy = vi.spyOn(auth, 'requireTenant').mockResolvedValueOnce(Response.json({ error: 'Se requiere sesión' }, { status: 401 }))
    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(req({ message: 'hola', modo: 'voz' }))
    expect(res.status).toBe(401)
    spy.mockRestore()
  })
})
