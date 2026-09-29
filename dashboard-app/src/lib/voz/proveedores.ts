// Contratos de voz del chat: "oír" (audio → texto) y "hablar" (texto → voz).
//
// La UI (useGrabadora, useModoVoz) sólo conoce estas interfaces. Hoy hay UN juego de
// proveedores y es gratis:
//
//   transcripción → /api/transcribe (Groq Whisper, la misma llave de Groq del chat)
//   voz           → Piper (voz neuronal es-MX, corre EN EL NAVEGADOR, ./voz-natural)
//                   con speechSynthesis del navegador como respaldo automático
//
// Para cambiar a un proveedor de pago o realtime más adelante: implementa estas
// interfaces, regístralo en FABRICAS y selecciónalo con NEXT_PUBLIC_VOZ_PROVEEDOR.
// Sin esa variable (hoy) se usa 'gratis'. No hay ningún proveedor de pago aquí.

import { transcribirAudio } from './microfono'
import { crearVozNatural } from './voz-natural'

export interface OpcionesTranscripcion {
  /** 'voz' = modo conversación (límite por minuto más alto en el servidor). */
  modo?: 'voz'
}

export interface ProveedorTranscripcion {
  readonly nombre: string
  /** Audio grabado → texto ('' si no se entendió nada). Lanza Error con mensaje en español. */
  transcribir(audio: Blob, mime: string, signal?: AbortSignal, opciones?: OpcionesTranscripcion): Promise<string>
}

export interface OpcionesHablar {
  /**
   * Se llama al EMPEZAR a sonar cada frase de `frasesParaHablar(texto)` (índice
   * sobre esa lista). La pantalla resalta la frase; el modo voz abre la ventana
   * "sorda" de inicio de frase para no confundir su propio eco con el dueño.
   */
  alFrase?: (indice: number) => void
  /** Empezar desde esta frase (respaldo a media respuesta). */
  desdeFrase?: number
  /** Guardar el audio sintetizado (acuses cortos que se repiten). */
  cachear?: boolean
}

/** Estado de la voz natural, para mostrar "Preparando voz… (solo la primera vez)". */
export type EstadoCargaVoz =
  | { estado: 'inactivo' }
  | { estado: 'descargando'; cargado: number; total: number }
  | { estado: 'iniciando' }
  | { estado: 'listo'; motor: string }
  | { estado: 'respaldo'; razon: string }

export interface ProveedorVoz {
  readonly nombre: string
  disponible(): boolean
  /** Se llama DENTRO del toque del usuario (iOS no deja hablar si no). */
  preparar(): void
  /** Resuelve al terminar de hablar, o al callar/abortar. Nunca lanza. */
  hablar(texto: string, signal?: AbortSignal, opciones?: OpcionesHablar): Promise<void>
  callar(): void
  /**
   * Opcional: descarga / inicializa el motor (voz natural). Resuelve cuando está
   * listo o cuando se decidió usar el respaldo. Nunca lanza. Mientras tanto
   * `hablar()` sigue funcionando con el respaldo.
   */
  cargar?(alEstado?: (e: EstadoCargaVoz) => void): Promise<void>
  /** Opcional: RMS (0‥1) de lo que está sonando ahora; `null` si no se puede medir. */
  nivelSalida?(): number | null
  /**
   * Opcional: `true` si la salida pasa por Web Audio (el cancelador de eco del
   * micrófono la ve y `nivelSalida` funciona): sólo así se permite interrumpir
   * HABLANDO. Con speechSynthesis el eco no se puede separar: sólo tocando.
   */
  permiteInterrupcionPorVoz?(): boolean
}

export interface ProveedoresVoz {
  transcripcion: ProveedorTranscripcion
  voz: ProveedorVoz
}

const FABRICAS: Record<string, () => ProveedoresVoz> = {
  gratis: () => ({
    transcripcion: { nombre: 'groq-whisper', transcribir: transcribirAudio },
    voz: crearVozNatural(),
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
