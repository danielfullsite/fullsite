'use strict'

// Code package only. Employee credentials, catalog and orders stay in their own
// stores. Packages come from the signed Electron installer, never from a renderer.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MANIFEST = 'fullsite-ui-manifest.json'
const ORIGIN = 'https://app.fullsite.mx'
const REQUIRED_ROUTES = ['/pos', '/pos/mesas', '/pos/cocina', '/pos/barra', '/pos/corte', '/pos/turno']
const MAX_BYTES = 512 * 1024 * 1024
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_FILES = 20000
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 500 &&
    !value.includes('\\') && !value.includes('\0') && !value.includes(':') &&
    !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..')
}
function listFiles(directory, relative = '') {
  const result = []
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (!safeRelative(name) || entry.isSymbolicLink()) throw new Error(`Unsafe UI package path: ${name}`)
    if (entry.isDirectory()) result.push(...listFiles(directory, name))
    else if (entry.isFile()) result.push(name)
    else throw new Error(`Unsupported UI package entry: ${name}`)
  }
  return result.sort()
}
function manifestRevision(manifest) {
  return digest(JSON.stringify({ schema_version: 1, origin: ORIGIN, routes: manifest.routes, files: manifest.files }))
}
function createManifest(directory) {
  const names = listFiles(directory).filter(name => name !== MANIFEST)
  const files = {}
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(directory, name))
    files[name] = { bytes: bytes.length, sha256: digest(bytes) }
  }
  const routes = names.filter(name => name.endsWith('.html') && (name === 'pos.html' || name.startsWith('pos/')))
    .map(name => `/${name.slice(0, -5)}`).sort()
  const manifest = { schema_version: 1, origin: ORIGIN, routes, files }
  manifest.revision = manifestRevision(manifest)
  fs.writeFileSync(path.join(directory, MANIFEST), JSON.stringify(manifest, null, 2))
  return verifyPackage(directory)
}
function verifyPackage(directory, expectedRevision) {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('UI package directory cannot be a symlink')
  const manifestPath = path.join(directory, MANIFEST)
  if (fs.lstatSync(manifestPath).isSymbolicLink() || fs.statSync(manifestPath).size > 4 * 1024 * 1024) throw new Error('Invalid UI manifest')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.schema_version !== 1 || manifest.origin !== ORIGIN || !validRevision(manifest.revision) ||
      !Array.isArray(manifest.routes) || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Unsupported UI manifest')
  }
  const names = Object.keys(manifest.files)
  if (!names.length || names.length > MAX_FILES || names.some(name => !safeRelative(name) || name === MANIFEST)) throw new Error('Invalid UI manifest paths')
  if (manifestRevision(manifest) !== manifest.revision || (expectedRevision && expectedRevision !== manifest.revision)) throw new Error('UI manifest revision mismatch')
  if (!REQUIRED_ROUTES.every(route => manifest.routes.includes(route)) ||
      manifest.routes.some(route => typeof route !== 'string' || !/^\/pos(?:\/[a-z0-9-]+)*$/.test(route) || !manifest.files[`${route.slice(1)}.html`] || !manifest.files[`${route.slice(1)}.txt`])) {
    throw new Error('Incomplete UI route package')
  }
  if (!names.some(name => name.startsWith('_next/static/') && name.endsWith('.js')) || !names.some(name => name.endsWith('.css'))) throw new Error('UI assets missing')
  const actual = listFiles(directory).filter(name => name !== MANIFEST)
  if (actual.length !== names.length || actual.some(name => !Object.hasOwn(manifest.files, name))) throw new Error('Unlisted UI package files')
  let total = 0
  for (const name of names) {
    const entry = manifest.files[name]
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_FILE_BYTES || !validRevision(entry.sha256)) throw new Error('Invalid UI file metadata')
    total += entry.bytes
    if (total > MAX_BYTES) throw new Error('UI package too large')
    const bytes = fs.readFileSync(path.join(directory, name))
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`UI integrity mismatch: ${name}`)
  }
  return { directory, manifest }
}
function syncDirectory(directory) {
  let fd
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd) }
  catch (error) { if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'EACCES'].includes(error.code)) throw error }
  finally { if (fd !== undefined) fs.closeSync(fd) }
}
function durableWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

class PackageStore {
  constructor(directory) {
    this.directory = directory
    this.versions = path.join(directory, 'versions')
    this.pointer = path.join(directory, 'active.json')
    fs.mkdirSync(this.versions, { recursive: true })
  }
  state() {
    try {
      const value = JSON.parse(fs.readFileSync(this.pointer, 'utf8'))
      if (!validRevision(value.active) || (value.previous && !validRevision(value.previous))) throw new Error('Invalid UI activation pointer')
      return value
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  writeState(value) {
    const temporary = `${this.pointer}.${crypto.randomUUID()}.tmp`
    try {
      durableWrite(temporary, JSON.stringify(value))
      fs.renameSync(temporary, this.pointer)
      syncDirectory(this.directory)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
  load() {
    const state = this.state()
    if (!state) return null
    try { return { ...verifyPackage(path.join(this.versions, state.active), state.active), recovered: false } }
    catch (error) {
      if (!state.previous) throw error
      const previous = verifyPackage(path.join(this.versions, state.previous), state.previous)
      this.writeState({ active: state.previous, previous: null, rejected: state.active })
      return { ...previous, recovered: true, rejected: state.active }
    }
  }
  // Called at boot, before any window. No activation while a renderer is using
  // the previous release; all routes/chunks in that process remain one revision.
  install(source) {
    const candidate = verifyPackage(source)
    const current = this.load()
    const revision = candidate.manifest.revision
    if (current?.manifest.revision === revision) return current
    if (this.state()?.rejected === revision) throw new Error('UI package previously rejected; keep recovered version')
    const destination = path.join(this.versions, revision)
    const staging = path.join(this.versions, `.install-${crypto.randomUUID()}`)
    try {
      if (!fs.existsSync(destination)) {
        fs.mkdirSync(staging)
        for (const name of [...Object.keys(candidate.manifest.files), MANIFEST]) {
          durableWrite(path.join(staging, name), fs.readFileSync(path.join(source, name)))
        }
        verifyPackage(staging, revision)
        // Flush nested directory entries as well as file data before activation.
        const directories = new Set([''])
        for (const name of Object.keys(candidate.manifest.files)) {
          let directory = path.posix.dirname(name)
          while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory) }
        }
        for (const directory of [...directories].sort((a, b) => b.length - a.length)) syncDirectory(path.join(staging, directory))
        fs.renameSync(staging, destination)
        syncDirectory(this.versions)
      }
      const installed = verifyPackage(destination, revision)
      this.writeState({ active: revision, previous: current?.manifest.revision || null })
      return installed
    } finally { fs.rmSync(staging, { recursive: true, force: true }) }
  }
}

module.exports = { PackageStore, createManifest, verifyPackage, MANIFEST, ORIGIN, REQUIRED_ROUTES, digest, safeRelative }
