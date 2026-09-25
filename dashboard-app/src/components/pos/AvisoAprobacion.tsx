'use client'

import { useEffect, useState } from 'react'
import type { MotivoAprobacionFallida } from '@/lib/pos-data'

/**
 * Aviso global cuando una aprobación de gerente falla por algo que NO es el PIN.
 *
 * Las 17 pantallas que piden PIN de gerente dicen «PIN incorrecto» cuando la verificación
 * devuelve null. Eso es verdad cuando la autoridad rechazó el PIN, y mentira cuando la nube
 * no contestó, la terminal no tiene restaurante, no está enrolada o está bloqueada por
 * intentos. `pos-data.ts` emite `fullsite:aprobacion-fallida` con el motivo real sólo en esos
 * casos, y aquí se muestra, sin tocar las 17 pantallas.
 *
 * Vive en su propio componente a propósito: `pos/layout.tsx` arrastra un `rules-of-hooks` de
 * nacimiento, y cada hook nuevo ahí suma un error de lint.
 */
export function mensajeDeAprobacionFallida(motivo: MotivoAprobacionFallida): string | null {
  switch (motivo) {
    case 'autoridad-no-disponible':
      return 'No se pudo confirmar el PIN del gerente: el servidor no contestó y esta terminal no tiene una aprobación guardada con qué juzgarlo. No es el PIN.'
    case 'sin-tenant':
      return 'Esta terminal no sabe a qué restaurante pertenece. Pide que la configuren; no es el PIN.'
    case 'terminal-no-enrolada':
      return 'Esta terminal no está autorizada para aprobar. Pide que la den de alta; no es el PIN.'
    case 'bloqueado-local':
      return 'Demasiados PINs de gerente equivocados en esta terminal. Espera un momento antes de intentar de nuevo.'
    case 'pin-rechazado':
      return null
  }
}

export default function AvisoAprobacion() {
  const [mensaje, setMensaje] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const onFallo = (e: Event) => {
      const motivo = (e as CustomEvent<{ motivo?: MotivoAprobacionFallida }>).detail?.motivo
      const m = motivo ? mensajeDeAprobacionFallida(motivo) : null
      if (!m) return
      setMensaje(m)
      if (t) clearTimeout(t)
      t = setTimeout(() => setMensaje(null), 8000)
    }
    window.addEventListener('fullsite:aprobacion-fallida', onFallo)
    return () => { window.removeEventListener('fullsite:aprobacion-fallida', onFallo); if (t) clearTimeout(t) }
  }, [])
  if (!mensaje) return null
  return (
    <div role="alert" className="fixed top-2 left-1/2 z-[1000] -translate-x-1/2 max-w-[92vw] rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[13px] text-amber-200 shadow-lg">
      {mensaje}
    </div>
  )
}
