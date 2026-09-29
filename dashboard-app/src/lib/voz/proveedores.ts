// Contratos de voz del chat: "oír" (audio → texto) y "hablar" (texto → voz).
//
// La UI (useGrabadora, useModoVoz) sólo conoce estas interfaces. Hoy hay UN juego de
// proveedores y es gratis:
//
//   transcripción → /api/transcribe (Groq Whisper, la misma llave de Groq del chat)
//   voz           → speechSynthesis del navegador
//
// Para cambiar a un proveedor de pago o realtime más adelante: implementa estas
// interfaces, regístralo en FABRICAS y selecciónalo con NEXT_PUBLIC_VOZ_PROVEEDOR.
// Sin esa variable (hoy) se usa 'gratis'. No hay ningún proveedor de pago aquí.

import { transcribirAudio } from './microfono'
import { crearVozNavegador } from './voz-navegador'

export interface OpcionesTranscripcion {
  /** 'voz' = modo conversación (límite por minuto más alto en el servidor). */
  modo?: 'voz'
}

export interface ProveedorTranscripcion {
  readonly nombre: string
  /** Audio grabado → texto ('' si no se entendió nada). Lanza Error con mensaje en español. */
  transcribir(audio: Blob, mime: string, signal?: AbortSignal, opciones?: OpcionesTranscripcion): Promise<string>
}

export interface ProveedorVoz {
  readonly nombre: string
  disponible(): boolean
  /** Se llama DENTRO del toque del usuario (iOS no deja hablar si no). */
  preparar(): void
  /** Resuelve al terminar de hablar, o al callar/abortar. Nunca lanza. */
  hablar(texto: string, signal?: AbortSignal): Promise<void>
  callar(): void
}

export interface ProveedoresVoz {
  transcripcion: ProveedorTranscripcion
  voz: ProveedorVoz
}

const FABRICAS: Record<string, () => ProveedoresVoz> = {
  gratis: () => ({
    transcripcion: { nombre: 'groq-whisper', transcribir: transcribirAudio },
    voz: crearVozNavegador(),
  }),
}

export const PROVEEDOR_POR_DEFECTO = 'gratis'

/** Nombre efectivo: uno registrado, o el gratis. */
export function nombreProveedor(pedido: string | null | undefined): string {
  const n = (pedido || '').trim().toLowerCase()
  return n && n in FABRICAS ? n : PROVEEDOR_POR_DEFECTO
}

const cache = new Map<string, ProveedoresVoz>()

export function obtenerProveedoresVoz(pedido: string | null | undefined = process.env.NEXT_PUBLIC_VOZ_PROVEEDOR): ProveedoresVoz {
  const nombre = nombreProveedor(pedido)
  let p = cache.get(nombre)
  if (!p) { p = FABRICAS[nombre](); cache.set(nombre, p) }
  return p
}
