// /api/chat + verificador de números: ninguna cifra sin rastro en los datos llega al
// dueño. Red simulada (Groq + PostgREST), como chat-lectura-universal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { separarGraficas } from '@/lib/grafica-spec'
import { MARCA_SIN_VERIFICAR, NOTA_SIN_VERIFICAR } from '@/lib/verificador-numeros'

vi.mock('@/lib/client-config', () => ({
  fetchClientConfig: async () => ({ display_name: 'Demo', city: '', business_context: '', timezone: 'America/Monterrey' }),
}))
vi.mock('@/lib/wansoft-legacy', () => ({ esDuenoDelHistoricoWansoft: async () => false }))
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth')>()),
  requireTenant: async () => ({ clientId: 'demo', staffId: `vn-${Math.random()}`, staffName: 'x', role: 'dueño', authType: 'supabase_session' }),
}))

const MAPA = [{
  tabla: 'pos_orders', filas: '1200', fechas: { columna: 'dia_venta', desde: '2026-08-01', hasta: '2026-09-27' },
  columnas: [{ c: 'dia_venta', t: 'date' }, { c: 'total', t: 'numeric' }, { c: 'mesero', t: 'text' }], descripcion: null,
}]

type TC = { id: string; type: 'function'; function: { name: string; arguments: string } }
type MsgModelo = { content?: string | null; tool_calls?: TC[] }
let guion: (body: Record<string, unknown>, i: number) => MsgModelo
let mapaOk = true
let consulta: (sql: string) => Record<string, unknown>[]
let groqBodies: Record<string, unknown>[] = []
let diarias: Record<string, unknown>[] = []

const tc = (id: string, sql: string, para_que = 'Venta') =>
  ({ id, type: 'function' as const, function: { name: 'consultar_datos', arguments: JSON.stringify({ sql, para_que }) } })

const req = (body: unknown) => ({
  headers: new Headers(), cookies: { get: (n: string) => (n === 'fs-at' ? { value: 'JWT' } : undefined) }, json: async () => body,
}) as unknown as import('next/server').NextRequest

beforeEach(() => {
  groqBodies = []
  mapaOk = true
  diarias = []
  consulta = () => [{ total: '12534.49' }]
  guion = () => ({ content: 'Listo.' })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE'
  process.env.GROQ_API_KEY = 'g'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T19:00:00Z'))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    const resp = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
    if (u.includes('api.groq.com')) {
      const body = JSON.parse(String(init?.body || '{}'))
      groqBodies.push(body)
      const r = guion(body, groqBodies.length - 1)
      return resp(200, { choices: [{ message: { role: 'assistant', content: r.content ?? '', tool_calls: r.tool_calls } }] })
    }
    if (u.endsWith('/rpc/ia_mapa')) return mapaOk ? resp(200, MAPA) : resp(500, { message: 'x' })
    if (u.endsWith('/rpc/ia_consulta')) {
      const filas = consulta(String(JSON.parse(String(init?.body || '{}')).p_sql))
      return resp(200, { filas, n: filas.length, truncado: false })
    }
    if (u.includes('/rest/v1/wansoft_daily')) return resp(200, diarias)
    return resp(200, [])
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function preguntar(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/chat/route')
  const res = await POST(req(body))
  return (await res.json() as { response: string }).response
}
const mensajesDe = (b: Record<string, unknown>) => (b.messages as { role: string; content: string | null }[])
const ultimo = (b: Record<string, unknown>) => mensajesDe(b)[mensajesDe(b).length - 1]

describe('consulta libre + verificador', () => {
  it('todo rastreable: 2 llamadas al modelo, respuesta intacta, log de conteos sin valores', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Del 2026-08-01 al 2026-09-27 vendiste $12,534 (unos 12.5k).' }
    const log = vi.spyOn(console, 'log')
    const r = await preguntar({ message: '¿cuánto vendí?' })
    expect(r).toBe('Del 2026-08-01 al 2026-09-27 vendiste $12,534 (unos 12.5k).')
    expect(groqBodies).toHaveLength(2)
    const linea = log.mock.calls.map(c => String(c[0])).find(l => l.startsWith('[chat] verificador'))!
    expect(JSON.parse(linea.replace('[chat] verificador ', ''))).toEqual({ afirmaciones: 2, sin_rastro: 0, reparado: false, marcados: 0, ms_reparacion: 0, voz: false })
    expect(linea).not.toContain('12')
  })

  it('cifra inventada → UNA reparación con la lista y los resultados previos; la reparada pasa', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : i === 1 ? { content: 'Vendiste $99,999.' } : { content: 'Vendiste $12,534.' }
    const r = await preguntar({ message: '¿cuánto vendí?' })
    expect(r).toBe('Vendiste $12,534.')
    expect(groqBodies).toHaveLength(3)
    const rep = groqBodies[2]
    expect(ultimo(rep).role).toBe('user')
    expect(ultimo(rep).content).toContain('VERIFICACIÓN AUTOMÁTICA')
    expect(ultimo(rep).content).toContain('"$99,999"')
    expect(ultimo(rep).content).toContain('consultar_datos')
    const ms = mensajesDe(rep)
    expect(ms[ms.length - 2]).toEqual({ role: 'assistant', content: 'Vendiste $99,999.' })
    expect(ms[0].content).toContain('RESULTADOS DE CONSULTAS YA HECHAS')
    expect(rep.tools).toBeDefined() // puede consultar en la reparación
  })

  it('la reparación puede consultar: la cifra nueva sale de SQL y queda verificada', async () => {
    consulta = sql => (sql.includes('avg') ? [{ ticket_promedio: 313.36 }] : [{ total: '12534.49' }])
    guion = (_b, i) => [
      { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] },
      { content: 'Vendiste $12,534, ticket de $314.' },
      { tool_calls: [tc('c2', 'select avg(total) as ticket_promedio from pos_orders', 'Ticket')] },
      { content: 'Vendiste $12,534, ticket de $313.' },
    ][i] ?? { content: 'x' }
    const r = await preguntar({ message: '¿cuánto vendí y ticket?' })
    expect(r).toBe('Vendiste $12,534, ticket de $313.')
  })

  it('reparación que vuelve a inventar → "[sin verificar]" + nota', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Vendiste $12,534 y creciste 23%.' }
    const r = await preguntar({ message: '¿cuánto vendí?' })
    expect(r).toBe(`Vendiste $12,534 y creciste ${MARCA_SIN_VERIFICAR}.\n\n${NOTA_SIN_VERIFICAR}`)
    expect(groqBodies).toHaveLength(3)
  })

  it('marcador de gráfica: sus dígitos no se leen; el spec lo pone el servidor', async () => {
    consulta = () => [{ dia: '2026-08-01', total: 100 }, { dia: '2026-08-02', total: 200 }, { dia: '2026-08-03', total: 150 }]
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select dia_venta as dia, sum(total) as total from pos_orders group by 1')] }
      : { content: 'Tu mejor día fue el 2026-08-02 con $200.\n<!--grafica:consulta-1-->' }
    const r = await preguntar({ message: 'ventas por día' })
    expect(groqBodies).toHaveLength(2)
    expect(r).toContain('Tu mejor día fue el 2026-08-02 con $200.')
    expect(separarGraficas(r).some(p => p.tipo === 'grafica')).toBe(true)
    expect(r).not.toContain(MARCA_SIN_VERIFICAR)
  })

  it('montos de la pregunta del usuario o de respuestas previas del asistente NO respaldan; conteos del usuario sí', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Vas en $12,534 de tu meta de $15,000 en 12 mesas; antes te dije $7,777.' }
    const r = await preguntar({
      message: 'mi meta es $15,000 en 12 mesas, ¿cómo voy?',
      history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Llevas $7,777' }],
    })
    expect(r).toContain('Vas en $12,534')
    expect(r).toContain(`de tu meta de ${MARCA_SIN_VERIFICAR} en 12 mesas`)
    expect(r).toContain(`antes te dije ${MARCA_SIN_VERIFICAR}`)
  })

  it('un % sin columna de porcentaje no se respalda con una proporción cualquiera', async () => {
    consulta = () => [{ total: '12534.49', peso_kg: 0.14 }]
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total, avg(peso) as peso_kg from pos_orders')] }
      : { content: 'Vendiste $12,534 y creciste 14%.' }
    const r = await preguntar({ message: '¿cuánto vendí?' })
    expect(r).toContain(`creciste ${MARCA_SIN_VERIFICAR}`)
  })
})

describe('sin consulta libre (precalculados) + verificador', () => {
  beforeEach(() => {
    mapaOk = false
    diarias = [{ fecha: '2026-09-27', ventas_dia: 1000, personas_restaurant: 10, tickets_count: 5 }]
  })

  it('cifra del bloque precalculado: pasa', async () => {
    guion = () => ({ content: 'El 2026-09-27 vendiste $1,000 con 10 personas.' })
    const r = await preguntar({ message: '¿cuánto vendí ayer?' })
    expect(r).toBe('El 2026-09-27 vendiste $1,000 con 10 personas.')
    expect(groqBodies).toHaveLength(1)
  })

  it('cifra inventada: reparación por groqChat (sin herramientas, sin ofrecer SQL)', async () => {
    guion = (_b, i) => ({ content: i === 0 ? 'Vendiste $5,000.' : 'Vendiste $1,000.' })
    const r = await preguntar({ message: '¿cuánto vendí ayer?' })
    expect(r).toBe('Vendiste $1,000.')
    expect(groqBodies).toHaveLength(2)
    expect(groqBodies[1].tools).toBeUndefined()
    expect(ultimo(groqBodies[1]).content).not.toContain('consultar_datos')
  })
})

describe('modo voz + verificador', () => {
  it('números en palabras con rastro pasan; sin rastro se marcan', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Llevas doce mil quinientos treinta y cuatro pesos.' }
    expect(await preguntar({ message: '¿cuánto vendí?', modo: 'voz' })).toBe('Llevas doce mil quinientos treinta y cuatro pesos.')

    groqBodies = []
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Llevas trece mil pesos.' }
    const r = await preguntar({ message: '¿cuánto vendí?', modo: 'voz' })
    expect(r).toBe(`Llevas ${MARCA_SIN_VERIFICAR} pesos.\n\n${NOTA_SIN_VERIFICAR}`)
  })

  it('dígitos en voz (la app los verbaliza) se verifican igual', async () => {
    guion = (_b, i) => i === 0
      ? { tool_calls: [tc('c1', 'select sum(total) as total from pos_orders')] }
      : { content: 'Llevas $12,534.' }
    expect(await preguntar({ message: '¿cuánto vendí?', modo: 'voz' })).toBe('Llevas $12,534.')
  })
})
