'use strict'
// ─── Capturing Fake ESC/POS Printer ──────────────────────────────────────────
// TCP server mimicking a network thermal printer (port 9100-style). The bridge's
// printer adapter opens one TCP connection per print job attempt, writes the raw
// ESC/POS bytes, and closes. We capture every connection's byte stream verbatim
// to an evidence file:
//   <evidenceDir>/NNN.bin           — raw bytes of job N
//   <evidenceDir>/index.json        — [{ n, file, ts, len, sha256 }]
// Outages are simulated per-printer by stop()/start() — connections during an
// outage are refused (ECONNREFUSED) which the bridge treats as recoverable.

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const path = require('path')

class CapturingPrinter {
  /**
   * @param {{ id?: string, name?: string, station: string, port: number, evidenceDir: string, onError?: (msg: string) => void }} opts
   *   `station` remains as a legacy label; named instances (5-printer AMALAY
   *   topology) pass `id`/`name` — used in logs and evidence.
   */
  constructor({ id, name, station, port, evidenceDir, onError }) {
    this.id = id || station
    this.name = name || station
    this.station = station
    this.port = port
    this.evidenceDir = evidenceDir
    this.onError = onError || (() => {})
    this.up = false
    this.server = null
    this.sockets = new Set()
    this.jobs = []          // index entries
    this.jobCount = 0
    this.bytes = 0
    this.connections = 0
    this.recentBuffers = [] // last 50 captured payloads (Buffer) for in-memory assertions
    fs.mkdirSync(evidenceDir, { recursive: true })
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve()
      const server = net.createServer((sock) => {
        this.connections++
        this.sockets.add(sock)
        const chunks = []
        sock.on('data', (d) => { chunks.push(d); this.bytes += d.length })
        sock.on('error', () => {})
        sock.on('close', () => {
          this.sockets.delete(sock)
          const buf = Buffer.concat(chunks)
          if (buf.length > 0) this._captureJob(buf)
        })
      })
      server.on('error', (e) => {
        this.onError(`fake-printer-${this.id}: ${e.message}`)
        reject(e)
      })
      server.listen(this.port, '0.0.0.0', () => {
        this.server = server
        this.up = true
        resolve()
      })
    })
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.up = false
      for (const s of this.sockets) { try { s.destroy() } catch {} }
      this.sockets.clear()
      const srv = this.server
      this.server = null
      srv.close(() => resolve())
    })
  }

  _captureJob(buf) {
    const n = ++this.jobCount
    const file = `${String(n).padStart(3, '0')}.bin`
    // Parse the harness's evidence markers out of the ESC/POS payload so the
    // per-printer index records ORIGIN (terminal), order, kind + timestamp.
    const text = buf.toString('latin1')
    const marker = (re) => { const m = text.match(re); return m ? m[1] : null }
    const entry = {
      n,
      file,
      ts: new Date().toISOString(),
      len: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      printer_id: this.id,
      kind: marker(/TWIN ([A-Z0-9-]+) /),
      pn: marker(/pn=([0-9a-f]+)/),
      origin_terminal: marker(/term=([^\s]+)/),
      order: marker(/order=([^\s]+)/),
    }
    this.jobs.push(entry)
    this.recentBuffers.push(buf)
    if (this.recentBuffers.length > 5000) this.recentBuffers.splice(0, this.recentBuffers.length - 5000)
    try {
      fs.writeFileSync(path.join(this.evidenceDir, file), buf)
      fs.writeFileSync(path.join(this.evidenceDir, 'index.json'), JSON.stringify(this.jobs, null, 2))
    } catch (e) {
      this.onError(`fake-printer-${this.id} evidence write: ${e.message}`)
    }
  }

  /** Search all captured payloads for an ASCII marker. Returns match count. */
  countMarker(marker) {
    let n = 0
    for (const buf of this.recentBuffers) {
      if (buf.includes(marker)) n++
    }
    return n
  }
}

module.exports = { CapturingPrinter }
