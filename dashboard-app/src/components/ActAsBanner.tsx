'use client'

import { useEffect, useState } from 'react'
import { Eye, LogOut, Loader2 } from 'lucide-react'

// Banner de impersonación: visible cuando un platform admin entró a un tenant
// (localStorage 'fullsite_actas'). "Salir" borra la membresía actas en el server
// y limpia el estado local, regresando a /platform/tenants.
export default function ActAsBanner() {
  const [actas, setActas] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try { setActas(localStorage.getItem('fullsite_actas')) } catch { /* SSR */ }
  }, [])

  if (!actas) return null

  async function exit() {
    setBusy(true)
    let wasAdmin = false
    try {
      const res = await fetch('/api/platform/act-as', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exit: true }),
      })
      wasAdmin = res.ok
    } catch { /* best-effort */ }
    try {
      localStorage.removeItem('fullsite_actas')
      localStorage.removeItem('fullsite_client_id')
    } catch { /* SSR */ }
    // Un no-admin con flag huérfano no tiene acceso a /platform — mandarlo ahí
    // era aterrizar en "Acceso denegado". A su home normal.
    window.location.href = wasAdmin ? '/platform/tenants' : '/'
  }

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-[var(--warn-soft)] border-b border-[color-mix(in_srgb,var(--warn)_45%,transparent)] px-4 py-2 text-[13px] font-medium text-[var(--warn-ink)] backdrop-blur">
      <Eye size={15} className="flex-shrink-0" />
      <span>Estás viendo <b className="font-mono">{actas}</b> como administrador de plataforma.</span>
      <button
        onClick={exit}
        disabled={busy}
        className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] px-2.5 py-1 font-semibold text-[var(--warn-ink)] hover:bg-[color-mix(in_srgb,var(--warn)_34%,transparent)] disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Salir
      </button>
    </div>
  )
}
