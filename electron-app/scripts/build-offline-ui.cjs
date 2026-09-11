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
// URL y llave del MISMO proyecto, y la llave `anon`. El 2026-09-10 CI compilo cuatro
// paquetes con la llave de staging y la URL de produccion sin que nada lo detectara.
// Un paquete de laboratorio con valores sinteticos tiene que declararlo: nunca podra
// confundirse con un candidato, y el manifiesto lo lleva escrito.
const sintetico = process.env.FULLSITE_UI_BUNDLE_SINTETICO === '1'
if (sintetico) console.warn('[build-offline-ui] PAQUETE SINTETICO: no se verifica la pareja URL/llave. Solo laboratorio; no instalar.')
else require('./configuracion-publica.cjs').verificarParejaSupabase({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

const repository = path.resolve(__dirname, '../..')
const source = path.join(repository, 'dashboard-app')
const output = path.resolve(process.argv[2] || path.join(__dirname, '../ui-bundle'))
// EL BUILD AISLADO TIENE QUE VIVIR EN LA MISMA UNIDAD QUE EL REPOSITORIO.
//
// En Windows, `os.tmpdir()` es `C:\Users\...\Temp` y el repositorio del runner está en
// `D:\a\fullsite\fullsite`. El `node_modules` del build aislado es un junction hacia el
// del repositorio, así que webpack resuelve los módulos a rutas en `D:` y luego intenta
// hacerlas relativas al contexto, que está en `C:`. Entre dos unidades distintas NO
// existe ruta relativa, y sale este engendro (visto en CI el 2026-09-09):
//
//     Can't resolve './D:/a/fullsite/fullsite/dashboard-app/node_modules/next/dist/client/next.js'
//       in 'C:\Users\RUNNER~1\AppData\Local\Temp\fullsite-offline-build-62Cz5t\dashboard-app'
//
// Una ruta absoluta de Windows pegada detrás de `./`. En macOS no se ve nunca: hay un
// solo sistema de archivos y la ruta relativa siempre existe.
//
// Se crea AL LADO del repositorio, no dentro: dentro ensuciaría el checkout de quien lo
// corra en su máquina, y `git status` empezaría a mostrar basura si la limpieza fallara.
// El `finally` de abajo lo borra igual. Si el directorio padre no fuera escribible, se
// cae al temporal del sistema — que es el comportamiento de antes y funciona en macOS.
const temporary = (() => {
  const junto = path.join(path.dirname(repository), '.fullsite-offline-build-')
  try { return fs.mkdtempSync(junto) }
  catch { return fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-offline-build-')) }
})()
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
    return !fuera(relative)
  } })
  // EL FILTRO NO ES DE FIAR EN WINDOWS, así que se pasa otra vez por lo copiado.
  //
  // Tres fallos seguidos en CI el 2026-09-09 y los tres eran lo mismo: el `filter` de
  // `fs.cpSync` excluye bien en macOS y deja pasar cosas en Windows. Primero se coló
  // `src/instrumentation.ts`; una vez tapado ése, se coló `src/app/api/**` entero y el
  // type check reventó sobre `api/pos/save-order/route`.
  //
  // La causa es del sistema operativo, no de las reglas: `fs.cpSync` puede entregarle al
  // filtro rutas con prefijo extendido (`\\?\C:\...`), y entonces `path.relative` no
  // produce la ruta que las reglas esperan. Tapar archivo por archivo era perseguir
  // síntomas — `api/` tiene rutas de servidor con acceso a la base.
  //
  // `limpiar()` aplica LAS MISMAS reglas sobre lo que quedó en el destino, donde las
  // rutas ya son nuestras. El filtro se conserva porque ahorra copiar cientos de
  // archivos, pero la garantía es ésta.
  limpiar(path.join(build, 'src'))
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

/**
 * QUÉ NO ENTRA AL PAQUETE QUE SE INSTALA EN UN RESTAURANTE.
 *
 * Una sola definición, consultada por el filtro de la copia y por `limpiar()`. Estaban
 * en línea dentro del filtro; se sacaron aquí para que las dos pasadas no puedan
 * divergir — que es exactamente cómo se cuela lo que se creía excluido.
 *
 * `rel` es relativo a `src/`, con `/` como separador.
 */
function fuera(rel) {
  if (rel === 'proxy.ts' || rel === 'instrumentation.ts') return true
  if (rel === '__tests__' || rel.startsWith('__tests__/')) return true
  // De `app/` sólo viaja el POS y el armazón mínimo. Todo lo demás —y `api/` sobre
  // todo, que son rutas de servidor con acceso a la base— se queda fuera.
  if (rel.startsWith('app/')) {
    return !(rel === 'app/pos' || rel.startsWith('app/pos/') ||
      ['app/layout.tsx', 'app/globals.css', 'app/not-found.tsx', 'app/favicon.ico'].includes(rel))
  }
  return false
}

/**
 * Segunda pasada sobre lo YA copiado, con las mismas reglas.
 *
 * Aquí las rutas son nuestras —las construimos nosotros al recorrer el destino— así que
 * no dependen de cómo el sistema operativo se las entregue a un `filter`. Si un
 * directorio entero sobra, se borra completo y no se desciende.
 */
function limpiar(raiz, relative = '') {
  for (const entry of fs.readdirSync(path.join(raiz, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (fuera(rel)) {
      fs.rmSync(path.join(raiz, rel), { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) limpiar(raiz, rel)
  }
}

function walk(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    return entry.isDirectory() ? walk(directory, name) : [name]
  })
}
