'use strict'
// Tests for the rotating file logger.
// Run: node --test electron-app/local-server/tests/logger.test.js

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')

let tmpDir

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-logger-test-'))
})

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
})

// Return a fresh, uncached module instance so each test has isolated state.
function freshLogger() {
  const p = path.resolve(__dirname, '../logger.js')
  delete require.cache[p]
  return require(p)
}

// ── Init & basic write ─────────────────────────────────────────────────────────

describe('init + basic write', () => {
  test('creates logDir and server.log on first write', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-init')
    logger.init(logDir)
    logger.info('startup message')

    const logFile = path.join(logDir, 'server.log')
    assert.ok(fs.existsSync(logFile), 'server.log should be created')

    const content = fs.readFileSync(logFile, 'utf8')
    assert.ok(content.includes('[INFO ]'), 'log level INFO should appear')
    assert.ok(content.includes('startup message'), 'message should appear in file')
  })

  test('log line is ISO timestamp + level + message', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-format')
    logger.init(logDir)
    logger.warn('format test')

    const line = fs.readFileSync(path.join(logDir, 'server.log'), 'utf8').trim()
    // Must start with an ISO date like 2025-01-01T00:00:00.000Z
    assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[WARN /)
    assert.ok(line.includes('format test'))
  })

  test('getLastEntry() is null before first write, populated after', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-last-entry')
    logger.init(logDir)

    assert.equal(logger.getLastEntry(), null)

    logger.error('boom')
    const entry = logger.getLastEntry()
    assert.ok(entry, 'getLastEntry() should not be null after a write')
    assert.equal(entry.level, 'ERROR')
    assert.ok(entry.msg.includes('boom'))
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('getLogPath() returns the active log file path', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-logpath')
    logger.init(logDir)
    assert.equal(logger.getLogPath(), path.join(logDir, 'server.log'))
  })
})

// ── All three levels ───────────────────────────────────────────────────────────

describe('log levels', () => {
  test('info / warn / error all write to file', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-levels')
    logger.init(logDir)
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    const content = fs.readFileSync(path.join(logDir, 'server.log'), 'utf8')
    assert.ok(content.includes('[INFO ]'))
    assert.ok(content.includes('[WARN ]'))
    assert.ok(content.includes('[ERROR]'))
  })
})

// ── Survive restart ────────────────────────────────────────────────────────────

describe('restart persistence', () => {
  test('logs written before restart are preserved; new logs are appended', () => {
    const logDir = path.join(tmpDir, 'test-restart')

    const logger1 = freshLogger()
    logger1.init(logDir)
    logger1.info('before restart')

    const logger2 = freshLogger()
    logger2.init(logDir)
    logger2.info('after restart')

    const content = fs.readFileSync(path.join(logDir, 'server.log'), 'utf8')
    assert.ok(content.includes('before restart'), 'pre-restart log must survive')
    assert.ok(content.includes('after restart'), 'post-restart log must be appended')
  })
})

// ── Rotation ───────────────────────────────────────────────────────────────────

describe('rotation', () => {
  test('rotates when file exceeds maxSizeBytes threshold', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-rotate-basic')
    // Use a 1KB threshold so rotation triggers quickly
    logger.init(logDir, { maxSizeBytes: 1024 })

    // Write ~3KB to force 2 rotations
    const msg = 'R'.repeat(200)
    for (let i = 0; i < 20; i++) logger.info(msg)

    const logPath = path.join(logDir, 'server.log')
    const base    = logPath.slice(0, -'.log'.length)

    // Active log must exist
    assert.ok(fs.existsSync(logPath), 'active server.log must exist after rotation')
    // Active log must be under threshold (+ one line's overhead)
    assert.ok(fs.statSync(logPath).size < 1024 + 300, 'active log size should be < threshold + one line')
    // At least one archive should exist
    assert.ok(fs.existsSync(`${base}.1.log`), 'server.1.log should exist after first rotation')
  })

  test('keeps at most 5 archived files — oldest is dropped', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-rotate-max')
    logger.init(logDir, { maxSizeBytes: 512 })

    // Write enough to force at least 7 rotations
    const msg = 'M'.repeat(200)
    for (let i = 0; i < 40; i++) logger.info(msg)

    const logPath = path.join(logDir, 'server.log')
    const base    = logPath.slice(0, -'.log'.length)

    assert.ok(fs.existsSync(logPath), 'active log must exist')

    let archiveCount = 0
    for (let i = 1; i <= 5; i++) {
      if (fs.existsSync(`${base}.${i}.log`)) archiveCount++
    }
    assert.equal(archiveCount, 5, `must have exactly 5 archives, found ${archiveCount}`)

    // server.6.log must not exist
    assert.ok(!fs.existsSync(`${base}.6.log`), 'server.6.log must NOT exist')
  })

  test('each archived file is <= threshold size', () => {
    const logger = freshLogger()
    const logDir = path.join(tmpDir, 'test-rotate-size')
    const MAX    = 512
    logger.init(logDir, { maxSizeBytes: MAX })

    const msg = 'S'.repeat(100)
    for (let i = 0; i < 30; i++) logger.info(msg)

    const logPath = path.join(logDir, 'server.log')
    const base    = logPath.slice(0, -'.log'.length)

    for (let i = 1; i <= 5; i++) {
      const archive = `${base}.${i}.log`
      if (fs.existsSync(archive)) {
        // Each archived file should not have grown past MAX + one line's slack
        assert.ok(
          fs.statSync(archive).size < MAX + 300,
          `server.${i}.log should be close to the threshold, not much larger`
        )
      }
    }
  })
})
