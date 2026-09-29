// Runner de la eval IA con mocks (sin red): config, contexto, reloj fijado, bloqueo de
// escrituras, lectura de logs, corrida completa y el banco de preguntas.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bloquearEscrituras, configDesdeEnv, contextoEval, correrEval, escribirReportes, fijarAhora, jsonDeLog, preguntarEnProceso,
  render, resumir, esFallaTransitoria, type ConfigEval, type Preguntar, type RespuestaChat,
} from './correr'
import { PREGUNTAS, type PreguntaEval } from './preguntas'
import { reporteMarkdown } from './puntaje'
import type { ResultadoConsulta } from '@/lib/ia-lectura'

const ENV = { EVAL_IA_SUPABASE_URL: 'https://stg.supabase.co/', EVAL_IA_SUPABASE_SERVICE_KEY: 'SK', GROQ_API_KEY: 'g' }

describe('configDesdeEnv', () => {
  it('exige variables EXPLÍCITAS de la eval (no toma SUPABASE_URL sueltas)', () => {
    const r = configDesdeEnv({ SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_KEY: 'PROD' })
    expect(r).toEqual({ ok: false, faltan: ['EVAL_IA_SUPABASE_URL', 'EVAL_IA_SUPABASE_SERVICE_KEY', 'GROQ_API_KEY'] })
  })
  it('defaults: chickin-demo, 2026-08, reloj = 1º del mes siguiente 12:00 −06:00, umbral 0.9', () => {
    const r = configDesdeEnv(ENV, '/x')
    if (!r.ok) throw new Error('config')
    expect(r.cfg).toMatchObject({
      sbUrl: 'https://stg.supabase.co', serviceKey: 'SK', anonKey: 'SK', tenant: 'chickin-demo', tz: 'America/Monterrey', mes: '2026-08',
      ahora: '2026-09-01T12:00:00-06:00', umbral: 0.9, pausaMs: 3000, solo: null, dirSalida: '/x/resultados',
    })
  })
  it('EVAL_IA_AHORA=real, filtro, umbral y validaciones', () => {
    const r = configDesdeEnv({ ...ENV, EVAL_IA_AHORA: 'real', EVAL_IA_SOLO: 'trampa, s01', EVAL_IA_UMBRAL: '0.95', EVAL_IA_MES: '2026-12' })
    if (!r.ok) throw new Error('config')
    expect(r.cfg).toMatchObject({ ahora: null, solo: ['trampa', 's01'], umbral: 0.95, mes: '2026-12' })
    expect(configDesdeEnv({ ...ENV, EVAL_IA_MES: '2026-13' }).ok).toBe(false)
    expect(configDesdeEnv({ ...ENV, EVAL_IA_TZ: "x'; drop" }).ok).toBe(false)
    expect(configDesdeEnv({ ...ENV, EVAL_IA_AHORA: 'ayer' }).ok).toBe(false)
    const d = configDesdeEnv({ ...ENV, EVAL_IA_MES: '2026-12' })
    expect(d.ok && d.cfg.ahora).toBe('2027-01-01T12:00:00-06:00')
  })
})

describe('contextoEval', () => {
  it('fechas del mes, hoy/ayer en la zona del tenant y mes viejo', () => {
    const c = contextoEval({ mes: '2026-08', tz: 'America/Monterrey', ahora: '2026-09-01T12:00:00-06:00' })
    expect(c).toMatchObject({
      desde: '2026-08-01', hasta: '2026-08-31', mesNombre: 'agosto de 2026', mesSolo: 'agosto',
      hoy: '2026-09-01', ayer: '2026-08-31', anteayer: '2026-08-30',
      mesViejo: { desde: '2026-02-01', hasta: '2026-02-28', nombre: 'febrero de 2026' },
    })
    // 01:00 UTC del 1º = 19:00 del 31 en Monterrey
    expect(contextoEval({ mes: '2026-08', tz: 'America/Monterrey', ahora: '2026-09-01T01:00:00Z' }).hoy).toBe('2026-08-31')
  })
})

describe('fijarAhora', () => {
  it('fija Date.now y new Date() (el reloj sigue avanzando); fechas explícitas intactas; se restaura', () => {
    const Real = Date
    const restaurar = fijarAhora('2026-09-01T12:00:00-06:00')
    try {
      expect(Math.abs(Date.now() - Real.parse('2026-09-01T18:00:00Z'))).toBeLessThan(1000)
      expect(Math.abs(new Date().getTime() - Real.parse('2026-09-01T18:00:00Z'))).toBeLessThan(1000)
      expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z')
      expect(new Date('2026-08-15T12:00:00Z').getUTCDate()).toBe(15)
      expect(new Date() instanceof Real).toBe(true)
    } finally { restaurar() }
    expect(Date).toBe(Real)
    expect(Math.abs(Date.now() - Real.now())).toBeLessThan(1000)
  })
})

describe('bloquearEscrituras', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('POST a tablas → 201 falso sin red; RPC y GET pasan', async () => {
    const llamadas: string[] = []
    vi.stubGlobal('fetch', async (u: string) => { llamadas.push(u); return new Response('[]', { status: 200 }) })
    const restaurar = bloquearEscrituras()
    try {
      expect((await fetch('https://s.co/rest/v1/chat_logs', { method: 'POST', body: '{}' })).status).toBe(201)
      expect((await fetch('https://s.co/rest/v1/agent_runs', { method: 'post' })).status).toBe(201)
      expect((await fetch('https://s.co/rest/v1/pos_orders', { method: 'PATCH' })).status).toBe(201)
      expect((await fetch('https://s.co/rest/v1/rpc/ia_consulta', { method: 'POST' })).status).toBe(200)
      expect((await fetch('https://s.co/rest/v1/pos_orders?select=id')).status).toBe(200)
      expect((await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST' })).status).toBe(200)
    } finally { restaurar() }
    expect(llamadas).toEqual(['https://s.co/rest/v1/rpc/ia_consulta', 'https://s.co/rest/v1/pos_orders?select=id', 'https://api.groq.com/openai/v1/chat/completions'])
  })
})

describe('preguntarEnProceso', () => {
  it('manda el mensaje, lee la respuesta y los conteos de los logs [chat] (y deja pasar los demás logs)', async () => {
    const otros: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => { otros.push(a[0]) })
    let cuerpo: unknown = null
    const POST = async (req: never) => {
      cuerpo = await (req as { json: () => Promise<unknown> }).json()
      console.log('[chat] lectura universal {"consultas":2,"llamadas_modelo":3}')
      console.log('[chat] verificador {"afirmaciones":4,"sin_rastro":1,"reparado":true,"marcados":0}')
      console.log('otro log')
      return Response.json({ response: 'Vendiste $10' })
    }
    const r = await preguntarEnProceso(POST)('¿cuánto?')
    spy.mockRestore()
    expect(cuerpo).toEqual({ message: '¿cuánto?', history: [] })
    expect(r).toMatchObject({ respuesta: 'Vendiste $10', consultas: 2, llamadasModelo: 3, verificador: { afirmaciones: 4, sin_rastro: 1, reparado: true, marcados: 0 } })
    expect(otros).toEqual(['otro log'])
  })
  it('jsonDeLog: la última línea con la etiqueta; JSON roto = null', () => {
    expect(jsonDeLog(['[chat] x {"a":1}', '[chat] x {"a":2}'], 'x')).toEqual({ a: 2 })
    expect(jsonDeLog(['[chat] x {roto'], 'x')).toBeNull()
    expect(jsonDeLog([], 'x')).toBeNull()
  })
  it('fallas transitorias reconocidas', () => {
    expect(esFallaTransitoria('Demasiadas consultas. Espera un momento.')).toBe(true)
    expect(esFallaTransitoria('Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.')).toBe(true)
    expect(esFallaTransitoria('Vendiste $10')).toBe(false)
  })
})

// ── Corrida completa con red simulada ─────────────────────────────────────

const cfgBase = (): ConfigEval => {
  const r = configDesdeEnv({ ...ENV, EVAL_IA_PAUSA_MS: '5' }, '/tmp')
  if (!r.ok) throw new Error('config')
  return r.cfg
}
const ok = (filas: Record<string, unknown>[]): ResultadoConsulta => ({ ok: true, filas, n: filas.length, truncado: false, ms: 1 })
const err = (error: string): ResultadoConsulta => ({ ok: false, error, status: 400, ms: 1 })
const chat = (respuesta: string, extra: Partial<RespuestaChat> = {}): RespuestaChat =>
  ({ respuesta, ms: 1200, consultas: 1, llamadasModelo: 2, verificador: { afirmaciones: 1, sin_rastro: 0, reparado: false, marcados: 0 }, ...extra })

describe('correrEval', () => {
  it('parámetros escapados en SQL y en claro en la pregunta; verdad; puntaje; pausas', async () => {
    const pregs: PreguntaEval[] = [{
      id: 'x1', categoria: 'cruce',
      parametrosSql: 'select mesero from t',
      pregunta: c => `¿Cuánto vendió ${c.pt.mesero}?`,
      verdadSql: c => `select sum(total) as ventas from pos_orders where mesero = '${c.p.mesero}'`,
      numeros: [{ col: 'ventas' }],
    }, {
      id: 'x2', categoria: 'simple', pregunta: 'q2', verdadSql: 'select 1 as v', numeros: [{ col: 'v' }],
    }]
    const sqls: string[] = []
    const preguntas: string[] = []
    const pausas: number[] = []
    const rs = await correrEval({
      cfg: cfgBase(), preguntas: pregs,
      consultar: async sql => { sqls.push(sql); return sql.startsWith('select mesero') ? ok([{ mesero: "Ana O'Brien" }]) : sql.includes('sum') ? ok([{ ventas: '1500.5' }]) : ok([{ v: 7 }]) },
      preguntar: async q => { preguntas.push(q); return chat(q.includes('Ana') ? "Ana O'Brien vendió $1,501." : 'Fueron 8.') },
      dormir: async ms => { pausas.push(ms) },
    })
    expect(sqls[1]).toBe("select sum(total) as ventas from pos_orders where mesero = 'Ana O''Brien'")
    expect(preguntas[0]).toBe("¿Cuánto vendió Ana O'Brien?")
    expect(rs.map(r => r.estado)).toEqual(['aprobada', 'fallida'])
    expect(rs[0]).toMatchObject({ latenciaMs: 1200, consultas: 1, chequeos: [{ tipo: 'numero', campo: 'ventas', ok: true, esperado: 1500.5, obtenido: 1501 }] })
    expect(rs[1].chequeos).toEqual([{ tipo: 'numero', campo: 'v', ok: false, esperado: 7, obtenido: 8 }])
    expect(pausas).toEqual([5])
  })

  it('omite (no cuenta) cuando: parámetros vacíos, verdad con error o sin filas, trampa con datos', async () => {
    const pregs: PreguntaEval[] = [
      { id: 'p-vacio', categoria: 'cruce', parametrosSql: 'P0', pregunta: 'q', verdadSql: 'V', numeros: [{ col: 'v' }] },
      { id: 'p-nulo', categoria: 'cruce', parametrosSql: 'PNULL', pregunta: 'q', verdadSql: 'V', numeros: [{ col: 'v' }] },
      { id: 'v-error', categoria: 'simple', pregunta: 'q', verdadSql: 'VERR', numeros: [{ col: 'v' }] },
      { id: 'v-vacia', categoria: 'simple', pregunta: 'q', verdadSql: 'V0', numeros: [{ col: 'v' }] },
      { id: 't-con-datos', categoria: 'trampa', pregunta: 'q', trampa: { validezSql: ['N5'] } },
    ]
    let preguntadas = 0
    const rs = await correrEval({
      cfg: cfgBase(), preguntas: pregs, dormir: async () => {},
      consultar: async sql => ({ P0: ok([]), PNULL: ok([{ mesero: null }]), VERR: { ...err('función no permitida: round'), codigo: 'P0001', categoria: 'sintaxis' }, V0: ok([]), N5: ok([{ n: 5 }]) } as Record<string, ResultadoConsulta>)[sql] ?? ok([]),
      preguntar: async () => { preguntadas++; return chat('x') },
    })
    expect(rs.map(r => r.estado)).toEqual(['omitida', 'omitida', 'omitida', 'omitida', 'omitida'])
    // Sólo la CLASE del error, nunca el texto de la base.
    expect(rs[2]).toMatchObject({ motivo: 'la verdad falló', errorClase: 'sintaxis' })
    expect(JSON.stringify(rs)).not.toContain('round')
    expect(rs[4].motivo).toMatch(/trampa no válida/)
    expect(preguntadas).toBe(0)
    expect(resumir(rs).evaluadas).toBe(0)
  })

  it('trampa: validez con error (tabla inexistente) = sin datos → se evalúa; prohibidos aplican', async () => {
    const pregs: PreguntaEval[] = [
      { id: 't1', categoria: 'trampa', pregunta: 'q', trampa: { validezSql: ['select count(*) as n from reviews'] } },
      { id: 't2', categoria: 'trampa', pregunta: 'q', trampa: { validezSql: ['N0'], prohibido: ['@'] } },
    ]
    const rs = await correrEval({
      cfg: cfgBase(), preguntas: pregs, dormir: async () => {},
      consultar: async sql => (sql === 'N0' ? ok([{ n: 0 }]) : err('relation "reviews" does not exist')),
      preguntar: async () => chat('No tengo ese dato; escribe a ana@x.com'),
    })
    expect(rs[0].estado).toBe('aprobada')
    expect(JSON.stringify(rs[0])).not.toContain('does not exist')
    expect(rs[1].estado).toBe('fallida')
  })

  it('falla de infraestructura: reintenta una vez tras 20 s; si sigue, se omite (no es culpa del modelo)', async () => {
    const pregs: PreguntaEval[] = [{ id: 's', categoria: 'simple', pregunta: 'q', verdadSql: 'V', numeros: [{ col: 'v' }] }]
    const pausas: number[] = []
    let n = 0
    const preguntar: Preguntar = async () => { n++; return chat(n === 1 ? 'Demasiadas consultas. Espera un momento.' : 'Son 7.') }
    const rs = await correrEval({ cfg: cfgBase(), preguntas: pregs, consultar: async () => ok([{ v: 7 }]), preguntar, dormir: async ms => { pausas.push(ms) } })
    expect(pausas).toEqual([20_000])
    expect(rs[0].estado).toBe('aprobada')

    const siempre = await correrEval({ cfg: cfgBase(), preguntas: pregs, consultar: async () => ok([{ v: 7 }]), preguntar: async () => chat('Lo siento, hubo un error al procesar tu mensaje.'), dormir: async () => {} })
    expect(siempre[0].estado).toBe('omitida')
    expect(resumir(siempre).fallasInfra).toEqual(['s'])
    // Una trampa sin respuesta del chat tampoco es "dato inventado": se omite.
    const trampa = await correrEval({ cfg: cfgBase(), preguntas: [{ id: 't', categoria: 'trampa', pregunta: 'q', trampa: {} }], consultar: async () => ok([]), preguntar: async () => chat('Lo siento, hubo un error al procesar tu mensaje.'), dormir: async () => {} })
    expect(trampa[0].estado).toBe('omitida')
    expect(resumir(trampa).trampasFallidas).toEqual([])
  })

  it('lo guardado NO trae datos del restaurante (pregunta, respuesta, filas, SQL, nombres); el detalle sólo va al callback', async () => {
    const pregs: PreguntaEval[] = [{
      id: 'x', categoria: 'cruce', parametrosSql: 'P', pregunta: c => `¿Cuánto vendió ${c.pt.mesero}?`,
      verdadSql: c => `select mesero, sum(total) as ventas from pos_orders where mesero = '${c.p.mesero}'`,
      entidades: [{ col: 'mesero' }], numeros: [{ col: 'ventas' }],
    }]
    const detalles: unknown[] = []
    const rs = await correrEval({
      cfg: cfgBase(), preguntas: pregs, dormir: async () => {},
      consultar: async sql => (sql === 'P' ? ok([{ mesero: 'MESERO-PRIVADO' }]) : ok([{ mesero: 'MESERO-PRIVADO', ventas: 4321.5 }])),
      preguntar: async () => chat('MESERO-PRIVADO vendió $4,321.50 con el cliente CLIENTE-PRIVADO'),
      detalle: d => detalles.push(d),
    })
    const guardado = JSON.stringify(rs)
    for (const dato of ['MESERO-PRIVADO', 'CLIENTE-PRIVADO', 'select', '¿Cuánto']) expect(guardado).not.toContain(dato)
    expect(rs[0].chequeos).toEqual([
      { tipo: 'numero', campo: 'ventas', ok: true, esperado: 4321.5, obtenido: 4321.5 },
      { tipo: 'entidad', campo: 'mesero', ok: true },
    ])
    const md = reporteMarkdown(rs, resumir(rs), { tenant: 't', mes: '2026-08', ahora: 'x', umbral: 0.9, modelo: 'm' })
    expect(md).not.toContain('PRIVADO')
    expect(JSON.stringify(detalles)).toContain('MESERO-PRIVADO') // sólo para depurar en local
  })

  it('filtro EVAL_IA_SOLO por prefijo de id o categoría', async () => {
    const cfg = { ...cfgBase(), solo: ['trampa', 's01'] }
    const vistos: string[] = []
    await correrEval({ cfg, preguntas: PREGUNTAS, consultar: async () => ok([{ n: 0, ventas: 1 }]), preguntar: async q => { vistos.push(q); return chat('No tengo ese dato.') }, dormir: async () => {} })
    expect(vistos).toHaveLength(PREGUNTAS.filter(p => p.categoria === 'trampa' || p.id.startsWith('s01')).length)
  })

  it('escribe JSON y markdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-ia-'))
    const cfg = { ...cfgBase(), dirSalida: dir }
    const rs = [{
      id: 's01', categoria: 'simple' as const, estado: 'aprobada' as const, errorClase: null, chequeos: [],
      latenciaMs: 10, consultas: 0, llamadasModelo: 1, verificador: null,
    }]
    const rutas = escribirReportes(cfg, rs, resumir(rs), '2026-09-28T20:00:00.000Z')
    expect(rutas.json).toBe(join(dir, '2026-09-28T20-00-00-000Z.json'))
    const j = JSON.parse(readFileSync(rutas.json, 'utf8'))
    expect(j.meta).toMatchObject({ tenant: 'chickin-demo', mes: '2026-08', umbral: 0.9 })
    expect(j.resumen.exactitud).toBe(1)
    expect(readFileSync(rutas.md, 'utf8')).toMatch(/^# Eval IA del dueño — PASA/)
  })
})

describe('banco de preguntas', () => {
  const ctx = contextoEval({ mes: '2026-08', tz: 'America/Monterrey', ahora: '2026-09-01T12:00:00-06:00' },
    { mesero: "Ana O''Brien", categoria: 'BEBIDAS', bebida: 'Limonada', platillo: 'Taco', metodo: 'Efectivo' },
    { mesero: "Ana O'Brien", categoria: 'BEBIDAS', bebida: 'Limonada', platillo: 'Taco', metodo: 'Efectivo' })

  it('≥ 50 preguntas, ids únicos, mezcla pedida (≥15 simples, ≥20 cruces, ≥10 trampas, ≥5 fechas)', () => {
    expect(PREGUNTAS.length).toBeGreaterThanOrEqual(50)
    expect(new Set(PREGUNTAS.map(p => p.id)).size).toBe(PREGUNTAS.length)
    const n = (c: string) => PREGUNTAS.filter(p => p.categoria === c).length
    expect(n('simple')).toBeGreaterThanOrEqual(15)
    expect(n('cruce')).toBeGreaterThanOrEqual(20)
    expect(n('trampa')).toBeGreaterThanOrEqual(10)
    expect(n('fechas')).toBeGreaterThanOrEqual(5)
  })

  it('cada pregunta no-trampa tiene verdad y algo que revisar; cada trampa no tiene verdad', () => {
    for (const p of PREGUNTAS) {
      if (p.categoria === 'trampa') { expect(p.trampa, p.id).toBeDefined(); expect(p.verdadSql, p.id).toBeUndefined() } else {
        expect(p.verdadSql, p.id).toBeDefined()
        expect((p.numeros?.length ?? 0) + (p.entidades?.length ?? 0), p.id).toBeGreaterThan(0)
      }
    }
  })

  it('todo el SQL cumple las reglas de ia_consulta (una sentencia SELECT/WITH, sin ; comentarios $ ni comillas dobles, sin esquema)', () => {
    const sqls = PREGUNTAS.flatMap(p => [p.parametrosSql, p.verdadSql, ...(p.trampa?.validezSql || [])].filter(Boolean).map(t => [p.id, render(t, ctx)] as const))
    expect(sqls.length).toBeGreaterThan(50)
    for (const [id, s] of sqls) {
      expect(s, id).toMatch(/^\s*(select|with)\b/i)
      expect(s, id).not.toMatch(/;|--|\/\*|\$|"/)
      expect(s, id).not.toMatch(/\b(public|pg_catalog|information_schema)\.|\bpg_\w+|set_config|\brecursive\b/i)
      expect(s, id).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i)
      expect(s, id).not.toMatch(/\b(round|coalesce|nullif)\s*\(/i)
      expect(s.includes('{') || s.includes('undefined'), id).toBe(false)
    }
  })

  it('las preguntas se leen bien (sin placeholders) y mencionan el periodo cuando aplica', () => {
    for (const p of PREGUNTAS) {
      const q = render(p.pregunta, ctx)
      expect(q, p.id).not.toMatch(/undefined|\{|\}/)
      expect(q.length, p.id).toBeGreaterThan(10)
    }
    expect(render(PREGUNTAS.find(p => p.id === 'c05-pct-categoria-mesero')!.pregunta, ctx)).toContain("Ana O'Brien")
  })
})
