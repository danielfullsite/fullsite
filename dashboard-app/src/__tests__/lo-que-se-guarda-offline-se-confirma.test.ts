import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// «COBRO GUARDADO LOCALMENTE» SE DECIA ANTES DE QUE SE GUARDARA.
//
// No hace falta un ladron: basta con que Chromium falle una transaccion.
//
//   1. 22:15, sin WAN. El cajero cobra $793 en efectivo. `saveOrder` ve
//      `navigator.onLine === false` y llama `queueForReplay()`.
//   2. `await queueOperation(...)`. La funcion abria la transaccion, encolaba el `put` y
//      hacia `return id` en la linea siguiente. El `await` se resuelve en el microtask
//      siguiente -- ANTES de que la transaccion commitee.
//   3. Como no lanza, el catch de `queueForReplay` --que existe justo para caer al
//      buffer de localStorage-- no se dispara nunca.
//   4. `saveOrder` devuelve OFFLINE_QUEUED. El POS abre el cajon, imprime el ticket y
//      dice «Sin conexion — cobro guardado localmente».
//
// El dinero entro al cajon y el registro no existe en ninguna parte. Ticket promedio de
// AMALAY: ~$790 por ocurrencia, sin rastro que permita descubrirlo despues.
//
// LO MAS REVELADOR: el patron correcto ya estaba en el mismo archivo. `saveIDBPrintJob`
// y `cacheTurno` esperan `tx.oncomplete`. O sea que el trabajo de IMPRESION se guardaba
// con mas cuidado que el cobro.
//
// Esta prueba no revisa cuatro funciones: BARRE EL ARCHIVO. Cualquier funcion nueva que
// escriba en IndexedDB sin esperar el commit la pone en rojo.

const fuente = readFileSync(
  join(__dirname, '..', 'lib', 'pos-offline-db.ts'), 'utf8',
)

/** Cuerpo de cada `export async function` del archivo, por nombre. */
function funcionesExportadas(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /export async function (\w+)\s*\([^)]*\)[^{]*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    // Recorre llaves hasta cerrar la función.
    let i = re.lastIndex, prof = 1
    while (i < src.length && prof > 0) {
      if (src[i] === '{') prof++
      else if (src[i] === '}') prof--
      i++
    }
    out.set(m[1], src.slice(re.lastIndex, i))
  }
  return out
}

const ESCRIBE = /\.(put|add|clear|delete)\s*\(/
const ESPERA_COMMIT = /tx\.oncomplete\s*=/

describe('toda escritura a IndexedDB espera su commit', () => {
  const funciones = funcionesExportadas(fuente)

  it('el barrido encuentra funciones que analizar', () => {
    // Si el regex deja de casar (por un refactor de estilo), esta prueba avisa en vez de
    // pasar en verde sobre cero funciones — que es como un barrido miente.
    expect(funciones.size).toBeGreaterThan(20)
  })

  /**
   * CACHÉS DE REFERENCIA — se permiten sin esperar el commit, y aquí está el porqué.
   *
   * El barrido encontró 12 funciones con el patrón, cuatro veces lo que decía el
   * reporte. Se arreglaron las que pierden algo irrecuperable:
   *
   *   queueOperation, cacheOrder, markSynced, cacheStaff   (cobro, orden, cola, acceso)
   *   cacheCashMovement                                     (dinero del arqueo)
   *   incrementRetry, clearAllPending, clearSyncedItems,
   *   clearTerminalItems, deleteCachedOrder                 (estado de la cola)
   *
   * Las de abajo cachean datos que el POS vuelve a bajar del servidor en el siguiente
   * arranque con red: si la transacción falla, se pierde una copia, no un hecho. La
   * distinción no es "importante / no importante", es SI EXISTE OTRA FUENTE.
   *
   * Si alguna de éstas pasa a guardar algo que sólo vive aquí, sale de la lista.
   */
  const CACHES_DE_REFERENCIA = new Set([
    'cacheMenu', 'cacheInventory', 'cacheModifierData', 'cachePaymentMethods',
    'resetOfflineReferenceCaches', 'clearIDBPrintedJobs',
  ])

  it('NINGUNA función que guarde algo irrecuperable resuelve antes del commit', () => {
    const sinEsperar: string[] = []
    for (const [nombre, cuerpo] of funciones) {
      if (CACHES_DE_REFERENCIA.has(nombre)) continue
      const codigo = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (!ESCRIBE.test(codigo)) continue          // sólo lee: no aplica
      if (!/\.transaction\(/.test(codigo)) continue // no abre transacción propia
      if (!ESPERA_COMMIT.test(codigo)) sinEsperar.push(nombre)
    }
    expect(sinEsperar, `escriben sin esperar el commit: ${sinEsperar.join(', ')}`).toEqual([])
  })

  it('la lista de excepciones no crece sola', () => {
    // Sin esto, la forma fácil de pasar la prueba anterior sería agregar el nombre a la
    // lista. Que sea un cambio visible y deliberado.
    expect(CACHES_DE_REFERENCIA.size).toBe(6)
  })

  it('y toda excepción existe de verdad en el archivo', () => {
    // Un nombre mal escrito en la lista silenciaría una función real sin que se note.
    for (const n of CACHES_DE_REFERENCIA) expect(funciones.has(n), `${n} no existe`).toBe(true)
  })

  it('las que estaban rotas ahora esperan', () => {
    for (const nombre of [
      'queueOperation', 'cacheOrder', 'markSynced', 'cacheStaff',
      'cacheCashMovement', 'incrementRetry', 'deleteCachedOrder',
      'clearAllPending', 'clearSyncedItems', 'clearTerminalItems',
    ]) {
      const cuerpo = funciones.get(nombre)
      expect(cuerpo, `no encontré ${nombre}`).toBeTruthy()
      expect(ESPERA_COMMIT.test(cuerpo!), `${nombre} no espera el commit`).toBe(true)
    }
  })

  it('y también propagan el error, que es lo que hace que el catch sirva', () => {
    // Sin `onerror`/`onabort` la promesa se quedaría colgada para siempre: peor que
    // resolver de más, porque el cobro ni siquiera terminaría.
    for (const nombre of ['queueOperation', 'cacheOrder', 'markSynced', 'cacheStaff']) {
      const cuerpo = funciones.get(nombre)!
      expect(cuerpo, `${nombre} sin onerror`).toMatch(/tx\.onerror\s*=/)
      expect(cuerpo, `${nombre} sin onabort`).toMatch(/tx\.onabort\s*=/)
    }
  })

  it('las que ya estaban bien siguen bien', () => {
    for (const nombre of ['saveIDBPrintJob', 'cacheTurno']) {
      expect(ESPERA_COMMIT.test(funciones.get(nombre)!), nombre).toBe(true)
    }
  })
})

describe('el camino del cobro conserva su red de seguridad', () => {
  const posData = readFileSync(join(__dirname, '..', 'lib', 'pos-data.ts'), 'utf8')

  it('queueForReplay sigue teniendo el catch que cae a localStorage', () => {
    // Es el que ahora SÍ se va a disparar. Sin él, hacer que queueOperation rechace
    // convertiría una pérdida silenciosa en una excepción — igual de perdida.
    const i = posData.indexOf('const queueForReplay = async () => {')
    expect(i).toBeGreaterThan(-1)
    const cuerpo = posData.slice(i, i + 1800)
    expect(cuerpo).toMatch(/await queueOperation\(/)
    expect(cuerpo).toMatch(/catch \{/)
    expect(cuerpo).toMatch(/fullsite_offline_queue/)
  })

  it('y el drenado tolera que una marca falle, sin abortar la cola', () => {
    // `markSynced` ahora puede rechazar. El bucle tiene catch POR ITEM con
    // incrementRetry, así que un fallo reintenta ese item en vez de tumbar el drenado
    // completo — que es lo que pasaba con el `break` del 403 antes de arreglarlo.
    const db = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Hay DOS bucles `for (const item of queue)`: el que cuenta el resumen y el que
    // drena. El que importa es el que llama a `markSynced`.
    const bucles = [...db.matchAll(/for \(const item of queue\) \{/g)].map(m => m.index!)
    // La ventana se mide hasta el siguiente bucle o el fin del archivo, no con un
    // número fijo: un número fijo se queda corto en cuanto alguien agrega líneas.
    const drenado = bucles
      .map((i, n) => db.slice(i, bucles[n + 1] ?? db.length))
      .find(b => b.includes('markSynced('))
    expect(drenado, 'no encontré el bucle de drenado').toBeTruthy()
    // 700 y no 400: desde 2026-09-10 antes del try hay guardas de `continue` (orden
    // detenida, item terminal, reintentos agotados) que no lanzan; el try sigue
    // envolviendo todo lo que si puede fallar.
    expect(drenado!, 'el drenado debe envolver cada item en try').toMatch(/^for \(const item of queue\) \{[\s\S]{0,700}try \{/)
    expect(drenado!).toMatch(/catch \(error\) \{[\s\S]{0,200}incrementRetry/)
  })
})
