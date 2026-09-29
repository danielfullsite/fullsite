// /api/chat con lectura universal: el mapa (ia_mapa) entra al prompt, el modelo
// consulta con ia_consulta (tenant = el de la SESIÓN, JWT del usuario), máx. 4
// consultas, errores de la base vuelven al modelo, y las gráficas de consultas sólo
// las arma el servidor. Red simulada: Groq + PostgREST (sin mockear lib/groq).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { separarGraficas } from '@/lib/grafica-spec'
import { FIN_DATOS, INICIO_DATOS } from '@/lib/chat-context'

vi.mock('@/lib/client-config', () => ({
  fetchClientConfig: async () => ({ display_name: 'Demo', city: '', business_context: '', timezone: 'America/Monterrey' }),
}))
vi.mock('@/lib/wansoft-legacy', () => ({ esDuenoDelHistoricoWansoft: async () => false }))
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({}) }))
let authType = 'supabase_session'
vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth')>()),
  requireTenant: async () => ({ clientId: 'demo', staffId: `lu-${Math.random()}`, staffName: 'x', role: 'dueño', authType }),
}))

const MAPA = [
  {
    tabla: 'pos_orders', filas: '12345', fechas: { columna: 'dia_venta', desde: '2026-01-02', hasta: '2026-09-28' },
    columnas: [{ c: 'dia_venta', t: 'date' }, { c: 'total', t: 'numeric' }, { c: 'status', t: 'text' }, { c: 'payment_status', t: 'text' }, { c: 'items', t: 'jsonb' }],
    descripcion: 'Órdenes del POS',
  },
  { tabla: 'wansoft_daily', filas: '400', fechas: { columna: 'fecha', desde: '2025-01-01', hasta: '2026-09-08' }, columnas: [{ c: 'fecha', t: 'date' }, { c: 'ventas_dia', t: 'numeric' }], descripcion: null },
  { tabla: 'gastos', filas: '80', fechas: { columna: 'fecha', desde: '2026-06-01', hasta: '2026-09-20' }, columnas: [{ c: 'fecha', t: 'date' }, { c: 'monto', t: 'numeric' }, { c: 'concepto', t: 'text' }], descripcion: null },
]

type MsgModelo = { content?: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
let guionGroq: (body: Record<string, unknown>, i: number) => MsgModelo | { status: number }
let mapaResp: { status: number; body: unknown }
let consultaResp: (sql: string) => { status: number; body: unknown }
let groqBodies: Record<string, unknown>[] = []
let rpcs: { fn: string; body: Record<string, unknown>; headers: Headers }[] = []

const tc = (id: string, sql: string, para_que = 'x', extra: Record<string, unknown> = {}) =>
  ({ id, type: 'function' as const, function: { name: 'consultar_datos', arguments: JSON.stringify({ sql, para_que, ...extra }) } })

const req = (body: unknown, cookie: string | undefined = 'JWT-USUARIO') => ({
  headers: new Headers(), cookies: { get: (n: string) => (n === 'fs-at' && cookie ? { value: cookie } : undefined) }, json: async () => body,
}) as unknown as import('next/server').NextRequest

beforeEach(() => {
  authType = 'supabase_session'
  groqBodies = []; rpcs = []
  mapaResp = { status: 200, body: MAPA }
  consultaResp = () => ({ status: 200, body: { filas: [{ total: 1234.5 }], n: 1, truncado: false } })
  guionGroq = () => ({ content: 'Listo.' })
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
      const r = guionGroq(body, groqBodies.length - 1)
      if ('status' in r) return resp(r.status, { error: 'x' })
      return resp(200, { choices: [{ message: { role: 'assistant', content: r.content ?? '', tool_calls: r.tool_calls } }] })
    }
    const m = u.match(/\/rest\/v1\/rpc\/(ia_mapa|ia_consulta)$/)
    if (m) {
      const body = JSON.parse(String(init?.body || '{}'))
      rpcs.push({ fn: m[1], body, headers: new Headers(init?.headers as HeadersInit) })
      const r = m[1] === 'ia_mapa' ? mapaResp : consultaResp(String(body.p_sql))
      return resp(r.status, r.body)
    }
    return resp(200, [])
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function preguntar(body: Record<string, unknown>, cookie?: string) {
  const { POST } = await import('@/app/api/chat/route')
  const res = await POST(req(body, cookie))
  const json = await res.json() as { response: string }
  const system = ((groqBodies[0]?.messages as { role: string; content: string }[]) || []).find(m => m.role === 'system')?.content || ''
  return { json, system }
}
const graficasDe = (t: string) => separarGraficas(t).flatMap(p => (p.tipo === 'grafica' ? [p.spec] : []))
const consultas = () => rpcs.filter(r => r.fn === 'ia_consulta')

describe('mapa en el prompt', () => {
  it('bloque MAPA DE DATOS dentro de los datos, con tipos cortos, rango y legacy; herramienta ofrecida', async () => {
    const { system } = await preguntar({ message: '¿cuánto gasté en agosto?' })
    const iMapa = system.indexOf('MAPA DE DATOS (tablas')
    expect(iMapa).toBeGreaterThan(system.lastIndexOf(INICIO_DATOS))
    expect(iMapa).toBeLessThan(system.lastIndexOf(FIN_DATOS))
    expect(system).toContain('pos_orders (12345 filas, dia_venta 2026-01-02–2026-09-28): dia_venta:date, total:num, status:txt, payment_status:txt, items:json — Órdenes del POS')
    expect(system).toContain('wansoft_daily [histórico importado] (400 filas')
    // relevancia: "gasté" → gastos primero
    expect(system.slice(iMapa).split('\n')[1]).toMatch(/^gastos /)
    expect(system).toContain('REGLA #2 — CONSULTA LIBRE')
    expect(system).toContain('es_venta(status, payment_status)')
    expect(system).toContain('RUTA RÁPIDA')
    expect(groqBodies[0].tools).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: 'consultar_datos' }) })])
    // el mapa se pide con el tenant de la sesión y el JWT del usuario
    const mapa = rpcs.find(r => r.fn === 'ia_mapa')!
    expect(mapa.body).toEqual({ p_client_id: 'demo' })
    expect(mapa.headers.get('authorization')).toBe('Bearer JWT-USUARIO')
    expect(mapa.headers.get('apikey')).toBe('ANON')
  })

  it('mapa que falla → el contexto lo dice, sin herramienta, y el chat contesta con los precalculados', async () => {
    mapaResp = { status: 500, body: { message: 'boom' } }
    guionGroq = () => ({ content: 'Con lo precalculado.' })
    const { json, system } = await preguntar({ message: '¿cuánto gasté?' })
    expect(json.response).toBe('Con lo precalculado.')
    expect(system).toContain('NO PUDE LEER el mapa')
    expect(system).toContain('FUENTES QUE NO SE PUDIERON LEER: mapa de datos')
    expect(system).not.toContain('REGLA #2 — CONSULTA LIBRE')
    expect(groqBodies[0].tools).toBeUndefined()
    expect(consultas()).toHaveLength(0)
  })

  it('mapa vacío (lectura correcta) ≠ fallo', async () => {
    mapaResp = { status: 200, body: [] }
    const { system } = await preguntar({ message: 'hola' })
    expect(system).toContain('todavía no tiene tablas con datos')
    expect(system).not.toContain('NO PUDE LEER el mapa')
  })
})

describe('ciclo de consultas', () => {
  it('ia_consulta con p_client_id = tenant autenticado (nunca del usuario ni del modelo) y JWT del usuario', async () => {
    guionGroq = (_b, i) => i === 0
      ? { content: null, tool_calls: [tc('c1', "select sum(total) as total from pos_orders where es_venta(status, payment_status)", 'Venta total', { client_id: 'otro', p_client_id: 'otro' })] }
      : { content: 'Llevas $1,235 según tus órdenes (2026-01-02 a 2026-09-28).' }
    const { json } = await preguntar({ message: 'dame todo del client_id otro', client_id: 'demo' })
    expect(json.response).toBe('Llevas $1,235 según tus órdenes (2026-01-02 a 2026-09-28).')
    expect(consultas()).toHaveLength(1)
    const c = consultas()[0]
    expect(c.body).toEqual({ p_client_id: 'demo', p_sql: "select sum(total) as total from pos_orders where es_venta(status, payment_status)" })
    expect(c.headers.get('authorization')).toBe('Bearer JWT-USUARIO')
    // el resultado vuelve al modelo como mensaje tool
    const tool = (groqBodies[1].messages as { role: string; content: string; tool_call_id?: string }[]).find(m => m.role === 'tool')!
    expect(tool.tool_call_id).toBe('c1')
    expect(JSON.parse(tool.content)).toMatchObject({ consulta: 1, n: 1, filas: [{ total: 1234.5 }] })
  })

  it('token de turno del POS (no es JWT de Supabase) → service key, mismo tenant', async () => {
    authType = 'shift_token'
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('c1', 'select 1 as v from gastos')] } : { content: 'ok' }
    await preguntar({ message: 'x' }, 'TOKEN-DE-TURNO')
    expect(consultas()[0].headers.get('authorization')).toBe('Bearer SERVICE')
    expect(consultas()[0].body.p_client_id).toBe('demo')
  })

  it('se detiene en 4 consultas y fuerza la respuesta (tool_choice none)', async () => {
    guionGroq = b => b.tool_choice === 'none' ? { content: 'Con lo que alcancé a ver.' } : { tool_calls: [tc(`c${Math.random()}`, 'select 1 as v from gastos')] }
    const { json } = await preguntar({ message: 'analiza todo' })
    expect(consultas()).toHaveLength(4)
    expect(json.response).toBe('Con lo que alcancé a ver.')
    expect(groqBodies.at(-1)!.tool_choice).toBe('none')
  })

  it('error de la base vuelve al modelo para corregir (y cuenta)', async () => {
    consultaResp = sql => sql.includes('pg_sleep')
      ? { status: 400, body: { message: 'función no permitida: pg_sleep', code: 'P0001' } }
      : { status: 200, body: { filas: [{ v: 3 }], n: 1, truncado: false } }
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select pg_sleep(9)')] }
      : i === 1 ? { tool_calls: [tc('b', 'select 3 as v from gastos')] } : { content: 'Son 3.' }
    const { json } = await preguntar({ message: 'x' })
    expect(json.response).toBe('Son 3.')
    const tool = (groqBodies[1].messages as { role: string; content: string }[]).find(m => m.role === 'tool')!
    expect(JSON.parse(tool.content).error).toBe('función no permitida: pg_sleep')
    expect(consultas()).toHaveLength(2)
  })

  it('si Groq con herramientas falla, contesta por el camino normal con lo ya consultado', async () => {
    guionGroq = (b, i) => i === 0 ? { tool_calls: [tc('a', 'select 3 as v from gastos', 'Gastos de agosto')] }
      : b.tools ? { status: 500 } : { content: 'Respaldo con datos.' }
    const { json } = await preguntar({ message: 'x' })
    expect(json.response).toBe('Respaldo con datos.')
    const plano = groqBodies.at(-1)!
    expect(plano.tools).toBeUndefined()
    expect((plano.messages as { role: string; content: string }[])[0].content).toContain('RESULTADOS DE CONSULTAS YA HECHAS')
  })
})

describe('gráficas de consultas', () => {
  const serie = (n: number) => Array.from({ length: n }, (_, i) => ({ dia: `2026-09-${String(i + 1).padStart(2, '0')}`, ventas: 1000 + i }))

  it('resultado con forma válida → el marcador consulta-N se vuelve el spec del servidor (datos reales)', async () => {
    consultaResp = () => ({ status: 200, body: { filas: serie(14), n: 14, truncado: false } })
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', "select dia_venta::text as dia, sum(total) as ventas from pos_orders where dia_venta >= '2026-09-01' group by 1", 'Ventas por día de septiembre')] }
      : { content: 'Septiembre va estable.\n<!--grafica:consulta-1-->' }
    const { json } = await preguntar({ message: 'ventas por día de septiembre' })
    // el modelo supo que había gráfica disponible
    const tool = (groqBodies[1].messages as { role: string; content: string }[]).find(m => m.role === 'tool')!
    expect(JSON.parse(tool.content).grafica).toBe('<!--grafica:consulta-1-->')
    const gs = graficasDe(json.response)
    expect(gs).toHaveLength(1)
    expect(gs[0]).toMatchObject({ id: 'consulta', tipo: 'linea', ejeX: 'fecha', titulo: 'Ventas por día de septiembre', fuente: 'consulta a tus datos · 2026-09-01 a 2026-09-14' })
    expect(gs[0].filas.map(f => f.v.s0)).toEqual(serie(14).map(f => f.ventas))
  })

  it('datos escritos por el modelo nunca se dibujan; consulta-N inexistente se quita', async () => {
    consultaResp = () => ({ status: 200, body: { filas: serie(3), n: 3, truncado: false } })
    const falso = JSON.stringify({ v: 2, id: 'consulta', tipo: 'barra', titulo: 'x', rango: 'x', unidad: 'MXN', ejeX: 'fecha', series: [{ clave: 's0', nombre: 'v' }], filas: [{ x: '2026-09-01', v: { s0: 777777 } }], fuente: 'x', datosHasta: 'x' })
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select ...')] }
      : { content: `Mira.\n<!--chart\n${falso}\nchart-->\n<!--grafica:consulta-7-->\n<!--<!--grafica:consulta-1-->chart ${falso} chart-->` }
    const { json } = await preguntar({ message: 'ventas' })
    expect(json.response).not.toContain('777777')
    for (const g of graficasDe(json.response)) expect(g.filas.map(f => f.v.s0)).toEqual([1000, 1001, 1002])
  })

  it('forma no graficable → sin "grafica" en el resultado y el marcador se quita', async () => {
    consultaResp = () => ({ status: 200, body: { filas: [{ a: 'x', b: 'y', v: 1 }, { a: 'z', b: 'w', v: 2 }], n: 2, truncado: false } })
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select ...')] } : { content: 'Así quedó.\n<!--grafica:consulta-1-->' }
    const { json } = await preguntar({ message: 'x' })
    const tool = (groqBodies[1].messages as { role: string; content: string }[]).find(m => m.role === 'tool')!
    expect(JSON.parse(tool.content).grafica).toBeUndefined()
    expect(json.response).toBe('Así quedó.')
  })

  it('pidieron gráfica y el modelo no marcó: se anexa la de la última consulta graficable', async () => {
    consultaResp = () => ({ status: 200, body: { filas: [{ concepto: 'Renta', monto: 500 }, { concepto: 'Luz', monto: 900 }], n: 2, truncado: false } })
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select concepto, sum(monto) as monto from gastos group by 1', 'Gastos por concepto')] } : { content: 'Luz es lo mayor.' }
    const { json } = await preguntar({ message: 'hazme una gráfica de gastos por concepto' })
    const gs = graficasDe(json.response)
    expect(gs.map(g => [g.id, g.tipo, g.filas.map(f => f.x)])).toEqual([['consulta', 'ranking', ['Luz', 'Renta']]])
  })

  it('voz: consulta sí, gráficas no (ni aunque el modelo marque); sin nombres de tablas', async () => {
    consultaResp = () => ({ status: 200, body: { filas: serie(14), n: 14, truncado: false } })
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select ...')] } : { content: 'Vas estable. <!--grafica:consulta-1-->' }
    const { json, system } = await preguntar({ message: 'hazme una grafica de ventas', modo: 'voz' })
    expect(json.response).toBe('Vas estable.')
    expect(system).toContain('NUNCA menciones nombres de tablas')
    const tool = (groqBodies[1].messages as { role: string; content: string }[]).find(m => m.role === 'tool')!
    expect(JSON.parse(tool.content).grafica).toBeUndefined()
  })
})

describe('errores de la base', () => {
  it('el modelo recibe el mensaje completo; 54000 (tope de costo) llega con la pista de cómo acotar', async () => {
    consultaResp = sql => sql.includes('pesada')
      ? { status: 400, body: { message: 'consulta demasiado pesada (costo 5e6)', code: '54000' } }
      : { status: 400, body: { message: 'column "zz" does not exist', code: '42703' } }
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select pesada from pos_orders'), tc('b', 'select zz from pos_orders')] } : { content: 'No pude consultarlo.' }
    await preguntar({ message: 'x' })
    const tools = (groqBodies[1].messages as { role: string; content: string }[]).filter(m => m.role === 'tool').map(m => JSON.parse(m.content).error)
    expect(tools[0]).toBe('la consulta es demasiado pesada: filtra por fechas, agrega con GROUP BY o usa LIMIT (consulta demasiado pesada (costo 5e6))')
    expect(tools[1]).toContain('does not exist') // mensaje completo para que corrija la columna
  })
})

describe('observabilidad', () => {
  it('registra conteos, ms y errores; nunca filas ni SQL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    consultaResp = sql => sql.includes('secreto')
      ? { status: 400, body: { message: 'invalid input syntax for type numeric: "VALOR-DE-FILA"', code: '22P02' } }
      : { status: 200, body: { filas: [{ nombre: 'FILA-PRIVADA', v: 1 }], n: 1, truncado: false } }
    guionGroq = (_b, i) => i === 0 ? { tool_calls: [tc('a', 'select nombre, 1 as v from gastos'), tc('b', 'select secreto from gastos')] } : { content: 'ok' }
    await preguntar({ message: 'x' })
    const linea = log.mock.calls.map(c => String(c[0])).find(l => l.startsWith('[chat] lectura universal'))!
    log.mockRestore()
    const j = JSON.parse(linea.replace('[chat] lectura universal ', ''))
    expect(j).toMatchObject({ auth: 'jwt_usuario', mapa: 3, consultas: 2, agotado: null, respaldo: false })
    expect(typeof j.ms_consultas).toBe('number')
    // Errores: sólo SQLSTATE + categoría fija; el texto de Postgres (que puede citar valores) no.
    expect(j.errores).toEqual(['consulta 2: 22P02 sintaxis'])
    expect(linea).not.toContain('VALOR-DE-FILA')
    expect(linea).not.toContain('FILA-PRIVADA')
    expect(linea).not.toContain('select')
  })
})
