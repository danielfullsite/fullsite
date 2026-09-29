// Cliente del worker de Piper (public/voz/piper-worker.js) + reproductor Web Audio.
//
// Este módulo se importa DINÁMICAMENTE desde ./voz-natural sólo cuando se abre el
// modo voz (o para la precarga): nada de esto va en el bundle principal, y la
// librería/onnxruntime ni siquiera pasan por el bundler (los carga el worker).

import { MODELOS_PIPER, type ModeloPiper } from './motor-voz'
import { rmsDeFloat, wavAPcm } from './wav'

export interface RutasMotor {
  piper: string
  ortPrefijo: string
  piperWasm: string
  piperData: string
  worker: string
}

const RUTA_MOTOR = '/voz/motor.json'

/** Sólo rutas propias bajo /voz/: el worker no debe cargar código de otro lado. */
export function validarRutas(x: unknown): RutasMotor {
  const r = (x || {}) as Record<string, unknown>
  const ok = (v: unknown, fin?: string) => typeof v === 'string' && /^\/voz\/[\w./-]+$/.test(v) && !v.includes('..') && (!fin || v.endsWith(fin))
  if (!ok(r.piper, '.js') || !ok(r.ortPrefijo, '/') || !ok(r.piperWasm, '.wasm') || !ok(r.piperData, '.data') || !ok(r.worker, '.js')) {
    throw new Error('motor de voz sin configurar')
  }
  return r as unknown as RutasMotor
}

export async function leerRutasMotor(fetchImpl: typeof fetch = fetch): Promise<RutasMotor> {
  const res = await fetchImpl(RUTA_MOTOR, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`motor de voz ${res.status}`)
  return validarRutas(await res.json())
}

export interface ProgresoMotor { fase: 'descargando' | 'iniciando'; cargado?: number; total?: number; modelo?: string }

export interface MotorPiper {
  /** Descarga (si hace falta) e inicia el primer modelo que funcione. Lanza si ninguno. */
  cargar(modelos: readonly ModeloPiper[], alProgreso?: (p: ProgresoMotor) => void, alAviso?: (modelo: string) => void): Promise<string>
  sintetizar(texto: string, prioridad?: 'alta' | 'baja'): Promise<AudioBuffer>
  /** Tira lo que esté en cola en el worker (lo que ya está sintetizando termina). */
  cancelarPendientes(): void
  cerrar(): void
}

type Mensaje =
  | { tipo: 'progreso'; id: number; cargado: number; total: number }
  | { tipo: 'iniciando'; id: number; modelo: string }
  | { tipo: 'listo'; id: number; modelo: string }
  | { tipo: 'aviso'; id: number; modelo: string; mensaje: string }
  | { tipo: 'audio'; id: number; wav: ArrayBuffer }
  | { tipo: 'error'; id: number; mensaje: string }

interface Pendiente {
  resolver: (m: Mensaje) => void
  rechazar: (e: Error) => void
  alMensaje?: (m: Mensaje) => void
}

export function crearMotorPiper(opciones: {
  ctx: AudioContext
  rutas: RutasMotor
  crearWorker?: (url: string) => Worker
}): MotorPiper {
  const { ctx, rutas } = opciones
  const worker = (opciones.crearWorker ?? (url => new Worker(url, { type: 'module', name: 'voz-piper' })))(rutas.worker)
  let siguiente = 1
  const pendientes = new Map<number, Pendiente>()
  let cerrado = false

  const fallarTodo = (e: Error) => {
    for (const p of pendientes.values()) p.rechazar(e)
    pendientes.clear()
  }

  worker.onmessage = (ev: MessageEvent<Mensaje>) => {
    const m = ev.data
    const p = m && pendientes.get(m.id)
    if (!p) return
    if (m.tipo === 'listo' || m.tipo === 'audio') { pendientes.delete(m.id); p.resolver(m); return }
    if (m.tipo === 'error') { pendientes.delete(m.id); p.rechazar(new Error(m.mensaje || 'error de voz')); return }
    p.alMensaje?.(m)
  }
  worker.onerror = (ev) => { ev.preventDefault?.(); fallarTodo(new Error('el motor de voz se detuvo')) }

  const pedir = (msg: Record<string, unknown>, alMensaje?: (m: Mensaje) => void) => new Promise<Mensaje>((resolver, rechazar) => {
    if (cerrado) { rechazar(new Error('motor cerrado')); return }
    const id = siguiente++
    pendientes.set(id, { resolver, rechazar, alMensaje })
    worker.postMessage({ ...msg, id })
  })

  return {
    async cargar(modelos, alProgreso, alAviso) {
      const m = await pedir({ tipo: 'cargar', rutas, modelos: modelos.map(x => ({ ...x })) }, msg => {
        if (msg.tipo === 'progreso') alProgreso?.({ fase: 'descargando', cargado: msg.cargado, total: msg.total })
        else if (msg.tipo === 'iniciando') alProgreso?.({ fase: 'iniciando', modelo: msg.modelo })
        else if (msg.tipo === 'aviso') alAviso?.(msg.modelo)
      })
      return m.tipo === 'listo' ? m.modelo : ''
    },
    async sintetizar(texto, prioridad = 'alta') {
      const m = await pedir({ tipo: 'sintetizar', texto, prioridad })
      if (m.tipo !== 'audio') throw new Error('sin audio')
      const { muestras, sampleRate } = wavAPcm(m.wav)
      if (!muestras.length) throw new Error('audio vacío')
      const buffer = ctx.createBuffer(1, muestras.length, sampleRate)
      buffer.copyToChannel(muestras as Float32Array<ArrayBuffer>, 0)
      return buffer
    },
    cancelarPendientes() {
      if (!cerrado) worker.postMessage({ tipo: 'cancelar' })
    },
    cerrar() {
      if (cerrado) return
      cerrado = true
      fallarTodo(new Error('motor cerrado'))
      worker.terminate()
    },
  }
}

/**
 * Precarga en segundo plano: baja el modelo a OPFS (sin iniciar la sesión, sin
 * memoria de inferencia) y cierra el worker. Nunca lanza.
 */
export async function precargarModelo(modelo: ModeloPiper = MODELOS_PIPER[0], crearWorker?: (url: string) => Worker): Promise<boolean> {
  let worker: Worker | null = null
  try {
    const rutas = await leerRutasMotor()
    worker = (crearWorker ?? (url => new Worker(url, { type: 'module', name: 'voz-piper-precarga' })))(rutas.worker)
    const w = worker
    return await new Promise<boolean>(resolve => {
      w.onmessage = (ev: MessageEvent<Mensaje>) => {
        if (ev.data?.tipo === 'listo') resolve(true)
        else if (ev.data?.tipo === 'error') resolve(false)
      }
      w.onerror = () => resolve(false)
      w.postMessage({ tipo: 'descargar', id: 1, modelo: { ...modelo } })
    })
  } catch {
    return false
  } finally {
    worker?.terminate()
  }
}

// ── Reproductor ──────────────────────────────────────────────────────────────

export interface Reproductor {
  /** Resuelve al terminar de sonar o al abortar/detener. Nunca lanza. */
  reproducir(buffer: AudioBuffer, signal?: AbortSignal): Promise<void>
  detener(): void
  /** RMS (0‥1) de lo que está sonando ahora (0 si nada). */
  nivel(): number
}

/**
 * Toda la voz sale por el MISMO AudioContext que mide el micrófono: así el
 * cancelador de eco del navegador (getUserMedia echoCancellation) ve lo que suena
 * y lo resta, y `nivel()` da la referencia para el umbral de interrupción.
 */
export function crearReproductor(ctx: AudioContext): Reproductor {
  const ganancia = ctx.createGain()
  const analizador = ctx.createAnalyser()
  analizador.fftSize = 1024
  ganancia.connect(analizador)
  analizador.connect(ctx.destination)
  const cuadro = new Float32Array(analizador.fftSize)
  let actual: { fuente: AudioBufferSourceNode; terminar: () => void } | null = null

  const detener = () => {
    const a = actual
    actual = null
    if (!a) return
    try { a.fuente.onended = null; a.fuente.stop() } catch { /* ya terminó */ }
    try { a.fuente.disconnect() } catch { /* */ }
    a.terminar()
  }

  return {
    reproducir(buffer, signal) {
      detener()
      return new Promise<void>(resolve => {
        if (signal?.aborted) { resolve(); return }
        if (ctx.state === 'suspended') void ctx.resume?.().catch(() => {})
        const fuente = ctx.createBufferSource()
        fuente.buffer = buffer
        fuente.connect(ganancia)
        let listo = false
        const terminar = () => {
          if (listo) return
          listo = true
          signal?.removeEventListener('abort', alAbortar)
          if (actual?.fuente === fuente) actual = null
          resolve()
        }
        const alAbortar = () => { if (actual?.fuente === fuente) detener(); else terminar() }
        fuente.onended = terminar
        signal?.addEventListener('abort', alAbortar, { once: true })
        actual = { fuente, terminar }
        try { fuente.start() } catch { terminar() }
      })
    },
    detener,
    nivel() {
      if (!actual) return 0
      try { analizador.getFloatTimeDomainData(cuadro); return rmsDeFloat(cuadro) } catch { return 0 }
    },
  }
}
