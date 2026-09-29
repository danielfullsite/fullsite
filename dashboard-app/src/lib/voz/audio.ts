// Piezas puras del audio del chat de voz: qué formato graba el navegador, qué
// extensión lleva el archivo que se sube, cuánto "suena" un cuadro del micrófono y
// qué decirle al usuario cuando el micrófono falla.
//
// Nada aquí toca `window`: se prueba en node.

/**
 * Formatos en orden de preferencia.
 *
 * Chrome/Edge/Firefox graban webm/opus (chico y Whisper lo lee directo). Safari en
 * iOS/macOS NO graba webm: da audio/mp4 (AAC). Si ninguno dice que sí, se deja que
 * el navegador elija (`''` → `new MediaRecorder(stream)` sin mimeType).
 */
export const MIME_CANDIDATOS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/ogg;codecs=opus',
] as const

/** Primer formato soportado, o `''` para usar el del navegador. */
export function elegirMimeType(soporta: ((tipo: string) => boolean) | null | undefined): string {
  if (typeof soporta !== 'function') return ''
  for (const tipo of MIME_CANDIDATOS) {
    try {
      if (soporta(tipo)) return tipo
    } catch { /* algunos navegadores truenan con tipos que no conocen */ }
  }
  return ''
}

/**
 * Extensión del archivo que se manda a Whisper. Groq decide el decodificador por la
 * extensión del nombre, así que un mp4 llamado "nota.webm" falla.
 * Aceptadas por Groq: flac mp3 mp4 mpeg mpga m4a ogg opus wav webm.
 */
export function extensionDeMime(mime: string | null | undefined): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4')) return 'mp4'
  if (m.includes('aac') || m.includes('m4a')) return 'm4a'
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  return 'webm'
}

/**
 * RMS (0‥1) de un cuadro de `AnalyserNode.getByteTimeDomainData`: bytes 0‥255 con el
 * silencio en 128.
 */
export function rmsDeBytes(cuadro: ArrayLike<number>): number {
  const n = cuadro.length
  if (!n) return 0
  let suma = 0
  for (let i = 0; i < n; i++) {
    const v = (cuadro[i] - 128) / 128
    suma += v * v
  }
  return Math.sqrt(suma / n)
}

/** Nivel 0‥1 para dibujar la barra: el RMS de la voz normal anda en 0.02‥0.3. */
export function nivelVisual(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  return Math.min(1, Math.sqrt(rms * 4))
}

/** "0:07", "1:42". */
export function formatoDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Mensaje para el usuario cuando `getUserMedia` / `MediaRecorder` falla. */
export function mensajeErrorMicrofono(err: unknown): string {
  const nombre = (err && typeof err === 'object' && 'name' in err) ? String((err as { name: unknown }).name) : ''
  switch (nombre) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'No tengo permiso para usar el micrófono. Actívalo en los permisos del navegador y vuelve a intentar.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No encontré un micrófono en este dispositivo.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'El micrófono está ocupado por otra aplicación. Ciérrala y vuelve a intentar.'
    case 'NoSoportado':
      return 'Este navegador no permite grabar audio aquí. Prueba con Chrome o Safari actualizados.'
    default:
      return 'No pude usar el micrófono. Intenta de nuevo.'
  }
}

/** Límites compartidos entre cliente y servidor. */
/**
 * 4 MB: Vercel corta los cuerpos de más de ~4.5 MB ANTES de llegar a la ruta (con un
 * error que no es JSON). Con opus son muchos minutos; con AAC de Safari, ~2–4 min.
 * El cliente corta/rechaza antes de este tope y el servidor lo vuelve a revisar.
 */
export const MAX_BYTES_AUDIO = 4 * 1024 * 1024
export const MENSAJE_AUDIO_GRANDE = 'La nota de voz es demasiado grande (máximo 4 MB, unos 2 minutos). Graba una más corta.'
export const MAX_SEGUNDOS_NOTA = 120            // nota de voz: 2 min
