#!/usr/bin/env node
// gen-precache-manifest — emite public/precache-manifest.json con TODOS los
// assets de /_next/static (chunks JS/CSS incluidos los de dynamic import).
//
// POR QUÉ EXISTE (fuga precache familia #45):
// El warm-crawl del SW (sw.js Phase 2) recorre el HTML de cada ruta y cachea los
// chunks referenciados como string literal. Pero los chunks de dynamic import
// (modal de modificadores, panel de cuenta…) NO aparecen en el HTML — el runtime
// de Turbopack los resuelve bajo demanda. Un chunk que solo se pide tras una
// interacción NUNCA se precachea, y recargar OFFLINE tras esa interacción tira
// "Failed to load chunk" (la app sigue usable, pero es una fuga).
//
// Turbopack (Next 16) NO expone un manifiesto navegable que liste los 246 chunks
// (build-manifest.json solo trae 6 entradas raíz). La ÚNICA fuente determinista
// de la lista completa es el disco tras el build — por eso esto corre en build,
// no en el browser. Es el patrón de next-pwa/Serwist: leer el output y precachear.
//
// El SW lee este archivo en install y precachea la unión con el warm-crawl.
// Ausente (dev/local) → el SW cae al warm-crawl; no rompe nada.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const STATIC_DIR = path.join(APP_ROOT, '.next', 'static')
const PUBLIC_DIR = path.join(APP_ROOT, 'public')
const OUT_FILE = path.join(PUBLIC_DIR, 'precache-manifest.json')

// Solo assets que el runtime pide en el browser. Los .map son para devtools y no
// deben inflar el precache offline.
const ASSET_RE = /\.(js|css)$/
const SKIP_RE = /\.map$/

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (ASSET_RE.test(e.name) && !SKIP_RE.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

async function main() {
  // Si no hay build (o el path cambió), no romper la compilación: avisar y salir 0.
  try {
    await fs.access(STATIC_DIR)
  } catch {
    console.warn(`[precache-manifest] ${STATIC_DIR} no existe — se omite (¿build sin .next/static?)`)
    return
  }

  let buildId = ''
  try {
    buildId = (await fs.readFile(path.join(APP_ROOT, '.next', 'BUILD_ID'), 'utf8')).trim()
  } catch { /* opcional */ }

  const files = await walk(STATIC_DIR)
  const assets = files
    .map((f) => '/_next/static/' + path.relative(STATIC_DIR, f).split(path.sep).join('/'))
    .sort()

  await fs.mkdir(PUBLIC_DIR, { recursive: true })
  const payload = {
    version: 1,
    buildId,
    generatedAt: new Date().toISOString(),
    count: assets.length,
    assets,
  }
  await fs.writeFile(OUT_FILE, JSON.stringify(payload) + '\n', 'utf8')
  console.log(`[precache-manifest] ${assets.length} assets → public/precache-manifest.json (buildId ${buildId || 'n/a'})`)
}

main().catch((e) => {
  // Nunca tumbar el build por esto: el SW tiene fallback (warm-crawl).
  console.warn('[precache-manifest] error (no fatal):', e?.message || e)
})
