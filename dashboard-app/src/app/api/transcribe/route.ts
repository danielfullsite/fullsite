import { NextRequest } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { MAX_BYTES_AUDIO } from '@/lib/voz/audio'
import { crearLimitador } from '@/lib/voz/limite'
import { ErrorTranscripcion, llaveGroq, transcribirConGroq } from '@/lib/voz/transcripcion'

/**
 * POST /api/transcribe — nota de voz → texto (Groq Whisper).
 *
 * Multipart con el campo `audio` (webm/opus de Chrome, mp4/aac de Safari).
 * Mismo guardián que /api/chat: sesión del restaurante, falla cerrado.
 * Responde `{ text }` o `{ error }` con un mensaje en español que la UI muestra tal cual.
 *
 * Nunca se loguea el audio ni el texto transcrito.
 */

// 20 por minuto por usuario — el mismo ritmo que el chat: cada nota termina en una
// pregunta al chat, así que más transcripciones que preguntas no tiene sentido.
// El modo voz (`?modo=voz`, conversación manos libres) tiene su propio contador de 30:
// una plática rápida hace más turnos, y el VAD ya descarta ruidos cortos antes de subir.
// Declarar "voz" sólo sube el tope a 30 — sigue siendo un freno de abuso.
const permitir = crearLimitador(20)
const permitirVoz = crearLimitador(30)

// Holgura para las cabeceras del multipart sobre el tope del archivo.
const HOLGURA_MULTIPART = 64 * 1024

const json = (cuerpo: Record<string, unknown>, status: number) => Response.json(cuerpo, { status })

const MENSAJE_413 = 'La nota de voz es demasiado larga. El máximo son 2 minutos (4 MB).'

/** Lee el cuerpo contando bytes. 'grande' al pasar `tope`; null si no hay cuerpo o falla. */
async function leerConTope(request: Request, tope: number): Promise<Uint8Array<ArrayBuffer> | 'grande' | null> {
  if (!request.body) return null
  const lector = request.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > tope) {
        try { await lector.cancel() } catch { /* */ }
        return 'grande'
      }
      partes.push(value)
    }
  } catch {
    return null
  }
  const junto = new Uint8Array(total)
  let o = 0
  for (const p of partes) { junto.set(p, o); o += p.byteLength }
  return junto
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant(request)
  if (auth instanceof Response) return auth

  const esVoz = new URL(request.url).searchParams.get('modo') === 'voz'
  if (!(esVoz ? permitirVoz : permitir)(auth.staffId)) {
    return json({ error: 'Demasiadas notas de voz seguidas. Espera un momento.' }, 429)
  }

  const llave = llaveGroq()
  if (!llave) {
    return json({ error: 'El dictado por voz no está disponible: falta configurar la transcripción en el servidor.' }, 503)
  }

  // Rechazo temprano por tamaño declarado, antes de leer el cuerpo.
  const declarado = Number(request.headers.get('content-length') || 0)
  if (declarado > MAX_BYTES_AUDIO + HOLGURA_MULTIPART) {
    return json({ error: MENSAJE_413 }, 413)
  }

  // Sin Content-Length (chunked) o con uno falso: el cuerpo se lee CONTANDO bytes y se
  // corta al pasar el tope — nunca se junta en memoria un cuerpo sin límite.
  const cuerpo = await leerConTope(request, MAX_BYTES_AUDIO + HOLGURA_MULTIPART)
  if (cuerpo === 'grande') return json({ error: MENSAJE_413 }, 413)
  if (cuerpo === null) return json({ error: 'No recibí el audio. Intenta grabarlo de nuevo.' }, 400)

  let audio: FormDataEntryValue | null
  try {
    const form = await new Response(cuerpo, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData()
    audio = form.get('audio')
  } catch {
    return json({ error: 'No recibí el audio. Intenta grabarlo de nuevo.' }, 400)
  }

  if (!audio || typeof audio === 'string') {
    return json({ error: 'No recibí el audio. Intenta grabarlo de nuevo.' }, 400)
  }
  if (audio.size === 0) {
    return json({ error: 'La grabación salió vacía. Intenta de nuevo.' }, 400)
  }
  if (audio.size > MAX_BYTES_AUDIO) {
    return json({ error: MENSAJE_413 }, 413)
  }

  try {
    const text = await transcribirConGroq(audio, audio.type, llave)
    return json({ text }, 200)
  } catch (err) {
    if (err instanceof ErrorTranscripcion) return json({ error: err.message }, err.status)
    console.error('[transcribe] Error inesperado:', err instanceof Error ? err.name : 'desconocido')
    return json({ error: 'No pude transcribir el audio. Intenta de nuevo.' }, 500)
  }
}
