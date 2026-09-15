'use client'
// ─────────────────────────────────────────────────────────────────────────────
// El caparazón del punto de venta.
//
// Hasta ahora cada una de las 42 rutas del POS traía su propio encabezado, su
// propia altura y su propio menú. Por eso el rediseño se sentía a parches: se
// arreglaba una pantalla y la siguiente seguía siendo otra aplicación.
//
// Esto es lo que el demo llama `#app`: una retícula de dos franjas —barra de
// estado de 52 px y el resto para la operación— con la navegación a pantalla
// completa colgando del mismo botón en todas partes.
//
// LA ALTURA ES EL PUNTO DELICADO. 33 pantallas del POS se declaran `h-screen`
// o `h-dvh`, o sea «toda la ventana». Dentro de un caparazón con barra, eso
// desborda 52 px exactos. `pos-v2.css` las baja a `height:100%` sólo cuando el
// caparazón está puesto; sin la bandera, nada cambia.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, Wifi, WifiOff, Settings } from 'lucide-react'
import NavPantallaCompleta from '@/components/NavPantallaCompleta'
import { nombreDePantalla, type PosNavGroup } from '@/lib/pos-nav'

/* ── ¿Hay internet? ────────────────────────────────────────────────────────
   `navigator.onLine` NUNCA equivale a conectividad real —lo dice el contrato
   offline del sistema— así que esto informa, no decide. Ninguna operación
   depende de este valor: la cola y el servidor local siguen mandando. */
const oyentes = new Set<() => void>()
function suscribirRed(fn: () => void) {
  oyentes.add(fn)
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => { oyentes.delete(fn); window.removeEventListener('online', fn); window.removeEventListener('offline', fn) }
}
const leerRed = () => (typeof navigator === 'undefined' ? true : navigator.onLine)
const leerRedServidor = () => true

function Reloj() {
  const [hora, setHora] = useState('')
  useEffect(() => {
    const pinta = () => setHora(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
    pinta()
    const t = setInterval(pinta, 20_000)
    return () => clearInterval(t)
  }, [])
  // Sin hora hasta que el cliente la calcula: el servidor está en otro huso y
  // pintar la suya provoca un salto visible al hidratar.
  return <span className="font-mono tabular-nums text-[11px] font-semibold tracking-[0.04em]">{hora || '--:--'}</span>
}

function Pastilla({ children, tono = 'neutro' }: { children: React.ReactNode; tono?: 'neutro' | 'ok' | 'mal' }) {
  const t = tono === 'ok'
    ? { background: 'var(--accent-soft)', color: 'var(--accent-bright)', borderColor: 'var(--accent-line)' }
    : tono === 'mal'
    ? { background: 'var(--crit-soft)', color: 'var(--crit-ink)', borderColor: 'var(--crit-line)' }
    : { background: 'var(--surface)', color: 'var(--text-3)', borderColor: 'var(--line)' }
  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-semibold uppercase tracking-[0.04em] whitespace-nowrap"
      style={t}
    >
      {children}
    </span>
  )
}

export function PosShell({
  children, secciones, tenant, usuario, onSignOut,
}: {
  children: React.ReactNode
  /** Navegación ya filtrada por permiso y por estaciones del tenant. */
  secciones: PosNavGroup[]
  tenant?: string
  usuario?: string
  onSignOut?: () => void
}) {
  const pathname = usePathname()
  const [menu, setMenu] = useState(false)
  const enLinea = useSyncExternalStore(suscribirRed, leerRed, leerRedServidor)

  return (
    <div className="h-dvh grid overflow-hidden" style={{ gridTemplateRows: '52px minmax(0,1fr)', background: 'var(--bg)' }}>
      <header
        className="flex items-center gap-3 px-3 border-b relative z-10"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
      >
        <button
          onClick={() => setMenu(true)}
          aria-label="Menú"
          className="w-10 h-10 rounded-[var(--r1,8px)] grid place-items-center flex-shrink-0 transition-transform active:scale-90"
          style={{ color: 'var(--text-2)' }}
        >
          <Menu size={20} />
        </button>

        {/* La marca, como en el diseño: el cuadro verde es el PUNTO FINAL. */}
        <span className="inline-flex items-end gap-[0.07em] font-extrabold text-[15px] leading-[0.9] tracking-[-0.045em] flex-shrink-0" style={{ color: 'var(--text-1)' }}>
          fullsite
          <i className="block w-[0.22em] h-[0.22em] mb-[0.055em] flex-shrink-0" style={{ background: '#10B981' }} />
        </span>

        <span className="w-px h-[22px] flex-shrink-0" style={{ background: 'var(--line)' }} />

        <span className="text-[13px] font-bold truncate min-w-0" style={{ color: 'var(--text-2)' }}>
          {nombreDePantalla(pathname)}
        </span>

        <span className="flex-1" />

        {enLinea
          ? <Pastilla tono="ok"><Wifi size={12} />En línea</Pastilla>
          : <Pastilla tono="mal"><WifiOff size={12} />Sin internet</Pastilla>}
        {usuario && <Pastilla>{usuario}</Pastilla>}
        <Pastilla><Reloj /></Pastilla>

        <a
          href="/pos/configuracion"
          aria-label="Ajustes"
          className="w-10 h-10 rounded-[var(--r1,8px)] grid place-items-center flex-shrink-0 transition-transform active:scale-90"
          style={{ color: 'var(--text-3)' }}
        >
          <Settings size={18} />
        </a>
      </header>

      <div className="min-h-0 overflow-hidden">{children}</div>

      {menu && (
        <NavPantallaCompleta
          // El menú habla de `label`; la navegación del POS, de `title`. Se
          // traduce aquí y no se toca ninguno de los dos.
          secciones={secciones.map(g => ({ label: g.title, items: g.items }))}
          pathname={pathname}
          onClose={() => setMenu(false)}
          onSignOut={onSignOut}
          titulo={tenant || 'Fullsite'}
          subtitulo={usuario}
        />
      )}
    </div>
  )
}
