'use strict'
// Outbox shadow: conserva una copia inmutable de eventos en pos_local_events.
// Un evento copiado NO demuestra que existan su orden, pago o inventario cloud.
// La materialización de negocio exige un recibo distinto (cloud-materializer).
//
// Contrato (OFFLINE-GAP-001):
//   - Lee eventos con synced:false, en orden FIFO (por sequence).
//   - EXCLUYE eventos STATE_SYNC (son observaciones internas del poll de Phase 1;
//     el schema de pos_local_events tiene CHECK (type <> 'STATE_SYNC')).
//   - Idempotencia por event.id: insertar sin sobrescribir y comparar el registro
//     recibido. Un ID igual con contenido distinto es conflicto, nunca éxito.
//   - Marca la COPIA confirmada con markSynced([sequence]).
//   - Recovery: al reiniciar, los eventos synced:false se reenvían (idempotentes).
//   - Un 409 también puede ser otra operación con la misma secuencia. No prueba
//     que esta operación se guardó: se conserva pendiente y se detiene el FIFO.
//
// Nota: este módulo es SOLO el worker (el motor). Voltear la autoridad de escritura
// (que el browser deje de escribir a Supabase) es un paso aparte, gateado por
// pos_authority_transitions + certificación en hardware. Aquí puede correr en
// "shadow mode" (sube eventos sin que nadie más deje de escribir) de forma segura.

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_BATCH = 200
const { sameCommand } = require('./command-identity')

class OutboxWorker {
  /**
   * @param {object}   opts
   * @param {object}   opts.eventStore    CoreEventStore (readAfter, markSynced)
   * @param {string}   opts.supabaseUrl
   * @param {string}   opts.supabaseKey   service key del tenant
   * @param {string}   opts.restaurantId  client_id del tenant
   * @param {function} [opts.fetchImpl]   inyectable para tests (default: global fetch)
   * @param {number}   [opts.intervalMs]
   * @param {number}   [opts.batchSize]
   * @param {function} [opts.logger]
   */
  constructor({ eventStore, supabaseUrl, supabaseKey, restaurantId, fetchImpl, intervalMs, batchSize, logger, timeoutMs = 8000 }) {
    if (!eventStore) throw new Error('OutboxWorker: eventStore requerido')
    if (!restaurantId) throw new Error('OutboxWorker: restaurantId requerido')
    this._store = eventStore
    this._url = (supabaseUrl || '').replace(/\/+$/, '')
    this._key = supabaseKey
    this._restaurantId = restaurantId
    this._fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
    this._intervalMs = intervalMs || DEFAULT_INTERVAL_MS
    this._batch = batchSize || DEFAULT_BATCH
    this._log = logger || ((...a) => console.log('[outbox]', ...a))
    this._timer = null
    this._running = false
    this._timeoutMs = timeoutMs
  }

  start() {
    if (this._timer) return
    // primer flush inmediato + luego en intervalo
    this._tick()
    this._timer = setInterval(() => this._tick(), this._intervalMs)
    if (this._timer.unref) this._timer.unref()
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  }

  async _tick() {
    if (this._running) return          // evita solapamiento de flushes
    this._running = true
    try { await this.flush() }
    catch (e) { this._log('flush error (no fatal):', e.message) }
    finally { this._running = false }
  }

  // Un pase: sube los eventos pendientes en orden y marca los confirmados.
  // Devuelve { pending, sent, conflicts, failedAt } para observabilidad/tests.
  async flush() {
    const all = await this._store.readAfter(0)
    const pending = all
      .filter((e) => e && !e.synced && e.type !== 'STATE_SYNC')
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, this._batch)

    if (pending.length === 0) return { pending: 0, sent: 0, conflicts: 0, failedAt: null }

    const confirmed = []
    let conflicts = 0
    let failedAt = null

    // FIFO estricto: si un evento falla duro, paramos para no romper el orden;
    // el resto se reintenta en el siguiente flush (Supabase es idempotente por id).
    for (const ev of pending) {
      const res = await this._sendEvent(ev)
      if (res.ok) {
        confirmed.push(ev.sequence)
      } else if (res.conflict) {
        conflicts++
        failedAt = ev.sequence
        break
      } else {
        failedAt = ev.sequence
        break
      }
    }

    if (confirmed.length > 0) await this._store.markSynced(confirmed)
    return { pending: pending.length, sent: confirmed.length, conflicts, failedAt }
  }

  // POST idempotente a pos_local_events. → { ok } | { conflict } | { ok:false }
  async _sendEvent(ev) {
    if (!this._fetch || !this._url || !this._key) {
      return { ok: false }   // sin config no podemos subir; se reintenta al reconectar
    }
    if (ev.restaurant_id && ev.restaurant_id !== this._restaurantId) return { ok: false, conflict: true }
    const body = {
      id:            ev.id,
      sequence:      ev.sequence,
      type:          ev.type,
      ts:            typeof ev.ts === 'number' ? ev.ts : 0,  // pos_local_events.ts es BIGINT NOT NULL
      terminal_id:   ev.terminal_id || null,
      restaurant_id: ev.restaurant_id || this._restaurantId,
      payload:       ev.payload != null ? ev.payload : {},
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this._timeoutMs)
    const auth = { apikey: this._key, Authorization: `Bearer ${this._key}` }
    try {
      const r = await this._fetch(`${this._url}/rest/v1/pos_local_events`, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (r.status === 409) return { ok: false, conflict: true }
      if (!r.ok) {
        this._log(`send failed seq=${ev.sequence} http=${r.status}`)
        return { ok: false }
      }
      let rows = await r.json()
      // ignore-duplicates returns [] for an existing row. Verify what is stored;
      // an empty HTTP success is not a receipt for this immutable operation.
      if (Array.isArray(rows) && rows.length === 0) {
        const existing = await this._fetch(`${this._url}/rest/v1/pos_local_events` +
          `?id=eq.${encodeURIComponent(body.id)}&restaurant_id=eq.${encodeURIComponent(this._restaurantId)}&limit=1`,
        { headers: auth, signal: controller.signal })
        if (!existing.ok) return { ok: false }
        rows = await existing.json()
      }
      if (!Array.isArray(rows) || rows.length !== 1) return { ok: false }
      const stored = rows[0]
      const matches = stored.id === body.id && Number(stored.sequence) === body.sequence &&
        Number(stored.ts) === body.ts && (stored.terminal_id ?? null) === body.terminal_id && sameCommand(stored, body)
      return matches ? { ok: true } : { ok: false, conflict: true }
    } catch (e) {
      // offline / red caída → reintenta en el próximo flush
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = { OutboxWorker }
