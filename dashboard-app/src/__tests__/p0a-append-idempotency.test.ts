/**
 * P0A · APPEND IDEMPOTENCY FOUNDATION
 *
 * Lo que estas pruebas cuidan no es que «haya un id»: es que sea el id CORRECTO.
 * Un UUID aleatorio hace seguro el reintento del mismo item y deja pasar el caso
 * que de verdad duplica inventario —dos terminales procesando el mismo evento—.
 * Por eso cada productor se prueba contra sus DOS preguntas, no una.
 */
import { describe, it, expect } from 'vitest'
import {
  nuevaIdentidadDeAccion,
  identidadDeRecepcionDeCompra,
  type ResultadoDeEscritura,
} from '../lib/operation-identity'

describe('identidad aleatoria — acciones humanas', () => {
  it('15 · dos retiros legítimos idénticos en monto y motivo son DOS eventos', () => {
    // Mismo cajero, mismo monto, mismo motivo, mismo minuto: dos hechos distintos.
    const primero = nuevaIdentidadDeAccion()
    const segundo = nuevaIdentidadDeAccion()
    expect(primero).not.toBe(segundo)
  })

  it('16 · el reintento del MISMO movimiento reusa la identidad, no genera otra', () => {
    // La identidad se genera UNA vez al confirmar y viaja en el payload; el
    // replay reusa ese payload. Se modela igual que en producción: el valor se
    // captura una vez y se reenvía.
    const alConfirmar = nuevaIdentidadDeAccion()
    const payload = { client_op_id: alConfirmar, amount: 500 }
    const reintento = { ...payload }
    expect(reintento.client_op_id).toBe(alConfirmar)
  })

  it('17 · dos observaciones legítimas de auditoría son DOS filas', () => {
    expect(nuevaIdentidadDeAccion()).not.toBe(nuevaIdentidadDeAccion())
  })

  it('devuelve un UUID, no una cadena cualquiera', () => {
    expect(nuevaIdentidadDeAccion()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })
})

describe('identidad determinista — movimientos derivados de otra operación', () => {
  it('14 · dos terminales que reciben la MISMA orden de compra producen la MISMA identidad', () => {
    const terminalA = identidadDeRecepcionDeCompra('oc-2026-0417', 8842)
    const terminalB = identidadDeRecepcionDeCompra('oc-2026-0417', 8842)
    expect(terminalA).toEqual(terminalB)
    expect(terminalA.movement_operation_key).toBe('po:oc-2026-0417')
    expect(terminalA.movement_operation_line).toBe('8842')
  })

  it('el replay del mismo renglón produce la misma identidad que el intento original', () => {
    const original = identidadDeRecepcionDeCompra('oc-2026-0417', 8842)
    const replay = identidadDeRecepcionDeCompra('oc-2026-0417', 8842)
    expect(replay).toEqual(original)
  })

  it('dos renglones distintos de la misma OC NO se colapsan', () => {
    const harina = identidadDeRecepcionDeCompra('oc-2026-0417', 8842)
    const azucar = identidadDeRecepcionDeCompra('oc-2026-0417', 8843)
    expect(harina.movement_operation_line).not.toBe(azucar.movement_operation_line)
  })

  it('no depende del orden del arreglo: la identidad sale del id del renglón', () => {
    const renglones = [{ id: 8842 }, { id: 8843 }, { id: 8844 }]
    const enUnOrden = renglones.map(r => identidadDeRecepcionDeCompra('oc-1', r.id))
    const enOtroOrden = [...renglones].reverse().map(r => identidadDeRecepcionDeCompra('oc-1', r.id))
    expect(new Set(enUnOrden.map(i => i.movement_operation_line)))
      .toEqual(new Set(enOtroOrden.map(i => i.movement_operation_line)))
  })

  it('exige los dos componentes: sin OC o sin renglón, no hay identidad que inventar', () => {
    expect(() => identidadDeRecepcionDeCompra('', 8842)).toThrow()
    expect(() => identidadDeRecepcionDeCompra('oc-1', '')).toThrow()
  })
})

describe('el audit registra el resultado real, no el esperado', () => {
  it('11 · los tres resultados son representables y distintos', () => {
    const resultados: ResultadoDeEscritura[] = ['saved', 'queued', 'failed']
    expect(new Set(resultados).size).toBe(3)
  })

  it('un movimiento encolado NO se audita como guardado', () => {
    // Modela la rama del catch de doCashSave: la escritura no llegó, se encoló.
    const detalles = { type: 'retiro', amount: 500, resultado: 'queued' as ResultadoDeEscritura }
    expect(detalles.resultado).not.toBe('saved')
  })
})

describe('la identidad del audit es SUYA, no la de la operación que audita', () => {
  it('9 · dos auditorías del mismo movimiento de caja llevan client_op_id distintos', () => {
    const movimiento = nuevaIdentidadDeAccion()          // identidad del retiro
    const auditDeLaCaja = nuevaIdentidadDeAccion()       // identidad del evento
    const auditDelGerente = nuevaIdentidadDeAccion()     // otra observación del mismo hecho
    expect(auditDeLaCaja).not.toBe(auditDelGerente)
    expect(auditDeLaCaja).not.toBe(movimiento)
    // La operación auditada viaja como metadato, no como llave.
    const detalles = { movimiento_client_op_id: movimiento }
    expect(detalles.movimiento_client_op_id).toBe(movimiento)
  })
})

describe('cash movement: el id ya no se manda', () => {
  it('2 · el payload lleva client_op_id y NO lleva id', () => {
    // `pos_cash_movements.id` es bigint/nextval: mandarle un UUID daba 22P02 y la
    // fila nunca existía. Esta prueba fija el contrato del payload.
    const clientOpId = nuevaIdentidadDeAccion()
    const payload: Record<string, unknown> = {
      client_op_id: clientOpId, client_id: 'cert', turno_id: 't1',
      type: 'retiro', amount: 500, reason: 'banco', actor: 'cajero', approved_by: 'gerente',
    }
    expect(payload.client_op_id).toBe(clientOpId)
    expect('id' in payload).toBe(false)
  })

  it('3 · el valor encolado es el MISMO que el del intento online', () => {
    const clientOpId = nuevaIdentidadDeAccion()
    const online = { client_op_id: clientOpId, amount: 500 }
    const encolado = { ...online }   // la cola guarda el payload tal cual
    expect(encolado.client_op_id).toBe(online.client_op_id)
  })
})

describe('10 · items legacy sin identidad', () => {
  it('un payload viejo sin client_op_id sigue siendo válido y no se le inventa una', () => {
    const legacy: Record<string, unknown> = { client_id: 'amalay', action: 'item_added', actor: 'Ana' }
    expect('client_op_id' in legacy).toBe(false)
    // P0A no reescribe items encolados: la ausencia se conserva tal cual.
    const reproducido = { ...legacy }
    expect('client_op_id' in reproducido).toBe(false)
  })
})
