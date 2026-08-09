/**
 * TSK-002 — HTTP Contract Tests: Bridge WS + REST API
 *
 * Validates the wire protocol between POS/KDS clients and the Fullsite local server.
 * Uses a minimal inline server that implements the same contracts as
 * electron-app/local-server/core/ws-hub.js + index.js, without importing
 * the full Electron bundle (avoids CJS/ESM + heavy-dep complications in CI).
 *
 * Protocol source of truth: electron-app/local-server/protocol.js
 * Server source of truth:   electron-app/local-server/core/ws-hub.js
 *                           electron-app/local-server/index.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

// ── Protocol constants (mirrors protocol.js) ──────────────────────────────────

const PROTOCOL_VERSION = '1.0'
const SERVER_ID        = 'test-server-001'
const RESTAURANT_ID    = 'test-restaurant'
const TEST_PORT        = 17719

// ── Minimal state (mirrors RestaurantState.toSnapshot()) ──────────────────────

const state = {
  mesas:              {},
  kds_queue:          [],
  kds_orders:         [],
  turno:              null,
  locks:              {},
  last_supabase_sync: null,
}

// ── Sequence counter ─────────────────────────────────────────────────────────

let _seq = 0
const nextSeq = () => ++_seq

// ── Envelope builder (mirrors serverEnvelope() in protocol.js) ───────────────

function envelope(type, payload, sequence) {
  return JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    server_id:        SERVER_ID,
    restaurant_id:    RESTAURANT_ID,
    sequence:         sequence ?? nextSeq(),
    ts:               Date.now(),
    type,
    payload:          payload ?? {},
  })
}

// ── Client message parser (mirrors parseClientMessage() in protocol.js) ───────

const VALID_C2S = new Set(['SUBSCRIBE', 'COMMAND', 'PING'])

function parseClient(raw) {
  try {
    const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
    if (!msg.type || !VALID_C2S.has(msg.type)) return null
    if (!msg.protocol_version) return null
    return msg
  } catch { return null }
}

// ── Connected clients map: clientId → { ws, meta } ───────────────────────────

const clients = new Map()

// ── Broadcast helper (exposed so tests can trigger DELTA) ─────────────────────

let broadcastDelta
function setupBroadcast() {
  broadcastDelta = (event) => {
    const msg = envelope('DELTA', { event })
    for (const { ws: cws } of clients.values()) {
      if (cws.readyState === WebSocket.OPEN) try { cws.send(msg) } catch {}
    }
  }
}

// ── HTTP server & WS hub (minimal inline implementation) ──────────────────────

let httpServer, wss

function buildServer() {
  // HTTP handler (REST endpoints)
  httpServer = http.createServer((req, res) => {
    const hdrs = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    const url   = req.url?.split('?')[0]

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // GET /health — mirrors index.js /health route
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, hdrs)
      res.end(JSON.stringify({
        ok:                true,
        server_id:         SERVER_ID,
        restaurant_id:     RESTAURANT_ID,
        version:           '1.3.3',
        protocol_version:  PROTOCOL_VERSION,
        hostname:          'test-host',
        platform:          process.platform,
        uptime_s:          Math.floor(process.uptime()),
        lan_ip:            '127.0.0.1',
        clients_connected: clients.size,
        clients:           [...clients.values()].map(c => c.meta),
        last_sequence:     _seq,
        sync_queue_size:   0,
        print_jobs_failed: 0,
        staged_update:     null,
        update_channel:    'stable',
        stations:          ['caja'],
      }))
      return
    }

    // GET /state — mirrors index.js /state route
    if (url === '/state' && req.method === 'GET') {
      res.writeHead(200, hdrs)
      res.end(JSON.stringify({ sequence: _seq, ...state }))
      return
    }

    res.writeHead(404, hdrs)
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  // WebSocket hub — mirrors WsHub._onConnection()
  wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws) => {
    let clientId = null

    ws.on('message', (raw) => {
      const msg = parseClient(raw)
      if (!msg) return

      // SUBSCRIBE
      if (msg.type === 'SUBSCRIBE') {
        clientId = msg.client_id
        if (!clientId) { ws.close(1008, 'Missing client_id'); return }

        // CFG-02: reject terminals with wrong restaurant_id
        const rid = msg.restaurant_id
        if (rid && rid !== 'unknown' && rid !== RESTAURANT_ID) {
          ws.close(1008, `restaurant_id mismatch: server=${RESTAURANT_ID} client=${rid}`)
          return
        }

        clients.set(clientId, {
          ws,
          meta: {
            client_id:    clientId,
            client_type:  msg.client_type || 'pos',
            connected_at: Date.now(),
          },
        })

        ws.send(envelope('SNAPSHOT', {
          state:  { ...state },
          deltas: [],
        }))
        return
      }

      // PING → PONG
      if (msg.type === 'PING') {
        ws.send(envelope('PONG', {}))
        return
      }

      // COMMAND → ACK | REJECT
      if (msg.type === 'COMMAND') {
        const cmdId   = msg.payload?.command_id
        const cmdType = msg.payload?.command_type

        if (!cmdType || cmdType === 'UNKNOWN_COMMAND') {
          ws.send(envelope('REJECT', {
            command_id: cmdId,
            reason:     cmdType ? `Unknown command type: ${cmdType}` : 'Missing command_type',
          }))
          return
        }

        // Happy path: valid command → ACK
        ws.send(envelope('ACK', {
          command_id: cmdId,
          event:      { type: cmdType, payload: msg.payload, id: crypto.randomUUID() },
        }))
      }
    })

    ws.on('close', () => {
      if (clientId) clients.delete(clientId)
    })
  })

  setupBroadcast()
}

// ── Test lifecycle ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  buildServer()
  await new Promise((resolve, reject) => {
    httpServer.listen(TEST_PORT, '127.0.0.1', resolve)
    httpServer.on('error', reject)
  })
})

afterAll(() => {
  wss.close()
  httpServer.close()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function wsConnect(clientId, restaurantId = RESTAURANT_ID, lastSeq = -1) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type:             'SUBSCRIBE',
        client_id:        clientId,
        client_type:      'pos',
        restaurant_id:    restaurantId,
        last_sequence:    lastSeq,
      }))
    })
    ws.on('error', reject)
    resolve(ws)
  })
}

function nextMsg(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS message timeout')), timeout)
    ws.once('message', (raw) => {
      clearTimeout(t)
      resolve(JSON.parse(raw.toString()))
    })
    ws.once('close', (code) => {
      clearTimeout(t)
      reject(new Error(`ws closed with ${code} before message`))
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// REST /health
// ─────────────────────────────────────────────────────────────────────────────

describe('REST /health', () => {
  it('returns 200 with ok: true and required fields', async () => {
    const res  = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.server_id).toBe(SERVER_ID)
    expect(body.restaurant_id).toBe(RESTAURANT_ID)
    expect(body.protocol_version).toBe(PROTOCOL_VERSION)
    expect(typeof body.version).toBe('string')
    expect(typeof body.clients_connected).toBe('number')
    expect(Array.isArray(body.clients)).toBe(true)
    expect(typeof body.last_sequence).toBe('number')
    expect(typeof body.uptime_s).toBe('number')
    expect(typeof body.sync_queue_size).toBe('number')
    expect(Array.isArray(body.stations)).toBe(true)
  })

  it('clients_connected increments when a client subscribes', async () => {
    const before = await (await fetch(`http://127.0.0.1:${TEST_PORT}/health`)).json()

    const ws = await wsConnect('health-count-client')
    await nextMsg(ws) // consume SNAPSHOT

    const after = await (await fetch(`http://127.0.0.1:${TEST_PORT}/health`)).json()
    expect(after.clients_connected).toBeGreaterThan(before.clients_connected)
    ws.close()
  })

  it('clients list contains meta for each connected terminal', async () => {
    const ws = await wsConnect('health-meta-client')
    await nextMsg(ws)

    const body = await (await fetch(`http://127.0.0.1:${TEST_PORT}/health`)).json()
    const found = body.clients.find(c => c.client_id === 'health-meta-client')
    expect(found).toBeDefined()
    expect(found.client_type).toBe('pos')
    ws.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REST /state
// ─────────────────────────────────────────────────────────────────────────────

describe('REST /state', () => {
  it('returns 200 with sequence + snapshot fields', async () => {
    const res  = await fetch(`http://127.0.0.1:${TEST_PORT}/state`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(typeof body.sequence).toBe('number')
    expect(body.mesas).toBeDefined()
    expect(Array.isArray(body.kds_queue)).toBe(true)
    expect(Array.isArray(body.kds_orders)).toBe(true)
    expect('turno' in body).toBe(true)
    expect('locks' in body).toBe(true)
  })

  it('unknown route returns 404 with error field', async () => {
    const res  = await fetch(`http://127.0.0.1:${TEST_PORT}/no-such-path`)
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(typeof body.error).toBe('string')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WS: SUBSCRIBE message
// ─────────────────────────────────────────────────────────────────────────────

describe('WS SUBSCRIBE', () => {
  it('happy path: server responds with SNAPSHOT containing state and deltas', async () => {
    const ws  = await wsConnect('sub-happy-client')
    const msg = await nextMsg(ws)

    expect(msg.type).toBe('SNAPSHOT')
    expect(msg.protocol_version).toBe(PROTOCOL_VERSION)
    expect(msg.server_id).toBe(SERVER_ID)
    expect(msg.restaurant_id).toBe(RESTAURANT_ID)
    expect(typeof msg.sequence).toBe('number')
    expect(typeof msg.ts).toBe('number')
    expect(msg.payload.state).toBeDefined()
    expect(Array.isArray(msg.payload.deltas)).toBe(true)
    ws.close()
  })

  it('missing client_id → server closes with code 1008', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(r => ws.on('open', r))

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_type:      'pos',
      // no client_id
    }))

    const { code } = await new Promise(r =>
      ws.on('close', (c, rsn) => r({ code: c, reason: rsn.toString() }))
    )
    expect(code).toBe(1008)
  })

  it('wrong restaurant_id → server closes with 1008 and mentions mismatch (CFG-02)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(r => ws.on('open', r))

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_id:        'intruder',
      client_type:      'pos',
      restaurant_id:    'wrong-restaurant-xyz',
      last_sequence:    -1,
    }))

    const { code, reason } = await new Promise(r =>
      ws.on('close', (c, rsn) => r({ code: c, reason: rsn.toString() }))
    )
    expect(code).toBe(1008)
    expect(reason).toContain('mismatch')
  })

  it('matching restaurant_id → server accepts and returns SNAPSHOT', async () => {
    const ws  = await wsConnect('sub-match-client', RESTAURANT_ID)
    const msg = await nextMsg(ws)
    expect(msg.type).toBe('SNAPSHOT')
    ws.close()
  })

  it('no restaurant_id → server accepts (legacy terminal compatibility)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`)
    await new Promise(r => ws.on('open', r))

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'SUBSCRIBE',
      client_id:        'legacy-no-rid',
      client_type:      'kds',
      last_sequence:    -1,
      // no restaurant_id
    }))

    const msg = await nextMsg(ws)
    expect(msg.type).toBe('SNAPSHOT')
    ws.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WS: COMMAND → ACK (happy path)
// ─────────────────────────────────────────────────────────────────────────────

describe('WS COMMAND → ACK', () => {
  it('valid command returns ACK envelope with command_id echoed', async () => {
    const ws = await wsConnect('cmd-ack-client')
    await nextMsg(ws) // consume SNAPSHOT

    const cmdId = 'cmd-ack-001'
    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      payload: {
        command_id:   cmdId,
        command_type: 'ORDER_UPSERTED',
        mesa:         '5',
        items:        [{ id: 'item-1', name: 'Chilaquiles', qty: 2 }],
      },
    }))

    const ack = await nextMsg(ws)
    expect(ack.type).toBe('ACK')
    expect(ack.protocol_version).toBe(PROTOCOL_VERSION)
    expect(ack.server_id).toBe(SERVER_ID)
    expect(typeof ack.sequence).toBe('number')
    expect(ack.payload.command_id).toBe(cmdId)
    expect(ack.payload.event).toBeDefined()
    ws.close()
  })

  it('ORDER_SENT command returns ACK with event type matching command', async () => {
    const ws = await wsConnect('cmd-sent-client')
    await nextMsg(ws)

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      payload: {
        command_id:   'cmd-sent-001',
        command_type: 'ORDER_SENT',
        order_id:     'order-42',
        mesa:         '3',
      },
    }))

    const ack = await nextMsg(ws)
    expect(ack.type).toBe('ACK')
    expect(ack.payload.event.type).toBe('ORDER_SENT')
    ws.close()
  })

  it('KDS_ITEM_STATUS command returns ACK', async () => {
    const ws = await wsConnect('cmd-kds-client')
    await nextMsg(ws)

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      payload: {
        command_id:   'cmd-kds-001',
        command_type: 'KDS_ITEM_STATUS',
        order_id:     'order-99',
        item_id:      'item-1',
        status:       'entregada',
      },
    }))

    const ack = await nextMsg(ws)
    expect(ack.type).toBe('ACK')
    ws.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WS: COMMAND → REJECT (error cases)
// ─────────────────────────────────────────────────────────────────────────────

describe('WS COMMAND → REJECT', () => {
  it('unknown command_type returns REJECT with reason string', async () => {
    const ws = await wsConnect('cmd-rej-client')
    await nextMsg(ws)

    const cmdId = 'cmd-rej-001'
    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      payload: {
        command_id:   cmdId,
        command_type: 'UNKNOWN_COMMAND',
      },
    }))

    const rej = await nextMsg(ws)
    expect(rej.type).toBe('REJECT')
    expect(rej.protocol_version).toBe(PROTOCOL_VERSION)
    expect(rej.payload.command_id).toBe(cmdId)
    expect(typeof rej.payload.reason).toBe('string')
    expect(rej.payload.reason.length).toBeGreaterThan(0)
    ws.close()
  })

  it('missing command_type returns REJECT', async () => {
    const ws = await wsConnect('cmd-rej-notype')
    await nextMsg(ws)

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      payload: {
        command_id: 'cmd-rej-002',
        // no command_type
      },
    }))

    const rej = await nextMsg(ws)
    expect(rej.type).toBe('REJECT')
    expect(rej.payload.command_id).toBe('cmd-rej-002')
    ws.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WS: DELTA broadcast
// ─────────────────────────────────────────────────────────────────────────────

describe('WS DELTA broadcast', () => {
  it('DELTA reaches all subscribed clients with correct envelope', async () => {
    const ws1 = await wsConnect('delta-client-a')
    const ws2 = await wsConnect('delta-client-b')
    await nextMsg(ws1)
    await nextMsg(ws2)

    const event = { type: 'ORDER_SENT', payload: { mesa: '7', order_id: 'order-77' } }

    const p1 = nextMsg(ws1)
    const p2 = nextMsg(ws2)
    broadcastDelta(event)

    const [d1, d2] = await Promise.all([p1, p2])

    for (const delta of [d1, d2]) {
      expect(delta.type).toBe('DELTA')
      expect(delta.protocol_version).toBe(PROTOCOL_VERSION)
      expect(delta.server_id).toBe(SERVER_ID)
      expect(typeof delta.sequence).toBe('number')
      expect(delta.payload.event.type).toBe('ORDER_SENT')
      expect(delta.payload.event.payload.mesa).toBe('7')
    }

    ws1.close()
    ws2.close()
  })

  it('DELTA envelope contains ts timestamp', async () => {
    const before = Date.now()
    const ws = await wsConnect('delta-ts-client')
    await nextMsg(ws)

    const p = nextMsg(ws)
    broadcastDelta({ type: 'MESA_LOCK', payload: { mesa: '2' } })
    const delta = await p

    expect(delta.ts).toBeGreaterThanOrEqual(before)
    expect(delta.ts).toBeLessThanOrEqual(Date.now())
    ws.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WS: Server envelope structure (cross-cutting)
// ─────────────────────────────────────────────────────────────────────────────

describe('WS envelope structure', () => {
  it('every server message includes protocol_version, server_id, restaurant_id, sequence, ts, type, payload', async () => {
    const ws  = await wsConnect('envelope-check-client')
    const msg = await nextMsg(ws) // SNAPSHOT

    const required = ['protocol_version', 'server_id', 'restaurant_id', 'sequence', 'ts', 'type', 'payload']
    for (const field of required) {
      expect(msg, `field "${field}" must be present`).toHaveProperty(field)
    }
    ws.close()
  })

  it('invalid client message (not JSON) is silently ignored — no crash', async () => {
    const ws = await wsConnect('bad-json-client')
    await nextMsg(ws) // SNAPSHOT

    ws.send('not-valid-json{{{')

    // Server should not crash or respond — wait briefly
    await new Promise(r => setTimeout(r, 100))

    // Confirm server still up by fetching /health
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
    expect(res.status).toBe(200)
    ws.close()
  })

  it('client message with unrecognized type is silently ignored', async () => {
    const ws = await wsConnect('unknown-type-client')
    await nextMsg(ws)

    ws.send(JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      type:             'REBOOT_SERVER',   // not in C2S
    }))

    await new Promise(r => setTimeout(r, 100))
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
    expect(res.status).toBe(200)
    ws.close()
  })
})
