// Sobre común de todo artefacto del cerebro operativo.
//
// UNA REGLA GOBIERNA ESTE ARCHIVO
//   Un artefacto se EMITE, no se edita. Lleva su hora, su SHA y el hash de su
//   propio contenido. Si el mundo cambia, se emite otro; el viejo no se reescribe.
//
// Y una segunda, que es la que evita el peor fallo:
//   La ausencia de evidencia NO es salud. `sinEvidencia()` devuelve UNKNOWN con
//   su motivo, nunca OK. Ningún camino de este módulo produce OK por omisión.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const ESTADOS = Object.freeze({
  OK: 'OK', DEGRADED: 'DEGRADED', ALERT: 'ALERT', UNKNOWN: 'UNKNOWN', NOT_INSTRUMENTED: 'NOT_INSTRUMENTED',
})

/** Un hallazgo sin evidencia no existe. Éste es el único constructor de UNKNOWN. */
export function sinEvidencia(motivo, detalle = null) {
  return { state: ESTADOS.UNKNOWN, reason: motivo, detail: detalle, evidence: [] }
}

/** Hash estable del contenido: claves ordenadas, sin el propio campo de hash. */
export function hashContenido(obj) {
  const orden = (v) => Array.isArray(v) ? v.map(orden)
    : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).filter(k => k !== 'content_sha256').sort().map(k => [k, orden(v[k])]))
      : v
  return createHash('sha256').update(JSON.stringify(orden(obj))).digest('hex')
}

/**
 * Emite un artefacto. `kind` lo identifica; `body` es su contenido.
 * El sobre nunca lleva secretos: quien lo llama es responsable de no meterlos,
 * y `revisarFugas()` lo comprueba antes de escribir.
 */
export function emitir({ kind, body, repoSha = null, dbIdentity = null, outDir, emittedAt = null }) {
  const fuga = revisarFugas(body)
  if (fuga) throw new Error(`el artefacto ${kind} trae algo que parece secreto o PII: ${fuga}`)
  const art = {
    artifact_kind: kind,
    artifact_version: '1.0',
    emitted_at: emittedAt || new Date().toISOString(),
    repo_sha: repoSha,
    database_identity: dbIdentity,
    ...body,
    guarantees: { read_only: true, shared_db_writes: 0, product_files_modified: 0, ...(body.guarantees || {}) },
  }
  art.content_sha256 = hashContenido(art)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    const ruta = join(outDir, `${kind}.json`)
    writeFileSync(ruta, JSON.stringify(art, null, 2) + '\n')
    art._path = ruta
  }
  return art
}

/**
 * Lee un artefacto y verifica que nadie lo haya editado a mano.
 *
 * TRES RESULTADOS, NO DOS. Un artefacto de otra herramienta puede no venir
 * firmado, y eso NO es manipulación: es ausencia de firma. Llamarlo TAMPERED
 * sería una falsa alarma, y una falsa alarma repetida entrena a la gente a
 * ignorar la comprobación entera. Se vio en la primera corrida del índice.
 */
export function leer(ruta) {
  if (!existsSync(ruta)) return null
  const art = JSON.parse(readFileSync(ruta, 'utf8'))
  const esperado = art.content_sha256
  if (!esperado) return { ...art, _integrity: 'UNSIGNED', _path: ruta }
  return { ...art, _integrity: esperado === hashContenido(art) ? 'OK' : 'TAMPERED', _path: ruta }
}

/** Todos los artefactos de un directorio, con su integridad ya evaluada. */
export function leerTodos(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => leer(join(dir, f))).filter(Boolean)
}

/**
 * Detección de fugas. No pretende ser exhaustiva: pretende que un descuido
 * evidente no llegue a un archivo que puede acabar compartido.
 */
const PATRONES = [
  [/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/, 'JWT'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'llave privada'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'api key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub'],
  [/\bsbp_[a-f0-9]{40}/, 'token de Supabase'],
  [/\bAKIA[0-9A-Z]{16}/, 'llave de AWS'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/, 'bearer con token'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'correo'],
]
export function revisarFugas(obj) {
  const texto = JSON.stringify(obj)
  for (const [re, etiqueta] of PATRONES) if (re.test(texto)) return etiqueta
  return null
}

/** Antigüedad en minutos de un ISO8601, o null si no se puede calcular. */
export function edadMin(iso, ahora = Date.now()) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.round((ahora - t) / 60000) : null
}

export { dirname, join }
