'use client'

// "Habla con tu restaurante": conversación por turnos, manos libres.
//
//   preparando → escuchando ─(VAD: fin)→ pensando ─(transcribe + chat)→ hablando ─┐
//                    ▲                                                            │
//                    └────────────────────────────────────────────────────────────┘
//
// - Al abrir se calibra el ruido del lugar (~300 ms) antes de escuchar.
// - Mientras habla, el micrófono se IGNORA (sin VAD ni grabación): si no, la bocina se
//   escucha a sí misma y el ciclo nunca termina. Tocar interrumpe y vuelve a escuchar.
// - Transcripción vacía o ruido → vuelve a escuchar sin llamar al chat.
// - El cerebro (`preguntar`) es el mismo /api/chat del chat escrito, con modo 'voz'.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_BYTES_AUDIO, mensajeErrorMicrofono, nivelVisual } from '@/lib/voz/audio'
import {
  abrirMicrofono, audioContextCompartido, cerrarStream, crearGrabador, crearMedidor, ErrorMicrofono,
} from '@/lib/voz/microfono'
import { obtenerProveedoresVoz, type ProveedoresVoz } from '@/lib/voz/proveedores'
import {
  estadoCalibrando, estadoInicialVad, pasoVad, ruidoDe, VAD_POR_DEFECTO, type ConfigVad, type EstadoVad,
} from '@/lib/voz/vad'

export type FaseVoz = 'inactivo' | 'preparando' | 'escuchando' | 'pensando' | 'hablando' | 'error'

/** Cada cuánto se lee el micrófono. */
const CUADRO_MS = 50
/** Si nadie habla en este tiempo, se reinicia la grabación para no acumular silencio. */
const REINICIO_SILENCIO_MS = 15_000
/** El grabador entrega un trozo cada tanto: así se lleva la cuenta del tamaño. */
const TROZO_MS = 1000
/** Antes del tope del servidor (~4 MB, límite de cuerpo de Vercel) se cierra el enunciado. */
const TOPE_BYTES_ENUNCIADO = Math.floor(MAX_BYTES_AUDIO * 0.9)

/**
 * iOS/WebKit: con el micrófono abierto, la voz sale por el AURICULAR (modo llamada) y
 * casi no se oye. En iOS se suelta el micrófono mientras habla y se vuelve a pedir al
 * escuchar (ya concedido en la sesión: no vuelve a preguntar).
 */
export function debeSoltarMicAlHablar(nav: { userAgent?: string; maxTouchPoints?: number } | undefined =
  typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav?.userAgent) return false
  const ua = nav.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)
}

/** Menos de esto no es una pregunta ("eh", "mm"). */
const MIN_CARACTERES_PREGUNTA = 2

interface Opciones {
  /** El cerebro: pregunta → respuesta (texto). Lanza Error con un mensaje para decir. */
  preguntar: (texto: string, signal: AbortSignal) => Promise<string>
  alPreguntar?: (texto: string) => void
  alResponder?: (texto: string) => void
  proveedores?: ProveedoresVoz
  vad?: ConfigVad
}

interface Sesion {
  stream: MediaStream
  medidor: { leer: () => number; cerrar: () => void }
  vad: EstadoVad
  grabador: MediaRecorder | null
  /** Trozos del grabador ACTUAL. Cada grabador tiene su propio arreglo: un trozo que
   *  llega tarde de uno viejo no se cuela en el siguiente enunciado. */
  trozos: Blob[]
  bytes: number
  grabadorDesde: number
  /** El micrófono se soltó mientras hablaba (iOS); hay que volver a pedirlo. */
  micSuelto: boolean
  intervalo: ReturnType<typeof setInterval> | null
  /** Sube en cada interrupción/cierre: lo que venía en camino se ignora. */
  turno: number
  abort: AbortController | null
}

/**
 * Prepara audio y voz DENTRO del toque del usuario (iOS Safari: la síntesis y el
 * AudioContext sólo arrancan desde un gesto). Llamar en el onClick del botón.
 */
export function prepararModoVozEnGesto(proveedores: ProveedoresVoz = obtenerProveedoresVoz()): void {
  proveedores.voz.preparar()
  audioContextCompartido()
}

export function useModoVoz({ preguntar, alPreguntar, alResponder, proveedores: prov, vad: cfgVad = VAD_POR_DEFECTO }: Opciones) {
  const [fase, setFase] = useState<FaseVoz>('inactivo')
  const [nivel, setNivel] = useState(0)
  const [usuarioHablando, setUsuarioHablando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaPregunta, setUltimaPregunta] = useState('')
  const [ultimaRespuesta, setUltimaRespuesta] = useState('')

  const faseRef = useRef<FaseVoz>('inactivo')
  /** Sube en cada abrir/cerrar/desmontar: un getUserMedia que llega tarde se descarta. */
  const intentoRef = useRef(0)
  const sesionRef = useRef<Sesion | null>(null)
  const montadoRef = useRef(true)
  const cb = useRef({ preguntar, alPreguntar, alResponder })
  useEffect(() => { cb.current = { preguntar, alPreguntar, alResponder } }, [preguntar, alPreguntar, alResponder])
  const proveedoresRef = useRef<ProveedoresVoz | null>(prov ?? null)
  const proveedores = useCallback((): ProveedoresVoz => {
    if (!proveedoresRef.current) proveedoresRef.current = obtenerProveedoresVoz()
    return proveedoresRef.current
  }, [])

  const cambiar = useCallback((f: FaseVoz) => {
    faseRef.current = f
    if (montadoRef.current) setFase(f)
    if (f !== 'escuchando') setUsuarioHablando(false)
  }, [])

  const detenerGrabador = useCallback((s: Sesion) => {
    const g = s.grabador
    s.grabador = null
    if (!g) return
    g.ondataavailable = null
    g.onstop = null
    try { if (g.state !== 'inactive') g.stop() } catch { /* */ }
  }, [])

  const iniciarGrabador = useCallback((s: Sesion) => {
    detenerGrabador(s)
    // Arreglo PROPIO de este grabador (capturado por su closure).
    const trozos: Blob[] = []
    s.trozos = trozos
    s.bytes = 0
    s.grabadorDesde = Date.now()
    try {
      const g = crearGrabador(s.stream)
      g.ondataavailable = (e: BlobEvent) => {
        if (!e.data || e.data.size <= 0) return
        trozos.push(e.data)
        if (s.trozos === trozos) s.bytes += e.data.size
      }
      g.start(TROZO_MS)
      s.grabador = g
    } catch {
      s.grabador = null
    }
  }, [detenerGrabador])

  /** Suelta el micrófono (iOS, mientras habla): la voz vuelve a la bocina. */
  const soltarMic = useCallback((s: Sesion) => {
    detenerGrabador(s)
    s.medidor.cerrar()
    cerrarStream(s.stream)
    s.micSuelto = true
  }, [detenerGrabador])

  const escucharYa = useCallback((s: Sesion) => {
    s.abort = null
    s.vad = estadoInicialVad(ruidoDe(s.vad))
    iniciarGrabador(s)
    setError(null)
    cambiar('escuchando')
  }, [cambiar, iniciarGrabador])

  const volverAEscuchar = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    if (!s.micSuelto) { escucharYa(s); return }
    // Se había soltado el micrófono: se vuelve a pedir (sin nuevo permiso) y luego escucha.
    const turno = s.turno
    s.micSuelto = false
    void abrirMicrofono().then(stream => {
      if (!montadoRef.current || sesionRef.current !== s || s.turno !== turno) {
        cerrarStream(stream)
        if (sesionRef.current === s) s.micSuelto = true
        return
      }
      s.stream = stream
      s.medidor = crearMedidor(audioContextCompartido(), stream)
      escucharYa(s)
    }, err => {
      if (!montadoRef.current || sesionRef.current !== s) return
      s.micSuelto = true
      setError(err instanceof ErrorMicrofono ? err.message : mensajeErrorMicrofono(err))
      cambiar('error')
    })
  }, [cambiar, escucharYa])

  /** Transcribe → chat → habla. Todo lo que llega tarde (otro turno) se ignora. */
  const procesar = useCallback(async (s: Sesion, audio: Blob, mime: string) => {
    const turno = s.turno
    const vigente = () => montadoRef.current && sesionRef.current === s && s.turno === turno
    const ctrl = new AbortController()
    s.abort = ctrl
    const { transcripcion, voz } = proveedores()

    let texto: string
    try {
      texto = await transcripcion.transcribir(audio, mime, ctrl.signal, { modo: 'voz' })
    } catch (err) {
      if (!vigente()) return
      // Sin llave, límite gratuito, sin red: se pausa y se explica. "Reintentar" sigue.
      setError(err instanceof Error && err.message ? err.message : 'No pude transcribir el audio.')
      cambiar('error')
      return
    }
    if (!vigente()) return
    if (texto.trim().length < MIN_CARACTERES_PREGUNTA) { volverAEscuchar(); return }

    let respuesta: string
    try {
      const promesa = cb.current.preguntar(texto, ctrl.signal) // lee el historial ANTES de agregar la pregunta
      cb.current.alPreguntar?.(texto)
      setUltimaPregunta(texto)
      setUltimaRespuesta('')
      respuesta = await promesa
    } catch (err) {
      if (!vigente()) return
      respuesta = err instanceof Error && err.message ? err.message : 'Hubo un error al procesar tu pregunta. Intenta de nuevo.'
    }
    if (!vigente()) return
    cb.current.alResponder?.(respuesta)
    setUltimaRespuesta(respuesta)
    if (debeSoltarMicAlHablar()) soltarMic(s)
    cambiar('hablando')
    await voz.hablar(respuesta, ctrl.signal)
    if (!vigente()) return
    volverAEscuchar()
  }, [cambiar, proveedores, soltarMic, volverAEscuchar])

  const cerrarEnunciado = useCallback((s: Sesion) => {
    const g = s.grabador
    cambiar('pensando')
    if (!g) { volverAEscuchar(); return }
    s.grabador = null
    const turno = s.turno
    // Los trozos de ESTE grabador (el siguiente tendrá su propio arreglo).
    const trozos = s.trozos
    g.onstop = () => {
      if (sesionRef.current !== s || s.turno !== turno) return
      const mime = g.mimeType || trozos[0]?.type || ''
      const audio = new Blob(trozos, mime ? { type: mime } : undefined)
      if (audio.size === 0) { volverAEscuchar(); return }
      void procesar(s, audio, mime)
    }
    try { g.stop() } catch { volverAEscuchar() }
  }, [cambiar, procesar, volverAEscuchar])

  const cuadro = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    const f = faseRef.current
    if (f !== 'escuchando' && f !== 'preparando') {
      setNivel(prev => (prev === 0 ? prev : 0))
      return
    }
    const rms = s.medidor.leer()
    const ahora = Date.now()
    const n = Math.round(nivelVisual(rms) * 12) / 12
    setNivel(prev => (prev === n ? prev : n))

    const { estado, evento } = pasoVad(s.vad, rms, ahora, cfgVad)
    s.vad = estado
    switch (evento) {
      case 'calibrado':
        iniciarGrabador(s)
        cambiar('escuchando')
        break
      case 'inicio':
        setUsuarioHablando(true)
        break
      case 'descartar':
        setUsuarioHablando(false)
        iniciarGrabador(s)
        break
      case 'fin':
        setUsuarioHablando(false)
        cerrarEnunciado(s)
        break
      default:
        // Tope de tamaño (el servidor no acepta más de ~4 MB): se cierra ya.
        if (estado.fase === 'hablando' && s.bytes >= TOPE_BYTES_ENUNCIADO) {
          s.vad = estadoInicialVad(ruidoDe(estado))
          setUsuarioHablando(false)
          cerrarEnunciado(s)
          break
        }
        if (estado.fase === 'esperando' && f === 'escuchando' && ahora - s.grabadorDesde > REINICIO_SILENCIO_MS) {
          iniciarGrabador(s)
        }
    }
  }, [cambiar, cerrarEnunciado, cfgVad, iniciarGrabador])

  const cerrar = useCallback(() => {
    intentoRef.current++
    const s = sesionRef.current
    sesionRef.current = null
    if (s) {
      s.turno++
      s.abort?.abort()
      if (s.intervalo) clearInterval(s.intervalo)
      detenerGrabador(s)
      s.medidor.cerrar()
      cerrarStream(s.stream)
    }
    proveedores().voz.callar()
    cambiar('inactivo')
    if (montadoRef.current) { setNivel(0); setError(null) }
  }, [cambiar, detenerGrabador, proveedores])

  /** Abre el micrófono y empieza. Llamar después de `prepararModoVozEnGesto()`. */
  const abrir = useCallback(async () => {
    if (sesionRef.current || faseRef.current === 'preparando') return
    const intento = ++intentoRef.current
    setError(null)
    cambiar('preparando')
    const ctx = audioContextCompartido()
    let stream: MediaStream
    try {
      stream = await abrirMicrofono()
    } catch (err) {
      if (!montadoRef.current || intento !== intentoRef.current) return
      setError(err instanceof ErrorMicrofono ? err.message : mensajeErrorMicrofono(err))
      cambiar('error')
      return
    }
    if (!montadoRef.current || intento !== intentoRef.current) { cerrarStream(stream); return }
    const s: Sesion = {
      stream,
      medidor: crearMedidor(ctx, stream),
      vad: estadoCalibrando(Date.now()),
      grabador: null,
      trozos: [],
      bytes: 0,
      grabadorDesde: Date.now(),
      micSuelto: false,
      intervalo: null,
      turno: 0,
      abort: null,
    }
    sesionRef.current = s
    s.intervalo = setInterval(cuadro, CUADRO_MS)
  }, [cambiar, cuadro])

  /** Tocar mientras habla o piensa: se calla / cancela y vuelve a escuchar. */
  const interrumpir = useCallback(() => {
    const s = sesionRef.current
    const f = faseRef.current
    if (!s || (f !== 'hablando' && f !== 'pensando')) return
    s.turno++
    s.abort?.abort()
    detenerGrabador(s)
    proveedores().voz.callar()
    volverAEscuchar()
  }, [detenerGrabador, proveedores, volverAEscuchar])

  /** Tras un error: con micrófono abierto sigue escuchando; si no, lo vuelve a pedir. */
  const reintentar = useCallback(() => {
    prepararModoVozEnGesto(proveedores())
    if (sesionRef.current) volverAEscuchar()
    else { cambiar('inactivo'); void abrir() }
  }, [abrir, cambiar, proveedores, volverAEscuchar])

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      // Es un contador, no un nodo del DOM: se incrementa a propósito al desmontar.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      intentoRef.current++
      faseRef.current = 'inactivo'
      const s = sesionRef.current
      sesionRef.current = null
      if (s) {
        s.turno++
        s.abort?.abort()
        if (s.intervalo) clearInterval(s.intervalo)
        const g = s.grabador
        if (g) { g.ondataavailable = null; g.onstop = null; try { if (g.state !== 'inactive') g.stop() } catch { /* */ } }
        s.medidor.cerrar()
        cerrarStream(s.stream)
      }
      proveedoresRef.current?.voz.callar()
    }
  }, [])

  return {
    fase,
    nivel,
    usuarioHablando,
    error,
    ultimaPregunta,
    ultimaRespuesta,
    abrir,
    cerrar,
    interrumpir,
    reintentar,
  }
}
