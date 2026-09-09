import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zonedStartOfDayISO } from '@/lib/date-mx'

// EL CORTE "POR DÍA" NO CUBRÍA EL DÍA.
//
// Dos errores independientes que se sumaban, los dos medidos el 2026-09-08.
//
// ERROR 1 — la fecha por defecto era MAÑANA después de las 18:00.
//
//     new Date(now.toLocaleString('en-US', {timeZone})).toISOString().split('T')[0]
//
// construye una fecha con los números locales pero interpretados como hora local del
// proceso, y `.toISOString()` vuelve a convertir a UTC: el desfase se aplica dos veces.
// Corrido en node con la zona de Monterrey:
//
//     hora local MX      fecha que usaba el corte     fecha real
//     7 sep 17:30        2026-09-07                   2026-09-07
//     7 sep 18:30        2026-09-08   <-- MAÑANA      2026-09-07
//     7 sep 23:30        2026-09-08   <-- MAÑANA      2026-09-07
//
// O sea: todas las noches a partir de las 18:00, que es justo cuando se hace el corte.
// El historial era peor todavía: `new Date().toISOString()`, la fecha en UTC sin
// siquiera intentar la zona.
//
// ERROR 2 — la ventana estaba corrida seis horas. El filtro era
// `created_at=gte.${fecha}T00:00:00&lte.${fecha}T23:59:59`, sin zona, y Postgres corre
// en UTC. Comprobado contra la base viva:
//
//     '2026-09-08T00:00:00'::timestamptz AT TIME ZONE 'America/Monterrey'
//       = 2026-09-07 18:00:00
//     '2026-09-08T23:59:59'::timestamptz AT TIME ZONE 'America/Monterrey'
//       = 2026-09-08 17:59:59
//
// Pedir "8 de septiembre" traía del 7 a las 18:00 al 8 a las 17:59: TODA LA COMIDA del
// día quedaba fuera y se colaba la cena del día anterior. El gerente compara ese total
// contra el sobre y le sobra el importe de la comida — y si alguien se llevó dinero de
// la comida, ese número no lo delata, porque la comida no está en él.

const TZ = 'America/Monterrey'
const soloFecha = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

// EL DEFECTO DEPENDE DE LA ZONA DEL PROCESO, Y POR ESO ESTA PRUEBA NO PUEDE LEERLA.
//
// `new Date(d.toLocaleString('en-US', { timeZone: TZ }))` toma los numeros de PARED de
// Monterrey y los reinterpreta como hora local DEL PROCESO. El resultado depende de la
// maquina:
//
//   - Terminal de AMALAY (TZ del sistema = Monterrey): devuelve MAÑANA a la hora de la
//     cena. Es el caso de campo.
//   - Runner de CI (TZ = UTC): devuelve la fecha correcta por casualidad.
//
// La primera version de esta prueba llamaba al patron viejo directamente y afirmaba
// '2026-09-08'. Pasaba en la Mac de Daniel (Monterrey) y fallaba en CI (UTC) --
// verde en la maquina de quien lo escribio, rojo donde importa. Y de paso muestra por
// que CI nunca iba a delatar este defecto sola.
//
// Se simula la zona del proceso en vez de leerla. `simuladorFiel` comprueba, en la
// maquina que sea, que la simulacion coincide con el patron real.

/** Los numeros de pared de un instante en una zona. */
function pared(instante: Date, zona: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instante)
  const v = (t: string) => Number(p.find(x => x.type === t)!.value)
  return { y: v('year'), m: v('month'), d: v('day'), h: v('hour') % 24, mi: v('minute'), s: v('second') }
}

/** Desfase de una zona respecto a UTC, en ms, en ese instante (respeta horario de verano). */
function desfase(zona: string, instante: Date): number {
  const w = pared(instante, zona)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - instante.getTime()
}

/** Lo que el patron viejo devuelve en un proceso cuya zona local es `zonaDelProceso`. */
function patronViejoEn(ahora: Date, zonaDelProceso: string): string {
  const w = pared(ahora, TZ)                                   // lo que dice toLocaleString
  const comoSiFueraLocal = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  // `new Date(str)` interpreta esos numeros en la zona del proceso -> resta su desfase.
  const aproximado = new Date(comoSiFueraLocal)
  return new Date(comoSiFueraLocal - desfase(zonaDelProceso, aproximado))
    .toISOString().split('T')[0]
}

/** La zona con la que corre este proceso ahora mismo. */
const ZONA_DEL_PROCESO = Intl.DateTimeFormat().resolvedOptions().timeZone

describe('ERROR 1: la fecha por defecto', () => {
  /** El patrón viejo, tal cual estaba en el corte. */
  const patronViejo = (ahora: Date) =>
    new Date(ahora.toLocaleString('en-US', { timeZone: TZ })).toISOString().split('T')[0]

  it('simuladorFiel: la simulación coincide con el patrón real en ESTA máquina', () => {
    // Ancla del simulador. Si esto pasa, lo de abajo es sobre el patron de verdad y no
    // sobre una teoria mia. Corre igual en Monterrey, en UTC o donde sea.
    for (const h of [2, 5, 12, 18, 23]) {
      const instante = new Date(Date.UTC(2026, 8, 8, h, 30))
      expect(patronViejoEn(instante, ZONA_DEL_PROCESO)).toBe(patronViejo(instante))
    }
  })

  it('en la terminal de AMALAY el patrón viejo daba MAÑANA a la hora de la cena', () => {
    // 7 de septiembre, 20:30 en Monterrey (UTC-6) = 8 de septiembre 02:30 UTC.
    const cena = new Date(Date.UTC(2026, 8, 8, 2, 30))
    expect(soloFecha(cena)).toBe('2026-09-07')                       // en Monterrey es el 7
    expect(patronViejoEn(cena, TZ)).toBe('2026-09-08')               // pero el corte decía el 8
  })

  it('en una máquina en UTC acertaba — por eso CI no lo iba a delatar', () => {
    const cena = new Date(Date.UTC(2026, 8, 8, 2, 30))
    expect(patronViejoEn(cena, 'UTC')).toBe('2026-09-07')
  })

  it('y a mediodía acertaba también en Monterrey — por eso pasaba desapercibido', () => {
    const comida = new Date(Date.UTC(2026, 8, 7, 18, 30)) // 12:30 en Monterrey
    expect(patronViejoEn(comida, TZ)).toBe(soloFecha(comida))
  })

  it('el corte ya no usa ese patrón', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'pos', 'corte', 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/new Date\(now\.toLocaleString\('en-US'/)
    expect(src).toMatch(/useState\(\(\) => todayMX\(\)\)/)
  })

  it('ni el historial, que usaba la fecha UTC pelada', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'pos', 'historial', 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/useState\(\(\) => new Date\(\)\.toISOString\(\)/)
    expect(src).toMatch(/useState\(\(\) => todayMX\(\)\)/)
  })
})

describe('ERROR 2: la ventana del día', () => {
  it('zonedStartOfDayISO arranca a medianoche LOCAL, no UTC', () => {
    // Monterrey es UTC-6, así que el 8 a las 00:00 local son las 06:00Z.
    expect(zonedStartOfDayISO('2026-09-08', TZ)).toBe('2026-09-08T06:00:00.000Z')
  })

  it('la ventana vieja empezaba seis horas antes — el día anterior', () => {
    const vieja = new Date('2026-09-08T00:00:00Z')
    const nueva = new Date(zonedStartOfDayISO('2026-09-08', TZ))
    expect(soloFecha(vieja)).toBe('2026-09-07')   // caía en el día anterior
    expect(soloFecha(nueva)).toBe('2026-09-08')   // ahora sí, en el día pedido
    expect(nueva.getTime() - vieja.getTime()).toBe(6 * 3600 * 1000)
  })

  it('la ventana nueva cubre las 24 horas del día local', () => {
    const desde = new Date(zonedStartOfDayISO('2026-09-08', TZ))
    const hasta = new Date(zonedStartOfDayISO('2026-09-09', TZ))
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 3600 * 1000)
  })

  it('LA CENA DEL DÍA, que era lo que se perdía, ahora entra', () => {
    // Precisión que costó una prueba en rojo, y vale anotarla: con la ventana SOLA lo
    // que se pierde es la CENA del día pedido (después de las 18:00 local), no la
    // comida. La comida del día pedido sí entraba.
    //
    // Que se pierda la comida es el efecto de SUMAR los dos errores, y es el caso real
    // del gerente — está probado abajo, aparte.
    const cena = new Date(Date.UTC(2026, 8, 9, 2, 0))   // 8 sep 20:00 local
    expect(soloFecha(cena)).toBe('2026-09-08')

    const viejaDesde = new Date('2026-09-08T00:00:00Z')
    const viejaHasta = new Date('2026-09-08T23:59:59Z')
    expect(cena >= viejaDesde && cena <= viejaHasta,
      'con la ventana vieja la cena del día quedaba FUERA').toBe(false)

    const desde = new Date(zonedStartOfDayISO('2026-09-08', TZ))
    const hasta = new Date(zonedStartOfDayISO('2026-09-09', TZ))
    expect(cena >= desde && cena < hasta).toBe(true)
  })

  it('EL CASO REAL: los dos errores juntos le quitaban la comida al gerente', () => {
    // 23:30 del 7 de septiembre. El gerente acaba de hacer el Corte Z y abre el corte
    // del día para revisar. Quiere ver el 7 completo.
    const ahora = new Date(Date.UTC(2026, 8, 8, 5, 30))
    expect(soloFecha(ahora)).toBe('2026-09-07')

    // ERROR 1: la fecha por defecto le daba el 8 EN LA TERMINAL (zona Monterrey).
    const fechaVieja = patronViejoEn(ahora, TZ)
    expect(fechaVieja).toBe('2026-09-08')

    // ERROR 2: y esa fecha, sin zona, abría la ventana el 7 a las 18:00.
    const ventanaDesde = new Date(`${fechaVieja}T00:00:00Z`)

    // Una comida del 7 a las 14:00 — la que el gerente quería ver.
    const comidaDel7 = new Date(Date.UTC(2026, 8, 7, 20, 0))
    expect(soloFecha(comidaDel7)).toBe('2026-09-07')
    expect(comidaDel7 >= ventanaDesde, 'la comida del 7 quedaba fuera del corte').toBe(false)

    // Con el arreglo: la fecha es el 7 y la ventana cubre el 7 completo.
    const desde = new Date(zonedStartOfDayISO('2026-09-07', TZ))
    const hasta = new Date(zonedStartOfDayISO('2026-09-08', TZ))
    expect(comidaDel7 >= desde && comidaDel7 < hasta).toBe(true)
  })

  it('y la cena del día ANTERIOR deja de colarse', () => {
    const cenaDeAyer = new Date(Date.UTC(2026, 8, 8, 2, 0))  // 7 sep 20:00 local
    expect(soloFecha(cenaDeAyer)).toBe('2026-09-07')

    const viejaDesde = new Date('2026-09-08T00:00:00Z')
    expect(cenaDeAyer >= viejaDesde, 'con la ventana vieja SÍ se colaba').toBe(true)

    const desde = new Date(zonedStartOfDayISO('2026-09-08', TZ))
    expect(cenaDeAyer >= desde).toBe(false)
  })
})

describe('las dos consultas del corte usan la ventana buena', () => {
  const src = readFileSync(join(__dirname, '..', 'app', 'pos', 'corte', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('las órdenes', () => {
    expect(src).toMatch(/pos_orders[\s\S]{0,200}created_at=gte\.\$\{encodeURIComponent\(desde\)\}/)
  })

  it('y los movimientos de caja, que el arqueo resta del efectivo esperado', () => {
    // Se encontró en el barrido: mismo defecto dos funciones más abajo. Con la ventana
    // corrida, un retiro de la comida no contaba y uno de la cena anterior sí.
    expect(src).toMatch(/pos_cash_movements[\s\S]{0,200}created_at=gte\.\$\{encodeURIComponent\(desde\)\}/)
  })

  it('ninguna de las dos usa ya el patrón desnudo', () => {
    expect(src).not.toMatch(/created_at=gte\.\$\{dateStr\}T00:00:00/)
    expect(src).not.toMatch(/created_at=lte\.\$\{dateStr\}T23:59:59/)
  })

  it('el extremo superior es `lt`, no `lte`', () => {
    // Con `lte` sobre el inicio del día siguiente se colaría una orden creada
    // exactamente a las 00:00:00.000 del día que sigue.
    expect(src).toMatch(/created_at=lt\.\$\{encodeURIComponent\(hasta\)\}/)
    expect(src).not.toMatch(/created_at=lte\.\$\{encodeURIComponent\(hasta\)\}/)
  })
})
