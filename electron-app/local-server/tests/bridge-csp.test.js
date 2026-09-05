'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { withLocalBridgeCsp } = require('../core/bridge-csp')

test('configured port reaches Pedro without changing script, image or other origins', () => {
  const original = { 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.test"], 'x-test': ['same'] }
  const updated = withLocalBridgeCsp(original, 57156)
  assert.match(updated['Content-Security-Policy'][0], /http:\/\/127.0.0.1:57156 ws:\/\/127.0.0.1:57156/)
  assert.match(updated['Content-Security-Policy'][0], /script-src 'self'/)
  assert.match(updated['Content-Security-Policy'][0], /https:\/\/api.example.test/)
  assert.equal(updated['Content-Security-Policy'][0].includes('*'), false)
  assert.equal(original['Content-Security-Policy'][0].includes('57156'), false)
  assert.deepEqual(updated['x-test'], ['same'])
})

test('missing connect-src retains the default restriction for everything else', () => {
  const result = withLocalBridgeCsp({ 'content-security-policy': ["default-src 'none'; img-src 'self'"] }, 8117)
  assert.equal(result['content-security-policy'][0], "default-src 'none'; img-src 'self'; connect-src http://127.0.0.1:8117 ws://127.0.0.1:8117")
})

test('multiple policies each allow the same local bridge without duplicate sources', () => {
  const result = withLocalBridgeCsp({ 'content-security-policy': ["connect-src 'self'", "connect-src 'none'"] }, 8117)
  assert.deepEqual(withLocalBridgeCsp(result, 8117), result)
  assert(result['content-security-policy'].every(policy => policy.includes('127.0.0.1:8117')))
  assert.throws(() => withLocalBridgeCsp({}, '8117; script-src *'), /Invalid/)
})
