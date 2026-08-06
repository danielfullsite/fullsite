'use strict'
// ─── Fingerprint Service Mock ─────────────────────────────────────────────────
// Mimics the surface of C:\fullsite\fingerprint-service.exe that the Electron
// bridge's /fp/* proxy expects (electron-app/local-server/index.js proxies
// /fp/<path> → http://127.0.0.1:7718/<path>; electron-app/main.js health-checks
// http://127.0.0.1:7718/health). Documented endpoints: /health, /enroll, /auth,
// /list.
//
// Four scenario states:
//   'available'   — responds normally
//   (stopped)     — stop() closes the listener entirely → ECONNREFUSED at proxy
//   'crash'       — accepts the request, writes partial bytes, destroys socket
//   'timeout'     — holds every request ~30 s, then 504 (proxy timeout is 90 s;
//                   the harness aborts its own probe earlier — the point is that
//                   PIN-based COMMAND flow keeps working while /fp hangs)

const http = require('http')

class FingerprintMock {
  /**
   * @param {{ port: number, users: Array<{name: string, role: string}>, holdMs?: number }} opts
   */
  constructor({ port, users, holdMs = 30_000 }) {
    this.port = port
    this.users = users || []
    this.holdMs = holdMs
    this.mode = 'available'
    this.server = null
    this.sockets = new Set()
    this.timers = new Set()
    this.hits = { health: 0, list: 0, enroll: 0, auth: 0, other: 0 }
  }

  setMode(mode) { this.mode = mode }

  start() {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve()
      const server = http.createServer((req, res) => this._handle(req, res))
      server.on('connection', (sock) => {
        this.sockets.add(sock)
        sock.on('close', () => this.sockets.delete(sock))
      })
      server.on('error', (e) => reject(e))
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        resolve()
      })
    })
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      for (const t of this.timers) clearTimeout(t)
      this.timers.clear()
      for (const s of this.sockets) { try { s.destroy() } catch {} }
      this.sockets.clear()
      const srv = this.server
      this.server = null
      srv.close(() => resolve())
    })
  }

  _handle(req, res) {
    const url = (req.url || '/').split('?')[0]
    const key = url.replace(/^\//, '') || 'other'
    if (this.hits[key] !== undefined) this.hits[key]++
    else this.hits.other++

    if (this.mode === 'crash') {
      // Simulate mid-request crash: partial write then socket destroy.
      try { res.socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/js') } catch {}
      try { res.socket.destroy() } catch {}
      return
    }

    if (this.mode === 'timeout') {
      const t = setTimeout(() => {
        this.timers.delete(t)
        try {
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'fingerprint device timeout (mock)' }))
        } catch {}
      }, this.holdMs)
      this.timers.add(t)
      return
    }

    // 'available'
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (url === '/health') {
      return send(200, { ok: true, device: 'mock-digitalpersona-4500', users_enrolled: this.users.length })
    }
    if (url === '/list') {
      return send(200, { ok: true, users: this.users.map((u, i) => ({ id: i + 1, name: u.name, role: u.role })) })
    }
    if (url === '/enroll' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => send(200, { ok: true, user_id: this.users.length + 1, enrolled: true }))
      return
    }
    if (url === '/auth' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const u = this.users[0] || { name: 'mock-user', role: 'mesero' }
        send(200, { ok: true, matched: true, user: { name: u.name, role: u.role } })
      })
      return
    }
    send(404, { ok: false, error: 'not found' })
  }
}

module.exports = { FingerprintMock }
