'use strict'
// ─── Slow-Staging Supabase REST Mock ─────────────────────────────────────────
// Mimics the exact (and only) Supabase surface the local-server's
// startSupabasePoll() calls (electron-app/local-server/index.js):
//
//   GET /rest/v1/pos_orders?client_id=eq.<restaurantId>&status=neq.closed&select=...
//   headers: { apikey, Authorization: Bearer <key> }
//
// The poll runs every 5 s with a 6 s AbortController. Feasibility note: the poll
// URL/key is injectable per spawned instance via config.supabaseUrl/supabaseKey
// (twin-server-runner.js passes them through) — NO electron-app changes needed.
// But STATE_SYNC events REPLACE mesa/KDS state wholesale (core/state.js
// _applyStateSync), so this mock must only ever be pointed at a DEDICATED bridge
// instance, never the instance carrying the twin's command traffic.
//
// Injectable behaviors: latencyMs (slow staging), failStatus (HTTP error),
// holdMs (hang past the poll's 6 s abort).

const http = require('http')

class StagingMock {
  constructor({ port, restaurantId }) {
    this.port = port
    this.restaurantId = restaurantId
    this.server = null
    this.sockets = new Set()
    this.behavior = { latencyMs: 0, failStatus: null, holdMs: 0 }
    this.orders = []
    this.hits = 0
    this.hitLog = [] // { ts, behavior }
  }

  setOrders(orders) { this.orders = orders }
  setBehavior(b) { this.behavior = { latencyMs: 0, failStatus: null, holdMs: 0, ...b } }

  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._handle(req, res))
      server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)) })
      server.on('error', reject)
      server.listen(this.port, '127.0.0.1', () => { this.server = server; resolve() })
    })
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      for (const s of this.sockets) { try { s.destroy() } catch {} }
      const srv = this.server
      this.server = null
      srv.close(() => resolve())
    })
  }

  _handle(req, res) {
    const url = req.url || '/'
    if (!url.startsWith('/rest/v1/pos_orders')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'not found (staging mock only serves /rest/v1/pos_orders)' }))
      return
    }

    this.hits++
    const b = this.behavior
    this.hitLog.push({ ts: Date.now(), behavior: { ...b } })
    if (this.hitLog.length > 500) this.hitLog.splice(0, this.hitLog.length - 500)

    const respond = () => {
      if (b.failStatus) {
        res.writeHead(b.failStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: `injected error ${b.failStatus} (staging mock)` }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.orders))
    }

    const delay = b.holdMs > 0 ? b.holdMs : b.latencyMs
    if (delay > 0) setTimeout(respond, delay)
    else respond()
  }
}

module.exports = { StagingMock }
