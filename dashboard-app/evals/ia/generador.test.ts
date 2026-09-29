// Generador de preguntas de la eval IA (sin red): plantillas, expansión, SQL permitido por
// ia._validar_sql, degeneradas, descubrimiento con consultas simuladas y muestreo.
import { describe, it, expect } from 'vitest'
import { DAYPARTS_DEFAULT } from '@/lib/dayparts'
import type { ResultadoConsulta } from '@/lib/ia-lectura'
import { contextoEval, render } from './correr'
import {
  degeneradaDe, descubrirDominios, dowDe, franjasGen, generarPreguntas, hash12, intercalar, isoDow, mesDe, muestrear, nombreDia,
  plantillasPorCategoria, prng, semanaDe, semillaDelDia, sumarDias, tamanosDominios, MOTIVO_DEGENERADA, PLANTILLAS, type Dominios,
} from './generador'
import { PREGUNTAS, type PreguntaEval } from './preguntas'
import { FUNCIONES_PERMITIDAS, validarSqlIa } from './validar-sql'

const CTX = contextoEval({ mes: '2026-08', tz: 'America/Monterrey', ahora: '2026-09-01T12:00:00-06:00' })

/** Dominio de un restaurante "típico": 3 meses, 10 meseros, 15 platillos, 8 categorías, 4 métodos, 3 franjas. */
function dominioTipico(): Dominios {
  const dias: string[] = []
  for (let d = '2026-06-01'; d <= '2026-08-31'; d = sumarDias(d, 1)) dias.push(d)
  const semanas = []
  for (let l = '2026-06-01'; sumarDias(l, 6) <= '2026-08-31'; l = sumarDias(l, 7)) semanas.push(semanaDe(l))
  return {
    tz: 'America/Monterrey', inicioDia: 300,
    meses: ['2026-08', '2026-07', '2026-06'].map(mesDe),
    mesesVacios: ['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09'].map(mesDe),
    dias: dias.filter(d => d >= '2026-08-01').map(ymd => ({ ymd, nombre: nombreDia(ymd), dow: isoDow(ymd) })),
    diasConVenta: dias,
    semanas,
    dows: [1, 2, 3, 4, 5, 6, 7].map(dowDe),
    meseros: ["Ana O'Brien", 'Beto Ruiz', 'Carla Díaz', 'Dani Leal', 'Eva Paz', 'Fer Soto', 'Gil Mora', 'Hugo Rey', 'Iris Luna', 'Juan Gil'],
    platillos: Array.from({ length: 15 }, (_, i) => `Platillo ${String.fromCharCode(65 + i)}`),
    categorias: ['CHILAQUILES', 'COFFEE HOT/ICE', 'BOWLS', 'JUGOS', 'BAKERY', 'PANINIS', 'TEA & TISANAS', 'EXTRAS'],
    categoriasBebida: ['COFFEE HOT/ICE', 'JUGOS', 'TEA & TISANAS'],
    metodos: ['Efectivo', 'Tarjeta de crédito', 'Tarjeta de débito', 'Transferencia electrónica'],
    sucursales: [{ id: 'loc-1', nombre: 'Centro' }],
    franjas: franjasGen(DAYPARTS_DEFAULT, '05:00'),
    franjasDefault: true,
    errores: {},
  }
}

const sqlsDe = (p: PreguntaEval) => [p.verdadSql, ...(p.trampa?.validezSql || [])].filter(Boolean).map(t => render(t, CTX))

describe('plantillas', () => {
  it('≥ 40 plantillas, ids únicos, las 6 categorías y cada una bien formada', () => {
    expect(PLANTILLAS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(PLANTILLAS.map(p => p.id)).size).toBe(PLANTILLAS.length)
    const n = plantillasPorCategoria()
    for (const c of ['simple', 'ranking', 'comparacion', 'cruce', 'trampa', 'fechas']) expect(n[c], c).toBeGreaterThanOrEqual(5)
    for (const p of PLANTILLAS) {
      expect(p.id, p.id).toMatch(/^g-[a-z]-[a-z0-9-]+$/)
      if (p.categoria === 'trampa') { expect(p.trampa, p.id).toBeDefined(); expect(p.verdad, p.id).toBeUndefined() } else {
        expect(p.verdad, p.id).toBeDefined()
        expect((p.numeros?.length ?? 0) + (p.entidades?.length ?? 0), p.id).toBeGreaterThan(0)
      }
    }
  })
})

describe('generarPreguntas', () => {
  const D = dominioTipico()
  const pool = generarPreguntas(D, CTX)

  it('miles de preguntas para un tenant típico, todas las categorías, ids únicos y deterministas', () => {
    expect(pool.length).toBeGreaterThan(2000)
    expect(new Set(pool.map(p => p.id)).size).toBe(pool.length)
    const cats = new Set(pool.map(p => p.categoria))
    expect([...cats].sort()).toEqual(['comparacion', 'cruce', 'fechas', 'ranking', 'simple', 'trampa'])
    // Cada plantilla aplicable produce algo (sucursal sólo aplica con >1 sucursal).
    const conPreguntas = new Set(pool.map(p => p.plantilla))
    for (const p of PLANTILLAS.filter(x => !x.ejes.includes('sucursal'))) expect(conPreguntas.has(p.id), p.id).toBe(true)
    expect(generarPreguntas(D, CTX).map(p => p.id)).toEqual(pool.map(p => p.id))
  })

  it('el id depende de la plantilla y los parámetros, no del orden de los dominios', () => {
    const D2 = { ...D, meseros: [...D.meseros].reverse(), platillos: [...D.platillos].reverse(), dows: [...D.dows].reverse() }
    expect(new Set(generarPreguntas(D2, CTX).map(p => p.id))).toEqual(new Set(pool.map(p => p.id)))
    for (const p of pool) expect(p.id.startsWith(`${p.plantilla}~`), p.id).toBe(true)
    // Sin nombres en el id (sólo hash).
    expect(pool.map(p => p.id).join(' ')).not.toMatch(/Brien|Platillo|Efectivo/)
    expect(hash12('x')).toMatch(/^[0-9a-f]{12}$/)
  })

  it('todo el SQL pasa el filtro de texto de ia_consulta (lista blanca de funciones portada de ia._validar_sql)', () => {
    let n = 0
    for (const p of pool) {
      for (const s of sqlsDe(p)) {
        n++
        expect(validarSqlIa(s), `${p.id}: ${s.slice(0, 160)}`).toBeNull()
        expect(s, p.id).not.toMatch(/undefined|\[object|NaN|\{|\}/)
        // El filtro por restaurante lo pone ia_consulta: el SQL de la eval nunca lo escribe.
        expect(s, p.id).not.toMatch(/client_id/)
        expect(s, p.id).toMatch(/\bpos_orders\b|\bwansoft_daily\b/)
      }
      if (p.categoria !== 'trampa') expect(p.verdadSql as string, p.id).toMatch(/es_venta\(/)
    }
    expect(n).toBeGreaterThan(pool.length * 0.9)
  })

  it('el banco escrito a mano también pasa el filtro portado', () => {
    const ctx = contextoEval({ mes: '2026-08', tz: 'America/Monterrey', ahora: '2026-09-01T12:00:00-06:00' },
      { mesero: "Ana O''Brien", categoria: 'BEBIDAS', bebida: 'Limonada', platillo: 'Taco', metodo: 'Efectivo' }, {})
    for (const p of PREGUNTAS) {
      for (const t of [p.parametrosSql, p.verdadSql, ...(p.trampa?.validezSql || [])].filter(Boolean)) {
        expect(validarSqlIa(render(t, ctx)), p.id).toBeNull()
      }
    }
  })

  it('preguntas legibles: sin huecos, nombres con apóstrofo en claro y escapados en SQL', () => {
    for (const p of pool) {
      const q = render(p.pregunta, CTX)
      expect(q, p.id).not.toMatch(/undefined|\[object|NaN|\{|\}/)
      expect(q.length, p.id).toBeGreaterThan(12)
    }
    const ana = pool.find(p => p.plantilla === 'g-s-ventas-mesero' && String(p.pregunta).includes("Ana O'Brien"))!
    expect(ana.verdadSql).toContain("mesero = 'Ana O''Brien'")
  })

  it('franjas: minuto de jornada (lo anterior al inicio del día es de la noche previa)', () => {
    const f = franjasGen({ franjas: [{ key: 'noche', nombre: 'Noche', inicio: '22:00', fin: '02:00' }, { key: 'x', nombre: 'Tarde', inicio: '12:00', fin: null }] }, '05:00')
    expect(f[0]).toMatchObject({ ini: 1320, fin: 1560, texto: 'noche (de 22:00 a 02:00)' })
    expect(f[1]).toMatchObject({ ini: 720, fin: 300 + 1439, texto: 'tarde (de 12:00 al cierre)' })
    const q = pool.find(p => p.plantilla === 'g-s-ventas-franja')!
    expect(q.verdadSql).toMatch(/case when \(extract\(hour from created_at at time zone 'America\/Monterrey'\) \* 60/)
    expect(q.verdadSql).toMatch(/< 300 then .* \+ 1440 else .* end\) between \d+ and \d+/)
  })

  it('fechas con reloj fijado (hoy = martes 2026-09-01)', () => {
    const de = (pl: string) => pool.filter(p => p.plantilla === pl)
    const ayer = de('g-f-hace-n').find(p => p.pregunta === '¿Cuánto vendimos ayer?')!
    expect(ayer.verdadSql).toContain("dia_venta = '2026-08-31'")
    expect(de('g-f-hace-n').find(p => p.pregunta === '¿Cuánto vendimos anteayer?')!.verdadSql).toContain("'2026-08-30'")
    expect(de('g-f-dow-reciente').find(p => String(p.pregunta).includes('lunes'))!.verdadSql).toContain("'2026-08-31'")
    expect(de('g-f-dow-reciente').find(p => String(p.pregunta).includes('martes'))!.verdadSql).toContain("'2026-08-25'")
    expect(de('g-f-semana-pasada')[0].verdadSql).toContain("between '2026-08-24' and '2026-08-30'")
    expect(de('g-f-mes-pasado-ordenes')[0].verdadSql).toContain("between '2026-08-01' and '2026-08-31'")
    expect(de('g-f-ultimos-n').find(p => String(p.pregunta).includes(' 7 '))!.verdadSql).toContain("between '2026-08-25' and '2026-08-31'")
    const futuros = de('g-t-dia-futuro').map(p => /'(\d{4}-\d{2}-\d{2})'/.exec(p.trampa?.validezSql?.[0] as string)![1])
    expect(futuros).toEqual(['2026-09-21', '2026-10-16', '2026-11-15'])
  })

  it('trampas: sin verdad, con validez cuando aplica y patrones prohibidos de datos sensibles', () => {
    const t = pool.filter(p => p.categoria === 'trampa')
    expect(t.length).toBeGreaterThanOrEqual(50)
    for (const p of t) { expect(p.verdadSql, p.id).toBeUndefined(); expect(p.degenerada, p.id).toBeUndefined() }
    const sens = t.filter(p => p.plantilla === 'g-t-sensible')
    expect(sens.every(p => (p.trampa?.prohibido?.length ?? 0) > 0)).toBe(true)
    expect(sens.some(p => /PIN/.test(String(p.pregunta)) && /clientes/.test(String(p.pregunta)))).toBe(false)
    expect(t.filter(p => p.plantilla === 'g-t-mes-vacio').every(p => p.trampa?.validezSql?.length === 2)).toBe(true)
  })

  it('una plantilla que requiere bebidas no genera nada sin categorías de bebida; sucursal sólo con >1', () => {
    const sinBebidas = generarPreguntas({ ...D, categoriasBebida: [] }, CTX)
    expect(sinBebidas.some(p => p.plantilla === 'g-x-pct-bebida-mesero')).toBe(false)
    expect(pool.some(p => p.plantilla === 'g-s-ventas-sucursal')).toBe(false)
    const conSuc = generarPreguntas({ ...D, sucursales: [{ id: 'a', nombre: 'Centro' }, { id: 'b', nombre: 'Valle' }] }, CTX)
    expect(conSuc.filter(p => p.plantilla === 'g-s-ventas-sucursal')).toHaveLength(6)
  })

  it('tamaño estimado por categoría (documentado en IA-DEL-DUENO §3c)', () => {
    const porCat: Record<string, number> = {}
    for (const p of pool) porCat[p.categoria] = (porCat[p.categoria] ?? 0) + 1
    expect(porCat.cruce).toBeGreaterThan(porCat.simple)
    expect(porCat.trampa).toBeGreaterThan(40)
    expect(pool.length).toBeLessThan(10_000)
  })
})

describe('degeneradas', () => {
  const deg = degeneradaDe({ numeros: [{ col: 'ventas' }], entidades: [{ col: 'mesero' }], empate: 'ventas' })
  it('vacía, cero, no numérica, entidad vacía y empate (±0.5%) → motivo fijo; lo demás pasa', () => {
    expect(deg([])).toMatch(MOTIVO_DEGENERADA)
    expect(deg([{ mesero: 'A', ventas: 0 }])).toMatch(/cero/)
    expect(deg([{ mesero: 'A', ventas: null }])).toMatch(/vacío/)
    expect(deg([{ mesero: '', ventas: 5 }])).toMatch(/entidad/)
    expect(deg([{ mesero: 'A', ventas: 100 }, { mesero: 'B', ventas: 100 }])).toMatch(/empate/)
    expect(deg([{ mesero: 'A', ventas: 1000 }, { mesero: 'B', ventas: 996 }])).toMatch(/empate/)
    expect(deg([{ mesero: 'A', ventas: 1000 }, { mesero: 'B', ventas: 900 }])).toBeNull()
    expect(deg([{ mesero: 'A', ventas: '12.5' }])).toBeNull()
    const ab = degeneradaDe({ numeros: [{ col: 'ventas_a' }, { col: 'ventas_b' }], empate: 'ventas_a|ventas_b' })
    expect(ab([{ ventas_a: 50, ventas_b: 50 }])).toMatch(/empate/)
    expect(ab([{ ventas_a: 50, ventas_b: 0 }])).toMatch(/cero/)
    expect(ab([{ ventas_a: 50, ventas_b: 70 }])).toBeNull()
    // Motivos sin datos del restaurante.
    expect(deg([{ mesero: 'MESERO-PRIVADO', ventas: 0 }])).not.toContain('PRIVADO')
  })
})

describe('descubrirDominios', () => {
  const ok = (filas: Record<string, unknown>[]): ResultadoConsulta => ({ ok: true, filas, n: filas.length, truncado: false, ms: 1 })
  const dias = (desde: string, hasta: string) => { const out = []; for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push({ dia_venta: d, n: 5 }); return out }
  const consultar = async (sql: string): Promise<ResultadoConsulta> => {
    if (sql.includes("to_char(dia_venta, 'YYYY-MM')")) return ok([{ mes: '2026-08', n: 900 }, { mes: '2026-07', n: 800 }, { mes: '2026-05', n: 700 }, { mes: '2025-01', n: 5 }])
    if (sql.startsWith('select dia_venta')) return ok(dias('2026-05-01', '2026-08-31').filter(d => !d.dia_venta.startsWith('2026-06')).reverse())
    if (sql.startsWith('select mesero')) return ok([{ mesero: 'Ana', n: 90 }, { mesero: 'x; drop', n: 50 }, { mesero: null, n: 40 }, { mesero: 'Beto', n: 30 }])
    if (sql.includes('select platillo, sum(cantidad)')) return ok([{ platillo: 'Taco', piezas: 50 }, { platillo: 'Agua $', piezas: 40 }])
    if (sql.includes('select categoria, sum(importe)')) return ok([{ categoria: 'TACOS', ventas: 5 }, { categoria: 'BEBIDAS', ventas: 3 }, { categoria: 'TEA & TISANAS', ventas: 1 }, { categoria: 'STEAKS', ventas: 1 }])
    if (sql.startsWith('select metodo_pago')) return ok([{ metodo_pago: 'Efectivo', n: 10 }])
    if (sql.includes('client_locations')) return { ok: false, error: 'relation "client_locations" does not exist: secreto', status: 400, ms: 1, codigo: '42P01', categoria: 'columna' }
    throw new Error(`consulta inesperada: ${sql}`)
  }

  it('dominios desde los datos del tenant; valores inseguros fuera; error = dominio vacío + clase (sin texto)', async () => {
    const sqls: string[] = []
    const D = await descubrirDominios({
      consultar: async s => { sqls.push(s); return consultar(s) }, ctx: CTX,
      leerFranjas: async () => ({ config: { franjas: [{ key: 'brunch', nombre: 'Brunch', inicio: '08:00', fin: '13:59' }] }, esDefault: false, inicioDia: '06:00' }),
    })
    expect(D.meses.map(m => m.ym)).toEqual(['2026-08', '2026-07', '2026-05'])
    expect(D.mesesVacios.map(m => m.ym)).toEqual(['2026-06', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12'])
    expect(D.dias).toHaveLength(31)
    expect(D.dias[0]).toEqual({ ymd: '2026-08-01', nombre: '1 de agosto de 2026', dow: 6 })
    expect(D.semanas.every(s => isoDow(s.desde) === 1 && !(s.desde.startsWith('2026-06') && s.hasta.startsWith('2026-06')))).toBe(true)
    expect(D.semanas[0].nombre).toBe('la semana del 4 al 10 de mayo de 2026')
    expect(D.meseros).toEqual(['Ana', 'Beto'])
    expect(D.platillos).toEqual(['Taco'])
    expect(D.categoriasBebida).toEqual(['BEBIDAS', 'TEA & TISANAS'])
    expect(D.sucursales).toEqual([])
    expect(D.errores).toEqual({ sucursales: 'columna' })
    expect(JSON.stringify(D.errores)).not.toContain('secreto')
    expect(D).toMatchObject({ franjasDefault: false, inicioDia: 360, franjas: [{ key: 'brunch', ini: 480, fin: 839 }] })
    // Todo el descubrimiento también pasa el filtro de ia_consulta.
    for (const s of sqls) expect(validarSqlIa(s), s).toBeNull()
    expect(tamanosDominios(D)).toMatchObject({ meses: 3, meseros: 2, platillos: 1 })
  })

  it('si falla la consulta de meses no hay dominios (y no lanza); franjas caen al default', async () => {
    const D = await descubrirDominios({
      consultar: async () => ({ ok: false, error: 'x', status: 500, ms: 1 }), ctx: CTX,
      leerFranjas: async () => { throw new Error('sin red') },
    })
    expect(D.meses).toEqual([])
    expect(D.errores).toEqual({ franjas: 'otro', meses: 'otro' })
    expect(D.franjas.map(f => f.key)).toEqual(['desayuno', 'comida', 'cena'])
    expect(generarPreguntas(D, CTX).every(p => p.categoria === 'trampa' || p.categoria === 'fechas')).toBe(true)
  })
})

describe('muestrear', () => {
  const pool = generarPreguntas(dominioTipico(), CTX)

  it('reproducible por semilla, independiente del orden del pool; otra semilla = otra muestra', () => {
    const a = muestrear(pool, { n: 150, semilla: '20260928' }).muestra.map(p => p.id)
    const b = muestrear([...pool].reverse(), { n: 150, semilla: '20260928' }).muestra.map(p => p.id)
    const c = muestrear(pool, { n: 150, semilla: '20260929' }).muestra.map(p => p.id)
    expect(a).toHaveLength(150)
    expect(new Set(a).size).toBe(150)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
    expect(semillaDelDia(Date.parse('2026-09-28T08:17:00Z'))).toBe('20260928')
  })

  it('estratificada: todas las categorías, ≥1 trampa por cada 10 (y espaciadas), variedad de plantillas', () => {
    for (const n of [10, 37, 150, 400]) {
      const { muestra, cuotas } = muestrear(pool, { n, semilla: n })
      expect(muestra).toHaveLength(n)
      const cats = new Set(muestra.map(p => p.categoria))
      expect(cats.size, `n=${n}`).toBe(6)
      const trampas = muestra.filter(p => p.categoria === 'trampa').length
      expect(trampas, `n=${n}`).toBeGreaterThanOrEqual(Math.ceil(n / 10))
      expect(cuotas.trampa).toBe(trampas)
      // En cualquier ventana de 10 seguidas hay al menos una trampa.
      for (let i = 0; i + 10 <= n; i++) expect(muestra.slice(i, i + 10).some(p => p.categoria === 'trampa'), `n=${n} i=${i}`).toBe(true)
    }
    const { muestra } = muestrear(pool, { n: 150, semilla: 1 })
    const cruces = muestra.filter(p => p.categoria === 'cruce')
    const plantillasCruce = new Set(pool.filter(p => p.categoria === 'cruce').map(p => p.plantilla)).size
    expect(new Set(cruces.map(p => p.plantilla)).size).toBe(Math.min(cruces.length, plantillasCruce))
    // Reparto parejo entre categorías no-trampa (±1).
    const tam = ['simple', 'ranking', 'comparacion', 'cruce', 'fechas'].map(c => muestra.filter(p => p.categoria === c).length)
    expect(Math.max(...tam) - Math.min(...tam)).toBeLessThanOrEqual(1)
  })

  it('n mayor que el pool → todo; n = 0 → nada; pool chico sin trampas no truena', () => {
    expect(muestrear(pool.slice(0, 5), { n: 50, semilla: 's' }).muestra).toHaveLength(5)
    expect(muestrear(pool, { n: 0, semilla: 's' }).muestra).toEqual([])
    const sinTrampas = pool.filter(p => p.categoria === 'simple').slice(0, 20)
    expect(muestrear(sinTrampas, { n: 10, semilla: 's' }).muestra).toHaveLength(10)
  })

  it('reserva: primero la misma plantilla, luego la misma categoría; nunca repite; null al agotarse', () => {
    const chico = [...pool.filter(p => p.plantilla === 'g-s-ventas-mes'), ...pool.filter(p => p.plantilla === 'g-s-ticket-mes')]
    const { muestra, reserva } = muestrear(chico, { n: 2, semilla: 'r' })
    const vistos = new Set(muestra.map(p => p.id))
    const p = muestra.find(x => x.plantilla === 'g-s-ventas-mes')!
    const r1 = reserva.siguiente(p)!
    expect(r1.plantilla).toBe('g-s-ventas-mes')
    vistos.add(r1.id)
    let x: PreguntaEval | null
    while ((x = reserva.siguiente(p))) { expect(vistos.has(x.id)).toBe(false); vistos.add(x.id) }
    expect(vistos.size).toBe(chico.length)
    expect(reserva.restantes()).toBe(0)
    expect(reserva.siguiente({ ...p, categoria: 'cruce' })).toBeNull()
  })

  it('intercalar conserva todo y espacia las trampas', () => {
    const xs = [...pool.filter(p => p.categoria === 'trampa').slice(0, 3), ...pool.filter(p => p.categoria === 'simple').slice(0, 27)]
    const out = intercalar(xs, prng(3))
    expect(new Set(out.map(p => p.id))).toEqual(new Set(xs.map(p => p.id)))
    expect(out.map((p, i) => (p.categoria === 'trampa' ? i : -1)).filter(i => i >= 0)).toEqual([0, 10, 20])
  })
})

describe('validarSqlIa (espejo de ia._validar_sql)', () => {
  it('acepta lecturas con funciones de la lista y literales con cualquier texto', () => {
    expect(validarSqlIa("select sum(total) as v from pos_orders where es_venta(status, payment_status) and mesero = 'pg_x drop into'")).toBeNull()
    expect(validarSqlIa('with a as (select 1 as x from pos_orders) select count(*) from a;')).toBeNull()
    expect(FUNCIONES_PERMITIDAS.has('es_venta')).toBe(true)
  })
  it('rechaza lo mismo que la base', () => {
    expect(validarSqlIa('')).toBe('consulta vacía')
    expect(validarSqlIa('update pos_orders set total = 0')).toMatch(/sólo se permiten/)
    expect(validarSqlIa('select 1 from pos_orders -- x')).toMatch(/caracteres/)
    expect(validarSqlIa("select '$1' from pos_orders")).toMatch(/caracteres/)
    expect(validarSqlIa('select "x" from pos_orders')).toMatch(/caracteres/)
    expect(validarSqlIa('select 1 from public.pos_orders')).toMatch(/no permitido/)
    expect(validarSqlIa('select * into t from pos_orders')).toMatch(/no permitido/)
    expect(validarSqlIa('with recursive r as (select 1) select * from r')).toMatch(/no permitido/)
    expect(validarSqlIa('select pg_sleep(1) from pos_orders')).toMatch(/no permitido/)
    expect(validarSqlIa('select md5(mesero) from pos_orders')).toBe('función no permitida: md5')
    expect(validarSqlIa(`select 1 from pos_orders where ${'x'.repeat(4000)}`)).toMatch(/larga/)
  })
})
