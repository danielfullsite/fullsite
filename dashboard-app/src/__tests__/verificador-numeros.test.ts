// Verificador de números: ninguna cifra sin rastro llega al dueño.
import { describe, it, expect } from 'vitest'
import {
  Evidencia, extraerCifras, verificarNumeros, marcarSinVerificar, garantizarNumeros, cifraRastreable, leerNumero,
  mensajeReparacion, MARCA_SIN_VERIFICAR, NOTA_SIN_VERIFICAR, type Cifra,
} from '@/lib/verificador-numeros'

const ev = (...xs: unknown[]) => { const e = new Evidencia(); for (const x of xs) e.agregarValor(x); return e }
/** Evidencia de dinero (columna `total`) y de porcentaje (columna `pct`). */
const evM = (...xs: number[]) => ev(...xs.map(total => ({ total })))
const evP = (...xs: number[]) => ev(...xs.map(pct => ({ pct })))
const crudos = (t: string) => extraerCifras(t).map(c => c.crudo)
const valores = (t: string) => extraerCifras(t).map(c => [c.valor, c.tipo])
const sinRastro = (t: string, e: Evidencia) => verificarNumeros(t, e).sinRastro.map(c => c.crudo)

describe('leerNumero (es-MX)', () => {
  it('coma de miles, punto decimal; coma decimal sólo si no parece miles', () => {
    expect(leerNumero('12,534.50')).toEqual({ valor: 12534.5, decimales: 2 })
    expect(leerNumero('1,234,567')).toEqual({ valor: 1234567, decimales: 0 })
    expect(leerNumero('1.234.567')).toEqual({ valor: 1234567, decimales: 0 })
    expect(leerNumero('14,8')).toEqual({ valor: 14.8, decimales: 1 })
    expect(leerNumero('12.5')).toEqual({ valor: 12.5, decimales: 1 })
  })
})

describe('extracción de cifras', () => {
  it('montos, escalas, porcentajes y conteos', () => {
    expect(valores('Vendiste $12,534.50 en agosto')).toEqual([[12534.5, 'monto']])
    expect(valores('Van $12.5k')).toEqual([[12500, 'monto']])
    expect(valores('Cerca de $1.3M')).toEqual([[1300000, 'monto']])
    expect(valores('unos 13 mil pesos')).toEqual([[13000, 'monto']])
    expect(valores('$12.5 mil')).toEqual([[12500, 'monto']])
    expect(valores('2.4 millones de pesos')).toEqual([[2400000, 'monto']])
    expect(valores('subió 14.8%')).toEqual([[14.8, 'porcentaje']])
    expect(valores('bajó -3 %')).toEqual([[3, 'porcentaje']])
    expect(valores('el 32 por ciento')).toEqual([[32, 'porcentaje']])
    expect(valores('1,214 órdenes')).toEqual([[1214, 'numero']])
    expect(valores('**$1,200**')).toEqual([[1200, 'monto']])
  })

  it('precisión mostrada = paso', () => {
    const [a, b, c, d] = extraerCifras('$12,534 · 12.5k · 14.8% · $1.3M')
    expect([a.paso, b.paso, c.paso, d.paso]).toEqual([1, 100, 0.1, 100000])
  })

  it('fechas, horas, años, duraciones, listas y ordinales NO son afirmaciones', () => {
    expect(crudos('Del 2026-08-01 al 2026-08-31 vendiste $10')).toEqual(['$10'])
    expect(crudos('El 15 de agosto de 2026 fue el mejor día')).toEqual([])
    expect(crudos('del 1 al 18 de agosto')).toEqual([])
    expect(crudos('agosto 12 y el lunes 5')).toEqual([])
    expect(crudos('28/09/2026 y 28/09')).toEqual([])
    expect(crudos('de 13 a 15 h, a las 3, 14:00, 2 pm, 7am')).toEqual([])
    expect(crudos('en 2026 y 2025')).toEqual([])
    expect(crudos('los últimos 7 días y hace 3 semanas')).toEqual([])
    expect(crudos('1. Omar\n2) Ana')).toEqual([])
    expect(crudos('top 3, el #1, 1er lugar, 2°, promo 2x1, refresco 600ml, código AMA-5096')).toEqual([])
    expect(crudos('Mira la gráfica <!--grafica:consulta-2--> y [Ver ventas →](/ventas/2026)')).toEqual([])
    expect(crudos('<!--chart {"data":[{"v":123}]} chart-->')).toEqual([])
  })

  it('un conteo con separador no es un año; un conteo con unidad tampoco', () => {
    expect(crudos('vendimos 2,050')).toEqual(['2,050'])
    expect(crudos('2026 órdenes')).toEqual(['2026'])
  })

  it('rango con guion: se leen los dos extremos', () => {
    expect(crudos('entre 12-15%')).toEqual(['12', '15%'])
  })

  it('números en palabras (voz)', () => {
    expect(valores('Llevas doce mil quinientos treinta y tres pesos')).toEqual([[12533, 'monto']])
    expect(valores('treinta y dos por ciento')).toEqual([[32, 'porcentaje']])
    expect(valores('catorce punto ocho por ciento')).toEqual([[14.8, 'porcentaje']])
    expect(valores('un millón doscientos mil pesos')).toEqual([[1200000, 'monto']])
    expect(valores('dos millones de pesos')).toEqual([[2000000, 'monto']])
    expect(valores('mil doscientas catorce órdenes')).toEqual([[1214, 'numero']])
    // Artículos, números chicos sin unidad, fechas, horas y años en palabras: no.
    expect(valores('un buen día, entre los dos, una de las tres')).toEqual([])
    expect(valores('los dos meseros, tus tres platillos')).toEqual([]) // ≤ 10 en palabras: sólo montos o %
    expect(valores('dos pesos y tres por ciento')).toEqual([[2, 'monto'], [3, 'porcentaje']])
    expect(valores('el veintiocho de septiembre a las cuatro')).toEqual([])
    expect(valores('en dos mil veintiséis')).toEqual([])
    expect(valores('los últimos siete días')).toEqual([])
  })

  it('se puede apagar la lectura de palabras', () => {
    expect(extraerCifras('doce mil pesos', { palabras: false })).toEqual([])
  })
})

describe('evidencia y tolerancia', () => {
  it('evidencia: números, numéricos en texto (PostgREST), números dentro de textos; sin partes de fechas', () => {
    const e = ev({ total: '12534.49', n: 3, nombre: 'Combo 2x1', fecha: '2026-08-15', hora: '14:00' })
    expect(e.hayEntre(12534.49, 12534.49)).toBe(true)
    expect(e.hayEntre(3, 3)).toBe(true)
    expect(e.hayEntre(2, 2)).toBe(true)
    expect(e.hayEntre(15, 15)).toBe(false)
    expect(e.hayEntre(2026, 2026)).toBe(false)
    expect(e.hayEntre(14, 14)).toBe(false)
  })

  it('evidencia desde bloques de texto con el formato del contexto', () => {
    const e = new Evidencia().agregarTexto('2026-08-15 (sábado): Ventas $12533, 40 personas | Platillos: TACO:12pzas/$1500 (+12.5%)')
    for (const v of [12533, 40, 12, 1500, 12.5]) expect(e.hayEntre(v, v)).toBe(true)
    expect(e.hayEntre(8, 8)).toBe(false)
  })

  it('redondeo a la precisión mostrada', () => {
    const e = evM(12534.49)
    expect(sinRastro('$12,534', e)).toEqual([])
    expect(sinRastro('$12,534.49', e)).toEqual([])
    expect(sinRastro('12.5k', e)).toEqual([])
    expect(sinRastro('$12.5 mil', e)).toEqual([])
    expect(sinRastro('13 mil pesos', e)).toEqual([])
    expect(sinRastro('$12,535', e)).toEqual(['$12,535'])
    expect(sinRastro('$12,534.50', e)).toEqual(['$12,534.50'])
    expect(sinRastro('12k', e)).toEqual(['12k'])
  })

  it('truncado sólo de decimales (paso ≤ 1), no con escala', () => {
    expect(sinRastro('$12,534', evM(12534.9))).toEqual([])
    expect(sinRastro('13 mil pesos', evM(13900))).toEqual(['13 mil'])
  })

  it('millones', () => {
    expect(sinRastro('$1.3M', evM(1284000))).toEqual([])
    expect(sinRastro('$1.2M', evM(1284000))).toEqual(['$1.2M'])
  })

  it('porcentaje ↔ proporción, y signo', () => {
    expect(sinRastro('14.8%', evP(0.148))).toEqual([])
    expect(sinRastro('14.8%', evP(0.14832))).toEqual([])
    expect(sinRastro('15%', evP(0.148))).toEqual([])
    expect(sinRastro('14.8%', evP(14.83))).toEqual([])
    expect(sinRastro('bajó -3.2%', evP(3.2))).toEqual([])
    expect(sinRastro('bajó 3.2%', evP(-0.032))).toEqual([])
    expect(sinRastro('14.9%', evP(0.148))).toEqual(['14.9%'])
  })

  it('clases: "$" sólo contra dinero, "%" sólo contra porcentajes; conteos contra cualquiera', () => {
    // Una celda cualquiera 0.14 (p. ej. un peso en kg) NO respalda "14%".
    expect(sinRastro('subió 14%', ev({ peso_kg: 0.14 }))).toEqual(['14%'])
    expect(sinRastro('subió 14%', ev({ cantidad: 14 }))).toEqual(['14%'])
    expect(sinRastro('subió 14%', ev({ pct_bebidas: 0.14 }))).toEqual([])
    expect(sinRastro('subió 14%', ev({ tasa_cancelacion: 14.2 }))).toEqual([])
    expect(sinRastro('margen de 14%', ev({ margen: 0.1402 }))).toEqual([])
    // Un conteo (piezas) no respalda un monto; una columna de dinero sí.
    expect(sinRastro('vendiste $1,214', ev({ piezas: 1214 }))).toEqual(['$1,214'])
    expect(sinRastro('vendiste $1,214', ev({ venta_total: '1214.2' }))).toEqual([])
    expect(sinRastro('ticket de $313', ev({ ticket_promedio: 313.36 }))).toEqual([])
    expect(sinRastro('12.5k', ev({ piezas: 12500 }))).toEqual(['12.5k']) // escala sin unidad = monto
    expect(sinRastro('12.5k piezas', ev({ piezas: 12500 }))).toEqual([])
    // Un conteo se rastrea con cualquier número (incluidos montos y %).
    expect(sinRastro('1,214 órdenes', ev({ total: 1214 }))).toEqual([])
    expect(sinRastro('1,214 órdenes', ev({ ordenes: 1214 }))).toEqual([])
    // Columnas anidadas: la clase la da la clave más cercana.
    expect(sinRastro('$50', ev({ meseros: [{ nombre: 'Ana', venta: 50 }] }))).toEqual([])
  })

  it('clases desde texto del contexto: por su formato', () => {
    const e = new Evidencia().agregarTexto('Ventas $12533, 40 personas, bebidas 23.5%, 7 mesas')
    expect(sinRastro('$12,533, 23.5%, 40 personas', e)).toEqual([])
    expect(sinRastro('$40', e)).toEqual(['$40'])
    expect(sinRastro('7%', e)).toEqual(['7%'])
  })

  it('lo que escribió el usuario sólo respalda conteos (soloConteos)', () => {
    const e = new Evidencia().agregarTexto('mi meta es $15,000, 20% más, en 12 mesas', { soloConteos: true })
    expect(sinRastro('tu meta de $15,000', e)).toEqual(['$15,000'])
    expect(sinRastro('20% más', e)).toEqual(['20%'])
    expect(sinRastro('12 mesas', e)).toEqual([])
  })

  it('NO acepta derivados: una suma o un % que el modelo calculó', () => {
    const e = ev({ a: 100, b: 250 })
    expect(sinRastro('En total $350', e)).toEqual(['$350'])
    expect(sinRastro('b es 150% más', e)).toEqual(['150%'])
  })

  it('palabras contra evidencia', () => {
    expect(sinRastro('Llevas doce mil quinientos treinta y tres pesos', evM(12533.2))).toEqual([])
    expect(sinRastro('Llevas trece mil pesos', evM(12533.2))).toEqual(['trece mil'])
  })

  it('cifraRastreable sobre una cifra armada a mano', () => {
    const c: Cifra = { inicio: 0, fin: 1, crudo: '5', valor: 5, paso: 1, tipo: 'numero', enPalabras: false }
    expect(cifraRastreable(c, ev(5))).toBe(true)
    expect(cifraRastreable(c, ev(6))).toBe(false)
  })
})

describe('marcado y reparación', () => {
  it('marca cada cifra sin rastro y agrega la nota', () => {
    const t = 'Vendiste $12,534 y 40 órdenes; ticket $313.'
    const r = verificarNumeros(t, evM(12534))
    const m = marcarSinVerificar(t, r.sinRastro)
    expect(m).toBe(`Vendiste $12,534 y ${MARCA_SIN_VERIFICAR} órdenes; ticket ${MARCA_SIN_VERIFICAR}.\n\n${NOTA_SIN_VERIFICAR}`)
    expect(marcarSinVerificar(t, [])).toBe(t)
  })

  it('palabras: se marca la corrida, la unidad se queda', () => {
    const t = 'Llevas trece mil pesos.'
    const m = marcarSinVerificar(t, verificarNumeros(t, ev(1)).sinRastro)
    expect(m.startsWith(`Llevas ${MARCA_SIN_VERIFICAR} pesos.`)).toBe(true)
  })

  it('todo con rastro: no repara, no marca', async () => {
    let llamadas = 0
    const r = await garantizarNumeros({ texto: 'Vendiste $100', evidencia: evM(100), reparar: async () => { llamadas++; return { texto: 'x' } } })
    expect(r).toMatchObject({ texto: 'Vendiste $100', afirmaciones: 1, sinRastroInicial: 0, reparado: false, marcados: 0 })
    expect(llamadas).toBe(0)
  })

  it('una reparación: la lista va al reparador; la respuesta reparada se re-verifica con la evidencia nueva', async () => {
    const vistos: string[][] = []
    const r = await garantizarNumeros({
      texto: 'Total $350',
      evidencia: evM(100, 250),
      reparar: async (_t, lista) => { vistos.push(lista.map(c => c.crudo)); return { texto: 'Total $350 según la consulta', evidenciaExtra: [{ total: 350 }] } },
    })
    expect(vistos).toEqual([['$350']])
    expect(r).toMatchObject({ texto: 'Total $350 según la consulta', sinRastroInicial: 1, reparado: true, marcados: 0 })
  })

  it('la reparación también inventa → se marca lo que quede', async () => {
    let llamadas = 0
    const r = await garantizarNumeros({ texto: 'Total $350', evidencia: evM(100), reparar: async () => { llamadas++; return { texto: 'Total $360 y $100' } } })
    expect(llamadas).toBe(1)
    expect(r.texto).toBe(`Total ${MARCA_SIN_VERIFICAR} y $100\n\n${NOTA_SIN_VERIFICAR}`)
    expect(r).toMatchObject({ reparado: true, marcados: 1 })
  })

  it('reparación que falla o viene vacía → se marca la original, nunca lanza', async () => {
    const a = await garantizarNumeros({ texto: 'Total $350', evidencia: ev(1), reparar: async () => { throw new Error('429') } })
    expect(a.texto).toBe(`Total ${MARCA_SIN_VERIFICAR}\n\n${NOTA_SIN_VERIFICAR}`)
    expect(a).toMatchObject({ reparado: false, marcados: 1 })
    const b = await garantizarNumeros({ texto: 'Total $350', evidencia: ev(1), reparar: async () => ({ texto: '  ' }) })
    expect(b).toMatchObject({ reparado: false, marcados: 1 })
  })

  it('sin reparador: marca directo', async () => {
    const r = await garantizarNumeros({ texto: 'Total $350', evidencia: ev(1) })
    expect(r).toMatchObject({ reparado: false, marcados: 1, sinRastroInicial: 1 })
  })

  it('el mensaje de reparación lista las cifras (sin repetir) y sólo ofrece SQL si hay consulta libre', () => {
    const cs = extraerCifras('$350 y $350 y 12%')
    const con = mensajeReparacion(cs, true)
    expect(con).toContain('"$350", "12%"')
    expect(con).toContain('consultar_datos')
    expect(mensajeReparacion(cs, false)).not.toContain('consultar_datos')
  })
})
