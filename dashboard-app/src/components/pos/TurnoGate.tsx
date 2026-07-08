'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { getActiveTurnoWithStaleCheck, autoCloseStaleTurno, openTurno, logAudit } from '@/lib/pos-data'
import { getPermissions } from '@/lib/pos-permissions'
import { Clock, DoorOpen, AlertTriangle } from 'lucide-react'

interface StaffMember {
  id: string
  name: string
  role: string
}

interface TurnoGateProps {
  staff: StaffMember
  children: React.ReactNode
}

type TurnoStatus = 'loading' | 'active' | 'none' | 'stale'

interface ActiveTurno {
  id: string
  fondo_inicial: number
  opened_by: string
  opened_at: string
}

// Paths that should NOT be blocked by turno gate
const UNGATED_PATHS = ['/pos/turno', '/pos/configuracion', '/pos/huella']

export default function TurnoGate({ staff, children }: TurnoGateProps) {
  const pathname = usePathname()
  const [status, setStatus] = useState<TurnoStatus>('loading')
  const [turno, setTurno] = useState<ActiveTurno | null>(null)
  const [fondoInicial, setFondoInicial] = useState('')
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')

  const permissions = getPermissions(staff.role)
  const canOpenTurno = permissions.abrir_dia_operaciones
  const canCloseTurno = permissions.corte_turno

  const checkTurno = useCallback(async () => {
    const result = await getActiveTurnoWithStaleCheck()
    if (result.turno) {
      if (result.isStale) {
        setTurno(result.turno)
        setStatus('stale')
      } else {
        setTurno(result.turno)
        setStatus('active')
      }
    } else {
      setTurno(null)
      setStatus('none')
    }
  }, [])

  // Initial check
  useEffect(() => {
    checkTurno()
  }, [checkTurno])

  // Poll every 5s when waiting for turno
  useEffect(() => {
    if (status !== 'none' && status !== 'stale') return
    const interval = setInterval(async () => {
      const result = await getActiveTurnoWithStaleCheck()
      if (result.turno && !result.isStale) {
        setTurno(result.turno)
        setStatus('active')
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [status])

  // Allow ungated paths (turno page itself, config)
  if (UNGATED_PATHS.some(p => pathname.startsWith(p))) {
    return <>{children}</>
  }

  // Loading state
  if (status === 'loading') {
    return (
      <div className="h-dvh flex items-center justify-center" style={{ background: '#0a0a14' }}>
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Active turno — pass through
  if (status === 'active') {
    return <>{children}</>
  }

  // ── No turno — gerente/admin/cajero can open ──
  if (status === 'none' && canOpenTurno) {
    const handleOpen = async () => {
      const fondo = parseFloat(fondoInicial)
      if (isNaN(fondo) || fondo < 0) {
        setError('Ingresa el fondo de caja')
        return
      }
      setOpening(true)
      setError('')
      const result = await openTurno(fondo, staff.name)
      if (result) {
        logAudit({ action: 'status_changed', actor: staff.name, mesa: 0, details: { type: 'turno_opened', fondo_inicial: fondo, turno_id: result.id } })
        setTurno(result)
        setStatus('active')
      } else {
        setError('Error al abrir turno')
      }
      setOpening(false)
    }

    return (
      <div className="h-dvh flex items-center justify-center select-none" style={{ background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)' }}>
        <div className="text-center w-full max-w-sm mx-4">
          <DoorOpen size={64} className="mx-auto mb-6 text-blue-400" strokeWidth={1.5} />
          <h2 className="text-2xl font-bold text-white mb-2">No hay turno abierto</h2>
          <p className="text-slate-400 text-sm mb-8">Cuenta el efectivo en caja y abre el turno para comenzar operaciones.</p>

          <div className="mb-4">
            <label className="text-slate-400 text-xs font-medium block mb-2 text-left">Fondo de caja (efectivo contado)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl font-bold">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={fondoInicial}
                onChange={(e) => setFondoInicial(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
                placeholder="0.00"
                autoFocus
                className="w-full bg-slate-800 border border-slate-600 rounded-xl pl-10 pr-4 py-4 text-white text-2xl font-bold text-center focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            onClick={handleOpen}
            disabled={opening || !fondoInicial}
            className="w-full py-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-all min-h-[64px]"
          >
            {opening ? 'Abriendo turno...' : 'Abrir turno'}
          </button>

          <p className="text-slate-500 text-xs mt-4">{staff.name} · {staff.role}</p>

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>
      </div>
    )
  }

  // ── No turno — mesero espera ──
  if (status === 'none' && !canOpenTurno) {
    return (
      <div className="h-dvh flex items-center justify-center select-none" style={{ background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)' }}>
        <div className="text-center w-full max-w-sm mx-4">
          <div className="relative mx-auto mb-6 w-16 h-16">
            <Clock size={64} className="text-blue-400 animate-pulse" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Esperando turno</h2>
          <p className="text-slate-400 text-sm mb-6">Un encargado debe abrir el turno para comenzar operaciones.</p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>

          <p className="text-slate-500 text-xs">Sesion: {staff.name}</p>
          <p className="text-slate-600 text-xs mt-1">Se desbloqueara automaticamente cuando el turno se abra</p>
        </div>
      </div>
    )
  }

  // ── Turno stale — gerente puede cerrar y abrir nuevo ──
  if (status === 'stale' && canCloseTurno) {
    const openedDate = turno ? new Date(turno.opened_at) : new Date()
    const dateStr = openedDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr = openedDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })

    const handleCloseAndOpen = async () => {
      if (!turno) return
      setClosing(true)
      setError('')
      const closed = await autoCloseStaleTurno(turno.id, staff.name)
      if (closed) {
        logAudit({ action: 'status_changed', actor: staff.name, mesa: 0, details: { type: 'turno_auto_closed', turno_id: turno.id } })
        setTurno(null)
        setStatus('none')
      } else {
        setError('Error al cerrar turno anterior')
      }
      setClosing(false)
    }

    const handleContinue = () => {
      setStatus('active')
    }

    return (
      <div className="h-dvh flex items-center justify-center select-none" style={{ background: 'linear-gradient(180deg, #1a1000 0%, #1f1800 100%)' }}>
        <div className="text-center w-full max-w-sm mx-4">
          <AlertTriangle size={64} className="mx-auto mb-6 text-amber-400" strokeWidth={1.5} />
          <h2 className="text-2xl font-bold text-white mb-2">Turno del dia anterior</h2>
          <p className="text-amber-300/70 text-sm mb-2">
            Abierto por <span className="font-bold text-amber-300">{turno?.opened_by}</span>
          </p>
          <p className="text-amber-300/50 text-xs mb-8">{dateStr} a las {timeStr}</p>

          <button
            onClick={handleCloseAndOpen}
            disabled={closing}
            className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-[0.97] disabled:bg-slate-700 text-white font-bold text-base transition-all min-h-[56px] mb-3"
          >
            {closing ? 'Cerrando...' : 'Cerrar anterior y abrir nuevo'}
          </button>

          <button
            onClick={handleContinue}
            className="w-full py-3 rounded-xl bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-300 text-sm transition-all"
          >
            Continuar con turno actual
          </button>

          <p className="text-slate-500 text-xs mt-4">{staff.name} · {staff.role}</p>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        </div>
      </div>
    )
  }

  // ── Turno stale — mesero espera ──
  if (status === 'stale' && !canCloseTurno) {
    return (
      <div className="h-dvh flex items-center justify-center select-none" style={{ background: 'linear-gradient(180deg, #1a1000 0%, #1f1800 100%)' }}>
        <div className="text-center w-full max-w-sm mx-4">
          <AlertTriangle size={64} className="mx-auto mb-6 text-amber-400" strokeWidth={1.5} />
          <h2 className="text-xl font-bold text-white mb-2">Turno sin cerrar</h2>
          <p className="text-amber-300/70 text-sm mb-6">Hay un turno del dia anterior sin cerrar. Espera a que un encargado lo resuelva.</p>
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-slate-500 text-xs">Sesion: {staff.name}</p>
        </div>
      </div>
    )
  }

  // Fallback
  return <>{children}</>
}
