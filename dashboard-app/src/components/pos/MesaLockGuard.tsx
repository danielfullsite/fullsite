'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { adquirirMesa, liberarMesa, MESA_LOCK_RENEW_MS, MesaLockError } from '@/lib/mesa-lock'
import { requiereCaja } from '@/lib/pedro-cliente'
import { resolveMesa } from '@/lib/pos-navigation'

type Estado = 'inactivo' | 'confirmando' | 'adquirido' | 'conflicto' | 'sin-caja'

export default function MesaLockGuard({ enabled, children }: Readonly<{ enabled: boolean; children?: React.ReactNode }>) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.toString()
  const [retry, setRetry] = useState(0)
  const [estado, setEstado] = useState<Estado>('inactivo')

  // El editor usa el query y, si el App Router lo perdió offline, el destino
  // estacionado en sessionStorage. Se memoriza por URL: el propio editor consume
  // ese destino al montar y no debe hacer que la guardia salte después a mesa 1.
  const mesa = useMemo(() => resolveMesa(new URLSearchParams(query).get('mesa')), [pathname, query])
  const params = new URLSearchParams(query)
  const debeBloquear = enabled && pathname === '/pos' && !params.get('cuenta') && !params.get('mostrador') && requiereCaja()

  useEffect(() => {
    if (!debeBloquear) { setEstado('inactivo'); return }
    let vivo = true
    let adquirido = false
    let renovando = false
    setEstado('confirmando')

    const adquirir = async () => {
      if (renovando) return
      renovando = true
      try {
        await adquirirMesa(mesa)
        if (!vivo) {
          // La navegación ganó la carrera contra el ACK: no dejar un lock
          // huérfano esperando a que venza.
          void liberarMesa(mesa).catch(() => {})
          return
        }
        adquirido = true
        setEstado('adquirido')
      } catch (error) {
        if (!vivo) return
        setEstado(error instanceof MesaLockError && error.code === 'MESA_LOCK_CONFLICT' ? 'conflicto' : 'sin-caja')
      } finally { renovando = false }
    }

    void adquirir()
    const timer = window.setInterval(() => { void adquirir() }, MESA_LOCK_RENEW_MS)
    return () => {
      vivo = false
      window.clearInterval(timer)
      if (adquirido) void liberarMesa(mesa).catch(() => {})
    }
  }, [debeBloquear, mesa, retry])

  if (!debeBloquear || estado === 'inactivo' || estado === 'adquirido') return children

  if (estado === 'confirmando') return (
    <div className="h-dvh flex items-center justify-center bg-[#0a0a0f] text-white" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-lg font-bold">Confirmando mesa {mesa} con Caja…</p>
        <p className="mt-2 text-sm text-white/55">Un momento; todavía no se puede editar la comanda.</p>
      </div>
    </div>
  )

  const conflicto = estado === 'conflicto'
  return (
    <div className="h-dvh flex items-center justify-center bg-[#0a0a0f] px-5 text-white" role="alert" aria-live="assertive">
      <div className="w-full max-w-md rounded-3xl border border-amber-400/30 bg-[#15151d] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-3xl">!</div>
        <h2 className="text-2xl font-black">{conflicto ? `Mesa ${mesa} en uso` : 'Caja no confirmó la mesa'}</h2>
        <p className="mt-3 text-base leading-relaxed text-white/70">
          {conflicto
            ? 'Otra terminal está editando esta mesa. Regresa al mapa o inténtalo cuando termine.'
            : 'No abrimos la comanda sin confirmación de Caja para evitar cambios cruzados entre terminales.'}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button onClick={() => router.replace('/pos/mesas')} className="min-h-14 rounded-2xl bg-white/10 px-5 font-bold active:scale-[0.98]">
            Volver a mesas
          </button>
          <button onClick={() => setRetry(value => value + 1)} className="min-h-14 rounded-2xl bg-emerald-600 px-5 font-bold active:scale-[0.98]">
            Reintentar
          </button>
        </div>
      </div>
    </div>
  )
}
