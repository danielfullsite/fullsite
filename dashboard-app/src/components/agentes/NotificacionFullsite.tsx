'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { LAYER } from '@/components/ui/layers'
import type { Deteccion } from '@/lib/agentes/detectar'

/**
 * La notificación con el logo de Fullsite.
 *
 * Aparece una sola vez por detección y por día. El candado importa: una alerta
 * que reaparece en cada recarga deja de leerse a la tercera vez, y entonces el
 * día que diga algo grave tampoco se va a leer. Se guarda en localStorage lo que
 * ya se enseñó, con la fecha, para que mañana sí vuelva a avisar si sigue.
 *
 * No interrumpe: entra por arriba, se queda unos segundos y se va sola. Sólo
 * saca la detección más grave — si hay tres cosas, la notificación no es el
 * lugar para las tres; para eso está el panel de abajo.
 *
 * Se desactiva con `prefers-reduced-motion`… no: con eso se quita la ANIMACIÓN,
 * no el aviso. Quitar el aviso sería quitar información.
 */

const LLAVE = 'fullsite_avisos_vistos'
const MS_VISIBLE = 9000

export interface NotificacionFullsiteProps {
  detecciones: Deteccion[]
  /** Para abrir el detalle al tocarla. */
  onAbrir?: (d: Deteccion) => void
  /** Sólo para pruebas: salta el candado de "ya se vio". */
  forzar?: boolean
}

function yaVista(id: string, hoy: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    const crudo = window.localStorage.getItem(LLAVE)
    if (!crudo) return false
    const vistas = JSON.parse(crudo) as Record<string, string>
    return vistas[id] === hoy
  } catch {
    // localStorage puede fallar en navegación privada. Ante la duda NO se
    // muestra: mejor un aviso de menos que uno repetido en bucle.
    return true
  }
}

function marcarVista(id: string, hoy: string): void {
  if (typeof window === 'undefined') return
  try {
    const crudo = window.localStorage.getItem(LLAVE)
    const vistas = crudo ? (JSON.parse(crudo) as Record<string, string>) : {}
    // Sólo se conserva lo de hoy: si no, el objeto crece para siempre.
    const limpio: Record<string, string> = {}
    for (const [k, v] of Object.entries(vistas)) if (v === hoy) limpio[k] = v
    limpio[id] = hoy
    window.localStorage.setItem(LLAVE, JSON.stringify(limpio))
  } catch { /* navegación privada */ }
}

export default function NotificacionFullsite({ detecciones, onAbrir, forzar }: NotificacionFullsiteProps) {
  const [visible, setVisible] = useState<Deteccion | null>(null)
  const [saliendo, setSaliendo] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const candidata = detecciones.length > 0 ? detecciones[0] : null
  const candidataId = candidata?.id ?? null

  useEffect(() => {
    if (!candidataId || !candidata) return
    const hoy = new Date().toLocaleDateString('en-CA')
    if (!forzar && yaVista(candidataId, hoy)) return

    // Un respiro antes de entrar: si el aviso aparece junto con la página, se
    // pierde entre todo lo demás que está montando.
    const entrada = setTimeout(() => {
      setVisible(candidata)
      setSaliendo(false)
      marcarVista(candidataId, hoy)
      temporizador.current = setTimeout(() => setSaliendo(true), MS_VISIBLE)
    }, 900)

    return () => {
      clearTimeout(entrada)
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [candidataId, candidata, forzar])

  // La salida espera a que termine la animación para desmontar.
  useEffect(() => {
    if (!saliendo) return
    const t = setTimeout(() => setVisible(null), 260)
    return () => clearTimeout(t)
  }, [saliendo])

  if (!visible) return null

  return (
    <div
      className="fixed left-1/2 top-4 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2"
      style={{ zIndex: LAYER.toast }}
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-start gap-3 rounded-[16px] border border-[var(--line)] px-3.5 py-3 shadow-2xl backdrop-blur ${saliendo ? 'ag-sale-aviso' : 'ag-entra-aviso'}`}
        style={{ background: 'var(--raised)' }}
      >
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--surface-2)]">
          {/* El logo va en las dos versiones y el CSS del tema decide cuál se ve,
              igual que en el sidebar. Un solo PNG se perdería en un tema u otro. */}
          <Image src="/fullsite-logo-white-v2.png" alt="" width={26} height={26} className="sidebar-logo-white" style={{ objectFit: 'contain' }} />
          <Image src="/fullsite-logo-black-v2.png" alt="" width={26} height={26} className="sidebar-logo-black" style={{ objectFit: 'contain' }} />
        </span>

        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => { setSaliendo(true); onAbrir?.(visible) }}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-[var(--text-1)]">Fullsite</span>
            <span className="text-[11px] text-[var(--text-4)]">ahora</span>
          </span>
          <span className="mt-0.5 block text-[13px] font-semibold leading-[1.35] text-[var(--text-1)]">
            {visible.pushTitulo}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-[var(--text-2)]">
            {visible.pushCuerpo}
          </span>
        </button>

        <button
          onClick={() => setSaliendo(true)}
          aria-label="Cerrar aviso"
          className="-mr-0.5 -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--text-4)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-2)]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
