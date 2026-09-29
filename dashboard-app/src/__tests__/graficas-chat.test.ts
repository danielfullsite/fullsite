// Gráficas del chat: el catálogo se arma SÓLO con datos leídos (huecos = null, hoy =
// parcial, fechas reales) y el modelo sólo elige un ID. Todo bloque con datos escritos
// por el modelo se descarta. Ver lib/graficas-chat.ts.
import { describe, it, expect } from 'vitest'
import {
  aplicarGraficas, anexarGrafica, compactarGraficasEnHistorial, construirCatalogo, elegirGraficaPorPregunta,
  graficaFranjas, graficaHoyVsSemanaPasada, graficaMeseros, graficaMetodosPago, graficaSemanaVsAnterior,
  graficaTopPlatillos, graficaVentasDiarias, graficaVentasPorHora, graficaVentasPorMes, lineasCatalogoParaPrompt,
  MAX_GRAFICAS_POR_RESPUESTA, type EntradaCatalogo,
} from '@/lib/graficas-chat'
import { quitarComentarios } from '@/lib/graficas-chat'
import { separarGraficas, validarSpec, corteSinPartirBloques, bloqueDeSpec, mxnCorto, mxnCompleto, etiquetaEje } from '@/lib/grafica-spec'
import { DAYPARTS_DEFAULT } from '@/lib/dayparts'

const HOY = '2026-09-28'
const sumar = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** n días hacia atrás desde `hasta`, saltando las fechas de `sin`. */
function dias(hasta: string, n: number, sin: string[] = [], extra: (f: string, i: number) => Record<string, unknown> = () => ({})) {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    const f = sumar(hasta, -i)
    if (sin.includes(f)) continue
    out.push({ fecha: f, ventas_dia: 10000 + i, personas_restaurant: 20, tickets_count: 10, ...extra(f, i) })
  }
  return out
}

const entrada = (p: Partial<EntradaCatalogo> = {}): EntradaCatalogo => ({
  hoy: HOY, zona: 'America/Monterrey', inicioDia: '05:00', dias: dias(HOY, 60),
  fuenteVentas: 'fullsite', ventasDeterminadas: true, ...p,
})

describe('ventas_diarias_30d', () => {
  it('30 días de calendario con fechas reales; hoy parcial; huecos null (no cero)', () => {
    const s = graficaVentasDiarias(entrada({ dias: dias(HOY, 40, ['2026-09-20', '2026-09-21']) }))!
    expect(s.filas).toHaveLength(30)
    expect(s.filas[0].x).toBe('2026-08-30')
    expect(s.filas[29].x).toBe(HOY)
    expect(s.rango).toBe('2026-08-30 a 2026-09-28')
    expect(s.filas[29].parcial).toBe(true)
    expect(s.filas.filter(f => f.parcial)).toHaveLength(1)
    const hueco = s.filas.find(f => f.x === '2026-09-20')!
    expect(hueco.v.ventas).toBeNull()
    expect(s.huecos).toBe(2)
    expect(s.filas.some(f => f.v.ventas === 0)).toBe(false)
    expect(validarSpec(s)).not.toBeNull()
  })

  it('sólo valores que existen en las filas leídas', () => {
    const d = dias(HOY, 30)
    const s = graficaVentasDiarias(entrada({ dias: d }))!
    const leidos = new Set(d.map(x => x.ventas_dia))
    for (const f of s.filas) if (f.v.ventas !== null) expect(leidos.has(f.v.ventas)).toBe(true)
  })

  it('dato viejo: la ventana termina en el último día con datos y lo avisa', () => {
    const s = graficaVentasDiarias(entrada({ dias: dias('2026-08-10', 20), fuenteVentas: 'wansoft' }))!
    expect(s.filas[29].x).toBe('2026-08-10')
    expect(s.datosHasta).toBe('2026-08-10')
    expect(s.aviso).toContain('2026-08-10')
    expect(s.fuente).toBe('histórico importado')
  })

  it('sin datos o lectura fallida → no hay gráfica', () => {
    expect(graficaVentasDiarias(entrada({ dias: [] }))).toBeNull()
    expect(graficaVentasDiarias(entrada({ ventasDeterminadas: false }))).toBeNull()
  })
})

describe('ventas_por_mes', () => {
  it('agrupa por mes; mes en curso parcial; mes sin datos = hueco', () => {
    const d = [...dias(HOY, 28), ...dias('2026-07-31', 31)] // agosto sin datos
    const s = graficaVentasPorMes(entrada({ dias: d }))!
    expect(s.filas.map(f => f.x)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(s.filas[1].v.ventas).toBeNull()
    expect(s.filas[2].parcial).toBe(true)
    expect(s.filas[2].nota).toContain('28 días con datos')
    expect(s.filas[0].v.ventas).toBe(d.filter(x => String(x.fecha).startsWith('2026-07')).reduce((a, x) => a + Number(x.ventas_dia), 0))
  })
  it('primer mes que empieza a medio mes = parcial aunque no haya ventanaDesde', () => {
    const s = graficaVentasPorMes(entrada({ dias: dias(HOY, 50) }))! // desde 2026-08-10
    expect(s.filas[0].x).toBe('2026-08')
    expect(s.filas[0].parcial).toBe(true)
    expect(s.filas[0].nota).toContain('datos desde 2026-08-10')
    expect(s.filas[1].parcial).toBe(true) // septiembre: en curso
  })
  it('un solo mes → no aplica', () => {
    expect(graficaVentasPorMes(entrada({ dias: dias(HOY, 10) }))).toBeNull()
  })
  it('mes cortado por la ventana leída = parcial', () => {
    const s = graficaVentasPorMes(entrada({ dias: dias(HOY, 60), ventanaDesde: '2026-07-31' }))!
    expect(s.filas[0].x).toBe('2026-07')
    expect(s.filas[0].parcial).toBe(true)
  })
})

describe('hoy_vs_semana_pasada', () => {
  const semanaPasada = '2026-09-21'
  // 2026-09-28 19:00Z = 13:00 Monterrey (UTC-6)
  const ahora = Date.parse('2026-09-28T19:00:00Z')
  const ordenes = [
    { dia_venta: HOY, total: 100, created_at: '2026-09-28T14:10:00Z' }, // 08:10
    { dia_venta: HOY, total: 300, created_at: '2026-09-28T16:30:00Z' }, // 10:30
    { dia_venta: semanaPasada, total: 200, created_at: '2026-09-21T14:05:00Z' }, // 08:05
    { dia_venta: semanaPasada, total: 999, created_at: '2026-09-21T20:00:00Z' }, // 14:00 → después del corte
  ]
  const e = entrada({ hoyVsSemana: { ordenes, semanaPasada, corteSemanaPasada: ahora - 7 * 864e5, horaCorte: '13:00' } })

  it('acumulado por hora, un solo eje, cortado a la misma hora', () => {
    const s = graficaHoyVsSemanaPasada(e)!
    expect(s.tipo).toBe('comparacion')
    expect(s.series.map(x => x.rol)).toEqual(['principal', 'contexto'])
    const ult = s.filas[s.filas.length - 1]
    expect(ult.x).toBe('13:00')
    expect(ult.parcial).toBe(true)
    expect(ult.v).toEqual({ hoy: 400, semana_pasada: 200 }) // el 999 de las 14:00 no entra
    expect(s.filas[0].x).toBe('09:00') // acumulado al cierre de la hora 8
    expect(s.filas[0].v).toEqual({ hoy: 100, semana_pasada: 200 })
    expect(new Set(s.filas.map(f => f.x)).size).toBe(s.filas.length)
  })

  it('sin órdenes en ningún día → no hay gráfica (sin cobertura, no $0)', () => {
    expect(graficaHoyVsSemanaPasada(entrada({ hoyVsSemana: { ordenes: [], semanaPasada, corteSemanaPasada: ahora, horaCorte: '13:00' } }))).toBeNull()
    expect(graficaHoyVsSemanaPasada(entrada())).toBeNull()
  })
})

describe('semana_vs_anterior', () => {
  it('7 vs 7 alineados; hoy no entra; huecos null; cobertura desigual avisada', () => {
    const s = graficaSemanaVsAnterior(entrada({ dias: dias(HOY, 20, ['2026-09-16']) }))!
    expect(s.filas).toHaveLength(7)
    expect(s.filas[0].x).toBe('2026-09-21')
    expect(s.filas[6].x).toBe('2026-09-27')
    expect(s.filas.find(f => f.x === '2026-09-23')!.v.anterior).toBeNull()
    expect(s.aviso).toMatch(/7 vs 6/)
  })
  it('periodo anterior fuera de la ventana leída → no comparable', () => {
    expect(graficaSemanaVsAnterior(entrada({ ventanaDesde: '2026-09-18' }))).toBeNull()
  })
})

describe('franjas', () => {
  it('apila comida/bebida por franja en el orden configurado; avisa muestra chica', () => {
    const filas = [
      { location_id: 'a', franja: 'cena', ordenes: 5, dias: 3, venta: 500, venta_comida: 300, venta_bebida: 200, fuente: null },
      { location_id: 'a', franja: 'desayuno', ordenes: 10, dias: 3, venta: 1000, venta_comida: 600, venta_bebida: 300, fuente: null },
      { location_id: 'b', franja: 'desayuno', ordenes: 2, dias: 1, venta: 100, venta_comida: 100, venta_bebida: 0, fuente: null },
    ]
    const s = graficaFranjas(entrada({ franjas: { filas, config: DAYPARTS_DEFAULT, desde: '2026-08-30', hasta: HOY } }))!
    expect(s.tipo).toBe('barra_apilada')
    expect(s.filas.map(f => f.x)).toEqual(['Desayuno', 'Cena'])
    expect(s.filas[0].v).toEqual({ comida: 700, bebida: 300, otros: 100 })
    expect(s.series.map(x => x.clave)).toEqual(['comida', 'bebida', 'otros'])
    expect(s.aviso).toMatch(/Muestra chica \(17 órdenes\)/)
  })
})

describe('rankings', () => {
  const conDetalle = dias(HOY, 10, [], (f) => ({
    meseros: [{ nombre: 'Ana', total: 500 }, { nombre: 'Beto', total: 300 }, { nombre: 'MESERO EVENTO', total: 9999 }],
    ventas_por_grupo: [{ nombre: 'BOWLS', total: 700 }],
    platillos_top: [{ nombre: 'Chilaquiles', cantidad: 3, total: 400 }, { nombre: 'Ana', cantidad: 1, total: 500 }, { nombre: 'BOWLS', total: 700 }, { nombre: 'Latte', cantidad: 5, total: 250 }],
    pago_metodos: [{ nombre: 'Tarjeta de crédito', total: 600 }, { nombre: 'Efectivo', total: 200 }],
    _f: f,
  }))

  it('meseros: últimos 7 días COMPLETOS (sin hoy), sin etiquetas que no son personas', () => {
    const s = graficaMeseros(entrada({ dias: conDetalle }))!
    expect(s.tipo).toBe('ranking')
    expect(s.filas.map(f => f.x)).toEqual(['Ana', 'Beto'])
    expect(s.filas[0].v.venta).toBe(3500)
    expect(s.rango).toBe('2026-09-21 a 2026-09-27')
  })

  it('platillos (histórico): excluye nombres que ese día son mesero o grupo', () => {
    const s = graficaTopPlatillos(entrada({ dias: conDetalle }))!
    expect(s.filas.map(f => f.x)).toEqual(['Chilaquiles', 'Latte'])
    expect(s.filas[0].nota).toBe('21 pzas')
  })

  it('platillos: prefiere fs_ventas_producto cuando existe', () => {
    const s = graficaTopPlatillos(entrada({ dias: conDetalle, productos: { filas: [{ producto: 'Bagel', piezas: 4, venta: 800 }, { producto: 'Café', piezas: 10, venta: 450 }], desde: '2026-07-01', hasta: HOY } }))!
    expect(s.filas.map(f => f.x)).toEqual(['Bagel', 'Café'])
    expect(s.fuente).toBe('POS Fullsite')
    expect(s.rango).toBe(`2026-07-01 a ${HOY}`)
  })

  it('métodos de pago: dona con ≤5 partes', () => {
    const s = graficaMetodosPago(entrada({ dias: conDetalle }))!
    expect(s.tipo).toBe('dona')
    expect(s.filas[0]).toEqual({ x: 'Tarjeta de crédito', v: { monto: 4200 } })
  })
})

describe('ventas_por_hora', () => {
  it('diferencias entre snapshots acumulados del día más reciente', () => {
    const s = graficaVentasPorHora(entrada({ horas: [
      { fecha: '2026-09-26', data: [{ hora: '09', total: 1 }, { hora: '10', total: 2 }] },
      { fecha: '2026-09-27', data: JSON.stringify([{ hora: '09', total: 1000 }, { hora: '10', total: 2500 }, { hora: '11', total: 3000 }]) },
    ] }))!
    expect(s.rango).toBe('2026-09-27')
    expect(s.filas.map(f => f.v.ventas)).toEqual([1000, 1500, 500])
  })
})

describe('catálogo y prompt', () => {
  it('sólo gráficas con dato; cada línea con su id y rango real', () => {
    const cat = construirCatalogo(entrada({ dias: dias(HOY, 60) }))
    expect([...cat.keys()]).toEqual(['ventas_diarias_30d', 'ventas_por_mes', 'semana_vs_anterior'])
    const lineas = lineasCatalogoParaPrompt(cat)
    expect(lineas).toContain('- ventas_diarias_30d: ')
    expect(lineas).toContain('2026-08-30 a 2026-09-28')
    expect(lineas).not.toContain('meseros')
  })
  it('lectura fallida → catálogo vacío', () => {
    expect(construirCatalogo(entrada({ ventasDeterminadas: false })).size).toBe(0)
  })
  it('elige la gráfica por la pregunta, sólo entre las disponibles', () => {
    const cat = construirCatalogo(entrada({ dias: dias(HOY, 60) }))
    expect(elegirGraficaPorPregunta('hazme una gráfica de ventas por mes', cat)).toBe('ventas_por_mes')
    expect(elegirGraficaPorPregunta('grafica vs la semana pasada', cat)).toBe('semana_vs_anterior')
    expect(elegirGraficaPorPregunta('gráfica de meseros', cat)).toBe('ventas_diarias_30d') // no hay meseros → la general
    expect(elegirGraficaPorPregunta('grafica', new Map())).toBeNull()
  })
})

describe('aplicarGraficas (marcadores → spec del servidor)', () => {
  const cat = construirCatalogo(entrada({ dias: dias(HOY, 60) }))

  it('sustituye el marcador por el spec del servidor', () => {
    const r = aplicarGraficas('Vas arriba.\n<!--grafica:ventas_por_mes-->', cat)
    expect(r.usadas).toEqual(['ventas_por_mes'])
    const partes = separarGraficas(r.texto)
    expect(partes[0]).toEqual({ tipo: 'texto', texto: 'Vas arriba.' })
    expect(partes[1].tipo === 'grafica' && partes[1].spec).toEqual(cat.get('ventas_por_mes'))
    expect(r.textoCompacto).toBe('Vas arriba.\n<!--grafica:ventas_por_mes-->')
  })

  it('IDs desconocidos o no disponibles se quitan', () => {
    const r = aplicarGraficas('Ok <!--grafica:inventada--> y <!--grafica:meseros-->.', cat)
    expect(r.usadas).toEqual([])
    expect(r.texto).toBe('Ok  y .')
    expect(r.texto).not.toContain('<!--')
  })

  it(`máximo ${MAX_GRAFICAS_POR_RESPUESTA} y sin repetir`, () => {
    const r = aplicarGraficas('<!--grafica:ventas_por_mes-->\n<!--grafica:ventas_por_mes-->\n<!--grafica:semana_vs_anterior-->\n<!--grafica:ventas_diarias_30d-->', cat)
    expect(r.usadas).toEqual(['ventas_por_mes', 'semana_vs_anterior'])
    expect(separarGraficas(r.texto).filter(p => p.tipo === 'grafica')).toHaveLength(2)
  })

  it('un <!--chart con datos INVENTADOS por el modelo se descarta', () => {
    const r = aplicarGraficas('Vendiste mucho.\n<!--chart\n{"type":"bar","title":"Ventas","data":[{"label":"lun","value":123456},{"label":"mar","value":999}]}\nchart-->', cat)
    expect(r.texto).toBe('Vendiste mucho.')
    expect(r.descartadas).toBe(1)
    expect(r.texto).not.toContain('123456')
  })

  it('un <!--chart con JSON inválido o a medias se descarta', () => {
    expect(aplicarGraficas('A <!--chart {nope chart--> B', cat).texto).toBe('A  B')
    expect(aplicarGraficas('A\n<!--chart\n{"type":"bar","data":[', cat).texto).toBe('A')
  })

  it('un <!--chart cuyos valores SON los del servidor se sustituye por el spec del servidor', () => {
    const s = cat.get('ventas_por_mes')!
    const data = s.filas.filter(f => f.v.ventas !== null).map(f => ({ label: f.x, value: Math.round(f.v.ventas as number) }))
    const r = aplicarGraficas(`Así va:\n<!--chart\n${JSON.stringify({ type: 'line', title: 'otro título', data })}\nchart-->`, cat)
    expect(r.usadas).toEqual(['ventas_por_mes'])
    const g = separarGraficas(r.texto).find(p => p.tipo === 'grafica')
    expect(g && g.tipo === 'grafica' && g.spec.titulo).toBe('Ventas por mes')
  })

  it('un <!--chart con formato del servidor escrito por el modelo tampoco pasa (datos no verificados)', () => {
    const falso = { ...cat.get('ventas_por_mes')!, filas: [{ x: '2026-09', v: { ventas: 1 } }, { x: '2026-08', v: { ventas: 2 } }] }
    const r = aplicarGraficas(`x ${bloqueDeSpec(falso)}`, cat)
    expect(r.usadas).toEqual([])
    expect(separarGraficas(r.texto).some(p => p.tipo === 'grafica')).toBe(false)
  })

  it('modo voz: sin gráficas, y un texto sin marcadores queda idéntico', () => {
    const r = aplicarGraficas('Vas bien <!--grafica:ventas_por_mes-->', cat, { sinGraficas: true })
    expect(r.texto).toBe('Vas bien')
    expect(aplicarGraficas('Vas bien.', cat).texto).toBe('Vas bien.')
  })

  it('anexarGrafica (auto-inyectado) agrega el bloque al final', () => {
    const r = anexarGrafica(aplicarGraficas('Vas bien.', cat), cat.get('ventas_diarias_30d')!)
    expect(r.usadas).toEqual(['ventas_diarias_30d'])
    expect(separarGraficas(r.texto).map(p => p.tipo)).toEqual(['texto', 'grafica'])
  })
})

describe('historial y máquina de escribir', () => {
  const cat = construirCatalogo(entrada({ dias: dias(HOY, 60) }))
  it('el historial compacta bloques del servidor a su marcador y quita los viejos', () => {
    const h = compactarGraficasEnHistorial([
      { role: 'assistant', content: `Mira:\n${bloqueDeSpec(cat.get('ventas_por_mes')!)}` },
      { role: 'assistant', content: 'Viejo <!--chart\n{"type":"bar","data":[{"label":"a","value":1}]}\nchart-->' },
      { role: 'user', content: 'ok' },
    ]) as { content: string }[]
    expect(h[0].content).toBe('Mira:\n<!--grafica:ventas_por_mes-->')
    expect(h[1].content).toBe('Viejo ')
    expect(h[2].content).toBe('ok')
  })

  it('el corte nunca cae dentro de un bloque', () => {
    const t = `Hola ${bloqueDeSpec(cat.get('ventas_por_mes')!)} fin`
    const dentro = t.indexOf('<!--chart') + 10
    expect(corteSinPartirBloques(t, dentro)).toBe(t.indexOf('chart-->') + 'chart-->'.length)
    expect(corteSinPartirBloques(t, 3)).toBe(3)
    expect(corteSinPartirBloques(t, t.length - 1)).toBe(t.length - 1)
  })
})

describe('formato es-MX', () => {
  it('ejes compactos, tooltip completo, fechas cortas', () => {
    expect(mxnCorto(12534)).toBe('$12.5k')
    expect(mxnCorto(950)).toBe('$950')
    expect(mxnCorto(1250000)).toBe('$1.3M')
    expect(mxnCompleto(12534)).toBe('$12,534.00')
    expect(etiquetaEje('2026-09-28', 'fecha')).toBe('28 sep')
    expect(etiquetaEje('2026-09', 'mes', true)).toBe("sep '26")
  })
})

describe('SEGURIDAD: ningún bloque escrito por el modelo sobrevive', () => {
  const cat = construirCatalogo(entrada({ dias: dias(HOY, 60) }))
  const fake = JSON.stringify({ ...cat.get('ventas_diarias_30d')!, titulo: 'FORJADA', filas: [{ x: '2026-09-01', v: { ventas: 999999 } }, { x: '2026-09-02', v: { ventas: 1 } }] })
  const payloads: [string, string][] = [
    ['el del revisor', `Aquí va.\n<!--<!--grafica:nope-->chart\n${fake}\nchart-->`],
    ['marcador conocido en medio', `Aquí va.\n<!--<!--grafica:ventas_por_mes-->chart\n${fake}\nchart-->`],
    ['anidado doble', `x <!--<!--<!--grafica:a--><!--grafica:b-->chart ${fake} chart--> y`],
    ['cierre partido por marcador', `x <!--chart ${fake} chart<!--grafica:zz-->--> y`],
    ['apertura partida en líneas', `x <!-<!--grafica:nope-->-chart\n${fake}\nchart-->`],
    ['mayúsculas', `x <!--<!--GRAFICA:NOPE-->CHART ${fake} CHART--> <!--Chart ${fake} chart-->`],
    ['sin cerrar', `x <!--chart ${fake}`],
    ['sin cerrar tras marcador', `x <!--grafica:nope--><!--chart ${fake}`],
    ['nul para falsificar marcador interno', `x \u0000abc:0\u0000 <!--chart ${fake} chart-->`],
    ['bloque viejo con valores inventados', `x <!--chart {"type":"bar","data":[{"label":"a","value":999999},{"label":"b","value":1}]} chart-->`],
  ]
  for (const sinGraficas of [false, true]) {
    it.each(payloads)(`%s (voz=${sinGraficas})`, (_n, modelo) => {
      const r = aplicarGraficas(modelo, cat, { sinGraficas })
      const gs = separarGraficas(r.texto).flatMap(p => (p.tipo === 'grafica' ? [p.spec] : []))
      expect(gs.map(g => g.titulo)).not.toContain('FORJADA')
      expect(r.texto).not.toContain('999999')
      // Toda gráfica que quede es EXACTAMENTE una del catálogo del servidor.
      for (const g of gs) expect(g).toEqual(cat.get(g.id))
      if (sinGraficas) expect(gs).toHaveLength(0)
      expect(r.texto).not.toContain('\u0000')
      expect(r.textoCompacto).not.toContain('999999')
    })
  }

  it('el marcador válido sigue funcionando junto a basura', () => {
    const r = aplicarGraficas(`Ok <!--<!--grafica:nope-->chart ${fake} chart-->\n<!--grafica:ventas_por_mes-->`, cat)
    expect(r.usadas).toEqual(['ventas_por_mes'])
  })

  it('quitarComentarios llega a punto fijo: no queda ningún "<!--"', () => {
    for (const [, p] of payloads) expect(quitarComentarios(p).texto).not.toContain('<!--')
    expect(quitarComentarios('a <!<!---->-- b --> c').texto).not.toContain('<!--')
  })
})
