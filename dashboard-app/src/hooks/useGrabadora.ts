'use client'

// Nota de voz del chat: tocar → grabar → (detener) transcribir → texto al input.
//
// El texto NO se envía solo: cae en el input para que el usuario lo revise.
// Cancelar descarta el audio sin mandarlo a ningún lado. Tope: 2 minutos.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_BYTES_AUDIO, MAX_SEGUNDOS_NOTA, mensajeErrorMicrofono, nivelVisual } from '@/lib/voz/audio'
import {
  abrirMicrofono, audioContextCompartido, cerrarStream, crearGrabador, crearMedidor, ErrorMicrofono,
} from '@/lib/voz/microfono'
import { obtenerProveedoresVoz, type ProveedorTranscripcion } from '@/lib/voz/proveedores'

export type EstadoGrabadora = 'inactivo' | 'pidiendo' | 'grabando' | 'transcribiendo'

interface Opciones {
  /** Texto transcrito (no vacío). */
  alTexto: (texto: string) => void
  transcripcion?: ProveedorTranscripcion
  maxSegundos?: number
}

interface Sesion {
  stream: MediaStream
  grabador: MediaRecorder
  medidor: { leer: () => number; cerrar: () => void }
  trozos: Blob[]
  inicio: number
  intervalo: ReturnType<typeof setInterval> | null
  descartar: boolean
}

export function useGrabadora({ alTexto, transcripcion, maxSegundos = MAX_SEGUNDOS_NOTA }: Opciones) {
  const [estado, setEstado] = useState<EstadoGrabadora>('inactivo')
  const [segundos, setSegundos] = useState(0)
  const [nivel, setNivel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const estadoRef = useRef<EstadoGrabadora>('inactivo')
  const sesionRef = useRef<Sesion | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const montadoRef = useRef(true)
  const alTextoRef = useRef(alTexto)
  useEffect(() => { alTextoRef.current = alTexto }, [alTexto])

  const cambiar = useCallback((e: EstadoGrabadora) => {
    estadoRef.current = e
    if (montadoRef.current) setEstado(e)
  }, [])

  const liberar = useCallback((s: Sesion) => {
    if (s.intervalo) clearInterval(s.intervalo)
    s.intervalo = null
    s.medidor.cerrar()
    cerrarStream(s.stream)
  }, [])

  const transcribir = useCallback(async (audio: Blob, mime: string) => {
    const proveedor = transcripcion ?? obtenerProveedoresVoz().transcripcion
    const ctrl = new AbortController()
    abortRef.current = ctrl
    cambiar('transcribiendo')
    try {
      const texto = await proveedor.transcribir(audio, mime, ctrl.signal)
      if (ctrl.signal.aborted || !montadoRef.current) return
      if (!texto) setError('No alcancé a escuchar nada. Intenta de nuevo, más cerca del micrófono.')
      else alTextoRef.current(texto)
    } catch (err) {
      if (ctrl.signal.aborted || !montadoRef.current) return
      setError(err instanceof Error && err.message ? err.message : 'No pude transcribir el audio. Intenta de nuevo.')
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      cambiar('inactivo')
    }
  }, [cambiar, transcripcion])

  const detener = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    s.descartar = false
    if (s.grabador.state !== 'inactive') s.grabador.stop()
  }, [])

  const cancelar = useCallback(() => {
    const s = sesionRef.current
    if (s) {
      s.descartar = true
      if (s.grabador.state !== 'inactive') s.grabador.stop()
      else { liberar(s); sesionRef.current = null; cambiar('inactivo') }
      return
    }
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      cambiar('inactivo')
      return
    }
    if (estadoRef.current === 'pidiendo') cambiar('inactivo')
  }, [cambiar, liberar])

  /** Llamar desde el onClick: el AudioContext se crea dentro del gesto (iOS). */
  const iniciar = useCallback(async () => {
    if (estadoRef.current !== 'inactivo') return
    setError(null)
    cambiar('pidiendo')
    const ctx = audioContextCompartido()

    let stream: MediaStream
    try {
      stream = await abrirMicrofono()
    } catch (err) {
      setError(err instanceof ErrorMicrofono ? err.message : mensajeErrorMicrofono(err))
      cambiar('inactivo')
      return
    }
    // Si canceló mientras el navegador pedía permiso, el micrófono se suelta sin grabar.
    if (!montadoRef.current || (estadoRef.current as EstadoGrabadora) !== 'pidiendo') { cerrarStream(stream); return }

    let grabador: MediaRecorder
    try {
      grabador = crearGrabador(stream)
    } catch {
      cerrarStream(stream)
      setError(mensajeErrorMicrofono({ name: 'NoSoportado' }))
      cambiar('inactivo')
      return
    }

    const s: Sesion = {
      stream, grabador, medidor: crearMedidor(ctx, stream), trozos: [], inicio: Date.now(), intervalo: null, descartar: false,
    }
    sesionRef.current = s

    // Trozos cada segundo para llevar la cuenta del tamaño: antes del tope del
    // servidor (~4 MB) se detiene sola, como al llegar a los 2 minutos.
    let bytes = 0
    grabador.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size <= 0) return
      s.trozos.push(e.data)
      bytes += e.data.size
      if (bytes >= Math.floor(MAX_BYTES_AUDIO * 0.9) && sesionRef.current === s) detener()
    }
    grabador.onstop = () => {
      liberar(s)
      if (sesionRef.current === s) sesionRef.current = null
      if (s.descartar || !montadoRef.current) { cambiar('inactivo'); return }
      const mime = grabador.mimeType || s.trozos[0]?.type || ''
      const audio = new Blob(s.trozos, mime ? { type: mime } : undefined)
      if (audio.size === 0) {
        setError('La grabación salió vacía. Intenta de nuevo.')
        cambiar('inactivo')
        return
      }
      void transcribir(audio, mime)
    }

    try {
      grabador.start(1000)
    } catch {
      liberar(s)
      sesionRef.current = null
      setError(mensajeErrorMicrofono({ name: 'NoSoportado' }))
      cambiar('inactivo')
      return
    }

    setSegundos(0)
    setNivel(0)
    cambiar('grabando')
    s.intervalo = setInterval(() => {
      const transcurrido = (Date.now() - s.inicio) / 1000
      const seg = Math.floor(transcurrido)
      setSegundos(prev => (prev === seg ? prev : seg))
      const n = Math.round(nivelVisual(s.medidor.leer()) * 12) / 12
      setNivel(prev => (prev === n ? prev : n))
      if (transcurrido >= maxSegundos) detener()
    }, 100)
  }, [cambiar, detener, liberar, maxSegundos, transcribir])

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      abortRef.current?.abort()
      const s = sesionRef.current
      if (s) {
        s.descartar = true
        try { if (s.grabador.state !== 'inactive') s.grabador.stop() } catch { /* */ }
        liberar(s)
        sesionRef.current = null
      }
    }
  }, [liberar])

  return {
    estado,
    segundos,
    nivel,
    error,
    limpiarError: useCallback(() => setError(null), []),
    iniciar,
    detener,
    cancelar,
    maxSegundos,
  }
}
