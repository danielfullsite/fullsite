'use strict'
// ─── WebSocket Hub ────────────────────────────────────────────────────────────
// Manages all connected terminals. Handles subscribe, ping/pong, and broadcast.
// One WebSocketServer instance, attached to the existing HTTP server via 'upgrade'.

const { WebSocketServer } = require('ws')
const { S2C, C2S, parseClientMessage, serverEnvelope } = require('../protocol')

const PING_INTERVAL_MS   = 15_000
const PONG_TIMEOUT_MS    = 10_000
const LOCK_EXPIRY_MS     = 30_000

class WsHub {
  /**
   * @param {{ serverId: string, restaurantId: string, getState: () => object, getLastSequence: () => Promise<number>, readAfter: (seq: number) => Promise<object[]> }} opts
   */
  constructor({ serverId, restaurantId, getState, getLastSequence, readAfter }) {
    this._serverId      = serverId
    this._restaurantId  = restaurantId
    this._getState      = getState
    this._getLastSeq    = getLastSequence
    this._readAfter     = readAfter
    this._clients       = new Map() // clientId → { ws, meta, lastPong }
    this._wss           = null
    this._pingTimer     = null
    this._onCommand     = null // set via onCommand()
  }

  // ─── Attach to HTTP server ───────────────────────────────────────────────

  attach(httpServer) {
    this._wss = new WebSocketServer({ noServer: true })

    httpServer.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws') {
        this._wss.handleUpgrade(req, socket, head, (ws) => {
          this._wss.emit('connection', ws, req)
        })
      } else {
        socket.destroy()
      }
    })

    this._wss.on('connection', (ws, req) => this._onConnection(ws, req))
    this._pingTimer = setInterval(() => this._pingAll(), PING_INTERVAL_MS)

    console.log('[ws-hub] WebSocket hub attached on /ws')
  }

  onCommand(fn) {
    this._onCommand = fn
  }

  // ─── Connection lifecycle ────────────────────────────────────────────────

  async _onConnection(ws, req) {
    const remoteIp = req.socket?.remoteAddress || 'unknown'
    let clientId   = null

    ws.on('message', async (raw) => {
      let msg
      try { msg = parseClientMessage(raw.toString()) } catch { return }
      if (!msg) return

      if (msg.type === C2S.SUBSCRIBE) {
        clientId = msg.client_id
        if (!clientId) { ws.close(1008, 'Missing client_id'); return }

        this._clients.set(clientId, {
          ws,
          meta:     { client_id: clientId, client_type: msg.client_type, remote_ip: remoteIp, connected_at: Date.now() },
          lastPong: Date.now(),
        })

        console.log(`[ws-hub] Client subscribed: ${clientId} (${msg.client_type}) from ${remoteIp}`)

        // Send SNAPSHOT + catch-up deltas since client's last known sequence
        const lastClientSeq = typeof msg.last_sequence === 'number' ? msg.last_sequence : -1
        const serverSeq     = await this._getLastSeq()
        const deltas        = lastClientSeq >= 0 ? await this._readAfter(lastClientSeq) : []

        ws.send(this._envelope(S2C.SNAPSHOT, {
          state:   this._getState(),
          deltas,
        }, serverSeq))

        return
      }

      if (msg.type === C2S.PING) {
        if (clientId && this._clients.has(clientId)) {
          this._clients.get(clientId).lastPong = Date.now()
        }
        ws.send(this._envelope(S2C.PONG, {}, await this._getLastSeq()))
        return
      }

      if (msg.type === C2S.COMMAND) {
        if (!this._onCommand) return
        try {
          const result = await this._onCommand(msg, clientId)
          const seq = await this._getLastSeq()
          if (result.duplicate) {
            ws.send(this._envelope(S2C.ACK, { command_id: msg.payload?.command_id, duplicate: true }, seq))
          } else if (result.error) {
            ws.send(this._envelope(S2C.REJECT, { command_id: msg.payload?.command_id, reason: result.error }, seq))
          } else {
            ws.send(this._envelope(S2C.ACK, { command_id: msg.payload?.command_id, event: result.event }, seq))
          }
        } catch (e) {
          ws.send(this._envelope(S2C.REJECT, { reason: e.message }, 0))
        }
        return
      }
    })

    ws.on('pong', () => {
      if (clientId && this._clients.has(clientId)) {
        this._clients.get(clientId).lastPong = Date.now()
      }
    })

    ws.on('close', () => {
      if (clientId) {
        this._clients.delete(clientId)
        console.log(`[ws-hub] Client disconnected: ${clientId}`)
      }
    })

    ws.on('error', (err) => {
      console.error(`[ws-hub] Client error: ${clientId || remoteIp}: ${err.message}`)
    })
  }

  // ─── Broadcast ───────────────────────────────────────────────────────────

  async broadcast(event) {
    if (this._clients.size === 0) return
    const seq = await this._getLastSeq()
    const msg = this._envelope(S2C.DELTA, { event }, seq)
    let sent = 0
    for (const { ws } of this._clients.values()) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(msg); sent++ } catch {}
      }
    }
    return sent
  }

  async broadcastUpdateAvailable(info) {
    if (this._clients.size === 0) return
    const seq = await this._getLastSeq()
    const msg = this._envelope(S2C.UPDATE_AVAILABLE, info, seq)
    for (const { ws } of this._clients.values()) {
      if (ws.readyState === ws.OPEN) try { ws.send(msg) } catch {}
    }
  }

  // ─── Keepalive ───────────────────────────────────────────────────────────

  _pingAll() {
    const deadline = Date.now() - PONG_TIMEOUT_MS
    for (const [clientId, client] of this._clients) {
      if (client.lastPong < deadline) {
        console.warn(`[ws-hub] Client timed out: ${clientId}`)
        client.ws.terminate()
        this._clients.delete(clientId)
        continue
      }
      if (client.ws.readyState === client.ws.OPEN) {
        try { client.ws.ping() } catch {}
      }
    }
  }

  // ─── Utils ───────────────────────────────────────────────────────────────

  _envelope(type, payload, sequence) {
    return serverEnvelope(type, payload, {
      serverId:     this._serverId,
      restaurantId: this._restaurantId,
      sequence:     sequence || 0,
    })
  }

  clientCount()   { return this._clients.size }
  getClientList() { return [...this._clients.values()].map(c => c.meta) }

  close() {
    if (this._pingTimer) clearInterval(this._pingTimer)
    if (this._wss)       this._wss.close()
  }
}

module.exports = { WsHub, LOCK_EXPIRY_MS }
