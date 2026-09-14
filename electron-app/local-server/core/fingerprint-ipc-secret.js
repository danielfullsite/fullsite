'use strict'

const crypto = require('node:crypto')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const FILE_NAME = 'fingerprint-ipc-secret'
const HEADER_TIMESTAMP = 'x-fullsite-fingerprint-timestamp'
const HEADER_NONCE = 'x-fullsite-fingerprint-nonce'
const HEADER_SIGNATURE = 'x-fullsite-fingerprint-signature'
const HEADER_RESPONSE_SIGNATURE = 'x-fullsite-fingerprint-response-signature'
const AUTH_VERSION = 'fullsite-fingerprint-hmac-v1'
const MAX_CLOCK_SKEW_MS = 30_000

function resolveFingerprintIpcDirectory({ userDataDirectory }) {
  if (typeof userDataDirectory !== 'string' || !userDataDirectory) throw new Error('Directorio privado de la app inválido')
  return path.join(userDataDirectory, 'fingerprint')
}

function prepareFingerprintIpcSecret({
  directory,
  platform = process.platform,
  username = process.env.USERNAME || os.userInfo().username,
  runAcl = (command, args) => childProcess.execFileSync(command, args, { stdio: 'ignore', windowsHide: true }),
}) {
  if (typeof directory !== 'string' || !directory) throw new Error('Directorio IPC de huella inválido')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, FILE_NAME)
  try { fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  fs.chmodSync(file, 0o600)
  if (platform === 'win32') {
    if (typeof username !== 'string' || !username.trim()) throw new Error('Usuario Windows inválido para proteger el secreto IPC')
    runAcl('icacls.exe', [file, '/inheritance:r', '/grant:r', `${username}:(F)`, 'SYSTEM:(F)'])
  }
  const secret = fs.readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Secreto IPC de huella inválido; requiere reparación manual')
  return secret
}

function validSecret(secret) {
  return typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)
}

function normalizeBody(body) {
  if (body == null) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  return Buffer.from(String(body), 'utf8')
}

function hashBody(body) {
  return crypto.createHash('sha256').update(normalizeBody(body)).digest('hex')
}

function hmac(secret, canonical) {
  if (!validSecret(secret)) throw new Error('Secreto IPC de huella inválido')
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(canonical, 'utf8').digest('hex')
}

function canonicalRequest({ timestamp, nonce, method, requestPath, body }) {
  return [AUTH_VERSION, timestamp, nonce, String(method || '').toUpperCase(), requestPath, hashBody(body)].join('\n')
}

function canonicalResponse({ timestamp, nonce, method, requestPath, statusCode, body }) {
  return [AUTH_VERSION + '-response', timestamp, nonce, String(method || '').toUpperCase(), requestPath,
    String(statusCode), hashBody(body)].join('\n')
}

/**
 * Autentica a Pedro sin mandar el secreto por el socket. El nonce liga una sola
 * petición a una sola respuesta y el hash liga método, ruta y cuerpo exactos.
 */
function createFingerprintIpcRequestAuth({ secret, method, path: requestPath, body = '', now = Date.now(), nonce = crypto.randomBytes(32).toString('hex') }) {
  if (!validSecret(secret)) throw new Error('Secreto IPC de huella inválido')
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Tiempo IPC de huella inválido')
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error('Nonce IPC de huella inválido')
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) throw new Error('Ruta IPC de huella inválida')
  const timestamp = String(now)
  const context = { timestamp, nonce, method: String(method || '').toUpperCase(), path: requestPath }
  const signature = hmac(secret, canonicalRequest({ ...context, requestPath, body }))
  return {
    context,
    headers: {
      [HEADER_TIMESTAMP]: timestamp,
      [HEADER_NONCE]: nonce,
      [HEADER_SIGNATURE]: signature,
    },
  }
}

function headerValue(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return headers.get(name) || ''
  return headers[name] || headers[name.toLowerCase()] || ''
}

function createFingerprintIpcResponseAuth({ secret, context, statusCode, body = '' }) {
  if (!context) throw new Error('Contexto IPC de huella inválido')
  return {
    [HEADER_RESPONSE_SIGNATURE]: hmac(secret, canonicalResponse({
      timestamp: context.timestamp,
      nonce: context.nonce,
      method: context.method,
      requestPath: context.path,
      statusCode,
      body,
    })),
  }
}

function verifyFingerprintIpcResponse({ secret, context, statusCode, body = '', headers, now = Date.now(), maxClockSkewMs = MAX_CLOCK_SKEW_MS }) {
  if (!context || !Number.isSafeInteger(Number(context.timestamp)) || Math.abs(now - Number(context.timestamp)) > maxClockSkewMs) {
    throw Object.assign(new Error('Respuesta biométrica vencida'), { code: 'FINGERPRINT_RESPONSE_STALE' })
  }
  const presented = headerValue(headers, HEADER_RESPONSE_SIGNATURE)
  const expected = hmac(secret, canonicalResponse({
    timestamp: context.timestamp,
    nonce: context.nonce,
    method: context.method,
    requestPath: context.path,
    statusCode,
    body,
  }))
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('El servicio de huella no demostró su identidad'), { code: 'FINGERPRINT_SERVICE_UNAUTHENTICATED' })
  }
  return true
}

module.exports = {
  prepareFingerprintIpcSecret,
  resolveFingerprintIpcDirectory,
  createFingerprintIpcRequestAuth,
  createFingerprintIpcResponseAuth,
  verifyFingerprintIpcResponse,
  canonicalRequest,
  canonicalResponse,
  hashBody,
  FILE_NAME,
  HEADER_TIMESTAMP,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_RESPONSE_SIGNATURE,
  AUTH_VERSION,
  MAX_CLOCK_SKEW_MS,
}
