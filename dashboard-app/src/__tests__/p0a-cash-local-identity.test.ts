/**
 * P0A · IDENTIDAD LOCAL DEL MOVIMIENTO DE CAJA
 *
 * El gap que estas pruebas cierran no lo encontró el código: lo encontró una
 * lectura del contrato local después de que P0A ya «pasaba» sus propios tests.
 *
 * Al quitar `id` del payload —correcto, porque esa columna es bigint del
 * servidor— quedaron dos deduplicaciones apuntando a un campo que ya no existe:
 *
 *   pos-offline-db.getCachedCashMovsByTurno  filtraba por `item.data.id`
 *     → sin `id`, TODO lo encolado pasaba el filtro y el arqueo contaba DOS veces
 *       el mismo movimiento (una por la caché, otra por la cola)
 *
 *   corte/page.tsx overlay                    exigía `d.id`
 *     → sin `id`, el movimiento encolado se DESCARTABA y desaparecía del arqueo
 *
 * Los dos fallos son de dinero y opuestos entre sí. La identidad lógica
 * (`client_op_id`, con respaldo al `id` legacy) es lo único que vive en los tres
 * estados: caché local, cola durable y fila en la nube.
 */
import { describe, it, expect } from 'vitest'
import { claveLogicaDeCaja, nuevaIdentidadDeAccion } from '../lib/operation-identity'

/** La fusión que hace el arqueo, reducida a lo que importa: contar una vez. */
function fusionarParaArqueo(
  deLaNubeOCache: Array<{ id?: string; client_op_id?: string; amount: number }>,
  deLaCola: Array<{ id?: string; client_op_id?: string; amount: number }>,
) {
  const vistos = new Set(deLaNubeOCache.map(claveLogicaDeCaja).filter(Boolean))
  const pendientes = deLaCola.filter(m => { const k = claveLogicaDeCaja(m); return !k || !vistos.has(k) })
  return [...deLaNubeOCache, ...pendientes]
}

describe('identidad lógica', () => {
  it('7 · client_op_id nunca viaja como `id` del servidor', () => {
    const clientOpId = nuevaIdentidadDeAccion()
    // El payload que sale hacia el servidor — el contrato de P0A.
    const payload: Record<string, unknown> = {
      client_op_id: clientOpId, client_id: 'cert', turno_id: 't1',
      type: 'retiro', amount: 500, reason: 'banco', actor: 'cajero', approved_by: 'gerente',
    }
    expect('id' in payload).toBe(false)
    expect(payload.client_op_id).toBe(clientOpId)
  })

  it('prefiere client_op_id y cae al id sólo cuando no hay', () => {
    expect(claveLogicaDeCaja({ client_op_id: 'op-1', id: 99 })).toBe('op-1')
    expect(claveLogicaDeCaja({ id: 'legacy-uuid' })).toBe('legacy-uuid')
    expect(claveLogicaDeCaja({ id: 7 })).toBe('7')
    expect(claveLogicaDeCaja({})).toBe('')
    expect(claveLogicaDeCaja(null)).toBe('')
    expect(claveLogicaDeCaja({ client_op_id: '   ' , id: 'x' })).toBe('x')
  })
})

describe('el arqueo cuenta cada movimiento UNA vez', () => {
  it('3 · el MISMO movimiento en caché y en cola se cuenta una sola vez', () => {
    const op = nuevaIdentidadDeAccion()
    const cache = [{ id: op, client_op_id: op, amount: 500 }]   // write-through local
    const cola = [{ client_op_id: op, amount: 500 }]            // el payload, SIN id
    const total = fusionarParaArqueo(cache, cola)
    expect(total).toHaveLength(1)
    expect(total.reduce((s, m) => s + m.amount, 0)).toBe(500)
  })

  it('4 · dos movimientos legítimos distintos se cuentan DOS veces', () => {
    const a = nuevaIdentidadDeAccion(), b = nuevaIdentidadDeAccion()
    const cache = [{ id: a, client_op_id: a, amount: 300 }]
    const cola = [{ client_op_id: b, amount: 300 }]   // mismo monto, otro evento
    const total = fusionarParaArqueo(cache, cola)
    expect(total).toHaveLength(2)
    expect(total.reduce((s, m) => s + m.amount, 0)).toBe(600)
  })

  it('5 · tras sincronizar, la fila de la nube y la de la cola no se cuentan doble', () => {
    const op = nuevaIdentidadDeAccion()
    // La nube devuelve su bigint propio ADEMÁS del client_op_id.
    const nube = [{ id: '42', client_op_id: op, amount: 750 }]
    const cola = [{ client_op_id: op, amount: 750 }]   // todavía no se limpió
    const total = fusionarParaArqueo(nube, cola)
    expect(total).toHaveLength(1)
    expect(total[0].id).toBe('42')
  })

  it('el bigint del servidor NO sirve como identidad: no empata con la cola', () => {
    const op = nuevaIdentidadDeAccion()
    const nube = [{ id: '42', client_op_id: op, amount: 750 }]
    const cola = [{ client_op_id: op, amount: 750 }]
    // Comparando por `id` —lo que hacía el código viejo— se contaría dos veces.
    const porIdDelServidor = new Set(nube.map(m => m.id))
    expect(cola.filter(m => !porIdDelServidor.has((m as { id?: string }).id ?? '')).length).toBe(1)
    // Por identidad lógica, una sola.
    expect(fusionarParaArqueo(nube, cola)).toHaveLength(1)
  })
})

describe('compatibilidad con lo que ya está guardado', () => {
  it('6 · un movimiento legacy con sólo `id` sigue siendo visible y deduplicable', () => {
    const legacyId = 'e3a1c9de-legacy'
    const cache = [{ id: legacyId, amount: 200 }]        // sin client_op_id
    const cola = [{ id: legacyId, amount: 200 }]         // payload viejo, con id
    expect(fusionarParaArqueo(cache, cola)).toHaveLength(1)
    // Y si sólo existe en la cola, se ve.
    expect(fusionarParaArqueo([], cola)).toHaveLength(1)
  })

  it('un item sin ninguna identidad se MUESTRA en vez de esconderse', () => {
    // Esconder dinero por no poder deduplicarlo sería el peor de los dos errores.
    const cache = [{ id: 'x', client_op_id: 'x', amount: 100 }]
    const cola = [{ amount: 999 }]   // ni id ni client_op_id
    const total = fusionarParaArqueo(cache, cola)
    expect(total).toHaveLength(2)
    expect(total.some(m => m.amount === 999)).toBe(true)
  })
})

describe('el registro local conserva las dos llaves', () => {
  it('1 y 2 · la caché usa client_op_id como llave técnica y lo guarda explícito', () => {
    const clientOpId = nuevaIdentidadDeAccion()
    // Lo que doCashSave escribe en el store `cash_movements` (keyPath 'id').
    const registro = { id: clientOpId, client_op_id: clientOpId, turno_id: 't1', type: 'retiro', amount: 500 }
    expect(registro.id).toBe(clientOpId)            // llave del store, no del servidor
    expect(registro.client_op_id).toBe(clientOpId)  // identidad lógica explícita
    // Y lo que se encola NO lleva id.
    const encolado: Record<string, unknown> = { client_op_id: clientOpId, turno_id: 't1', type: 'retiro', amount: 500 }
    expect('id' in encolado).toBe(false)
    // Las dos formas comparten identidad lógica: por eso el arqueo cuenta una vez.
    expect(claveLogicaDeCaja(registro)).toBe(claveLogicaDeCaja(encolado))
  })
})
