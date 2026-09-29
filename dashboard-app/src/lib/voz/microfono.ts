// Ayudantes de NAVEGADOR para el micrófono: abrir/cerrar el stream, crear el
// grabador con el formato correcto, medir el nivel y mandar el audio a transcribir.
// Las decisiones puras (formato, RMS, mensajes) viven en ./audio.

import { elegirMimeType, extensionDeMime, MAX_BYTES_AUDIO, MENSAJE_AUDIO_GRANDE, mensajeErrorMicrofono, rmsDeBytes } from './audio'

export class ErrorMicrofono extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErrorMicrofono'
  }
}

export function soportaGrabacion(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
}

/** Pide el micrófono. Lanza `ErrorMicrofono` con un mensaje en español. */
export async function abrirMicrofono(): Promise<MediaStream> {
  if (!soportaGrabacion()) throw new ErrorMicrofono(mensajeErrorMicrofono({ name: 'NoSoportado' }))
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (err) {
    throw new ErrorMicrofono(mensajeErrorMicrofono(err))
  }
}

/** Apaga todas las pistas: el indicador de micrófono del sistema se quita. */
export function cerrarStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach(t => { try { t.stop() } catch { /* ya estaba detenida */ } })
}

export function crearGrabador(stream: MediaStream): MediaRecorder {
  const soporta = typeof MediaRecorder.isTypeSupported === 'function'
    ? (t: string) => MediaRecorder.isTypeSupported(t)
    : null
  const mimeType = elegirMimeType(soporta)
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
}

type CtorAudioContext = typeof AudioContext
function ctorAudioContext(): CtorAudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: CtorAudioContext; webkitAudioContext?: CtorAudioContext }
  return w.AudioContext || w.webkitAudioContext || null
}

let ctxCompartido: AudioContext | null = null

/**
 * AudioContext compartido (uno por pestaña; nunca se cierra). Hay que llamarlo
 * dentro del toque del usuario al menos una vez: iOS Safari lo deja "suspended" si
 * nace o se reanuda fuera de un gesto. Llamadas posteriores reusan el mismo.
 */
export function audioContextCompartido(): AudioContext | null {
  if (ctxCompartido && ctxCompartido.state !== 'closed') {
    if (ctxCompartido.state === 'suspended') void ctxCompartido.resume?.().catch(() => {})
    return ctxCompartido
  }
  const Ctor = ctorAudioContext()
  if (!Ctor) return null
  try {
    ctxCompartido = new Ctor()
    void ctxCompartido.resume?.().catch(() => {})
    return ctxCompartido
  } catch {
    return null
  }
}

/** Medidor de nivel del stream: `leer()` devuelve el RMS actual (0‥1). */
export function crearMedidor(ctx: AudioContext | null, stream: MediaStream): { leer: () => number; cerrar: () => void } {
  if (!ctx) return { leer: () => 0, cerrar: () => {} }
  try {
    const fuente = ctx.createMediaStreamSource(stream)
    const analizador = ctx.createAnalyser()
    analizador.fftSize = 1024
    fuente.connect(analizador)
    const buffer = new Uint8Array(analizador.fftSize)
    return {
      leer: () => { analizador.getByteTimeDomainData(buffer); return rmsDeBytes(buffer) },
      cerrar: () => { try { fuente.disconnect() } catch { /* */ } },
    }
  } catch {
    return { leer: () => 0, cerrar: () => {} }
  }
}

/**
 * Sube el audio a /api/transcribe y devuelve el texto (puede ser `''` si no se
 * entendió nada). Lanza `Error` con el mensaje del servidor, listo para mostrar.
 */
export async function transcribirAudio(audio: Blob, mime: string, signal?: AbortSignal, opciones?: { modo?: 'voz' }): Promise<string> {
  // El servidor (Vercel) no acepta cuerpos de más de ~4.5 MB: ni se intenta.
  if (audio.size > MAX_BYTES_AUDIO) throw new Error(MENSAJE_AUDIO_GRANDE)
  const form = new FormData()
  form.append('audio', audio, `nota.${extensionDeMime(mime || audio.type)}`)
  let res: Response
  try {
    res = await fetch(opciones?.modo === 'voz' ? '/api/transcribe?modo=voz' : '/api/transcribe', { method: 'POST', body: form, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('Sin conexión. Revisa tu internet e intenta de nuevo.')
  }
  const data = await res.json().catch(() => ({})) as { text?: unknown; error?: unknown }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' && data.error ? data.error : 'No pude transcribir el audio. Intenta de nuevo.')
  }
  return typeof data.text === 'string' ? data.text.trim() : ''
}
