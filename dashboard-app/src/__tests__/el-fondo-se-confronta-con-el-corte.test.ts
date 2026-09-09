import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluarFondoDeApertura, UMBRAL_EXPLICACION_MXN } from '@/lib/pos-cierre-guard'

// ENTRE UN CORTE Y LA SIGUIENTE APERTURA, EL EFECTIVO NO LE RENDIA CUENTAS A NADIE.
//
// Quien abre el turno teclea el fondo de caja y el sistema lo cree. `openTurno`
// (pos-data.ts) nunca miro `pos_cierres`, y no hay ningun registro de lo que paso
// en medio. Comprobado en la base de AMALAY el 2026-09-09:
//
//   Z#3, 2026-09-03 03:27   total_contado = 0
//   turno mtljbu4i0tsm, mismo dia 13:02, fondo_inicial = 1
//
// Un peso que aparecio de la nada. Con las cifras de un restaurante de verdad, esa
// ventana es el unico tramo del dia donde se puede ir cualquier cantidad sin que
// quede rastro: el turno siguiente arranca tomando el numero tecleado como un hecho.
//
// LO QUE ESTA REGLA NO HACE: exigir que coincidan. Que NO coincidan es lo normal --
// al cerrar, el gerente se lleva la venta al banco y deja el fondo; la diferencia
// legitima es el deposito. Lo que estaba mal era que difirieran EN SILENCIO. Por eso
// se pide una explicacion, no una coincidencia.

const CIERRE = (contado: number) => ({
  determinado: true as const,
  cierre: { contado, fecha: '2026-09-08', closedBy: 'Daniel', folioZ: 4 },
})
const NOTA_VALIDA = 'deposito al banco de 2000'

describe('el fondo se compara contra lo que dejo contado el corte', () => {
  it('si coincide, se abre sin mas y se dice con cuanto se comparo', () => {
    const v = evaluarFondoDeApertura(3000, CIERRE(3000), '')
    expect(v.puedeAbrir).toBe(true)
    expect(v.exigeExplicacion).toBe(false)
    expect(v.diferencia).toBe(0)
    expect(v.aviso).toContain('3000.00')
    expect(v.aviso).toContain('Z#4')
  })

  it('una diferencia chica es redondeo y no molesta a nadie', () => {
    const v = evaluarFondoDeApertura(3000 + UMBRAL_EXPLICACION_MXN, CIERRE(3000), '')
    expect(v.puedeAbrir).toBe(true)
    expect(v.exigeExplicacion).toBe(false)
  })

  it('faltando mas del umbral, no se abre sin explicar a donde se fue', () => {
    const v = evaluarFondoDeApertura(1000, CIERRE(3000), '')
    expect(v.puedeAbrir).toBe(false)
    expect(v.exigeExplicacion).toBe(true)
    expect(v.diferencia).toBe(-2000)
    expect(v.aviso).toContain('faltan')
    expect(v.aviso).toContain('2000.00')
    expect(v.motivo).toContain('obligatoria')
  })

  it('con la explicacion escrita, se abre', () => {
    const v = evaluarFondoDeApertura(1000, CIERRE(3000), NOTA_VALIDA)
    expect(v.puedeAbrir).toBe(true)
    expect(v.exigeExplicacion).toBe(true)
    expect(v.motivo).toBeNull()
  })

  it('SOBRAR tambien se explica: dinero que aparece es tan raro como dinero que falta', () => {
    const v = evaluarFondoDeApertura(5000, CIERRE(3000), '')
    expect(v.puedeAbrir).toBe(false)
    expect(v.diferencia).toBe(2000)
    expect(v.aviso).toContain('sobran')
  })

  it('una nota de tres letras no es una explicacion', () => {
    // Misma regla que ya gobierna la escalacion del cierre: si "explicar" significa
    // algo distinto en cada puerta, no significa nada.
    const v = evaluarFondoDeApertura(1000, CIERRE(3000), 'ok')
    expect(v.puedeAbrir).toBe(false)
    expect(v.motivo).toMatch(/Mínimo 10/)
  })
})

describe('el dia nunca se traba por no haber podido comprobar', () => {
  it('sin red se abre igual, avisando que no se comparo con nada', () => {
    // Trabar el arranque del dia por un fetch fallido es el error del 2026-08-31:
    // un fallo leido como si fuera un hecho.
    const v = evaluarFondoDeApertura(1000, { determinado: false, motivo: 'sin conexión' }, '')
    expect(v.puedeAbrir).toBe(true)
    expect(v.exigeExplicacion).toBe(false)
    expect(v.diferencia).toBeNull()
    expect(v.aviso).toContain('sin conexión')
  })

  it('y un fondo enorme sin lectura tampoco se bloquea', () => {
    const v = evaluarFondoDeApertura(999999, { determinado: false, motivo: 'el servidor respondió 500' }, '')
    expect(v.puedeAbrir).toBe(true)
  })

  it('el primer turno del restaurante no tiene contra que confrontarse', () => {
    const v = evaluarFondoDeApertura(1000, { determinado: true, cierre: null }, '')
    expect(v.puedeAbrir).toBe(true)
    expect(v.aviso).toBeNull()      // no hay nada que decir, y no se inventa un aviso
    expect(v.diferencia).toBeNull()
  })
})

describe('el campo del fondo', () => {
  it('vacio no es cero: hay que contar el cajon', () => {
    const v = evaluarFondoDeApertura(null, CIERRE(0), '')
    expect(v.puedeAbrir).toBe(false)
    expect(v.motivo).toContain('escribe cuánto hay')
  })

  it('un cero ESCRITO si abre cuando el corte tambien dejo cero', () => {
    // "no conte" y "conte y no habia nada" son hechos distintos. El segundo vale.
    const v = evaluarFondoDeApertura(0, CIERRE(0), '')
    expect(v.puedeAbrir).toBe(true)
  })

  it('negativo no existe', () => {
    const v = evaluarFondoDeApertura(-100, CIERRE(0), '')
    expect(v.puedeAbrir).toBe(false)
    expect(v.motivo).toContain('negativo')
  })
})

// ── El sitio de llamada ──────────────────────────────────────────────────────

const pagina = (() => {
  const fuente = readFileSync(
    join(__dirname, '..', 'app', 'pos', 'turno', 'page.tsx'), 'utf8')
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
})()

describe('la pantalla de turno usa la politica', () => {
  it('lee el ultimo cierre del restaurante correcto', () => {
    const i = pagina.indexOf('pos_cierres?client_id=eq.')
    expect(i).toBeGreaterThan(-1)
    expect(pagina.slice(i, i + 200)).toMatch(/order=created_at\.desc&limit=1/)
    expect(pagina.slice(i, i + 250)).toMatch(/total_contado/)
  })

  it('arranca en "no se sabe", no en "no hay cierre anterior"', () => {
    // Si arrancara en `determinado: true, cierre: null`, durante el primer render
    // cualquier fondo pasaria sin confrontarse -- y ese render dura lo que tarde
    // la red, que es justo cuando alguien con prisa aprieta el boton.
    expect(pagina).toMatch(/useState<LecturaDelCierreAnterior>\(\s*\{ determinado: false/)
  })

  it('convierte total_contado a numero (PostgREST devuelve numeric como STRING)', () => {
    expect(pagina).toMatch(/contado: Number\(c\.total_contado\) \|\| 0/)
  })

  it('el boton depende del veredicto, no de que el campo tenga algo', () => {
    expect(pagina).toMatch(/disabled=\{!openedBy\.trim\(\) \|\| !veredictoDelFondo\.puedeAbrir\}/)
  })

  it('y el handler vuelve a comprobarlo: un Enter no salta la confrontacion', () => {
    expect(pagina).toMatch(/if \(!veredictoDelFondo\.puedeAbrir\)/)
  })

  it('la confrontacion queda escrita en la auditoria', () => {
    // logAudit encola en IndexedDB si falla la red, asi que el rastro sobrevive a
    // una apertura offline. Va por aqui y no por pos_turnos.notas porque en modo
    // Caja el turno lo crea Pedro con TURN_OPEN, que solo lleva opening_cash_cents.
    expect(pagina).toMatch(/contado_al_cerrar:/)
    expect(pagina).toMatch(/diferencia_contra_cierre: veredictoDelFondo\.diferencia/)
    expect(pagina).toMatch(/confrontado: cierreAnterior\.determinado/)
  })

  it('la nota se limpia al abrir, para que no se herede al turno siguiente', () => {
    expect(pagina).toMatch(/setNotaDelFondo\(''\)/)
  })
})

// ── El mismo agujero en modo Caja ────────────────────────────────────────────
//
// En `write_authority: 'caja'` la pantalla de turno NO es TurnoPageLegacy: es
// `TurnoDeCaja`, con su propio formulario y su propia llamada a `openTurno`
// (pos/turno/page.tsx:318). Arreglar solo la pantalla legada habria dejado el
// hueco abierto justo en el modo con el que va a operar AMALAY.

const cajaSrc = (() => {
  const fuente = readFileSync(
    join(__dirname, '..', 'components', 'pos', 'TurnoDeCaja.tsx'), 'utf8')
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
})()

describe('TurnoDeCaja confronta el fondo igual que la pantalla legada', () => {
  it('usa la misma politica, no una copia', () => {
    expect(cajaSrc).toMatch(/evaluarFondoDeApertura\(/)
  })

  it('saca el conteo anterior de lo que Caja ya devolvio', () => {
    // `leerTurnosCaja()` ya trae `turn_summaries`; no hace falta consulta nueva.
    expect(cajaSrc).toMatch(/contado: latest\.counted_cash_cents \/ 100/)
  })

  it('sin conexion con Caja NO dice "no hay cierre anterior"', () => {
    // Confundir "no pude ver" con "no hay" es el error del 2026-08-31.
    expect(cajaSrc).toMatch(/!connected\s*\n?\s*\? \{ determinado: false/)
  })

  it('el importe invalido llega como null, no como excepcion', () => {
    // `centavosDeTexto` lanza; la politica quiere null para "no escribio nada".
    expect(cajaSrc).toMatch(/catch \{ return null \}/)
  })

  it('la guarda solo aplica al ABRIR: cerrar no depende del veredicto', () => {
    // Con turno abierto el campo es "efectivo contado al cierre" y el veredicto no
    // significa nada. Bloquear el CIERRE con el seria un defecto nuevo.
    expect(cajaSrc).toMatch(/\(!turno && !veredictoDelFondo\.puedeAbrir\)/)
  })

  it('y la confrontacion queda escrita tambien aqui', () => {
    expect(cajaSrc).toMatch(/diferencia_contra_cierre: veredictoDelFondo\.diferencia/)
    expect(cajaSrc).toMatch(/confrontado: lecturaDelCierre\.determinado/)
  })
})
