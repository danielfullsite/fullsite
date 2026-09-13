'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('the fingerprint IPC secret is random, durable and never repaired open', t => {
  const { prepareFingerprintIpcSecret, resolveFingerprintIpcDirectory, FILE_NAME, HEADER_SIGNATURE } = require('../core/fingerprint-ipc-secret')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-fingerprint-ipc-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const first = prepareFingerprintIpcSecret({ directory })
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(prepareFingerprintIpcSecret({ directory }), first)
  assert.equal(FILE_NAME, 'fingerprint-ipc-secret')
  assert.equal(HEADER_SIGNATURE, 'x-fullsite-fingerprint-signature')
  assert.equal(resolveFingerprintIpcDirectory({ platform: 'win32', userDataDirectory: 'C:\\Users\\caja\\AppData\\Roaming\\Fullsite POS' }), path.join('C:\\Users\\caja\\AppData\\Roaming\\Fullsite POS', 'fingerprint'))
  assert.equal(resolveFingerprintIpcDirectory({ platform: 'darwin', userDataDirectory: '/private/app' }), path.join('/private/app', 'fingerprint'))
  assert.equal(fs.readFileSync(path.join(directory, FILE_NAME), 'utf8').trim(), first)
  // Windows reports synthetic POSIX mode bits (typically 0666) even after its
  // real DACL is private. The Windows guarantee is the icacls assertion below;
  // chmod mode is meaningful only on POSIX hosts.
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, FILE_NAME)).mode & 0o777, 0o600)

  const windowsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-fingerprint-ipc-win-'))
  t.after(() => fs.rmSync(windowsDirectory, { recursive: true, force: true }))
  const aclCalls = []
  prepareFingerprintIpcSecret({
    directory: windowsDirectory,
    platform: 'win32',
    username: 'caja',
    runAcl: (command, args) => aclCalls.push({ command, args }),
  })
  assert.deepEqual(aclCalls, [{
    command: 'icacls.exe',
    args: [path.join(windowsDirectory, FILE_NAME), '/inheritance:r', '/grant:r', 'caja:(F)', 'SYSTEM:(F)'],
  }])

  fs.writeFileSync(path.join(directory, FILE_NAME), 'weak')
  assert.throws(() => prepareFingerprintIpcSecret({ directory }), /inválido/i)
})

test('mutual HMAC binds request and response without sending the secret', () => {
  const {
    createFingerprintIpcRequestAuth,
    createFingerprintIpcResponseAuth,
    verifyFingerprintIpcResponse,
    HEADER_RESPONSE_SIGNATURE,
  } = require('../core/fingerprint-ipc-secret')
  const secret = '7'.repeat(64)
  const now = 1_800_000_000_000
  const request = createFingerprintIpcRequestAuth({
    secret,
    method: 'POST',
    path: '/identify?attempt=1',
    body: '{"probe":true}',
    now,
    nonce: 'a'.repeat(64),
  })
  assert.equal(Object.values(request.headers).includes(secret), false, 'the bearer secret must never cross HTTP')

  const body = '{"ok":true,"staffId":"admin-1"}'
  const responseHeaders = createFingerprintIpcResponseAuth({ secret, context: request.context, statusCode: 200, body })
  assert.match(responseHeaders[HEADER_RESPONSE_SIGNATURE], /^[a-f0-9]{64}$/)
  assert.equal(verifyFingerprintIpcResponse({ secret, context: request.context, statusCode: 200, body, headers: responseHeaders, now }), true)

  for (const changed of [
    { statusCode: 401, body },
    { statusCode: 200, body: body + ' ' },
    { statusCode: 200, body, context: { ...request.context, method: 'GET' } },
    { statusCode: 200, body, context: { ...request.context, path: '/enroll?id=admin-1' } },
    { statusCode: 200, body, context: { ...request.context, nonce: 'b'.repeat(64) } },
  ]) {
    assert.throws(() => verifyFingerprintIpcResponse({
      secret,
      context: changed.context || request.context,
      statusCode: changed.statusCode,
      body: changed.body,
      headers: responseHeaders,
      now,
    }), { code: 'FINGERPRINT_SERVICE_UNAUTHENTICATED' })
  }
  assert.throws(() => verifyFingerprintIpcResponse({
    secret, context: request.context, statusCode: 200, body, headers: responseHeaders, now: now + 30_001,
  }), { code: 'FINGERPRINT_RESPONSE_STALE' })
})

test('Pedro rejects a process that squats on 7718 and cannot sign the response', async t => {
  const { requestFingerprintService } = require('../index')
  const fake = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true,"staffId":"admin-1"}')
  })
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => fake.close(resolve)))
  await assert.rejects(requestFingerprintService({
    method: 'GET', path: '/identify', ipcSecret: '8'.repeat(64), port: fake.address().port,
  }), { code: 'FINGERPRINT_SERVICE_UNAUTHENTICATED' })
})

test('a captured response cannot be replayed against a fresh request nonce', async t => {
  const {
    createFingerprintIpcResponseAuth,
    HEADER_NONCE,
    HEADER_RESPONSE_SIGNATURE,
  } = require('../core/fingerprint-ipc-secret')
  const { requestFingerprintService } = require('../index')
  const secret = '9'.repeat(64)
  let capturedSignature = null
  let firstNonce = null
  const fake = http.createServer((req, res) => {
    const body = '{"ok":true}'
    const timestamp = req.headers['x-fullsite-fingerprint-timestamp']
    const nonce = req.headers[HEADER_NONCE]
    let signature
    if (!capturedSignature) {
      firstNonce = nonce
      signature = createFingerprintIpcResponseAuth({
        secret,
        context: { timestamp, nonce, method: req.method, path: req.url },
        statusCode: 200,
        body,
      })[HEADER_RESPONSE_SIGNATURE]
      capturedSignature = signature
    } else {
      assert.notEqual(nonce, firstNonce, 'Pedro must issue a fresh nonce per request')
      signature = capturedSignature
    }
    res.writeHead(200, { 'Content-Type': 'application/json', [HEADER_RESPONSE_SIGNATURE]: signature })
    res.end(body)
  })
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => fake.close(resolve)))
  const options = { method: 'GET', path: '/health', ipcSecret: secret, port: fake.address().port }
  assert.equal((await requestFingerprintService(options)).statusCode, 200)
  await assert.rejects(requestFingerprintService(options), { code: 'FINGERPRINT_SERVICE_UNAUTHENTICATED' })
})

test('the C# service fails closed before capture or template mutation and rejects replay', () => {
  const source = read('print-bridge/fingerprint-service.cs')
  assert.match(source, /FULLSITE_FINGERPRINT_IPC_SECRET/)
  assert.match(source, /fingerprint-ipc-secret/)
  assert.match(source, /X-Fullsite-Fingerprint-Signature/i)
  assert.match(source, /X-Fullsite-Fingerprint-Response-Signature/i)
  assert.match(source, /ConstantTimeEquals/)
  assert.match(source, /ipc_auth_required\\\":true/)
  assert.match(source, /RequireIpcAuth\(req, requestBody, res, out json, out auth\)/)
  assert.ok(source.indexOf('RequireIpcAuth(req, requestBody') < source.indexOf('switch (path)'), 'authentication must run before route work')
  assert.match(source, /seenNonces/)
  assert.match(source, /FINGERPRINT_IPC_REPLAY/)
  assert.match(source, /ResponseCanonical/)
  assert.doesNotMatch(source, /Access-Control-Allow-Origin\", "\*"/)
  assert.doesNotMatch(source, /X-Fullsite-Fingerprint-IPC["']/i)
})

test('Electron provisions the secret before probing/spawning and authenticates an existing service', () => {
  const main = read('electron-app/main.js')
  const start = main.slice(main.indexOf('function startFingerprintService()'), main.indexOf('// ─── MAIN WINDOW'))
  const prepareAt = start.indexOf('prepareFingerprintIpcSecret')
  const probeAt = start.indexOf('/health')
  const spawnAt = start.indexOf('spawn(fpExe')
  assert.ok(prepareAt >= 0 && prepareAt < probeAt && probeAt < spawnAt)
  assert.match(start, /FULLSITE_FINGERPRINT_IPC_SECRET/)
  assert.match(main, /resolveFingerprintIpcDirectory/)
  assert.match(start, /createFingerprintIpcRequestAuth/)
  assert.match(start, /verifyFingerprintIpcResponse/)
  assert.match(start, /ipc_auth_scheme/)
  assert.match(start, /actualiza fingerprint-service\.exe/i)
  const healthProbe = start.slice(start.indexOf('http.get('), start.indexOf("testReq.on('error'"))
  assert.match(healthProbe, /headers: healthAuth\.headers/)
  assert.doesNotMatch(healthProbe, /x-fullsite-fingerprint-ipc/i, 'an untrusted process already bound to 7718 must not receive the bearer secret during health probing')
  assert.doesNotMatch(read('electron-app/local-server/core/renderer-identity.js'), /fingerprint-ipc-secret|FULLSITE_FINGERPRINT_IPC_SECRET|x-fullsite-fingerprint-ipc/i)
})

test('the manual repair path provisions the same private secret and verifies mutual HMAC', () => {
  const install = read('print-bridge/install-fingerprint.ps1')
  const docs = read('electron-app/fingerprint/README.md')
  assert.match(install, /fingerprint-ipc-secret/)
  assert.match(install, /RandomNumberGenerator/)
  assert.match(install, /FULLSITE_FINGERPRINT_IPC_SECRET/)
  assert.match(install, /X-Fullsite-Fingerprint-Response-Signature/)
  assert.match(install, /Get-HmacHex/)
  assert.match(install, /LASTEXITCODE/)
  assert.match(docs, /servicio anterior/i)
  assert.match(docs, /fail.closed|fall[ae] cerrado/i)
  assert.match(docs, /HMAC/i)
  assert.match(docs, /nunca cruza HTTP/i)
})
