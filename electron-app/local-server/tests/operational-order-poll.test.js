'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readOperationalOrders } = require('../core/operational-order-poll')

const params = { supabaseUrl: 'http://cloud.invalid', restaurantId: 'restaurant', branchId: 'branch', turnoId: 'turno' }

test('bootstrap pagina 500 órdenes completas y conserva scope, orden, credencial y deadline', async () => {
  const signal = new AbortController().signal
  const headers = { Authorization: 'Bearer fixture-only' }
  const calls = []
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i), items: [{ nombre: 'Completa', notas: 'sin hielo' }], pagos: [], turno_id: 'turno' }))
  const result = await readOperationalOrders({ ...params, signal, headers, fetchImpl: async (input, init) => {
    const url = new URL(input)
    calls.push(url)
    assert.equal(url.searchParams.get('client_id'), 'eq.restaurant')
    assert.equal(url.searchParams.get('location_id'), 'eq.branch')
    assert.equal(url.searchParams.get('turno_id'), 'eq.turno')
    assert.equal(url.searchParams.get('select'), '*')
    assert.equal(url.searchParams.get('order'), 'created_at.asc,id.asc')
    assert.equal(url.searchParams.get('limit'), '500')
    assert.equal(init.headers, headers)
    assert.equal(init.signal, signal)
    const offset = Number(url.searchParams.get('offset'))
    return { ok: true, json: async () => rows.slice(offset, offset + 500) }
  } })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].searchParams.get('offset'), '500')
  assert.deepEqual(result, rows)
})

test('fallo de página, límite y deadline rechazan el bootstrap sin devolver lista parcial', async () => {
  let page = 0
  await assert.rejects(readOperationalOrders({ ...params, fetchImpl: async () => ++page === 1
    ? { ok: true, json: async () => Array.from({ length: 500 }, (_, id) => ({ id })) }
    : { ok: false, status: 503 } }), /incompleto: página 2, HTTP 503/)
  await assert.rejects(readOperationalOrders({ ...params, maxPages: 2, fetchImpl: async () =>
    ({ ok: true, json: async () => Array.from({ length: 500 }, (_, id) => ({ id })) }) }), /límite de 1000/)
  const abort = new AbortController()
  abort.abort()
  let fetched = false
  await assert.rejects(readOperationalOrders({ ...params, signal: abort.signal, fetchImpl: async () => { fetched = true } }), { name: 'AbortError' })
  assert.equal(fetched, false)
  assert.deepEqual(await readOperationalOrders({ ...params, turnoId: null, fetchImpl: async () => { throw new Error('sin turno no consulta historial') } }), [])
})
