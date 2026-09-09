#!/usr/bin/env node
'use strict'

// Build an isolated POS-only static export. Never move routes or .env files out
// of a developer checkout, and never bundle server API code or credentials.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createManifest, verifyPackage } = require('../offline-ui/package-store')

// These two values are public browser configuration, inlined by Next. Missing
// them cannot be repaired by setting server environment after installation.
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (!process.env[key]) throw new Error(`Missing public build configuration: ${key}`)
}
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).protocol !== 'https:') throw new Error('Public Supabase URL must use HTTPS')

const repository = path.resolve(__dirname, '../..')
const source = path.join(repository, 'dashboard-app')
const output = path.resolve(process.argv[2] || path.join(__dirname, '../ui-bundle'))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-offline-build-'))
const build = path.join(temporary, 'dashboard-app')
fs.mkdirSync(build)
console.log('[offline-ui] Isolated build:', build)

try {
  for (const name of ['package.json', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json', 'next-env.d.ts']) {
    if (fs.existsSync(path.join(source, name))) fs.copyFileSync(path.join(source, name), path.join(build, name))
  }
  fs.symlinkSync(fs.realpathSync(path.join(source, 'node_modules')), path.join(build, 'node_modules'), 'junction')
  fs.cpSync(path.join(source, 'src'), path.join(build, 'src'), { recursive: true, filter: value => {
    const relative = path.relative(path.join(source, 'src'), value).split(path.sep).join('/')
    if (relative === 'proxy.ts' || relative === 'instrumentation.ts' || relative.startsWith('__tests__')) return false
    if (relative.startsWith('app/')) return relative === 'app/pos' || relative.startsWith('app/pos/') ||
      ['app/layout.tsx', 'app/globals.css', 'app/not-found.tsx', 'app/favicon.ico'].includes(relative)
    return true
  } })
  // EL FILTRO DE ARRIBA NO BASTA EN WINDOWS, y esto es lo que rompía el build en CI.
  //
  // La primera vez que este workflow llegó a compilar (2026-09-09) fallo con:
  //
  //     ./src/instrumentation.ts
  //     Module not found: Can't resolve '../sentry.server.config'
  //
  // El mismo script corre limpio en macOS —comprobado: 456 archivos, 33 rutas— porque
  // ahí el filtro sí excluye el archivo. En Windows se cuela: `fs.cpSync` puede entregar
  // al filtro rutas con prefijo extendido (`\\?\C:\...`), y entonces la comparación
  // contra la ruta relativa no casa. El archivo llega al build aislado, Next lo compila,
  // y su `import '../sentry.server.config'` apunta a un archivo que este build no copia
  // a propósito (es configuración de servidor, y esto es un export estático).
  //
  // Borrarlos DESPUÉS de copiar no depende de cómo el sistema operativo entregue las
  // rutas al filtro: si están, se van. Es el mismo patrón que el script ya usa tres
  // líneas más abajo para `sw.js`, donde también se prefirió la garantía dura.
  for (const name of ['instrumentation.ts', 'proxy.ts']) {
    fs.rmSync(path.join(build, 'src', name), { force: true })
  }
  fs.cpSync(path.join(source, 'public'), path.join(build, 'public'), { recursive: true })
  // Static package owns its version; no SW may overlay another version on it.
  for (const name of ['sw.js', 'precache-manifest.json']) fs.rmSync(path.join(build, 'public', name), { force: true })
  // Shared permission contract is imported by the UI using a relative path.
  const contracts = path.join(temporary, 'electron-app/local-server/core')
  fs.mkdirSync(contracts, { recursive: true })
  fs.copyFileSync(path.join(repository, 'electron-app/local-server/core/permission-profiles.json'), path.join(contracts, 'permission-profiles.json'))
  fs.writeFileSync(path.join(build, 'src/app/page.tsx'), 'import Link from "next/link"; export default function Home(){ return <Link href="/pos">Abrir Fullsite POS</Link> }\n')
  fs.writeFileSync(path.join(build, 'next.config.mjs'), 'export default { output: "export", images: { unoptimized: true }, experimental: { cpus: 2 } }\n')
  const tsconfig = JSON.parse(fs.readFileSync(path.join(build, 'tsconfig.json'), 'utf8'))
  tsconfig.include = ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', '.next/types/**/*.ts']
  tsconfig.exclude = ['node_modules', 'src/__tests__/**']
  fs.writeFileSync(path.join(build, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
  // --webpack handles shared node_modules outside the isolated workspace. It
  // avoids relying on Turbopack's development filesystem-root inference.
  const result = spawnSync(process.execPath, [path.join(build, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
    cwd: build, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_CAPACITOR_OFFLINE: '1', NODE_ENV: 'production' },
  })
  if (result.status !== 0) throw new Error(`Static POS build failed (${result.status})`)
  const exported = path.join(build, 'out')
  for (const name of walk(exported)) if (name.endsWith('.map')) fs.rmSync(path.join(exported, name))
  const bundle = createManifest(exported)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const staging = `${output}.staging-${process.pid}`
  let backup = null
  try {
    fs.cpSync(exported, staging, { recursive: true, errorOnExist: true, force: false })
    verifyPackage(staging, bundle.manifest.revision)
    if (fs.existsSync(output)) {
      const previous = verifyPackage(output)
      backup = path.join(repository, 'output/closure/ui-build-previous', `${previous.manifest.revision}-${Date.now()}`)
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.renameSync(output, backup)
    }
    try { fs.renameSync(staging, output) }
    catch (error) { if (backup) fs.renameSync(backup, output); throw error }
  } finally { fs.rmSync(staging, { recursive: true, force: true }) }
  console.log(`[offline-ui] Verified ${Object.keys(bundle.manifest.files).length} files, ${bundle.manifest.routes.length} routes`)
  console.log(`[offline-ui] Revision ${bundle.manifest.revision}`)
  console.log(`[offline-ui] Output ${output}`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

function walk(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    return entry.isDirectory() ? walk(directory, name) : [name]
  })
}
