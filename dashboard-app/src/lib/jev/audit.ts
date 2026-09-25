/**
 * Auditoría append-only de la capa Jev.
 *
 * - La interfaz sólo expone `append` y lectura. No hay update ni delete.
 * - Cada registro lleva `prev_hash` y `record_hash` (SHA-256 del registro
 *   canónico sin `record_hash`). Editar, reordenar o borrar una línea intermedia
 *   rompe la cadena y `verifyAuditChain` lo detecta.
 * - Cortar la COLA no rompe la cadena por sí solo. El sink de archivo mantiene un
 *   ancla (`<archivo>.head`: último seq y hash) y se niega a abrir si no coincide.
 *   Límite honesto: quien pueda escribir ambos archivos puede truncarlos juntos;
 *   una garantía contra eso exige un ancla fuera de esta máquina (WORM/remoto).
 * - Un solo escritor por archivo. Dentro de un proceso, cada append relee la cola
 *   del disco, así que dos sinks sobre el mismo archivo no bifurcan la cadena.
 *   Entre procesos no hay candado: no se soporta.
 * - El archivo se abre con flag 'a' (O_APPEND): nunca trunca.
 * - Ningún campo contiene el estado, la credencial ni el cuerpo de la respuesta.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AuditRecord } from './contract'
import { canonicalJson, sha256Hex } from './redaction'

export const GENESIS_HASH = '0'.repeat(64)

export type AuditEntry = Omit<AuditRecord, 'seq' | 'ts' | 'prev_hash' | 'record_hash'>

export interface AuditSink {
  append(entry: AuditEntry): AuditRecord
  readAll(): AuditRecord[]
}

function seal(entry: AuditEntry, seq: number, prev: string, ts: string): AuditRecord {
  // Normalizar por JSON antes de sellar: lo que se hashea es exactamente lo que se
  // escribe y se relee (un `undefined` desaparecería al escribir y rompería el hash).
  const unsealed = JSON.parse(JSON.stringify({ ...entry, seq, ts, prev_hash: prev })) as Omit<AuditRecord, 'record_hash'>
  return { ...unsealed, record_hash: sha256Hex(canonicalJson(unsealed)) }
}

export function createMemoryAuditSink(now: () => Date = () => new Date()): AuditSink {
  const records: AuditRecord[] = []
  return {
    append(entry) {
      const prev = records.length ? records[records.length - 1].record_hash : GENESIS_HASH
      const rec = seal(entry, records.length + 1, prev, now().toISOString())
      records.push(rec)
      return rec
    },
    readAll: () => records.map((r) => JSON.parse(JSON.stringify(r)) as AuditRecord),
  }
}

function parseLines(path: string): AuditRecord[] {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n')
  const out: AuditRecord[] = []
  lines.forEach((l, i) => {
    if (l.trim().length === 0) return
    try {
      out.push(JSON.parse(l) as AuditRecord)
    } catch {
      throw new Error(`auditoría Jev corrupta en ${path}: línea ${i + 1} no es JSON (¿escritura interrumpida?)`)
    }
  })
  return out
}

export function createFileAuditSink(path: string, now: () => Date = () => new Date()): AuditSink {
  const headPath = `${path}.head`
  const readAll = () => parseLines(path)
  const assertIntact = (records: AuditRecord[]) => {
    const check = verifyAuditChain(records)
    if (!check.ok) throw new Error(`auditoría Jev corrupta en ${path}: ${check.error}`)
    const last = records[records.length - 1] ?? null
    const head = existsSync(headPath) ? (JSON.parse(readFileSync(headPath, 'utf8')) as { seq: number; record_hash: string }) : null
    if (last && !head) throw new Error(`auditoría Jev corrupta en ${path}: falta el ancla ${headPath}`)
    if (head && (!last || head.seq !== last.seq || head.record_hash !== last.record_hash))
      throw new Error(`auditoría Jev corrupta en ${path}: el ancla dice seq ${head.seq}, el archivo termina en ${last?.seq ?? 0} (¿cola truncada?)`)
    return last
  }
  assertIntact(readAll())
  return {
    append(entry) {
      const last = assertIntact(readAll())
      const rec = seal(entry, (last?.seq ?? 0) + 1, last?.record_hash ?? GENESIS_HASH, now().toISOString())
      appendFileSync(path, `${JSON.stringify(rec)}\n`, { flag: 'a', encoding: 'utf8' })
      writeFileSync(headPath, JSON.stringify({ seq: rec.seq, record_hash: rec.record_hash }), 'utf8')
      return rec
    },
    readAll,
  }
}

export function verifyAuditChain(records: AuditRecord[]): { ok: true } | { ok: false; error: string } {
  let prev = GENESIS_HASH
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.seq !== i + 1) return { ok: false, error: `seq ${r.seq} en posición ${i + 1}` }
    if (r.prev_hash !== prev) return { ok: false, error: `prev_hash roto en seq ${r.seq}` }
    const { record_hash, ...rest } = r
    if (sha256Hex(canonicalJson(rest)) !== record_hash) return { ok: false, error: `record_hash no coincide en seq ${r.seq}` }
    prev = record_hash
  }
  return { ok: true }
}
