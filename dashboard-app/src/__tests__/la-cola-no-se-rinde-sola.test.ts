import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ticksEntreReintentos, tocaReintentar } from '@/lib/pos-offline-db'

// LA RED DE SEGURIDAD SE APAGABA SOLA A LOS 100 SEGUNDOS.
//
// El intervalo de 20 s hacia:
//
//     const actionable = queue.filter(i => (i.retries ?? 0) < 5)
//     if (actionable.length === 0) return
//     await syncAll()            // <- sin retryExhausted
//
// El escenario que lo dispara es el documentado de AMALAY, y no hace falta que nadie se
// equivoque:
//
//   1. 21:10. El WAN se degrada pero la LAN sigue arriba. `navigator.onLine` se queda en
//      TRUE, y el evento 'online' NUNCA se disparara porque nunca hubo 'offline'.
//   2. Los cobros caen a la cola. Cada intento falla -> incrementRetry.
//   3. A los ~100 segundos (5 intentos x 20 s) cada item esta en retries=5.
//   4. Desde ahi el intervalo se apaga SOLO: `actionable.length === 0` -> return, cada
//      20 segundos, para siempre.
//   5. 21:35 el WAN vuelve. No pasa nada: no hay evento, no hay recarga, y la caja no
//      vuelve a teclear PIN durante el servicio.
//
// El corte de esa noche lee la nube incompleta y nadie se entera.
//
// Un fallo de RED no es terminal. El tope de 5 tiene sentido para no martillar, no para
// rendirse.

describe('el espaciado crece pero nunca se rinde', () => {
  it('al principio reintenta en cada tick — 20 segundos', () => {
    for (const r of [0, 1, 4]) expect(ticksEntreReintentos(r)).toBe(1)
  })

  it('EL PUNTO EXACTO donde antes se rendia: retries = 5', () => {
    // Antes esto era el fin. Ahora es el primer escalon.
    expect(ticksEntreReintentos(5)).toBe(3)       // 1 min
    expect(tocaReintentar(5, 3)).toBe(true)
  })

  it('sigue creciendo con el fracaso', () => {
    expect(ticksEntreReintentos(10)).toBe(15)     // 5 min
    expect(ticksEntreReintentos(19)).toBe(15)
    expect(ticksEntreReintentos(20)).toBe(45)     // 15 min
  })

  it('y se queda ahi: NO hay un caso "ya no"', () => {
    // La propiedad que importa. Con 500 fracasos sigue habiendo un reintento cada 15
    // minutos, que es lo que recupera solo cuando el WAN vuelve.
    for (const r of [50, 200, 1000, 99999]) {
      expect(ticksEntreReintentos(r), `retries=${r}`).toBe(45)
      expect(Number.isFinite(ticksEntreReintentos(r))).toBe(true)
    }
  })

  it('un item muy fracasado igual reintenta 4 veces por hora', () => {
    // 45 ticks x 20 s = 15 min. Suficiente para recuperar; poco para calentar la red.
    const ticksPorHora = 3600 / 20
    const intentos = Math.floor(ticksPorHora / ticksEntreReintentos(100))
    expect(intentos).toBe(4)
  })
})

describe('el caso de campo, tick por tick', () => {
  it('a los 100 segundos ya NO se abandona', () => {
    // tick 5 = 100 s. Con retries=5, el proximo intento cae en el tick 6 (multiplo de 3).
    const proximo = [6, 7, 8, 9].find(t => tocaReintentar(5, t))
    expect(proximo).toBe(6)
  })

  it('y cuando el WAN vuelve a los 25 minutos, hay un intento esperandolo', () => {
    // 25 min = 75 ticks. Un item castigado (retries=20, espaciado 45) reintenta en el
    // tick 90, o sea a los 30 minutos. Antes no reintentaba NUNCA.
    const dentroDeUnaHora = Array.from({ length: 180 }, (_, i) => i + 1)
      .filter(t => tocaReintentar(20, t))
    expect(dentroDeUnaHora.length).toBeGreaterThan(0)
    expect(dentroDeUnaHora[0]).toBe(45)
  })
})

describe('el intervalo usa la politica y revive a los agotados', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'pos-offline-db.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('ya no descarta por el tope de 5', () => {
    expect(src).not.toMatch(/queue\.filter\(i => \(i\.retries \?\? 0\) < 5\)/)
  })

  it('consulta a tocaReintentar', () => {
    expect(src).toMatch(/tocaReintentar\(i\.retries \?\? 0, tick\)/)
  })

  it('y pasa retryExhausted — sin eso el arreglo no serviria de nada', () => {
    // `_syncAllInner` salta los items agotados salvo que se le pida lo contrario.
    const i = src.indexOf('tocaReintentar(i.retries ?? 0, tick)')
    expect(src.slice(i, i + 500)).toMatch(/syncAll\(\{ retryExhausted: true \}\)/)
  })

  it('los terminales siguen fuera: esos si necesitan a una persona', () => {
    const i = src.indexOf('tocaReintentar(i.retries ?? 0, tick)')
    expect(src.slice(i - 400, i)).toMatch(/getPendingQueue\(true\)/)
  })
})

describe('el cierre no cuadra sobre una cola a medio subir', () => {
  const wizard = readFileSync(
    join(__dirname, '..', 'components', 'pos', 'CierreCajaWizard.tsx'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('fuerza un drenado antes de calcular el resumen', () => {
    expect(wizard).toMatch(/getSyncQueueSummary/)
    expect(wizard).toMatch(/syncAll\(\{ retryExhausted: true \}\)/)
  })

  it('avisa al gerente ANTES de que cuente el efectivo', () => {
    expect(wizard).toMatch(/colaPendiente > 0/)
    expect(wizard).toMatch(/no han subido/)
  })

  it('pero NO bloquea el cierre', () => {
    // A las 2am con la cola atorada, impedir el corte deja al restaurante sin cerrar la
    // noche. Si alguien convierte esto en un bloqueo, esta prueba se pone roja.
    const i = wizard.indexOf('colaPendiente')
    const cerca = wizard.slice(i, i + 2000)
    expect(cerca).not.toMatch(/disabled=\{[^}]*colaPendiente/)
    expect(wizard).not.toMatch(/if \(colaPendiente > 0\) return/)
  })

  it('y el numero queda EN el cierre, para explicar la diferencia mañana', () => {
    // La fila vive en lib/pos-cierre-fila.ts (2026-09-10); el wizard le pasa `colaPendiente`.
    const fila = readFileSync(join(process.cwd(), 'src/lib/pos-cierre-fila.ts'), 'utf8')
    expect(fila).toMatch(/cola_pendiente_al_cerrar: d\.colaPendiente/)
    expect(wizard).toMatch(/colaPendiente, notas: notas \|\| null, closedBy: manager/)
  })
})
