'use strict'
// One checksummed transaction per line: event(s), command receipt and pending
// effects share one commit boundary. The old command index is not authoritative.
// Legacy single-event lines remain readable; corrupt committed data fails closed.
const fs = require('fs')
const crypto = require('crypto')
const { EventStore } = require('./base')
const { syncDirectory, writeAll, replaceFile } = require('./durable-file')

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const frame = events => JSON.stringify({ transaction_version: 1, events, checksum: digest(events) }) + '\n'
const copy = value => JSON.parse(JSON.stringify(value))
const { sameCommand } = require('../../core/command-identity')

// ─── Fotos de nube heredadas en el log ───────────────────────────────────────
//
// Hasta el 2026-09-10 el poll legacy escribia un STATE_SYNC con TODAS las filas
// del turno cada 5 s (core/foto-de-nube.js cuenta la historia: ~220 MB/hora).
// Una instalacion que se actualiza trae ese log. No se pueden BORRAR esos
// eventos: la cadena de secuencias es contigua por contrato y las secundarias
// deduplican por secuencia. Lo que se hace es vaciarles el payload y dejar la
// marca `compacted`: misma identidad, misma secuencia, cien bytes en vez de
// trescientos mil. El estado ignora un STATE_SYNC compactado (core/state.js).
// Se conserva integro el ULTIMO, para que el primer arranque tras actualizar
// sin internet siga teniendo el salon hasta que exista cloud-snapshot.json.
const STATE_SYNC = 'STATE_SYNC'
const compactable = e => e && e.type === STATE_SYNC && e.payload && typeof e.payload === 'object' && e.payload.compacted !== true
function compactar(event) {
  return { ...event, payload: { compacted: true, synced_at: event.payload.synced_at ?? null } }
}
class NdjsonEventStore extends EventStore {
  constructor({ eventLogPath }) {
    super()
    this._logPath = eventLogPath
    this._events = []
    this._processedCommands = new Map()
    this._sequence = 0
    this._unsyncedCount = 0
    this._loaded = false
    this._fault = null
  }
  async load() {
    if (this._loaded) return
    const events = []
    let heredadas = 0
    if (fs.existsSync(this._logPath)) {
      const bytes = fs.readFileSync(this._logPath)
      const boundary = bytes.lastIndexOf(10) + 1
      // Only a missing final newline denotes an uncommitted append. Preserve its
      // bytes for diagnosis; never skip an invalid committed line.
      if (boundary < bytes.length) {
        replaceFile(this._logPath + '.torn-tail', bytes.subarray(boundary))
        const fd = fs.openSync(this._logPath, 'r+')
        try { fs.ftruncateSync(fd, boundary); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      }
      const ids = new Set()
      // Linea por linea desde el buffer, sin convertir el archivo entero a UNA
      // cadena: `toString` sobre un log de mas de 512 MB lanza ERR_STRING_TOO_LONG
      // y Pedro no arranca. Con las fotos heredadas ese tamano se alcanzaba en dos
      // turnos.
      let inicio = 0
      let lineNumber = 0
      while (inicio < boundary) {
        const fin = bytes.indexOf(10, inicio)
        const line = bytes.toString('utf8', inicio, fin)
        inicio = fin + 1
        lineNumber++
        if (!line) continue
        let record
        try { record = JSON.parse(line) } catch { throw new Error(`EVENT_LOG_CORRUPT: invalid JSON at line ${lineNumber}`) }
        const batch = record.transaction_version === 1 ? record.events : [record]
        if (!Array.isArray(batch) || !batch.length || (record.transaction_version === 1 && digest(batch) !== record.checksum)) {
          throw new Error(`EVENT_LOG_CORRUPT: invalid transaction at line ${lineNumber}`)
        }
        for (const event of batch) {
          if (!event || typeof event.id !== 'string' || !event.id || event.sequence !== events.length + 1 || ids.has(event.id)) {
            throw new Error(`EVENT_LOG_CORRUPT: invalid sequence or identity at line ${lineNumber}`)
          }
          ids.add(event.id)
          if (compactable(event)) heredadas++
          events.push(event)
        }
      }
    }
    // Compactar todas las fotos heredadas salvo la ultima (ver arriba).
    if (heredadas > 1) {
      let restantes = heredadas
      for (let i = 0; i < events.length; i++) {
        if (!compactable(events[i])) continue
        if (restantes > 1) events[i] = compactar(events[i])
        restantes--
      }
      try { this._rewrite(events) } catch (error) { this._fault = error; throw error }
      this._compactadas = heredadas - 1
    }
    this._adopt(events)
    this._loaded = true
  }
  // Reescritura completa por archivo temporal + rename, frame por frame: nunca
  // se arma el archivo entero en una sola cadena.
  _rewrite(events) {
    const tmp = this._logPath + '.tmp'
    const fd = fs.openSync(tmp, 'w', 0o600)
    try { for (const e of events) writeAll(fd, frame([e])); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, this._logPath)
    syncDirectory(this._logPath)
  }
  _adopt(events) {
    this._events = events
    this._sequence = events.length ? events[events.length - 1].sequence : 0
    this._unsyncedCount = events.filter(e => !e.synced).length
    this._processedCommands = new Map(events.map(e => [e.id, e]))
  }
  _assertHealthy() {
    if (this._fault) throw new Error(`EVENT_STORE_UNAVAILABLE: restart and inspect storage (${this._fault.message})`)
  }
  async append(events) {
    if (!this._loaded) await this.load()
    this._assertHealthy()
    if (!Array.isArray(events) || !events.length) return { sequences: [] }
    const ids = new Set()
    const full = copy(events).map((e, i) => {
      if (!e.id || this._processedCommands.has(e.id) || ids.has(e.id)) throw new Error('Duplicate or missing event identity')
      ids.add(e.id)
      return { ...e, sequence: this._sequence + i + 1, synced: false }
    })
    const existed = fs.existsSync(this._logPath)
    const fd = fs.openSync(this._logPath, 'a', 0o600)
    const previousSize = fs.fstatSync(fd).size
    try {
      writeAll(fd, frame(full))
      fs.fsyncSync(fd)
      if (!existed) syncDirectory(this._logPath)
    } catch (error) {
      // Failed writes never advance memory/ACK. If rollback also fails, stop all
      // writes until recovery determines the actual durable commit boundary.
      //
      // EN WINDOWS EL PRIMER INTENTO FALLA SIEMPRE, y por eso hay un segundo.
      // `fd` está abierto en modo append ('a'), y ahí `ftruncate` devuelve EPERM en
      // Windows — en Unix funciona, así que en macOS esto nunca se vio. Medido en CI el
      // 2026-09-09, la primera vez que estas pruebas corrieron en Windows: cinco fallos,
      // todos con
      //
      //     EVENT_STORE_UNAVAILABLE: restart and inspect storage
      //       (EPERM: operation not permitted, ftruncate)
      //
      // El efecto en la caja de un restaurante no es de laboratorio: cualquier escritura
      // fallida —disco lleno, antivirus, archivo tomado— dejaba `_fault` puesto y el
      // event store MUERTO hasta reiniciar el POS. La guarda que existe para proteger el
      // registro se volvía una parada garantizada.
      //
      // El segundo intento reabre el mismo archivo en 'r+', donde el truncado sí está
      // permitido. Si TAMBIÉN falla, se conserva el comportamiento original: `_fault`
      // puesto y todo detenido, que es lo correcto cuando de verdad no se puede
      // determinar la frontera de lo comprometido.
      try {
        fs.ftruncateSync(fd, previousSize); fs.fsyncSync(fd)
      } catch (rollbackError) {
        try {
          const fdRollback = fs.openSync(this._logPath, 'r+')
          try { fs.ftruncateSync(fdRollback, previousSize); fs.fsyncSync(fdRollback) }
          finally { fs.closeSync(fdRollback) }
        } catch { this._fault = rollbackError }
      }
      throw error
    } finally { fs.closeSync(fd) }
    this._adopt(this._events.concat(full))
    return { sequences: full.map(e => e.sequence) }
  }
  async commitCommand(event) {
    if (!this._loaded) await this.load()
    this._assertHealthy()
    const existing = this._processedCommands.get(event.id)
    if (existing) {
      if (!sameCommand(existing, event)) throw new Error('IDEMPOTENCY_KEY_REUSED: command content differs')
      return { duplicate: true, event: copy(existing) }
    }
    await this.append([event])
    return { duplicate: false, event: copy(this._processedCommands.get(event.id)) }
  }
  async getProcessedCommand(id) {
    if (!this._loaded) await this.load()
    this._assertHealthy()
    const event = this._processedCommands.get(id)
    return event ? copy(event) : null
  }
  async hasProcessedCommand(id) { return !!(await this.getProcessedCommand(id)) }
  // Compatibility: the event is already the durable receipt. Never trust a
  // second file to decide whether an event was committed.
  async saveProcessedCommand(id, eventId, sequence) {
    const event = await this.getProcessedCommand(id)
    if (!event || event.id !== eventId || event.sequence !== sequence) throw new Error('Command receipt must match a committed event')
  }
  async readAfter(sequence) {
    if (!this._loaded) await this.load()
    this._assertHealthy()
    return copy(this._events.filter(e => e.sequence > sequence))
  }
  async getLastSequence() { if (!this._loaded) await this.load(); this._assertHealthy(); return this._sequence }
  async unsyncedCount() { if (!this._loaded) await this.load(); this._assertHealthy(); return this._unsyncedCount }
  async markSynced(sequences) {
    if (!this._loaded) await this.load()
    this._assertHealthy()
    const selected = new Set(sequences)
    // Si nada cambia, no se toca el disco. El poll de delivery volvia a marcar
    // cada 5 s eventos ya sincronizados, y cada marca reescribia el log entero.
    if (!this._events.some(e => selected.has(e.sequence) && !e.synced)) return
    const updated = this._events.map(e => selected.has(e.sequence) ? { ...e, synced: true } : e)
    try { this._rewrite(updated) } catch (error) {
      this._fault = error // rename may already have committed; do not use stale memory.
      throw error
    }
    this._adopt(updated)
  }
  getStats() {
    return { lastSequence: this._sequence, unsyncedCount: this._unsyncedCount, processedCommands: this._processedCommands.size, storageUnavailable: !!this._fault, compactedSnapshots: this._compactadas || 0 }
  }
}
module.exports = { NdjsonEventStore }
