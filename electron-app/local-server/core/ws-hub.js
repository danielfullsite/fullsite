'use strict'
// ─── WebSocket Hub ────────────────────────────────────────────────────────────
// Manages all connected terminals. Handles subscribe, ping/pong, and broadcast.
// One WebSocketServer instance, attached to the existing HTTP server via 'upgrade'.

const { WebSocketServer } = require('ws')
const { S2C, C2S, revisarMensajeDeCliente, serverEnvelope } = require('../protocol')
const credLan = require('./credencial-lan')

const PING_INTERVAL_MS   = 15_000
const PONG_TIMEOUT_MS    = 10_000
const LOCK_EXPIRY_MS     = 30_000

class WsHub {
  /**
   * @param {{ serverId: string, restaurantId: string, getState: () => object, getLastSequence: () => Promise<number>, readAfter: (seq: number) => Promise<object[]> }} opts
   */
  constructor({ serverId, restaurantId, branchId, lanSecret, getState, getLastSequence, readAfter }) {
    this._serverId      = serverId
    this._restaurantId  = restaurantId
    this._branchId      = branchId
    this._lanSecret     = lanSecret
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
        // Node puede autenticar el upgrade; browsers lo hacen en SUBSCRIBE.
        // El handshake abierto NO registra un cliente ni autoriza datos/comandos.
        if (req.headers[credLan.CABECERA]) {
          const auth = credLan.verificarCredencial({ ruta: '/ws', metodo: 'GET', cabeceras: req.headers,
            secreto: this._lanSecret, restaurantId: this._restaurantId, branchId: this._branchId })
          if (!auth.permitido) {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            return
          }
        }
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
    let terminalId = null
    let autenticado = false
    const authTimeout = setTimeout(() => { if (!autenticado) ws.close(1008, 'falta credencial SUBSCRIBE') }, 5000)
    authTimeout.unref?.()
    let mensajes = Promise.resolve()

    const recibir = async (raw) => {
      // Se RECHAZA con motivo y se cierra, en vez de ignorar en silencio. Un
      // cliente ignorado queda conectado y mudo sin saber por que; uno cerrado
      // con codigo 1008 y un texto puede arreglarse. Ver protocol.js/RECHAZO.
      const revision = revisarMensajeDeCliente(raw.toString())
      if (revision.rechazo) {
        console.warn(`[ws-hub] mensaje rechazado de ${clientId || remoteIp}: ${revision.rechazo}`)
        try { ws.close(1008, revision.rechazo) } catch {}
        return
      }
      const msg = revision.msg

      if (msg.type === C2S.SUBSCRIBE) {
        const cabeceras = { ...req.headers }
        if (msg.lan_secret !== undefined) cabeceras[credLan.CABECERA] = msg.lan_secret
        const auth = credLan.verificarCredencial({ ruta: '/ws', metodo: 'GET', cabeceras,
          secreto: this._lanSecret, restaurantId: this._restaurantId, branchId: this._branchId })
        const scopeError = credLan.verificarScope(msg, { restaurantId: this._restaurantId, branchId: this._branchId })
        if (!auth.permitido || scopeError) {
          ws.close(1008, auth.motivo || scopeError)
          return
        }
        clientId = msg.client_id
        terminalId = req.headers['x-fullsite-terminal'] || msg.terminal_id || clientId
        if (!clientId) { ws.close(1008, 'Missing client_id'); return }

        // CFG-02: reject terminals with mismatched or missing restaurant_id.
        // Prevents data mixing when multiple restaurants share the same LAN.
        const remoteRestaurantId = msg.restaurant_id
        if (remoteRestaurantId && remoteRestaurantId !== 'unknown' && remoteRestaurantId !== this._restaurantId) {
          const reason = `restaurant_id mismatch: server=${this._restaurantId} client=${remoteRestaurantId}`
          console.warn(`[ws-hub] SUBSCRIBE rejected for ${clientId}: ${reason}`)
          ws.close(1008, reason)
          return
        }

        const anterior = this._clients.get(clientId)
        if (anterior && anterior.ws !== ws) anterior.ws.close(1008, 'conexion reemplazada')
        autenticado = true
        clearTimeout(authTimeout)
        this._clients.set(clientId, {
          ws,
          meta:     { client_id: clientId, client_type: msg.client_type, remote_ip: remoteIp, connected_at: Date.now(), restaurant_id: remoteRestaurantId || null },
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

      if (!autenticado || !clientId || this._clients.get(clientId)?.ws !== ws) {
        ws.close(1008, 'SUBSCRIBE autenticado requerido')
        return
      }
      const scopeError = credLan.verificarScope(msg, { restaurantId: this._restaurantId, branchId: this._branchId })
      if (scopeError || (msg.client_id && msg.client_id !== clientId)) {
        ws.close(1008, scopeError || 'otra terminal')
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
          const result = await this._onCommand(msg, clientId, { terminalId, actorToken: msg.actor_token })
          const seq = await this._getLastSeq()
          if (result.duplicate) {
            ws.send(this._envelope(S2C.ACK, { command_id: msg.payload?.command_id, duplicate: true, receipt: result.receipt, result: result.result }, seq))
          } else if (result.error) {
            ws.send(this._envelope(S2C.REJECT, { command_id: msg.payload?.command_id, reason: result.error, code: result.code }, seq))
          } else {
            ws.send(this._envelope(S2C.ACK, { command_id: msg.payload?.command_id, event: result.event, result: result.result }, seq))
          }
        } catch (e) {
          ws.send(this._envelope(S2C.REJECT, { command_id: msg.payload?.command_id, reason: e.message }, 0))
        }
        return
      }
    }
    // Un COMMAND pipelined no puede adelantar la autenticación/SNAPSHOT.
    ws.on('message', raw => {
      mensajes = mensajes.then(() => ws.readyState === ws.OPEN && recibir(raw))
        .catch(() => { try { ws.close(1011, 'no se pudo procesar el mensaje') } catch {} })
    })

    ws.on('pong', () => {
      if (clientId && this._clients.has(clientId)) {
        this._clients.get(clientId).lastPong = Date.now()
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      if (clientId && this._clients.get(clientId)?.ws === ws) {
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
    if (this._wss) for (const ws of this._wss.clients) ws.terminate()
    if (this._wss)       this._wss.close()
  }
}

module.exports = { WsHub, LOCK_EXPIRY_MS }
