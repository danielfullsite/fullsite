// Empaque de la voz natural: la librería se sirve desde /voz/vendor (sin bundler),
// la CSP sólo abre Hugging Face, el SW no guarda el modelo, y las rutas que lee el
// worker no pueden apuntar fuera de /voz/.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORT_ORT, importsDePaquete, parchearPiper } from '../../scripts/copiar-motor-voz.mjs'
import { validarRutas } from '@/lib/voz/piper-cliente'
import { wavAPcm, rmsDeFloat } from '@/lib/voz/wav'

const raiz = process.cwd()

describe('copiar-motor-voz: parche de la librería', () => {
  const lib = readFileSync(join(raiz, 'node_modules/@mintplex-labs/piper-tts-web/dist/piper-tts-web.js'), 'utf8')

  it('la versión instalada importa onnxruntime EXACTAMENTE una vez y queda sin paquetes sueltos', () => {
    const parchado = parchearPiper(lib, '../ort-1.23.2/ort.wasm.bundle.min.mjs') as string
    expect(parchado).not.toContain(IMPORT_ORT)
    expect(parchado).toContain('import("../ort-1.23.2/ort.wasm.bundle.min.mjs")')
    expect(importsDePaquete(parchado)).toEqual([])
    expect(importsDePaquete(lib)).toEqual(['onnxruntime-web/wasm'])
  })

  it('si una versión nueva cambia el import, falla en el build (no en el navegador)', () => {
    expect(() => parchearPiper('import("otra-cosa")', 'x')).toThrow(/se esperaba 1/)
    expect(() => parchearPiper(`${IMPORT_ORT};${IMPORT_ORT}`, 'x')).toThrow(/hay 2/)
  })

  it('los ids de voz es-MX existen en la librería instalada (y el repo de modelos es el que declara el worker)', () => {
    expect(lib).toContain('"es_MX-claude-high": "es/es_MX/claude/high/es_MX-claude-high.onnx"')
    expect(lib).toContain('"es_MX-ald-medium": "es/es_MX/ald/medium/es_MX-ald-medium.onnx"')
    const worker = readFileSync(join(raiz, 'public/voz/piper-worker.js'), 'utf8')
    const base = /const HF_BASE = "([^"]+)"/.exec(lib)?.[1]
    expect(base).toBeTruthy()
    expect(worker).toContain(`const HF_BASE = '${base}'`)
  })
})

describe('validarRutas (/voz/motor.json)', () => {
  const buenas = { piper: '/voz/vendor/p-1/piper-tts-web.js', ortPrefijo: '/voz/vendor/ort-1/', piperWasm: '/voz/vendor/w/piper_phonemize.wasm', piperData: '/voz/vendor/w/piper_phonemize.data', worker: '/voz/piper-worker.js' }
  it('acepta rutas propias bajo /voz/', () => {
    expect(validarRutas(buenas)).toEqual(buenas)
  })
  it('rechaza otro origen, subir de carpeta o faltantes', () => {
    expect(() => validarRutas({ ...buenas, piper: 'https://evil.example/x.js' })).toThrow()
    expect(() => validarRutas({ ...buenas, worker: '/voz/../api/x.js' })).toThrow()
    expect(() => validarRutas({ ...buenas, piperData: undefined })).toThrow()
    expect(() => validarRutas(null)).toThrow()
  })
})

describe('CSP y service worker', () => {
  const config = readFileSync(join(raiz, 'next.config.ts'), 'utf8')
  const connect = /"connect-src ([^"]+)"/.exec(config)?.[1] ?? ''
  const script = /"script-src ([^"]+)"/.exec(config)?.[1] ?? ''

  it('connect-src abre SÓLO Hugging Face (modelo) además de lo que ya había', () => {
    expect(connect).toContain('https://huggingface.co')
    expect(connect).toContain('https://*.hf.co')
    expect(connect).toContain('https://*.huggingface.co')
    expect(connect).not.toMatch(/jsdelivr|cdnjs/)
  })

  it('script-src NO se abre a CDNs (onnxruntime y el fonémico salen de /voz/vendor)', () => {
    expect(script).not.toMatch(/jsdelivr|cdnjs|huggingface/)
    expect(script).toContain("'self'")
  })

  it('/voz/vendor se cachea inmutable; motor.json y el worker no', () => {
    expect(config).toContain("source: '/voz/vendor/:path*'")
    expect(config).toContain('public, max-age=31536000, immutable')
    expect(config).toMatch(/motor\\\\\.json\|piper-worker\\\\\.js/)
  })

  it('el SW no intercepta Hugging Face ni /voz/ (no duplicar ~100 MB en su caché)', () => {
    const sw = readFileSync(join(raiz, 'public/sw.js'), 'utf8')
    const i = sw.indexOf("self.addEventListener('fetch'")
    const cuerpo = sw.slice(i, sw.indexOf('\n})\n', i))
    expect(cuerpo).toMatch(/huggingface\\\.co\|hf\\\.co/)
    expect(cuerpo).toContain("url.pathname.startsWith('/voz/')")
    // Va ANTES del catch-all stale-while-revalidate.
    expect(cuerpo.indexOf("startsWith('/voz/')")).toBeLessThan(cuerpo.indexOf('staleWhileRevalidate'))
  })

  it('el build copia el motor antes de compilar; lo generado no se versiona', () => {
    const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
    expect(pkg.scripts.build.startsWith('node scripts/copiar-motor-voz.mjs && next build')).toBe(true)
    const gi = readFileSync(join(raiz, '.gitignore'), 'utf8')
    expect(gi).toContain('/public/voz/vendor/')
    expect(gi).toContain('/public/voz/motor.json')
  })
})

describe('wavAPcm (salida de Piper → Web Audio)', () => {
  function wav(muestras: number[], sampleRate = 22050, canales = 1): ArrayBuffer {
    const b = new ArrayBuffer(44 + muestras.length * 2)
    const v = new DataView(b)
    const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    w(0, 'RIFF'); v.setUint32(4, b.byteLength - 8, true); w(8, 'WAVE'); w(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, canales, true); v.setUint32(24, sampleRate, true)
    v.setUint32(28, sampleRate * 2 * canales, true); v.setUint16(32, 2 * canales, true); v.setUint16(34, 16, true)
    w(36, 'data'); v.setUint32(40, muestras.length * 2, true)
    muestras.forEach((m, i) => v.setInt16(44 + i * 2, m, true))
    return b
  }
  it('PCM16 mono → Float32 con su sample rate', () => {
    const { muestras, sampleRate } = wavAPcm(wav([0, 16384, -32768, 32767]))
    expect(sampleRate).toBe(22050)
    expect(Array.from(muestras)).toEqual([0, 0.5, -1, 32767 / 32768])
  })
  it('estéreo se mezcla a mono', () => {
    const { muestras } = wavAPcm(wav([16384, 0, 0, 16384], 16000, 2))
    expect(Array.from(muestras)).toEqual([0.25, 0.25])
  })
  it('no-WAV → error (el llamador cae al respaldo)', () => {
    expect(() => wavAPcm(new ArrayBuffer(10))).toThrow()
    expect(() => wavAPcm(new TextEncoder().encode('x'.repeat(60)).buffer)).toThrow(/No es WAV/)
  })
  it('rmsDeFloat', () => {
    expect(rmsDeFloat([])).toBe(0)
    expect(rmsDeFloat([0.5, -0.5])).toBeCloseTo(0.5)
  })
})
