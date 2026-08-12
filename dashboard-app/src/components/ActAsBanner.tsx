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
    try {
      await fetch('/api/platform/act-as', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exit: true }),
      })
    } catch { /* best-effort */ }
    try {
      localStorage.removeItem('fullsite_actas')
      localStorage.removeItem('fullsite_client_id')
    } catch { /* SSR */ }
    window.location.href = '/platform/tenants'
  }

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-[13px] text-amber-200 backdrop-blur">
      <Eye size={15} className="flex-shrink-0" />
      <span>Estás viendo <b className="font-mono">{actas}</b> como administrador de plataforma.</span>
      <button
        onClick={exit}
        disabled={busy}
        className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Salir
      </button>
    </div>
  )
}
