// EL CATÁLOGO DE LEYES NO SE PUEDE PODRIR EN SILENCIO.
//
// `docs/pos/LEYES-DEL-SISTEMA.md` afirma cosas sobre el dinero y sobre el turno,
// y cada afirmación viene con su `archivo:línea`. Esa cita es lo único que
// separa una ley de un recuerdo.
//
// Pero el código se mueve todos los días y los documentos no. Medido el
// 2026-09-14: de 330 documentos en `docs/`, CERO se habían tocado en la última
// semana y el 90% llevaba entre uno y tres meses sin cambios. En esa misma
// sesión, `TEST-MATRIX.md` afirmaba «Impl ✓» de código que no estaba montado, y
// al escribir este catálogo una de doce citas ya apuntaba tres líneas de más.
//
// Este guardián lee las citas del documento y comprueba que sigan apuntando al
// símbolo que dicen. No juzga si la ley es correcta —eso lo hace una persona—:
// impide que el catálogo AFIRME sobre un archivo que ya no dice eso.
//
// Tolera un desfase de ±3 líneas a propósito. Exigir la línea exacta volvería el
// guardián insoportable —cualquier import nuevo lo pone rojo— y un guardián que
// molesta se termina borrando. Lo que caza es el símbolo que se movió de verdad,
// se renombró o desapareció.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RAIZ = resolve(__dirname, '..', '..', '..')
const CATALOGO = join(RAIZ, 'docs', 'pos', 'LEYES-DEL-SISTEMA.md')

/**
 * Las citas del catálogo, con el símbolo que cada una promete encontrar.
 *
 * Se declaran aquí y no se extraen del texto a propósito: del markdown se puede
 * sacar «archivo:línea», pero no QUÉ debería decir esa línea. Sin el símbolo
 * esperado, el guardián sólo comprobaría que el archivo existe — que es
 * exactamente el tipo de comprobación vacía que deja pasar un documento podrido.
 */
const CITAS: Array<[ruta: string, linea: number, simbolo: string]> = [
  ['dashboard-app/src/lib/pos-arqueo.ts', 38, 'calcEfectivoEsperado'],
  ['dashboard-app/src/lib/pos-arqueo.ts', 158, 'computeOrderSummary'],
  ['dashboard-app/src/lib/client-config.ts', 142, 'iva_rate'],
  ['dashboard-app/src/lib/pos-config.ts', 13, 'ivaRate'],
  ['dashboard-app/src/lib/pos-cierre-guard.ts', 4, 'OPEN_ORDER_STATUSES'],
  ['dashboard-app/src/lib/pos-cierre-guard.ts', 125, 'evaluarAperturaDeTurno'],
  ['dashboard-app/src/lib/pos-offline-db.ts', 1035, 'esMutacionSinFiltro'],
  ['dashboard-app/src/lib/pos-offline-db.ts', 585, 'error_class'],
  ['dashboard-app/src/lib/pedro-cliente.ts', 56, 'autoritativa'],
  ['dashboard-app/src/lib/pedro-cliente.ts', 57, 'completa'],
  ['dashboard-app/src/lib/supabase-fetch-patch.ts', 52, 'rest/v1/'],
  ['dashboard-app/src/lib/pos-db-policy.ts', 22, 'ALLOW'],
]

const TOLERANCIA = 3

describe('el catálogo de leyes sigue citando código vivo', () => {
  it('el catálogo existe y no está vacío', () => {
    // Prueba de vida: si alguien mueve o vacía el documento, el resto de este
    // archivo pasaría en verde sin comprobar nada.
    expect(existsSync(CATALOGO), `no encuentro ${CATALOGO}`).toBe(true)
    expect(readFileSync(CATALOGO, 'utf8').length).toBeGreaterThan(3000)
  })

  it('cada cita apunta a un archivo que existe', () => {
    const perdidos = CITAS.filter(([r]) => !existsSync(join(RAIZ, r))).map(([r]) => r)
    expect(perdidos, `el catálogo cita archivos que ya no existen:\n  ${perdidos.join('\n  ')}`).toEqual([])
  })

  it('REGRESION: cada cita sigue encontrando su símbolo cerca de la línea', () => {
    const rotas: string[] = []
    for (const [ruta, linea, simbolo] of CITAS) {
      const p = join(RAIZ, ruta)
      if (!existsSync(p)) continue
      const lineas = readFileSync(p, 'utf8').split('\n')
      const desde = Math.max(0, linea - 1 - TOLERANCIA)
      const hasta = Math.min(lineas.length, linea + TOLERANCIA)
      const cerca = lineas.slice(desde, hasta).some(l => l.includes(simbolo))
      if (!cerca) {
        const dondeEsta = lineas.findIndex(l => l.includes(simbolo))
        rotas.push(dondeEsta >= 0
          ? `${ruta}:${linea} dice «${simbolo}» pero ahora está en la línea ${dondeEsta + 1}`
          : `${ruta}:${linea} dice «${simbolo}» y ya no aparece en el archivo`)
      }
    }
    expect(rotas, `\nEl catálogo afirma sobre código que se movió:\n  ${rotas.join('\n  ')}\n` +
      `\nActualiza docs/pos/LEYES-DEL-SISTEMA.md y esta lista. Una ley sin cita correcta\n` +
      `no es una ley: es un recuerdo.\n`).toEqual([])
  })

  it('toda ley declara su estado de verificación', () => {
    // VERIFICADA / DERIVADA / PENDIENTE no son adornos: separan lo comprobado de
    // lo que alguien cree. Una ley sin estado se lee como un hecho.
    const texto = readFileSync(CATALOGO, 'utf8')
    const leyes = texto.match(/^### L-\d+ · .+$/gm) || []
    expect(leyes.length, 'el catálogo no tiene leyes numeradas').toBeGreaterThan(8)
    const sinEstado = leyes.filter(l => !/`(VERIFICADA|DERIVADA|PENDIENTE|VIOLADA[^`]*|VIVA[^`]*|ARREGLADA[^`]*|PARCIALMENTE[^`]*)`/.test(l))
    expect(sinEstado, `estas leyes no dicen si están verificadas:\n  ${sinEstado.join('\n  ')}`).toEqual([])
  })
})
