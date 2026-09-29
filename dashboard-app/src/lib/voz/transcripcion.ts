// Transcripción de voz con Groq Whisper (servidor).
//
// La ruta /api/transcribe decide QUIÉN puede transcribir; aquí sólo vive el "cómo":
// armar la petición a Groq, interpretar su respuesta y limpiar el texto.

import { extensionDeMime } from './audio'

export const GROQ_TRANSCRIPCION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
export const MODELO_WHISPER = 'whisper-large-v3-turbo'

/** Misma llave que el chat (ver lib/groq.ts): GROQ_API_KEY o GROQ. */
export function llaveGroq(): string {
  return process.env.GROQ_API_KEY || process.env.GROQ || ''
}

/** `STT_MODEL` permite cambiar de modelo sin desplegar código; por omisión el turbo (gratis). */
export function modeloWhisper(): string {
  return (process.env.STT_MODEL || '').trim() || MODELO_WHISPER
}

export const MENSAJE_LIMITE_GROQ = 'Límite gratuito alcanzado, intenta en unos minutos.'

/**
 * Whisper "oye" frases de subtítulos de YouTube cuando el audio es silencio o ruido.
 * Si la transcripción COMPLETA es una de éstas, no es lo que dijo el usuario.
 */
const ALUCINACIONES = [
  /^subt[ií]tulos (realizados|hechos|creados) por/i,
  /amara\.org/i,
  /^gracias por ver( el video)?\.?$/i,
  /^¡?suscr[ií]bete!?\.?$/i,
  /^(m[uú]sica|\[m[uú]sica\]|\(m[uú]sica\))\.?$/i,
  /^(\.|…|\s)*$/,
]

export function limpiarTranscripcion(texto: unknown): string {
  if (typeof texto !== 'string') return ''
  const t = texto.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (ALUCINACIONES.some(re => re.test(t))) return ''
  return t
}

export class ErrorTranscripcion extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ErrorTranscripcion'
  }
}

/**
 * Manda el audio a Groq Whisper y devuelve el texto limpio.
 * Lanza `ErrorTranscripcion` con un mensaje en español listo para mostrar.
 * Nunca incluye el audio ni el texto en los logs.
 */
export async function transcribirConGroq(
  audio: Blob,
  mime: string,
  llave: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData()
  form.append('file', audio, `nota.${extensionDeMime(mime || audio.type)}`)
  form.append('model', modeloWhisper())
  form.append('language', 'es')
  form.append('response_format', 'json')
  form.append('temperature', '0')

  let res: Response
  try {
    res = await fetchImpl(GROQ_TRANSCRIPCION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llave}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.warn(`[transcribe] Groq no respondió: ${err instanceof Error ? err.name : 'desconocido'}`)
    throw new ErrorTranscripcion('El servicio de transcripción no respondió. Intenta de nuevo.', 504)
  }

  if (!res.ok) {
    // Sólo el código: el cuerpo de error de Groq puede traer eco del archivo.
    console.warn(`[transcribe] Groq respondió ${res.status}`)
    if (res.status === 429) throw new ErrorTranscripcion(MENSAJE_LIMITE_GROQ, 429)
    if (res.status === 401 || res.status === 403) throw new ErrorTranscripcion('La transcripción de voz no está configurada correctamente en el servidor.', 503)
    if (res.status === 400 || res.status === 413 || res.status === 415) throw new ErrorTranscripcion('No pude leer ese audio. Intenta grabarlo de nuevo.', 400)
    throw new ErrorTranscripcion('No pude transcribir el audio. Intenta de nuevo.', 502)
  }

  const data = await res.json().catch(() => null) as { text?: unknown } | null
  return limpiarTranscripcion(data?.text)
}
