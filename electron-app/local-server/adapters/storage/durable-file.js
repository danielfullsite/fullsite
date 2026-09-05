'use strict'
const fs = require('fs')
const path = require('path')

// Windows does not expose directory fsync through Node. File data is flushed;
// power-cut certification on Windows remains a separate release gate.
function syncDirectory(filePath) {
  if (process.platform === 'win32') return
  const fd = fs.openSync(path.dirname(filePath), 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function writeAll(fd, bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  let offset = 0
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset)
    if (!written) throw new Error('Storage write made no progress')
    offset += written
  }
}
function replaceFile(filePath, bytes) {
  const fd = fs.openSync(filePath + '.tmp', 'w', 0o600)
  try { writeAll(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(filePath + '.tmp', filePath)
  syncDirectory(filePath)
}
module.exports = { syncDirectory, writeAll, replaceFile }
