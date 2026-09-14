'use strict'

// Windows PowerShell 5.1 writes `-Encoding UTF8` with a UTF-8 BOM. JSON permits
// surrounding whitespace, but JSON.parse does not accept U+FEFF at position 0.
// Field provisioning scripts commonly create config.json from PowerShell, so
// normalise that one encoding marker before parsing. Nothing else is repaired:
// malformed JSON must still fail closed and surface its real error.
function parseJsonText(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ''))
}

function readJsonFile(fs, filePath) {
  return parseJsonText(fs.readFileSync(filePath, 'utf8'))
}

module.exports = { parseJsonText, readJsonFile }
