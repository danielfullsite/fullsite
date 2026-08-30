'use strict'
// Harness reproducible: lee un JSONL de muestras de latencia (que un soak/twin escribe) y emite
// el reporte p50/p95 en el formato de soak-report.json. Sin dependencias.
//
// USO
//   node electron-app/local-server/telemetry/latency-harness.js <muestras.jsonl> [salida.json]
//
// Cada línea del JSONL es una muestra:
//   {"stage":"pos_to_kds","ms":42}
//   {"stage":"pos_to_print","ms":180}
//   {"event":"disconnect"}
//   {"event":"reconnect","gapMs":5300}
//
// REPRODUCIBLE: mismas muestras → mismo reporte (percentiles deterministas). Si el archivo no
// existe o está vacío, el reporte trae count 0 y percentiles null — NO inventa métricas.
const fs = require('fs')
const { computeFromSamples } = require('./latency-metrics')

/** Parsea un JSONL a muestras, ignorando líneas en blanco o corruptas (no aborta el reporte). */
function parseJsonl(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* línea corrupta: se omite, no se inventa */ }
  }
  return out
}

/** Construye el reporte desde un archivo. Archivo ausente → muestras vacías → percentiles null. */
function reportFromFile(rutaJsonl) {
  let samples = []
  try {
    if (fs.existsSync(rutaJsonl)) samples = parseJsonl(fs.readFileSync(rutaJsonl, 'utf8'))
  } catch { samples = [] }
  return {
    source: rutaJsonl,
    sample_count: samples.length,
    latency: computeFromSamples(samples),
  }
}

module.exports = { parseJsonl, reportFromFile }

// CLI
if (require.main === module) {
  const [, , entrada, salida] = process.argv
  if (!entrada) {
    console.error('uso: node latency-harness.js <muestras.jsonl> [salida.json]')
    process.exit(2)
  }
  const rep = reportFromFile(entrada)
  const json = JSON.stringify(rep, null, 2)
  if (salida) { fs.writeFileSync(salida, json); console.error(`reporte → ${salida}`) }
  else { process.stdout.write(json + '\n') }
}
