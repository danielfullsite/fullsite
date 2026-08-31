'use strict'

// HTTPS POS -> localhost bridge preflight (Private Network Access).
// A browser navigation to /health does not exercise this path; fetch() does.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildHttpRouter } = require('../index')

function mkRes() {
  return {
    statusCode: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v },
    writeHead(code, hdrs) {
      this.statusCode = code
      for (const [k, v] of Object.entries(hdrs || {})) this.headers[String(k).toLowerCase()] = v
    },
    end() {},
  }
}

test('OPTIONS authorizes HTTPS renderer access to the private localhost bridge', async () => {
  const router = buildHttpRouter({})
  const req = {
    url: '/health',
    method: 'OPTIONS',
    headers: {
      origin: 'https://app.fullsite.mx',
      'access-control-request-method': 'GET',
      'access-control-request-private-network': 'true',
    },
    on() {},
    socket: { remoteAddress: '127.0.0.1' },
  }
  const res = mkRes()

  await router(req, res)

  assert.equal(res.statusCode, 204)
  assert.equal(res.headers['access-control-allow-origin'], '*')
  assert.match(res.headers['access-control-allow-methods'], /GET/)
  assert.equal(res.headers['access-control-allow-private-network'], 'true')
  assert.match(res.headers.vary, /Access-Control-Request-Private-Network/)
})
