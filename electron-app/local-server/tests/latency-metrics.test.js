'use strict'
// Métricas de latencia POS→KDS→impresión. Run:
//   node --test electron-app/local-server/tests/latency-metrics.test.js
//
// Fija dos garantías: percentiles DETERMINISTAS a partir de muestras reales, y "sin inventar
// números" (sin muestras → null, nunca 0 ni un valor plausible).
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { LatencyMetrics, percentile, computeFromSamples } = require('../telemetry/latency-metrics')
const { parseJsonl, reportFromFile } = require('../telemetry/latency-harness')

describe('percentile — nearest-rank determinista', () => {
  test('p50/p95/p99 sobre un conjunto conocido', () => {
    const asc = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] // 10 muestras
    assert.equal(percentile(asc, 50), 50)  // ceil(0.50*10)=5 → índice 4
    assert.equal(percentile(asc, 95), 100) // ceil(0.95*10)=10 → índice 9
    assert.equal(percentile(asc, 99), 100)
  })
  test('sin muestras → null (no se fabrica)', () => {
    assert.equal(percentile([], 50), null)
  })
})

describe('LatencyMetrics — resumen por tramo', () => {
  test('calcula p50/p95 de pos_to_print desde muestras reales', () => {
    const m = new LatencyMetrics()
    for (const ms of [100, 200, 300, 400]) m.recordStage('pos_to_print', ms)
    const s = m.summary('pos_to_print')
    assert.equal(s.count, 4)
    assert.equal(s.min, 100)
    assert.equal(s.max, 400)
    assert.equal(s.p50, 200) // ceil(0.5*4)=2 → índice 1
    assert.equal(s.p95, 400) // ceil(0.95*4)=4 → índice 3
  })

  test('SIN INVENTAR: tramo sin muestras → count 0 y percentiles null', () => {
    const m = new LatencyMetrics()
    const s = m.summary('kds_to_print')
    assert.equal(s.count, 0)
    assert.equal(s.p50, null)
    assert.equal(s.p95, null)
  })

  test('ignora muestras inválidas (NaN, negativas, no numéricas)', () => {
    const m = new LatencyMetrics()
    m.recordStage('pos_to_kds', NaN)
    m.recordStage('pos_to_kds', -5)
    m.recordStage('pos_to_kds', 'lento')
    m.recordStage('pos_to_kds', 30)
    const s = m.summary('pos_to_kds')
    assert.equal(s.count, 1)
    assert.equal(s.p50, 30)
  })

  test('desconexión/reconexión se cuentan y el hueco entra como muestra', () => {
    const m = new LatencyMetrics()
    m.markDisconnect()
    m.markReconnect(5000)
    m.markDisconnect()
    m.markReconnect(3000)
    const r = m.report()
    assert.equal(r.disconnects, 2)
    assert.equal(r.reconnects, 2)
    assert.equal(r.stages.reconnect_gap.count, 2)
    assert.equal(r.stages.reconnect_gap.p50, 3000) // asc [3000,5000], ceil(0.5*2)=1 → índice 0
    assert.equal(r.stages.reconnect_gap.p95, 5000)
  })
})

describe('reproducibilidad — mismas muestras → mismo reporte', () => {
  test('computeFromSamples es determinista', () => {
    const samples = [
      { stage: 'pos_to_kds', ms: 40 },
      { stage: 'pos_to_kds', ms: 60 },
      { stage: 'pos_to_print', ms: 180 },
      { event: 'disconnect' },
      { event: 'reconnect', gapMs: 4200 },
    ]
    const a = computeFromSamples(samples)
    const b = computeFromSamples(samples)
    assert.deepEqual(a, b)
    assert.equal(a.stages.pos_to_kds.p50, 40) // asc [40,60], ceil(0.5*2)=1 → índice 0 = 40
    assert.equal(a.stages.pos_to_kds.p95, 60)
  })
})

describe('harness — lee JSONL, archivo ausente no inventa', () => {
  test('parseJsonl omite líneas corruptas sin abortar', () => {
    const s = parseJsonl('{"stage":"pos_to_kds","ms":10}\n{roto\n\n{"event":"disconnect"}')
    assert.equal(s.length, 2)
  })
  test('archivo ausente → sample_count 0 y percentiles null', () => {
    const rep = reportFromFile('/ruta/que/no/existe.jsonl')
    assert.equal(rep.sample_count, 0)
    assert.equal(rep.latency.stages.pos_to_print.p50, null)
  })
})
