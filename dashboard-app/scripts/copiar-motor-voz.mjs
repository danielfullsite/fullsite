#!/usr/bin/env node
// copiar-motor-voz — sirve el motor de la voz natural (Piper) desde NUESTRO origen.
//
// Copia de node_modules a public/voz/vendor/<paquete>-<versión>/:
//   @mintplex-labs/piper-tts-web  → la librería (ESM)                    ~0.3 MB
//   onnxruntime-web               → ort.wasm.bundle.min.mjs + ort-wasm-simd-threaded.{mjs,wasm}  ~12 MB
//   @diffusionstudio/piper-wasm   → piper_phonemize.{wasm,data} (espeak-ng)  ~18.7 MB
// y escribe public/voz/motor.json con las rutas (el worker las recibe de ahí).
//
// POR QUÉ: la librería, por omisión, baja onnxruntime de cdnjs y el fonémico de
// jsDelivr. Servirlos desde /voz/vendor evita abrir la CSP a esos CDNs (sólo se
// agrega Hugging Face, de donde sale el modelo) y fija versiones que coinciden con
// el código (onnxruntime .mjs/.wasm deben ser de la MISMA versión que su JS).
//
// La librería importa "onnxruntime-web/wasm" (especificador de paquete): se reescribe
// a la ruta relativa del bundle copiado, porque aquí no hay bundler que lo resuelva.
//
// Corre antes de `next dev` / `next build` (package.json). Nunca rompe el build: si
// falta algo, avisa y la voz cae sola al respaldo (speechSynthesis).
// El resultado está en .gitignore (se regenera).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const NM = path.join(APP_ROOT, 'node_modules')
const PUBLICO = path.join(APP_ROOT, 'public', 'voz')
const VENDOR = path.join(PUBLICO, 'vendor')

export const IMPORT_ORT = 'import("onnxruntime-web/wasm")'

/**
 * Reescribe el import de onnxruntime en la librería. Lanza Error si no aparece
 * EXACTAMENTE una vez: una versión nueva de la librería que cambie esto truena en la
 * prueba voz-motor-piper-empaque (CI) y aquí sólo se avisa (sin motor.json la voz usa
 * el respaldo), en vez de fallar en el navegador del dueño.
 */
export function parchearPiper(codigo, rutaOrtRelativa) {
  const veces = codigo.split(IMPORT_ORT).length - 1
  if (veces !== 1) throw new Error(`se esperaba 1 "${IMPORT_ORT}" en piper-tts-web, hay ${veces}`)
  return codigo.replace(IMPORT_ORT, `import(${JSON.stringify(rutaOrtRelativa)})`)
}

/** Especificadores de import (estáticos o dinámicos) que NO son rutas: no pueden quedar. */
export function importsDePaquete(codigo) {
  const re = /(?:\bimport\s*\(\s*|\bfrom\s*)["']([^"']+)["']/g
  const out = []
  let m
  while ((m = re.exec(codigo))) if (!/^(\.{1,2}\/|\/|https?:)/.test(m[1])) out.push(m[1])
  return out
}

async function version(paquete) {
  const pj = JSON.parse(await fs.readFile(path.join(NM, paquete, 'package.json'), 'utf8'))
  return pj.version
}

async function copiar(origen, destino) {
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.copyFile(origen, destino)
}

export async function copiarMotorVoz() {
  const vPiper = await version('@mintplex-labs/piper-tts-web')
  const vOrt = await version('onnxruntime-web')
  const vWasm = await version('@diffusionstudio/piper-wasm')

  const dPiper = `piper-tts-web-${vPiper}`
  const dOrt = `ort-${vOrt}`
  const dWasm = `piper-wasm-${vWasm}`

  await fs.rm(VENDOR, { recursive: true, force: true })

  // 1. Librería Piper (todos sus .js; los nombres llevan hash).
  const srcPiper = path.join(NM, '@mintplex-labs/piper-tts-web/dist')
  for (const f of await fs.readdir(srcPiper)) {
    if (!f.endsWith('.js')) continue
    let codigo = await fs.readFile(path.join(srcPiper, f), 'utf8')
    if (f === 'piper-tts-web.js') codigo = parchearPiper(codigo, `../${dOrt}/ort.wasm.bundle.min.mjs`)
    const sueltos = importsDePaquete(codigo)
    if (sueltos.length) throw new Error(`${f} importa paquetes sin resolver: ${sueltos.join(', ')}`)
    await fs.mkdir(path.join(VENDOR, dPiper), { recursive: true })
    await fs.writeFile(path.join(VENDOR, dPiper, f), codigo)
  }

  // 2. onnxruntime-web (sólo el backend WASM, sin WebGPU/JSEP).
  for (const f of ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    await copiar(path.join(NM, 'onnxruntime-web/dist', f), path.join(VENDOR, dOrt, f))
  }

  // 3. Fonémico (espeak-ng compilado a WASM + sus datos).
  for (const f of ['piper_phonemize.wasm', 'piper_phonemize.data']) {
    await copiar(path.join(NM, '@diffusionstudio/piper-wasm/build', f), path.join(VENDOR, dWasm, f))
  }

  const motor = {
    piper: `/voz/vendor/${dPiper}/piper-tts-web.js`,
    ortPrefijo: `/voz/vendor/${dOrt}/`,
    piperWasm: `/voz/vendor/${dWasm}/piper_phonemize.wasm`,
    piperData: `/voz/vendor/${dWasm}/piper_phonemize.data`,
    worker: '/voz/piper-worker.js',
  }
  await fs.writeFile(path.join(PUBLICO, 'motor.json'), `${JSON.stringify(motor, null, 2)}\n`)
  return motor
}

const directo = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directo) {
  if (process.env.CAPACITOR_OFFLINE === '1') {
    console.log('[motor-voz] CAPACITOR_OFFLINE=1: no se copia (la app nativa no usa la voz natural)')
  } else {
    copiarMotorVoz().then(
      m => console.log(`[motor-voz] listo → ${m.piper}`),
      err => {
        // Nunca rompe el build: sin estos archivos, la voz usa speechSynthesis.
        console.warn(`[motor-voz] no se pudo copiar el motor de voz natural (se usará la voz del navegador): ${err?.message || err}`)
        return fs.rm(path.join(PUBLICO, 'motor.json'), { force: true }).catch(() => {})
      },
    )
  }
}
