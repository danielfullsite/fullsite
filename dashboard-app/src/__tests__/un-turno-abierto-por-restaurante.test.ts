import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// DOS TURNOS ABIERTOS A LA VEZ. Es lo primero que reportó Eduardo, el 2026-08-27:
// "al parecer había dos turnos activos aún, no puedo hacer corte Z, y por lo que veía se
// ponían en conflicto".
//
// LA CAUSA, rastreada el 2026-09-08: nadie serializa la apertura ENTRE terminales.
// `idParaAbrirTurno()` deduplica con localStorage, que es por terminal; el único guard
// cruzado es `getActiveTurno()`, y el propio archivo de prueba del proyecto ya documenta
// que falla cuando importa — "en una terminal lenta el fetch se pasa del límite y el cache
// puede estar vacío: el guard no ve nada y se crea otro". Y `getActiveTurno()` devuelve
// `turnos[0]`, así que ESCONDE el segundo: el Corte Z cierra uno y el otro queda abierto
// para siempre con comandas colgando.
//
// LO QUE DEMUESTRA QUE DETECTAR NO ALCANZA: la detección de turnos múltiples entró el
// 2026-08-27 a las 16:27, el mismo día del reporte, y está en la línea desplegada. Aun
// así, el 2026-08-31 AMALAY acumuló ONCE turnos abiertos en 25 minutos.
//
// EL CIERRE tiene dos piezas y esta prueba cubre la segunda:
//
//   1. un índice único en la base (migración 20260909030000): un turno abierto por
//      restaurante, y ya no depende de que ningún código se acuerde de comprobar.
//   2. `openTurno` tiene que saber DISTINGUIR ese rechazo de una falla de red. Sin esto,
//      el 409 caería en el catch que abre un turno LOCAL con otro id y lo encola — o sea
//      que cambiaríamos dos turnos por un turno fantasma que no sincroniza jamás, con las
//      comandas colgadas de él. Peor que el defecto original.
//
// Esta prueba existe porque el arreglo bueno es fácil de romper por el lado equivocado.

const raiz = join(__dirname, '..')
const sinComentarios = (r: string) =>
  readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el conflicto no se confunde con una falla de red', () => {
  const fuente = (() => {
    const src = sinComentarios('lib/pos-data.ts')
    const i = src.indexOf('export async function openTurno')
    expect(i, 'no encontré openTurno').toBeGreaterThan(-1)
    return src.slice(i, i + 5000)
  })()

  it('un 409 se trata aparte, antes del catch de red', () => {
    expect(fuente).toMatch(/res\.status === 409/)
  })

  /** Sólo el bloque del conflicto: de `res.status === 409` hasta donde ese if termina.
   *  Una ventana por caracteres se pasa al catch de red — que SÍ encola, con razón — y la
   *  prueba falla por la razón equivocada. Ya me pasó al escribirla. */
  const bloqueDelConflicto = (() => {
    const i = fuente.indexOf('res.status === 409')
    expect(i, 'no encontré la rama del conflicto').toBeGreaterThan(-1)
    const fin = fuente.indexOf("throw new Error('Caja rechazó la apertura", i)
    expect(fin, 'el bloque del conflicto debe terminar lanzando').toBeGreaterThan(i)
    return fuente.slice(i, fin)
  })()

  it('y ante el conflicto adopta el turno que ya existe', () => {
    expect(bloqueDelConflicto).toMatch(/getActiveTurno\(\)/)
    expect(bloqueDelConflicto).toMatch(/sincronizado: true/)
  })

  it('NO abre un turno local ante un conflicto', () => {
    // Es el error que convertiría el arreglo en algo peor: un id distinto del real,
    // encolado para siempre, con las comandas apuntando ahí.
    expect(bloqueDelConflicto).not.toMatch(/queueForSync\(\)/)
    expect(bloqueDelConflicto).not.toMatch(/sincronizado: false/)
  })

  it('y si el conflicto no se puede resolver, el error sube en vez de inventar un turno', () => {
    expect(fuente).toMatch(/Caja rechazó la apertura/)
    // El catch tiene que dejarlo pasar, no tragárselo.
    const i = fuente.lastIndexOf('catch (e)')
    expect(fuente.slice(i, i + 400)).toMatch(/startsWith\('Caja rechazó la apertura'\)/)
  })

  it('una falla de RED sigue abriendo turno local — el día no se detiene por el internet', () => {
    // Lo contrario también rompe el restaurante: si un timeout bloqueara la apertura, no
    // se podría abrir el turno sin WAN, que es justo lo que este POS existe para permitir.
    const i = fuente.lastIndexOf('catch (e)')
    const bloque = fuente.slice(i, i + 500)
    expect(bloque).toMatch(/queueForSync\(\)/)
    expect(bloque).toMatch(/sincronizado: false/)
  })
})

describe('la migración dice lo que tiene que decir', () => {
  const sql = readFileSync(
    join(raiz, '..', '..', 'supabase', 'migrations', '20260909030000_un_turno_abierto_por_restaurante.sql'),
    'utf8',
  )

  it('es un índice único parcial sobre los turnos sin cerrar', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX/i)
    expect(sql).toMatch(/ON public\.pos_turnos \(client_id\)/)
    expect(sql).toMatch(/WHERE closed_at IS NULL/i)
  })

  it('advierte qué hacer cuando existan sucursales', () => {
    // Con location_id, dos sucursales legítimas chocarían contra este índice.
    expect(sql).toMatch(/location_id/)
  })

  it('advierte que el código tiene que ir primero', () => {
    expect(sql).toMatch(/openTurno/)
  })
})

describe('el guard de Pedro, que hasta hoy no tenía ninguna prueba', () => {
  // La auditoría lo encontró: `TURN_ALREADY_OPEN` aparece UNA sola vez en todo el repo,
  // en operational-domain.js:107, y no lo cubría nada. Es el guard que sí serializa entre
  // terminales — pero sólo corre con autoridad de Caja, que instalar NO enciende.
  const dominio = readFileSync(
    join(raiz, '..', '..', 'electron-app', 'local-server', 'core', 'operational-domain.js'),
    'utf8',
  )

  it('existe y rechaza el segundo turno', () => {
    expect(dominio).toMatch(/TURN_ALREADY_OPEN/)
  })

  it('y su mensaje explica al operador qué hacer', () => {
    const i = dominio.indexOf('TURN_ALREADY_OPEN')
    expect(dominio.slice(i, i + 200)).toMatch(/turno|cierra|abierto/i)
  })
})
