'use client'

// "Habla con tu restaurante": plática continua, manos libres (como una llamada).
//
//   preparando → escuchando ─(VAD: fin)→ pensando ─(transcribe + chat)→ hablando ─┐
//                  ▲   ▲                    │ (> 1.5 s: "Mmm, déjame ver…")        │
//                  │   └──── el dueño habla encima (barge-in) ◄───────────────────┤
//                  └──────────────────────────────────────────────────────────────┘
//   60 s sin que nadie hable → pausado ("¿Seguimos?", tocar para seguir)
//
// - Al abrir se calibra el ruido del lugar (~300 ms) antes de escuchar, y en
//   paralelo se prepara la voz natural (Piper; la primera vez baja ~63 MB).
// - Fin de turno adaptativo (lib/voz/vad): ~0.6 s si la frase se fue apagando,
//   ~0.85 s si se cortó con energía.
// - Interrumpir HABLANDO (lib/voz/barge-in): con voz natural (Web Audio) el micrófono
//   sigue abierto mientras responde; voz sostenida del dueño (≥ 300 ms, por encima
//   del eco medido) calla la respuesta y lo que ya dijo se queda como inicio de su
//   turno. Con la voz del navegador (speechSynthesis) el eco no se puede separar:
//   sólo se interrumpe tocando. En iOS el micrófono se suelta mientras habla (si no,
//   la voz sale por el auricular): sólo tocando.
// - Transcripción vacía o ruido → vuelve a escuchar sin llamar al chat.
// - El cerebro (`preguntar`) es el mismo /api/chat del chat escrito, con modo 'voz'
//   y el historial de la plática.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_BYTES_AUDIO, mensajeErrorMicrofono, nivelVisual } from '@/lib/voz/audio'
import {
  BARGE_IN_POR_DEFECTO, estadoInicialBargeIn, pasoBargeIn, type ConfigBargeIn, type EstadoBargeIn,
} from '@/lib/voz/barge-in'
import {
  abrirMicrofono, audioContextCompartido, cerrarStream, crearGrabador, crearMedidor, ErrorMicrofono,
} from '@/lib/voz/microfono'
import { obtenerProveedoresVoz, type EstadoCargaVoz, type ProveedoresVoz } from '@/lib/voz/proveedores'
import { frasesParaHablar } from '@/lib/voz/texto-hablado'
import { crearTranscripcionEnVivo, type TranscripcionEnVivo } from '@/lib/voz/transcripcion-en-vivo'
import {
  estadoCalibrando, estadoInicialVad, pasoVad, ruidoDe, VAD_POR_DEFECTO, type ConfigVad, type EstadoVad,
} from '@/lib/voz/vad'
import { siguienteAcuse } from '@/lib/voz/voz-natural'

export type FaseVoz = 'inactivo' | 'preparando' | 'escuchando' | 'pensando' | 'hablando' | 'pausado' | 'error'

/** Cada cuánto se lee el micrófono. */
const CUADRO_MS = 50
/** Si nadie habla en este tiempo, se reinicia la grabación para no acumular silencio. */
const REINICIO_SILENCIO_MS = 15_000
/** El grabador entrega un trozo cada tanto: así se lleva la cuenta del tamaño. */
const TROZO_MS = 1000
/** Antes del tope del servidor (~4 MB, límite de cuerpo de Vercel) se cierra el enunciado. */
const TOPE_BYTES_ENUNCIADO = Math.floor(MAX_BYTES_AUDIO * 0.9)
/** Si la respuesta tarda más que esto (desde que el dueño se calló), un acuse corto. */
export const ACUSE_DESPUES_MS = 1500
/** Tanto tiempo sin que nadie hable → pausa ("¿Seguimos?") y se suelta el micrófono. */
export const SILENCIO_PAUSA_MS = 60_000

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
  bargeIn?: ConfigBargeIn
  /** Pruebas: silencio que pausa la plática (default SILENCIO_PAUSA_MS). */
  silencioPausaMs?: number
  /** Pruebas: espera antes del acuse (default ACUSE_DESPUES_MS). */
  acuseDespuesMs?: number
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
  /** Interrupción por voz mientras habla (barge-in). */
  bargeIn: EstadoBargeIn
  bargeActivo: boolean
  /** Cuándo empezó a sonar la frase actual (ventana sorda del barge-in). */
  fraseDesde: number
  /** Última vez que alguien habló (para la pausa por silencio). */
  ultimaActividad: number
  /** Cuándo cerró el último enunciado del dueño (para el acuse). */
  finEnunciado: number
}

/**
 * Prepara audio y voz DENTRO del toque del usuario (iOS Safari: la síntesis y el
 * AudioContext sólo arrancan desde un gesto). Llamar en el onClick del botón.
 */
export function prepararModoVozEnGesto(proveedores: ProveedoresVoz = obtenerProveedoresVoz()): void {
  proveedores.voz.preparar()
  audioContextCompartido()
}

export function useModoVoz({
  preguntar, alPreguntar, alResponder, proveedores: prov, vad: cfgVad = VAD_POR_DEFECTO, bargeIn: cfgBarge = BARGE_IN_POR_DEFECTO,
  silencioPausaMs = SILENCIO_PAUSA_MS, acuseDespuesMs = ACUSE_DESPUES_MS,
}: Opciones) {
  const [fase, setFase] = useState<FaseVoz>('inactivo')
  const [nivel, setNivel] = useState(0)
  const [usuarioHablando, setUsuarioHablando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaPregunta, setUltimaPregunta] = useState('')
  const [ultimaRespuesta, setUltimaRespuesta] = useState('')
  /** Frases (con dígitos) de la respuesta que se está diciendo, y cuál suena. */
  const [frases, setFrases] = useState<string[]>([])
  const [fraseActual, setFraseActual] = useState(-1)
  /** Subtítulo en vivo de lo que va diciendo el dueño (si el navegador puede). */
  const [enVivo, setEnVivo] = useState('')
  const [cargaVoz, setCargaVoz] = useState<EstadoCargaVoz>({ estado: 'inactivo' })
  /** Mientras habla, ¿se le puede interrumpir hablando? (para la pista en pantalla) */
  const [interrumpePorVoz, setInterrumpePorVoz] = useState(false)

  const faseRef = useRef<FaseVoz>('inactivo')
  /** Sube en cada abrir/cerrar/desmontar: un getUserMedia que llega tarde se descarta. */
  const intentoRef = useRef(0)
  const sesionRef = useRef<Sesion | null>(null)
  const montadoRef = useRef(true)
  const acuseRef = useRef(-1)
  const vivoRef = useRef<TranscripcionEnVivo | null>(null)
  const cb = useRef({ preguntar, alPreguntar, alResponder })
  useEffect(() => { cb.current = { preguntar, alPreguntar, alResponder } }, [preguntar, alPreguntar, alResponder])
  const proveedoresRef = useRef<ProveedoresVoz | null>(prov ?? null)
  const proveedores = useCallback((): ProveedoresVoz => {
    if (!proveedoresRef.current) proveedoresRef.current = obtenerProveedoresVoz()
    return proveedoresRef.current
  }, [])

  const vivo = useCallback((): TranscripcionEnVivo | null => {
    if (!vivoRef.current && !debeSoltarMicAlHablar()) {
      vivoRef.current = crearTranscripcionEnVivo(t => { if (montadoRef.current && faseRef.current === 'escuchando') setEnVivo(t) })
    }
    return vivoRef.current
  }, [])

  const cambiar = useCallback((f: FaseVoz) => {
    faseRef.current = f
    if (montadoRef.current) setFase(f)
    if (f !== 'escuchando') setUsuarioHablando(false)
    // El subtítulo en vivo sólo corre mientras escucha.
    if (f === 'escuchando') vivo()?.iniciar()
    else vivoRef.current?.detener()
  }, [vivo])

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
    if (montadoRef.current) { setEnVivo(''); setFraseActual(-1) }
    cambiar('escuchando')
  }, [cambiar, iniciarGrabador])

  /**
   * El dueño ya está hablando (interrumpió, o empezó justo al terminar la respuesta):
   * se calla lo que suene y lo que YA se grabó queda como el inicio de su turno.
   */
  const tomarTurno = useCallback((s: Sesion, inicioVoz: number, vozMs: number) => {
    s.turno++
    s.abort?.abort()
    s.abort = null
    proveedores().voz.callar()
    const ahora = Date.now()
    s.vad = { fase: 'hablando', ruido: ruidoDe(s.vad), inicio: inicioVoz, ultimaVoz: ahora, vozMs, ultimoCuadro: ahora }
    s.bargeIn = { acople: s.bargeIn.acople, candidato: null }
    if (!s.grabador) iniciarGrabador(s)
    s.ultimaActividad = ahora
    setError(null)
    if (montadoRef.current) { setEnVivo(''); setFraseActual(-1) }
    cambiar('escuchando')
    setUsuarioHablando(true)
  }, [cambiar, iniciarGrabador, proveedores])

  const volverAEscuchar = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    s.ultimaActividad = Date.now()
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

    // Si la respuesta tarda, un acuse corto para que no se sienta muerto.
    const acuse: { sonando: Promise<void> | null } = { sonando: null }
    const tAcuse = setTimeout(() => {
      if (!vigente() || faseRef.current !== 'pensando') return
      const a = siguienteAcuse(acuseRef.current)
      acuseRef.current = a.indice
      acuse.sonando = voz.hablar(a.texto, ctrl.signal, { cachear: true })
    }, Math.max(0, acuseDespuesMs - (Date.now() - s.finEnunciado)))

    let respuesta: string
    try {
      const promesa = cb.current.preguntar(texto, ctrl.signal) // lee el historial ANTES de agregar la pregunta
      cb.current.alPreguntar?.(texto)
      setUltimaPregunta(texto)
      setUltimaRespuesta('')
      setFrases([])
      setFraseActual(-1)
      respuesta = await promesa
    } catch (err) {
      if (!vigente()) { clearTimeout(tAcuse); return }
      respuesta = err instanceof Error && err.message ? err.message : 'Hubo un error al procesar tu pregunta. Intenta de nuevo.'
    }
    clearTimeout(tAcuse)
    if (acuse.sonando) await acuse.sonando // no se encima con la respuesta
    if (!vigente()) return
    cb.current.alResponder?.(respuesta)
    setUltimaRespuesta(respuesta)
    setFrases(frasesParaHablar(respuesta).map(f => f.mostrar))
    setFraseActual(-1)

    const soltar = debeSoltarMicAlHablar()
    if (soltar) soltarMic(s)
    s.bargeActivo = !soltar && !!voz.permiteInterrupcionPorVoz?.()
    s.bargeIn = { acople: s.bargeIn.acople, candidato: null }
    s.fraseDesde = Date.now()
    setInterrumpePorVoz(s.bargeActivo)
    cambiar('hablando')
    await voz.hablar(respuesta, ctrl.signal, {
      alFrase: i => {
        if (!vigente()) return
        s.fraseDesde = Date.now()
        setFraseActual(i)
      },
    })
    if (!vigente()) return
    // Si el dueño ya había empezado a hablar justo al final, su voz ya se está grabando.
    const c = s.bargeIn.candidato
    if (c && s.grabador) { tomarTurno(s, c.desde, c.vozMs); return }
    detenerGrabador(s)
    volverAEscuchar()
  }, [acuseDespuesMs, cambiar, detenerGrabador, proveedores, soltarMic, tomarTurno, volverAEscuchar])

  const cerrarEnunciado = useCallback((s: Sesion) => {
    const g = s.grabador
    s.finEnunciado = Date.now()
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

  /** Suelta todo (micrófono, grabador, lo que esté sonando). */
  const desarmar = useCallback((s: Sesion | null) => {
    if (!s) return
    s.turno++
    s.abort?.abort()
    if (s.intervalo) clearInterval(s.intervalo)
    detenerGrabador(s)
    s.medidor.cerrar()
    cerrarStream(s.stream)
  }, [detenerGrabador])

  /** 60 s sin plática: se pausa y se suelta el micrófono. Tocar "Seguir" reanuda. */
  const pausar = useCallback(() => {
    intentoRef.current++
    const s = sesionRef.current
    sesionRef.current = null
    desarmar(s)
    proveedores().voz.callar()
    cambiar('pausado')
    if (montadoRef.current) { setNivel(0); setEnVivo('') }
  }, [cambiar, desarmar, proveedores])

  /** Mientras habla: ¿el dueño está hablando encima? */
  const cuadroHablando = useCallback((s: Sesion) => {
    if (!s.bargeActivo || s.micSuelto) return
    const voz = proveedores().voz
    if (!voz.permiteInterrupcionPorVoz?.()) {
      // La voz natural cayó al respaldo a media respuesta: ya no se puede separar el eco.
      if (s.bargeIn.candidato) { detenerGrabador(s); s.bargeIn = { acople: s.bargeIn.acople, candidato: null } }
      return
    }
    const ahora = Date.now()
    const r = pasoBargeIn(s.bargeIn, {
      rms: s.medidor.leer(), salida: voz.nivelSalida?.() ?? 0, ruido: ruidoDe(s.vad), ahora, fraseDesde: s.fraseDesde,
    }, cfgBarge)
    s.bargeIn = r.estado
    if (r.evento === 'posible') iniciarGrabador(s) // grabar YA: no perder el inicio
    else if (r.evento === 'descartar') detenerGrabador(s)
    else if (r.evento === 'interrumpir') tomarTurno(s, r.inicioVoz ?? ahora, r.vozMs ?? 0)
  }, [cfgBarge, detenerGrabador, iniciarGrabador, proveedores, tomarTurno])

  const cuadro = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    const f = faseRef.current
    if (f === 'hablando') {
      setNivel(prev => (prev === 0 ? prev : 0))
      cuadroHablando(s)
      return
    }
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
        s.ultimaActividad = ahora
        iniciarGrabador(s)
        cambiar('escuchando')
        break
      case 'inicio':
        s.ultimaActividad = ahora
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
        if (estado.fase === 'esperando' && f === 'escuchando') {
          if (ahora - s.ultimaActividad >= silencioPausaMs) { pausar(); break }
          if (ahora - s.grabadorDesde > REINICIO_SILENCIO_MS) iniciarGrabador(s)
        }
    }
  }, [cambiar, cerrarEnunciado, cfgVad, cuadroHablando, iniciarGrabador, pausar, silencioPausaMs])

  const cerrar = useCallback(() => {
    intentoRef.current++
    const s = sesionRef.current
    sesionRef.current = null
    desarmar(s)
    proveedores().voz.callar()
    vivoRef.current?.detener()
    cambiar('inactivo')
    if (montadoRef.current) { setNivel(0); setError(null); setEnVivo('') }
  }, [cambiar, desarmar, proveedores])

  /** Abre el micrófono y empieza. Llamar después de `prepararModoVozEnGesto()`. */
  const abrir = useCallback(async () => {
    if (sesionRef.current || faseRef.current === 'preparando') return
    const intento = ++intentoRef.current
    setError(null)
    cambiar('preparando')
    // La voz natural se prepara EN PARALELO: no se espera (mientras, habla el respaldo).
    const voz = proveedores().voz
    void voz.cargar?.(e => { if (montadoRef.current) setCargaVoz(e) })
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
    const ahora = Date.now()
    const s: Sesion = {
      stream,
      medidor: crearMedidor(ctx, stream),
      vad: estadoCalibrando(ahora),
      grabador: null,
      trozos: [],
      bytes: 0,
      grabadorDesde: ahora,
      micSuelto: false,
      intervalo: null,
      turno: 0,
      abort: null,
      bargeIn: estadoInicialBargeIn(cfgBarge),
      bargeActivo: false,
      fraseDesde: ahora,
      ultimaActividad: ahora,
      finEnunciado: ahora,
    }
    sesionRef.current = s
    s.intervalo = setInterval(cuadro, CUADRO_MS)
  }, [cambiar, cfgBarge, cuadro, proveedores])

  /** Tocar mientras habla o piensa: se calla / cancela y vuelve a escuchar. */
  const interrumpir = useCallback(() => {
    const s = sesionRef.current
    const f = faseRef.current
    if (!s || (f !== 'hablando' && f !== 'pensando')) return
    s.turno++
    s.abort?.abort()
    detenerGrabador(s)
    s.bargeIn = { acople: s.bargeIn.acople, candidato: null }
    proveedores().voz.callar()
    volverAEscuchar()
  }, [detenerGrabador, proveedores, volverAEscuchar])

  /** Tras un error o una pausa: con micrófono abierto sigue escuchando; si no, lo vuelve a pedir. */
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
      vivoRef.current?.detener()
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
    frases,
    fraseActual,
    enVivo,
    cargaVoz,
    interrumpePorVoz,
    abrir,
    cerrar,
    interrumpir,
    reintentar,
  }
}
