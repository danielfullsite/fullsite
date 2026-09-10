'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http')
const { buildHttpRouter } = require('../index'), cred = require('../core/credencial-lan')
const secret = cred.generarSecreto()
const headers = cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'lab', terminalId: 'pos2' })
const job = { job_id: 'job', uncertain_episode_id: 'episode', printer_name: 'Caja', document_type: 'receipt' }
function router(permissions = ['imprimir_cuentas'], extra = {}) {
  return buildHttpRouter({ restaurantId: 'lab', config: { lanSecret: secret, terminalId: 'pos2' },
    state: { toSnapshot: () => ({ write_authority: 'caja' }) },
    actorAuthority: { verify(token, terminal) { assert.equal(terminal, 'pos2'); if (token !== 'signed') throw new Error('Invalid actor'); return { permissions } } },
    printer: { getUncertainJobSummaries: () => [job], getUncertainJobs: () => [{ ...job, data_b64: 'private-bytes', connection: { host: 'private' } }] }, ...extra,
  })
}
async function get(route, token) {
  const request = { method: 'GET', url: '/print/uncertain', headers: { ...headers, ...(token ? { 'x-fullsite-actor': token } : {}) }, socket: { remoteAddress: '127.0.0.1' } }
  const response = { statusCode: 0, body: '', setHeader() {}, writeHead(status) { this.statusCode = status }, end(body) { this.body = body } }
  await route(request, response); return response
}
test('Caja requires employee permission and returns only the uncertain paper summary', async () => {
  assert.equal((await get(router())).statusCode, 403)
  assert.equal((await get(router([]), 'signed')).statusCode, 403)
  const response = await get(router(), 'signed')
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), { authoritative: true, jobs: [job] })
  assert(!response.body.includes('private'))
})
test('secondary forwards actor to Caja and cannot substitute its own empty queue on disconnect', async t => {
  const primary = http.createServer(router())
  await new Promise(resolve => primary.listen(0, '127.0.0.1', resolve))
  t.after(() => primary.close())
  const secondary = router([], { posServerIp: '127.0.0.1', posServerPort: primary.address().port })
  assert.equal((await get(secondary)).statusCode, 403)
  const response = await get(secondary, 'signed')
  assert.equal(response.statusCode, 200); assert.deepEqual(JSON.parse(response.body).jobs, [job])
  await new Promise(resolve => primary.close(resolve))
  assert.equal((await get(secondary, 'signed')).statusCode, 502)
})
