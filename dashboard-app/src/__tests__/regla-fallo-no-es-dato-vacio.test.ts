// Un fallo NO es un dato vacío. Regla del repo, con trinquete.
//
// ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
//
// El 2026-08-31 y el 2026-09-01 se encontraron siete bugs en producción. No eran
// siete bugs distintos: era **el mismo bug escrito siete veces**.
//
//   400 columna inexistente  -> leído como "no hay turno"        (el POS no envió
//                                                                 ninguna comanda)
//   401 sesión vencida       -> leído como "sin conexión"        (Corte Z fantasma)
//   401 en el plano          -> leído como "no hay mesas"        (todas libres, y
//                                                                 borró el caché)
//   500 al leer mesa destino -> leído como "no tiene cuenta"     (cuenta partida
//                                                                 en dos)
//   lectura fallida          -> leído como "no hubo ventas"      (la IA lo afirmaba)
//   `state` no exportado     -> leído como "no se pudo saber"    (nunca instalaba)
//
// Todos tienen la misma forma:
//
//   const datos = res.ok ? await res.json() : []
//
// Ante un fallo se fabrica un dato vacío, y el código de abajo no puede distinguir
// "no hay nada" de "no pude saber". Toma una decisión operativa sobre una mentira.
//
// ── POR QUÉ UNA REGLA Y NO MÁS ARREGLOS ──────────────────────────────────────
//
// Se arreglaron tres a mano. Quedan 22 sólo en rutas críticas, y cada semana se
// escriben más. Encontrarlas una por una depende de que alguien se tope con ellas —
// que es exactamente el problema que el producto tiene con los restaurantes: no
// escala, y depende de que una persona esté mirando.
//
// Esta regla convierte "Claude se topó con una" en "CI la encuentra sola".
//
// ── EL TRINQUETE ─────────────────────────────────────────────────────────────
//
// NO exige arreglar las 22 hoy. Exige que no aparezca la 23.
//
//   - Aparece una nueva  -> falla. Hay que arreglarla o justificarla.
//   - Se arregla una     -> falla, hasta que se baje el número aquí.
//
// Lo segundo es a propósito: el inventario sólo puede ENCOGER. Si se pudiera dejar
// inflado, en un año nadie sabría cuáles siguen vivas.
//
// ── LO QUE NO SE MARCA, Y POR QUÉ ────────────────────────────────────────────
//
// `res.ok ? await res.json() : { ok: false }` es CORRECTO y no se marca: no fabrica
// un dato vacío, propaga el fallo. La diferencia es justamente la que importa.
//
// Tampoco se revisa fuera de las rutas críticas. En una lista de administración, un
// arreglo vacío muestra menos y ya. Marcar las ~66 restantes haría ruido, alguien
// apagaría la regla, y volveríamos a cero — peor que no tenerla, porque daría falsa
// tranquilidad.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Donde una lista vacía puede convertirse en una decisión operativa equivocada. */
const RUTAS_CRITICAS = [
  'src/app/api/pos/',
  'src/lib/pos-',
  'src/app/pos/',
  'src/components/pos/',
]

/**
 * Sólo el dato FALSAMENTE VACÍO. `{ ok: false }` propaga el fallo: es lo correcto.
 * El `[,;)\n]` final evita casar dentro de expresiones más largas.
 */
// El ancla final acepta FIN DE LÍNEA. La primera versión exigía `[,;)\n]`, y como
// el escaneo va línea por línea el `\n` ya no está: se perdía todo `: []` al final
// de la línea — que es la forma más común. La prueba del inventario lo delató.
const FORMA_PELIGROSA = /(\w+)\.ok\s*\?[^\n]{0,160}?:\s*(\[\s*\]|null|\{\s*\}|\b0\b|false)\s*(?:[,;)]|$)/

/**
 * Inventario del 2026-09-01. Cada número es deuda conocida, no permiso.
 *
 * PARA BAJARLO: arregla la instancia (clasifica el fallo — ver `clasificar-fallo.ts`)
 * y resta uno aquí. Si arreglas y no restas, esta prueba falla — a propósito.
 *
 * PARA SUBIRLO: no. Si necesitas subirlo, estás escribiendo el bug otra vez.
 */
const INVENTARIO: Record<string, number> = {
  'src/app/pos/layout.tsx': 1,
  'src/app/pos/monitor/page.tsx': 1,
  'src/app/pos/staff-analytics/page.tsx': 1,
  'src/app/pos/plano/page.tsx': 1,
  'src/app/pos/recepcion-factura/page.tsx': 1,
  'src/app/pos/huella/page.tsx': 2,
  'src/app/pos/food-cost/page.tsx': 1,
  'src/app/pos/mesas/page.tsx': 3,
  'src/app/api/pos/recipe-sync/route.ts': 3,
  'src/app/api/pos/pin/route.ts': 1,
  'src/app/api/pos/time-clock/route.ts': 4,
  'src/components/pos/InventoryAlerts.tsx': 3,
}

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === '__tests__' || n === 'node_modules') continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(n)) acc.push(p)
  }
  return acc
}

/** Cuenta la forma peligrosa por archivo, ignorando comentarios. */
function contarPorArchivo(): Record<string, number> {
  const cuenta: Record<string, number> = {}
  for (const abs of archivos(join(process.cwd(), 'src'))) {
    const rel = abs.replace(process.cwd() + '/', '')
    if (!RUTAS_CRITICAS.some(c => rel.startsWith(c))) continue
    let n = 0
    for (const linea of readFileSync(abs, 'utf8').split('\n')) {
      const t = linea.trim()
      if (t.startsWith('//') || t.startsWith('*')) continue
      if (FORMA_PELIGROSA.test(linea)) n++
    }
    if (n > 0) cuenta[rel] = n
  }
  return cuenta
}

describe('Un fallo no se convierte en dato vacío (rutas críticas)', () => {
  const actual = contarPorArchivo()

  it('NO aparece ninguna instancia nueva', () => {
    const nuevas: string[] = []
    for (const [archivo, n] of Object.entries(actual)) {
      const conocidas = INVENTARIO[archivo] ?? 0
      if (n > conocidas) {
        nuevas.push(`${archivo}: ${n} (el inventario dice ${conocidas})`)
      }
    }
    expect(
      nuevas,
      'Un fallo NO es un dato vacío.\n\n' +
      `res.ok ? await res.json() : []  <- ante un 401 esto dice "no hay nada"\n\n` +
      'Clasifica el fallo con `clasificar-fallo.ts`: "no se pudo alcanzar el servidor"\n' +
      'vale caché; "el servidor rechazó la petición" sube como error. Si de verdad\n' +
      'necesitas propagar el fallo, `: { ok: false }` es correcto y no se marca.\n\n' +
      `Nuevas:\n${nuevas.join('\n')}`,
    ).toEqual([])
  })

  it('el inventario sólo ENCOGE: si arreglaste una, bájalo aquí', () => {
    // Sin esto el inventario quedaría inflado para siempre y en un año nadie sabría
    // cuáles siguen vivas. Que haya que tocarlo a mano es el punto.
    const sobrantes: string[] = []
    for (const [archivo, conocidas] of Object.entries(INVENTARIO)) {
      const n = actual[archivo] ?? 0
      if (n < conocidas) sobrantes.push(`${archivo}: quedan ${n}, el inventario dice ${conocidas}`)
    }
    expect(
      sobrantes,
      `Arreglaste instancias — gracias. Baja el número en INVENTARIO:\n${sobrantes.join('\n')}`,
    ).toEqual([])
  })

  it('el total conocido no crece', () => {
    const total = Object.values(actual).reduce((a, b) => a + b, 0)
    const inventariado = Object.values(INVENTARIO).reduce((a, b) => a + b, 0)
    expect(total, `deuda viva: ${total} · inventariada: ${inventariado}`).toBeLessThanOrEqual(inventariado)
  })
})

describe('El detector detecta de verdad', () => {
  // Sin esto, la prueba de arriba podría estar en verde por no encontrar NADA.
  // Ya pasó hoy: un barrido pasaba 9/9 con el bug puesto porque buscaba el texto de
  // una función en vez de su llamada.
  const marca = (linea: string) => FORMA_PELIGROSA.test(linea)

  it('atrapa las formas que causaron los bugs reales', () => {
    expect(marca('  const rows = res.ok ? await res.json() : []'), 'lista vacía').toBe(true)
    expect(marca('  const t = r.ok ? r.json() : null'), 'null').toBe(true)
    expect(marca('  const c = res.ok ? await res.json() : {},'), 'objeto vacío').toBe(true)
    expect(marca('  const n = res.ok ? await res.json() : 0;'), 'cero').toBe(true)
  })

  it('NO marca la forma correcta — propagar el fallo', () => {
    expect(marca('  const r = res.ok ? await res.json() : { ok: false }'), '{ ok: false }').toBe(false)
    expect(marca('  const r = res.ok ? await res.json() : { error: "falló" }')).toBe(false)
  })

  it('NO marca código que ya clasifica el fallo', () => {
    expect(marca('  if (!res.ok) throw new ErrorDeContrato(res.status)')).toBe(false)
    expect(marca('  const lectura = evaluarRespuestaDeMesas(res)')).toBe(false)
  })

  it('el inventario apunta a archivos que existen', () => {
    // Un inventario con rutas muertas se ve lleno y no protege nada.
    for (const archivo of Object.keys(INVENTARIO)) {
      expect(() => statSync(join(process.cwd(), archivo)), `${archivo} no existe`).not.toThrow()
    }
  })
})
