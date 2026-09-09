import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fmtDateEnZona, hoyEnZona, sumarDias } from '@/lib/date-mx'

// TRES RUTAS DE IA Y UNA PANTALLA CLAVABAN EL HUSO DE MONTERREY.
//
// El patron, identico en `chat`, `coach` y `voice`:
//
//     const mxOffset = -6 * 60 * 60 * 1000
//     const mxNow = new Date(now.getTime() + mxOffset + now.getTimezoneOffset() * 60 * 1000)
//
// Dos cosas mal a la vez:
//
//   1. El -6 vale SOLO para el centro de Mexico. `clients.timezone` existe --hay
//      tenants con 'America/Tijuana'-- y la app lo respeta desde el PR #335 con
//      `getActiveTimezone()`. Pero esa funcion lee `localStorage`, asi que en una ruta
//      API SIEMPRE devuelve el default: el encabezado de `date-mx.ts` lo decia como
//      follow-up pendiente. Tijuana es -7/-8 y ademas conserva horario de verano para
//      alinearse con California. Entre las 22:00 y la medianoche, preguntarle al chat
//      "como nos fue hoy" le contestaba con MANANA.
//
//   2. `now.getTimezoneOffset()` es la zona DEL PROCESO, no la del negocio. Hoy Vercel
//      corre en UTC y da 0, asi que la cuenta salia bien de casualidad. En cualquier
//      maquina que no fuera UTC quedaba corrida -- que es exactamente lo que hizo
//      fallar en CI a la prueba del corte del dia esta misma manana.
//
// Y en `MeseroLeaderboard` estaban los DOS errores del corte juntos otra vez: la fecha
// salia del idioma roto y se pegaba a `T00:00:00` sin zona. La tabla arrancaba a las
// 18:00 de ayer y se cortaba a las 18:00 de hoy: un mesero de la comida no aparecia y
// la cena de ayer se le sumaba a alguien mas. Es la pantalla con la que se decide a
// quien felicitar.

const limpiar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const leer = (...partes: string[]) =>
  limpiar(readFileSync(join(__dirname, '..', ...partes), 'utf8'))

// ── Las funciones nuevas, probadas de verdad ────────────────────────────────

describe('fmtDateEnZona / hoyEnZona: no leen localStorage', () => {
  it('el mismo instante da fechas distintas en zonas distintas', () => {
    // 2026-09-08 05:30 UTC = el 7 a las 23:30 en Monterrey, y ya el 8 en Madrid.
    const instante = new Date(Date.UTC(2026, 8, 8, 5, 30))
    expect(fmtDateEnZona(instante, 'America/Monterrey')).toBe('2026-09-07')
    expect(fmtDateEnZona(instante, 'Europe/Madrid')).toBe('2026-09-08')
  })

  it('Tijuana y Monterrey no son la misma fecha a la hora de la cena', () => {
    // 2026-09-08 06:30 UTC = 00:30 en Monterrey (-6) y 23:30 del 7 en Tijuana (-7).
    // Es el caso que el -6 clavado se comia.
    const instante = new Date(Date.UTC(2026, 8, 8, 6, 30))
    expect(fmtDateEnZona(instante, 'America/Monterrey')).toBe('2026-09-08')
    expect(fmtDateEnZona(instante, 'America/Tijuana')).toBe('2026-09-07')
  })

  it('hoyEnZona devuelve YYYY-MM-DD', () => {
    expect(hoyEnZona('America/Monterrey')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('sumarDias opera sobre el calendario, no sobre milisegundos', () => {
  it('ayer es el dia anterior', () => {
    expect(sumarDias('2026-09-08', -1, 'America/Monterrey')).toBe('2026-09-07')
  })

  it('cruza el cambio de mes', () => {
    expect(sumarDias('2026-09-01', -1, 'America/Monterrey')).toBe('2026-08-31')
  })

  it('cruza el cambio de ano', () => {
    expect(sumarDias('2026-01-01', -1, 'America/Monterrey')).toBe('2025-12-31')
  })

  it('respeta los anos bisiestos', () => {
    expect(sumarDias('2028-03-01', -1, 'America/Monterrey')).toBe('2028-02-29')
  })

  it('una semana atras son siete dias de calendario', () => {
    expect(sumarDias('2026-09-08', -7, 'America/Monterrey')).toBe('2026-09-01')
  })

  it('sobrevive al cambio de horario de Tijuana', () => {
    // Tijuana conserva el horario de verano (se alinea con California). El domingo del
    // cambio dura 23 o 25 horas: restar 86,400,000 ms cae en el dia equivocado. Aqui se
    // opera sobre los numeros de calendario, asi que no.
    expect(sumarDias('2026-11-02', -1, 'America/Tijuana')).toBe('2026-11-01')
    expect(sumarDias('2026-03-09', -1, 'America/Tijuana')).toBe('2026-03-08')
  })

  it('tambien suma hacia adelante', () => {
    expect(sumarDias('2026-09-08', 1, 'America/Monterrey')).toBe('2026-09-09')
  })
})

// ── Los sitios de llamada ───────────────────────────────────────────────────

const RUTAS = [
  ['chat', ['app', 'api', 'chat', 'route.ts']],
  ['voice', ['app', 'api', 'voice', 'route.ts']],
] as const

describe.each(RUTAS)('/api/%s toma la zona del tenant', (_n, partes) => {
  const src = leer(...partes)

  it('ya no clava el desfase de Mexico centro', () => {
    expect(src).not.toMatch(/mxOffset = -6 \* 60 \* 60 \* 1000/)
    expect(src).not.toMatch(/getTimezoneOffset\(\) \* 60 \* 1000/)
  })

  it('lee clientConfig.timezone con respaldo', () => {
    expect(src).toMatch(/timezone \|\| 'America\/Mexico_City'/)
  })

  it('la fecha de hoy sale de la zona', () => {
    expect(src).toMatch(/hoyEnZona\(zona\)/)
  })

  it('ayer y la semana pasan por sumarDias', () => {
    expect(src).toMatch(/sumarDias\(todayStr, -1, zona\)/)
    expect(src).toMatch(/sumarDias\(todayStr, -7, zona\)/)
  })

  it('el prefijo del mes sale de la fecha ya formateada, no de un toISOString', () => {
    expect(src).toMatch(/todayStr\.slice\(0, 7\)/)
    expect(src).not.toMatch(/mxNowChat|mxNowV/)
  })
})

describe('/api/coach dice el dia correcto', () => {
  const src = leer('app', 'api', 'coach', 'route.ts')

  it('el dia de la semana sale de la zona del tenant', () => {
    expect(src).toMatch(/new Intl\.DateTimeFormat\('es-MX', \{ timeZone: zona, weekday: 'long' \}\)/)
  })

  it('y ya no de un instante corrido a mano', () => {
    expect(src).not.toMatch(/mxOffset = -6 \* 60 \* 60 \* 1000/)
    expect(src).not.toMatch(/dayNames\[mxNow\.getDay\(\)\]/)
  })

  it('pero `dayNames` se conserva para el indice que SI era correcto', () => {
    // `todayDOW` sale de la fecha del DATO (`fecha + 'T12:00:00'`, mediodia, lejos de
    // cualquier frontera), no del reloj. Ese uso nunca estuvo mal.
    expect(src).toMatch(/dayNames\[todayDOW\]/)
    expect(src).toMatch(/const todayDate = new Date\(today\.fecha \+ 'T12:00:00'\)/)
  })
})

describe('el leaderboard de meseros cubre el dia de venta', () => {
  const src = leer('components', 'pos', 'MeseroLeaderboard.tsx')

  it('la fecha sale de todayMX, no del idioma roto', () => {
    expect(src).toMatch(/const todayStr = todayMX\(\)/)
    expect(src).not.toMatch(/new Date\(today\.toLocaleString/)
  })

  it('y la ventana abre con la zona, no a medianoche UTC', () => {
    expect(src).toMatch(/const desde = zonedStartOfDayISO\(todayStr\)/)
    expect(src).not.toMatch(/\$\{todayStr\}T00:00:00/)
  })

  it('las DOS consultas usan la misma ventana', () => {
    // Ordenes y asistencia: si una arranca a las 18:00 de ayer y la otra no, el
    // ranking mezcla horas de dos dias.
    expect((src.match(/encodeURIComponent\(desde\)/g) || []).length).toBe(2)
  })
})

describe('lo que se midio y NO se cambio', () => {
  it('pos-daily conserva MX_OFFSET_MS en dos sitios, los dos deliberados', () => {
    // Al escribir esta prueba supuse que quedaba UN uso y son DOS. La prueba lo
    // atrapo, que es para lo que sirven; queda con los numeros reales.
    //
    //   1. `sinceDate`: limite INFERIOR de un `created_at=gte`, ademas con `days + 1`.
    //      Estar corrido unas horas ahi solo trae filas de mas, nunca de menos.
    //   2. El RESPALDO del dia de venta, para filas anteriores al backfill de
    //      `dia_venta`. El comentario del archivo lo justifica: "es lo que habia; no se
    //      inventa un dato que no existe". El camino vivo lee `dia_venta`, que la base
    //      calcula por tenant con SU zona y SU corte de las 05:00.
    //
    // Medido en produccion el 2026-09-09: AMALAY tiene 36 ordenes y CERO sin
    // `dia_venta`, asi que el respaldo no se ejecuta para este tenant. Cambiarlo seria
    // reescribir un camino muerto y arriesgar el vivo.
    const src = leer('lib', 'pos-daily.ts')
    expect(src).toMatch(/const sinceDate = new Date\(Date\.now\(\) - \(days \+ 1\) \* 86400000 - MX_OFFSET_MS\)/)
    expect(src).toMatch(/typeof o\.dia_venta === 'string' && o\.dia_venta/)
    expect((src.match(/MX_OFFSET_MS/g) || []).length).toBe(3)   // la constante y sus dos usos
  })

  it('nowMX sigue existiendo, con la advertencia de que su instante no es real', () => {
    // Sus llamadores (`gastos`, `ventas`) solo leen componentes LOCALES, para lo que es
    // correcta. Cambiarla romperia dos pantallas para arreglar algo que ahi no falla.
    const src = readFileSync(join(__dirname, '..', 'lib', 'date-mx.ts'), 'utf8')
    expect(src).toMatch(/EL INSTANTE DE ESTA FECHA NO ES EL REAL/)
    expect(src).toMatch(/Nunca uses esta fecha para/)
  })
})
