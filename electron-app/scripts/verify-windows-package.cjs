#!/usr/bin/env node
'use strict'

// Local packaging verification only. Default: unpacked x64 directory. Explicit
// --installer-lab: synthetic prerelease NSIS, separate identity, never installed
// or published. No UI build, terminal config or automatic update here.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
const asar = require('@electron/asar')
const { verifyPackage } = require('../offline-ui/package-store')

const source = path.resolve(__dirname, '..')
const repository = path.dirname(source)
const installerLab = process.argv.includes('--installer-lab')
const args = process.argv.slice(2).filter(value => value !== '--installer-lab')
if (!args[0] || args.length > 2 || args.some(value => value.startsWith('--'))) throw new Error('Pass UI bundle, optional new output directory, and optional --installer-lab')
const bundle = verifyPackage(path.resolve(args[0]))
const output = path.resolve(args[1] || path.join(repository, 'output/closure/windows-package-smoke', String(Date.now())))
if (fs.existsSync(output)) throw new Error('Output must be a new directory; previous candidates are preserved')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-package-smoke-'))
const application = path.join(temporary, 'app')
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
const configs = [pkg.build, ...['electron-builder-pos.json', 'electron-builder-kds.json'].map(name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8')))]
for (const config of configs) assert.deepEqual(config.files, pkg.build.files, 'Every product must use the same runtime allowlist')
const matcher = new FileMatcher(source, application, value => value, pkg.build.files).createFilter()
const fileStat = { isDirectory: () => false }
for (const forbidden of ['.env', '.env.production', 'config.json', 'printers.json', 'lab/example.cjs',
  'profiles/Default/config.json', 'local-server/tests/actor-authority.test.js', 'offline-ui/package-store.test.js', 'local-server/catalog/actors.json']) {
  assert.equal(matcher(path.join(source, forbidden), fileStat), false, `Excluded file would ship: ${forbidden}`)
}

try {
  fs.cpSync(source, application, { recursive: true, filter: name => {
    const relative = path.relative(source, name).split(path.sep).join('/')
    if (relative === 'node_modules' || relative === 'ui-bundle') return false
    return relative === 'package.json' || matcher(name, fs.lstatSync(name))
  } })
  fs.cpSync(bundle.directory, path.join(application, 'ui-bundle'), { recursive: true })
  const config = { ...pkg.build, beforePack: path.join(__dirname, 'verify-offline-ui.cjs'), publish: null,
    directories: { output }, forceCodeSigning: false, electronVersion: require('electron/package.json').version }
  if (installerLab) {
    pkg.version = '1.4.1-offline.1'
    pkg.description = 'SYNTHETIC LABORATORY ONLY. Do not install at AMALAY.'
    config.appId = 'mx.fullsite.pos.lab'
    config.productName = 'Fullsite POS LAB SYNTHETIC'
    config.artifactName = 'Fullsite-POS-LAB-SYNTHETIC-${version}-${arch}.${ext}'
  }
  delete pkg.build
  fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify(pkg, null, 2))
  fs.writeFileSync(path.join(temporary, 'builder.json'), JSON.stringify(config, null, 2))
  const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  // The local smoke must not accidentally use a signing/publishing credential
  // inherited from a developer shell. Never print values or inspect keychains.
  for (const key of Object.keys(environment)) if (/^(?:CSC_|WIN_CSC_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key)) delete environment[key]
  environment.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  // A developer's shared node_modules can lag behind package-lock (the first
  // real smoke found electron-updater missing). Install the exact production
  // tree in staging, without touching the checkout running the UI laboratory.
  const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8'))
  lock.version = pkg.version; lock.packages[''].version = pkg.version
  fs.writeFileSync(path.join(application, 'package-lock.json'), JSON.stringify(lock))
  const dependencies = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: application, stdio: 'inherit', env: environment, shell: process.platform === 'win32',
    })
  if (dependencies.status !== 0) throw new Error(`Isolated production dependencies failed (${dependencies.status})`)
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli'), '--projectDir', application,
    '--config', path.join(temporary, 'builder.json'), '--win', '--x64', ...(installerLab ? [] : ['--dir']), '--publish', 'never'], {
    cwd: application, stdio: 'inherit', env: environment,
  })
  if (result.status !== 0) throw new Error(`Unpacked Windows build failed (${result.status})`)
  const unpacked = path.join(output, 'win-unpacked')
  const executable = fs.readFileSync(path.join(unpacked, `${config.productName}.exe`))
  const peOffset = executable.readUInt32LE(0x3c)
  assert.equal(executable.toString('ascii', peOffset, peOffset + 4), 'PE\0\0')
  assert.equal(executable.readUInt16LE(peOffset + 4), 0x8664, 'Windows executable must be x64')
  const archive = path.join(unpacked, 'resources/app.asar')
  const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''))
  const required = ['main.js', 'preload.js', 'preload-kds.js', 'preload-setup.js', 'setup.html', 'offline.html',
    'local-server/index.js', 'local-server/core/business-outbox.js', 'local-server/core/permission-profiles.json',
    'local-server/kds-ui.html', 'update/auto-installer.js', 'offline-ui/package-store.js', 'offline-ui/protocol.js',
    'node_modules/ws/package.json', 'node_modules/bonjour-service/package.json', 'node_modules/electron-updater/package.json',
    'ui-bundle/fullsite-ui-manifest.json']
  for (const name of required) assert(entries.includes(name), `Required runtime file missing: ${name}`)
  const appEntries = entries.filter(name => !name.startsWith('node_modules/'))
  const forbiddenEntries = appEntries.filter(name => /(?:^|\/)(?:\.env[^/]*|tests|lab|profiles|config\.json|printers\.json)(?:\/|$)|\.test\.(?:js|cjs)$|\.(?:log|ndjson)$/.test(name))
  assert.deepEqual(forbiddenEntries, [], 'An installed app must not contain local profiles or test data')
  const manifest = JSON.parse(asar.extractFile(archive, 'ui-bundle/fullsite-ui-manifest.json').toString('utf8'))
  assert.equal(manifest.revision, bundle.manifest.revision)
  const evidence = { status: installerLab ? 'verified-package-lab-installer-not-executed' : 'verified-unpacked-only', platform: 'win32', architecture: 'x64',
    version: pkg.version, app_id: config.appId,
    ui_revision: manifest.revision, app_files: appEntries.length, required_runtime_files: required.length,
    installed: false, published: false, signed: false, installer_tested: false }
  if (installerLab) {
    const name = `Fullsite-POS-LAB-SYNTHETIC-${pkg.version}-x64.exe`
    const bytes = fs.readFileSync(path.join(output, name))
    assert.equal(bytes.toString('ascii', 0, 2), 'MZ')
    evidence.installer = { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(output, 'NOT-FOR-INSTALLATION.txt'),
    'LOCAL PACKAGING VERIFICATION ONLY. ' + (installerLab ? 'Technical NSIS prerelease, never executed on Windows. ' : 'No installer. ') +
    'No field acceptance. UI may contain synthetic laboratory configuration. Do not copy to AMALAY.\n')
  console.log(JSON.stringify(evidence))
  console.log('[package-smoke] Evidence:', output)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
