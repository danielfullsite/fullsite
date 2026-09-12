import { describe, expect, it } from 'vitest'
import { validarPayload } from '@/lib/integrations/rappi/onboarding'

/**
 * Callback de self-onboarding de Rappi (STORE_PROVISIONING_STATUS).
 *
 * Rappi es un tercero: el validador existe para que un payload deforme se rechace
 * con un motivo legible en vez de reventar a medio proceso o, peor, escribir a
 * medias. Cada caso de abajo es una forma en que un payload puede llegar mal.
 */

const VALIDO = {
  batchId: 'batch-001',
  integrationId: 'Fullsite_DEV',
  operation: 'PROVISION',
  results: [
    { storeId: '900173586', integrationId: 'Fullsite_DEV', brand: 'AMALAY', status: 'ACTIVE', httpCode: 200 },
  ],
  timestamp: '2026-08-27T12:00:00Z',
}

describe('validarPayload — acepta lo que Rappi documenta', () => {
  it('acepta un batch de PROVISION bien formado', () => {
    const r = validarPayload(VALIDO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.batchId).toBe('batch-001')
    expect(r.payload.operation).toBe('PROVISION')
    expect(r.payload.results).toHaveLength(1)
    expect(r.payload.results[0].storeId).toBe('900173586')
  })

  it('acepta DEPROVISION', () => {
    const r = validarPayload({ ...VALIDO, operation: 'DEPROVISION' })
    expect(r.ok).toBe(true)
  })

  it('acepta los tres estados de tienda', () => {
    for (const status of ['ACTIVE', 'INACTIVE', 'FAILED']) {
      const r = validarPayload({ ...VALIDO, results: [{ storeId: 'S1', status }] })
      expect(r.ok, `status ${status} debería aceptarse`).toBe(true)
    }
  })

  it('acepta un batch vacío — Rappi puede reportar cero tiendas', () => {
    const r = validarPayload({ ...VALIDO, results: [] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.results).toHaveLength(0)
  })

  it('tolera que falten los campos opcionales', () => {
    const r = validarPayload({
      batchId: 'b', operation: 'PROVISION', results: [{ storeId: 'S1', status: 'ACTIVE' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.integrationId).toBeUndefined()
      expect(r.payload.results[0].brand).toBeUndefined()
    }
  })

  it('conserva errorMessage y httpCode de una tienda fallida', () => {
    const r = validarPayload({
      ...VALIDO,
      results: [{ storeId: 'S9', status: 'FAILED', errorMessage: 'store not found', httpCode: 404 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.results[0].errorMessage).toBe('store not found')
    expect(r.payload.results[0].httpCode).toBe(404)
  })
})

describe('validarPayload — rechaza con motivo, no revienta', () => {
  const casos: Array<[string, unknown, string]> = [
    ['null',                     null,                                          'objeto'],
    ['una cadena',               'no soy un objeto',                            'objeto'],
    ['sin batchId',              { operation: 'PROVISION', results: [] },       'batchId'],
    ['batchId vacío',            { batchId: '   ', operation: 'PROVISION', results: [] }, 'batchId'],
    ['operation desconocida',    { batchId: 'b', operation: 'BORRAR', results: [] },      'operation'],
    ['sin operation',            { batchId: 'b', results: [] },                 'operation'],
    ['results no es arreglo',    { batchId: 'b', operation: 'PROVISION', results: {} },   'results'],
    ['tienda sin storeId',       { batchId: 'b', operation: 'PROVISION', results: [{ status: 'ACTIVE' }] }, 'storeId'],
    ['tienda con status raro',   { batchId: 'b', operation: 'PROVISION', results: [{ storeId: 'S1', status: 'PENDIENTE' }] }, 'status'],
  ]

  for (const [nombre, entrada, fragmentoDelMotivo] of casos) {
    it(`rechaza ${nombre} y dice por qué`, () => {
      const r = validarPayload(entrada)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.motivo.toLowerCase()).toContain(fragmentoDelMotivo.toLowerCase())
    })
  }

  it('nombra la tienda culpable cuando el status es inválido', () => {
    const r = validarPayload({
      batchId: 'b', operation: 'PROVISION',
      results: [{ storeId: 'BUENA', status: 'ACTIVE' }, { storeId: 'MALA', status: '???' }],
    })
    expect(r.ok).toBe(false)
    // Sin el id, con 50 tiendas en el batch no se sabe cuál vino mal.
    if (!r.ok) expect(r.motivo).toContain('MALA')
  })

  it('recorta los espacios del storeId — un id con espacios no empata en la BD', () => {
    const r = validarPayload({
      batchId: 'b', operation: 'PROVISION', results: [{ storeId: '  900173586  ', status: 'ACTIVE' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.results[0].storeId).toBe('900173586')
  })

  it('ignora campos que Rappi no documenta en vez de arrastrarlos', () => {
    const r = validarPayload({ ...VALIDO, campoInventado: 'x', results: [{ storeId: 'S1', status: 'ACTIVE', otro: 1 }] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload).not.toHaveProperty('campoInventado')
      expect(r.payload.results[0]).not.toHaveProperty('otro')
    }
  })
})
