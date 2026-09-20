'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('the native reader no longer attempts the broken global-bearer cloud sync', () => {
  const source = read('print-bridge/fingerprint-service.cs')
  assert.doesNotMatch(source, /WebClient/)
  assert.doesNotMatch(source, /x-fp-secret/i)
  assert.doesNotMatch(source, /\/api\/pos\/fingerprint/i)
  assert.doesNotMatch(source, /Sync(?:From|To|DeleteFrom)Supabase/)
  assert.doesNotMatch(source, /fingerprintSyncSecret|fingerprint_sync_secret/)
  assert.match(source, /IsSafeStaffId\(staffId\)/)
  assert.match(source, /\^\[a-zA-Z0-9_-\]\{1,128\}\$/)
})

test('pilot template transfer is encrypted, tenant scoped, POS-only and recoverable', () => {
  const script = read('print-bridge/sync-fingerprint-templates.ps1')

  // A global LAN or cloud bearer must not authorize biometric movement.
  assert.doesNotMatch(script, /lanSecret|x-fullsite-lan|x-fp-secret|service_role/i)
  assert.match(script, /AES-256-CBC\+HMAC-SHA256/)
  assert.match(script, /Derive-Key \$masterKey 'encryption'/)
  assert.match(script, /Derive-Key \$masterKey 'authentication'/)
  assert.match(script, /Test-ConstantTimeEqual/)
  assert.ok(script.indexOf('Test-ConstantTimeEqual $presentedMac $expectedMac') < script.indexOf('$aes.CreateDecryptor()'),
    'authenticate ciphertext before decrypting it')

  // Caja is the one-way source. A KDS or a mis-provisioned secondary fails closed.
  assert.match(script, /Assert-Role \$configInfo 'server_pos'/)
  assert.match(script, /Assert-Role \$configInfo 'pos'/)
  assert.match(script, /TerminalRole -eq 'kds'/)
  assert.match(script, /Bundle pertenece a otro restaurante/)
  assert.match(script, /source_role = 'server_pos'/)
  assert.match(script, /Bundle vencido/)

  // The key is prompted securely on import, not prescribed on the command line.
  assert.match(script, /Read-Host 'Pega la clave efimera de transferencia' -AsSecureString/)
  assert.doesNotMatch(script, /clave de un solo uso/i)
  const usage = script.slice(0, script.indexOf('[CmdletBinding()]'))
  assert.doesNotMatch(usage, /-TransferKey/)
  const parameters = script.slice(script.indexOf('param('), script.indexOf('$ErrorActionPreference'))
  assert.doesNotMatch(parameters, /TransferKey|TemplatesDirectory|Force/)

  // Bounds and hashes are checked before materializing a replacement directory.
  const sizeCheck = script.indexOf("throw 'Tamano de bundle cifrado fuera de limite.'")
  const readBundle = script.indexOf('Get-Content -LiteralPath $resolvedBundle -Raw | ConvertFrom-Json')
  assert.ok(sizeCheck >= 0 && sizeCheck < readBundle)
  assert.match(script, /maxTemplateBytes = 65536/)
  assert.match(script, /maxTemplates = 500/)
  assert.match(script, /Get-Sha256Hex/)
  assert.match(script, /Hash de template \$id no coincide/)

  // Fullsite cannot race the swap; only the exact native service is stopped.
  assert.match(script, /Cierra Fullsite POS antes de transferir huellas/)
  assert.match(script, /ExecutablePath/)
  assert.match(script, /fingerprint-service\.exe/)
  assert.match(script, /Puerto 7718 pertenece a otro proceso/)
  assert.match(script, /El servicio de huella no se detuvo/)
  assert.doesNotMatch(script, /Stop-Process\s+-Name|taskkill/i)
  assert.equal((script.match(/\[Array\]::Clear\(\$master/g) || []).length, 2,
    'both export and import clear the binary transfer key')

  // Import uses a staged directory, private Windows ACL and rollback backup.
  assert.match(script, /\.fingerprints-stage-/)
  assert.match(script, /fingerprints-backup-/)
  assert.match(script, /icacls\.exe/)
  assert.match(script, /WindowsIdentity\]::GetCurrent\(\)\.Name/)
  assert.doesNotMatch(script, /\$env:USERNAME/)
  assert.match(script, /\/inheritance:r/)
  assert.match(script, /SYSTEM:\(OI\)\(CI\)\(F\)/)
  assert.ok(script.indexOf('Protect-TemplateDirectory $backup') > script.indexOf('Move-Item -LiteralPath $TemplatesDirectory -Destination $backup'))
  assert.match(script, /Move-Item -LiteralPath \$backup -Destination \$TemplatesDirectory/)
})
