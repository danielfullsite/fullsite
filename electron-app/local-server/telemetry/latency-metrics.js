'use strict'
// Métricas de latencia POS→KDS→impresión para el soak/twin. Motor PURO, sin dependencias.
//
// POR QUÉ
// El soak-report.json ya trae queue_depth y memoria, pero NINGUNA latencia. Este módulo mide
// los tres tramos que importan en offline y calcula p50/p95 a partir de MUESTRAS REALES:
//   pos_to_kds     — comando recibido por Pedro → estado aplicado/broadcast al KDS
//   kds_to_print   — broadcast → job de impresión encolado
//   pos_to_print   — extremo a extremo (comando → impresión)
//
// SIN INVENTAR NÚMEROS: los percentiles salen de las muestras que se registran; sin muestras,
// el resumen devuelve null (no 0, no un valor plausible). Determinista: mismas muestras → mismo
// resultado (ver latency-metrics.test.js).
//
// FRONTERA OFFLINE: instrumentar el hot path de Pedro (command-handler, ws-hub) requiere
// INSTALADOR NUEVO y reinstalar en la caja — eso va en un PR de local-server aparte. Este
// módulo es el motor + el enganche opt-in (recordStage) que ese PR llamará detrás del flag
// FACTORY_OFFLINE_METRICS. Aquí no se toca el hot path.

/** Percentil por rango-más-cercano (nearest-rank). Determinista. null si no hay muestras. */
function percentile(samplesAsc, p) {
  if (!Array.isArray(samplesAsc) || samplesAsc.length === 0) return null
  if (p <= 0) return samplesAsc[0]
  if (p >= 100) return samplesAsc[samplesAsc.length - 1]
  const rank = Math.ceil((p / 100) * samplesAsc.length)
  return samplesAsc[Math.min(rank, samplesAsc.length) - 1]
}

const STAGES = ['pos_to_kds', 'kds_to_print', 'pos_to_print']

class LatencyMetrics {
  constructor() {
    this._samples = new Map(STAGES.map((s) => [s, []]))
    this._disconnects = 0
    this._reconnects = 0
  }

  /** Registra una latencia (ms) de un tramo. Ignora valores no finitos o negativos. */
  recordStage(stage, ms) {
    const arr = this._samples.get(stage)
    if (!arr) return // tramo desconocido: no se inventa uno
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return
    arr.push(ms)
  }

  markDisconnect() { this._disconnects += 1 }

  /** Reconexión, con el hueco (ms) que estuvo caída la LAN si se conoce. */
  markReconnect(gapMs) {
    this._reconnects += 1
    if (typeof gapMs === 'number' && Number.isFinite(gapMs) && gapMs >= 0) {
      if (!this._samples.has('reconnect_gap')) this._samples.set('reconnect_gap', [])
      this._samples.get('reconnect_gap').push(gapMs)
    }
  }

  /** Resumen de un tramo. count 0 → percentiles null (no se fabrican). */
  summary(stage) {
    const arr = this._samples.get(stage) || []
    if (arr.length === 0) {
      return { count: 0, min: null, max: null, p50: null, p95: null, p99: null }
    }
    const asc = [...arr].sort((a, b) => a - b)
    return {
      count: asc.length,
      min: asc[0],
      max: asc[asc.length - 1],
      p50: percentile(asc, 50),
      p95: percentile(asc, 95),
      p99: percentile(asc, 99),
    }
  }

  /** Reporte completo, encajable en soak-report.json bajo la llave `latency`. */
  report() {
    const stages = {}
    for (const s of this._samples.keys()) stages[s] = this.summary(s)
    return {
      stages,
      disconnects: this._disconnects,
      reconnects: this._reconnects,
    }
  }
}

/**
 * Calcula el reporte de latencia a partir de un arreglo de muestras crudas — la forma que un
 * soak/twin escribe a un JSONL. Cada muestra: {stage, ms} o {event:'disconnect'|'reconnect',
 * gapMs?}. Reproducible: mismas muestras → mismo reporte.
 */
function computeFromSamples(samples) {
  const m = new LatencyMetrics()
  for (const s of Array.isArray(samples) ? samples : []) {
    if (s && s.event === 'disconnect') m.markDisconnect()
    else if (s && s.event === 'reconnect') m.markReconnect(s.gapMs)
    else if (s && typeof s.stage === 'string') m.recordStage(s.stage, s.ms)
  }
  return m.report()
}

module.exports = { LatencyMetrics, percentile, computeFromSamples, STAGES }
