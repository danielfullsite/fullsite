'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseJsonText, readJsonFile } = require('../core/json-file')

test('config JSON written by Windows PowerShell 5.1 accepts a UTF-8 BOM', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-json-'))
  const file = path.join(dir, 'config.json')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('{"restaurant_id":"amalay","lan_secret":"paired"}', 'utf8'),
  ]))

  assert.deepEqual(readJsonFile(fs, file), { restaurant_id: 'amalay', lan_secret: 'paired' })
})

test('only the leading BOM is normalised; malformed JSON remains rejected', () => {
  assert.throws(() => parseJsonText('\uFEFF{"restaurant_id":}'), SyntaxError)
  assert.throws(() => parseJsonText('{"restaurant_id":"ama\uFEFFlay"}trailing'), SyntaxError)
})
