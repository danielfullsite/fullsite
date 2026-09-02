'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { getActiveTurnoWithStaleCheck, openTurno, logAudit } from '@/lib/pos-data'
import { getPermissions } from '@/lib/pos-permissions'
import { Clock, DoorOpen, AlertTriangle } from 'lucide-react'
import { ErrorDeSesion } from '@/lib/clasificar-fallo'
import { evaluarAperturaDeTurno, totalDeCuentas, openOrderStatusLabel,
  type VeredictoApertura, type LecturaDeCuentas } from '@/lib/pos-cierre-guard'
import { esFalloDeAutenticacion } from '@/lib/clasificar-fallo'
import { mismoDiaDeVenta, inicioDiaConfigurado } from '@/lib/dia-de-venta'
import { fetchWithTimeout, getPOSAuthHeaders, getClientId, formatMXN, logAudit as _logAudit } from '@/lib/pos-data'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

interface StaffMember {
  id: string
  name: string
  role: string
}

interface TurnoGateProps {
  staff: StaffMember
  children: React.ReactNode
}

type TurnoStatus = 'loading' | 'active' | 'none' | 'stale' | 'conflict' | 'sesion'

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
  const [activeCount, setActiveCount] = useState(0)
  const [fondoInicial, setFondoInicial] = useState('')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  const permissions = getPermissions(staff.role)
  const canOpenTurno = permissions.abrir_dia_operaciones
  const canCloseTurno = permissions.corte_turno

  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [offlineSince, setOfflineSince] = useState<string | null>(null)

  /**
   * Regla de Eduardo: no se abre turno con cuentas abiertas del anterior.
   *
   *   "No puedes abrir un turno si sigues teniendo cuentas abiertas del turno
   *    anterior… hay que matarlas todas."  — Eduardo Esquivel, AMALAY
   *
   * Si NO hay turno abierto, cualquier orden viva pertenece por definicion a un
   * turno pasado. La POLITICA vive en `evaluarAperturaDeTurno` (probada aparte);
   * aqui solo se consulta, se pinta y se ofrece cerrarlas.
   *
   * REGLA DURA #3: abrir el dia NUNCA se bloquea por red. Si la consulta falla,
   * `evaluarAperturaDeTurno` devuelve permitido=true con aviso. Esa decision no
   * esta aqui a proposito — asi se puede probar sin montar el componente.
   */
  const [veredicto, setVeredicto] = useState<VeredictoApertura | null>(null)
  const [cerrandoCuentas, setCerrandoCuentas] = useState(false)
  const [errorCerrar, setErrorCerrar] = useState('')

  const revisarCuentasHuerfanas = useCallback(async () => {
    let lectura: LecturaDeCuentas
    try {
      const res = await fetchWithTimeout(
        `${SB_URL}/rest/v1/pos_orders?client_id=eq.${getClientId()}` +
        `&status=in.(enviada,preparando,lista)&select=id,mesa,mesero,status,total&order=created_at.asc&limit=50`,
        { headers: getPOSAuthHeaders(), cache: 'no-store' },
      )
      lectura = res.ok
        ? { determinado: true, cuentas: await res.json() }
        : { determinado: false, motivo: esFalloDeAutenticacion(res.status) ? 'tu sesion vencio' : `HTTP ${res.status}` }
    } catch {
      lectura = { determinado: false, motivo: 'sin conexion' }
    }
    setVeredicto(evaluarAperturaDeTurno(lectura))
  }, [])

  /** "Hay que matarlas todas" — cancelacion auditada, NUNCA un DELETE. */
  const cerrarCuentasHuerfanas = useCallback(async () => {
    if (cerrandoCuentas || !veredicto?.bloqueantes.length) return
    setCerrandoCuentas(true)
    setErrorCerrar('')
    const headers = { ...getPOSAuthHeaders(), 'Content-Type': 'application/json' }
    const fallidas: string[] = []
    for (const c of veredicto.bloqueantes) {
      try {
        // Filtro por id SIEMPRE. Un PATCH sin filtro toca toda la tabla — asi se
        // cerraron los once turnos de AMALAY el 2026-08-31 (ver esMutacionSinFiltro).
        const res = await fetchWithTimeout(
          `${SB_URL}/rest/v1/pos_orders?id=eq.${encodeURIComponent(c.id)}&client_id=eq.${getClientId()}`,
          { method: 'PATCH', headers, body: JSON.stringify({
              status: 'cancelada',
              closed_at: new Date().toISOString(),
              notas: `Cancelada al abrir turno: cuenta abierta del turno anterior (${staff.name})`,
            }) },
        )
        if (!res.ok) fallidas.push(`mesa ${c.mesa}`)
        else _logAudit({ order_id: c.id, action: 'status_changed', actor: staff.name,
                         details: { type: 'cuenta_huerfana_cancelada', mesa: c.mesa, total: c.total } })
      } catch { fallidas.push(`mesa ${c.mesa}`) }
    }
    setCerrandoCuentas(false)
    if (fallidas.length) {
      // Falla PARCIAL: se dice cuales quedaron. Nunca se declara exito a medias.
      setErrorCerrar(`No se pudieron cerrar: ${fallidas.join(', ')}. Reintenta o ciérralas desde la caja.`)
    }
    await revisarCuentasHuerfanas()
  }, [cerrandoCuentas, veredicto, staff.name, revisarCuentasHuerfanas])

  const checkTurno = useCallback(async () => {
    try {
      const result = await getActiveTurnoWithStaleCheck()
      setActiveCount(result.activeCount)
      if (result.turno) {
        // Online + turno found → cache it for offline use
        try {
          localStorage.setItem('pos_cached_turno', JSON.stringify(result.turno))
          localStorage.setItem('pos_last_turno_sync', new Date().toISOString())
        } catch {}
        setIsOfflineMode(false)
        setOfflineSince(null)
        if (result.activeCount > 1) {
          setTurno(result.turno)
          setStatus('conflict')
        } else if (result.isStale) {
          setTurno(result.turno)
          setStatus('stale')
        } else {
          setTurno(result.turno)
          setStatus('active')
        }
      } else {
        // Online + no turno → clear cache
        try { localStorage.removeItem('pos_cached_turno') } catch {}
        setIsOfflineMode(false)
        setTurno(null)
        setStatus('none')
      }
    } catch (err) {
      /**
       * Una sesion vencida NO es "no hay turno".
       *
       * Antes los dos casos caian aqui y terminaban en `status = 'none'`, que
       * ofrece ABRIR TURNO. Con un turno ya abierto en el servidor, aceptar eso
       * crea un turno duplicado: asi aparecieron los 11 turnos basura de AMALAY
       * el 2026-08-31, varios con `closed_at` anterior a `opened_at`.
       * Ante un 401/403 hay que volver a autenticar, no abrir nada.
       */
      if (err instanceof ErrorDeSesion) {
        setTurno(null)
        setStatus('sesion')
        return
      }
      console.error('[TurnoGate] Error verificando turno (offline?):', err)
      // Offline fallback: try cached turno from localStorage.
      // Se lee el MISMO cache que escribe openTurno/getActiveTurnos
      // (`pos_turno_cache`) — el legado `pos_cached_turno` queda de respaldo.
      // Un turno abierto offline en /pos/turno tiene que ser visible AQUI;
      // dos caches distintos fue una de las causas del "no hay turno activo".
      try {
        let cachedTurno: ActiveTurno | null = null
        const unificado = localStorage.getItem('pos_turno_cache')
        if (unificado) cachedTurno = JSON.parse(unificado)?.turno ?? null
        if (!cachedTurno) {
          const legado = localStorage.getItem('pos_cached_turno')
          if (legado) cachedTurno = JSON.parse(legado)
        }
        if (cachedTurno?.opened_at) {
          // Dia de VENTA, no dia natural: con toDateString(), entre las 00:00 y
          // las 05:00 un turno legitimo de anoche se declaraba "de otro dia" y
          // bloqueaba la operacion nocturna.
          const sameDay = mismoDiaDeVenta(cachedTurno.opened_at, Date.now(), inicioDiaConfigurado())
          if (sameDay) {
            // Same day → use cached turno (offline mode)
            setTurno(cachedTurno)
            setStatus('active')
            setIsOfflineMode(true)
            setOfflineSince(prev => prev || new Date().toISOString())
            return
          }
        }
      } catch {}
      // No valid cache → block
      setTurno(null)
      setStatus('none')
    }
  }, [])

  // Initial check
  useEffect(() => {
    checkTurno()
  }, [checkTurno])

  // Sin turno abierto = momento de revisar cuentas huerfanas (regla de Eduardo).
  useEffect(() => {
    if (status === 'none') void revisarCuentasHuerfanas()
    else setVeredicto(null)
  }, [status, revisarCuentasHuerfanas])

  // Poll every 5s when waiting for turno
  useEffect(() => {
    if (status !== 'none' && status !== 'stale' && status !== 'conflict') return
    const interval = setInterval(async () => {
      const result = await getActiveTurnoWithStaleCheck()
      if (result.turno && !result.isStale && result.activeCount === 1) {
        setTurno(result.turno)
        setStatus('active')
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [status])

  // Revalidate turno immediately when internet comes back
  useEffect(() => {
    const handleOnline = () => {
      console.log('[TurnoGate] Internet restored — revalidating turno')
      checkTurno()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [checkTurno])

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

  // Active turno — pass through (with offline banner if applicable)
  if (status === 'active') {
    if (isOfflineMode) {
      const offlineMinutes = offlineSince ? Math.floor((Date.now() - new Date(offlineSince).getTime()) / 60000) : 0
      const lastSync = typeof window !== 'undefined' ? localStorage.getItem('pos_last_turno_sync') : null
      return (
        <>
          <div className="bg-amber-900/80 text-amber-200 px-4 py-2 flex items-center justify-between text-sm flex-shrink-0 z-50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-bold">Modo Offline</span>
              <span className="text-amber-300/70">— Operando con información local</span>
              {offlineMinutes > 0 && <span className="text-amber-400/60">({offlineMinutes} min)</span>}
            </div>
            <div className="text-xs text-amber-300/50">
              {lastSync && `Ultimo sync: ${new Date(lastSync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`}
            </div>
          </div>
          {offlineMinutes > 120 && (
            <div className="bg-red-900/80 text-red-200 px-4 py-2 text-center text-sm font-bold flex-shrink-0">
              Llevas {Math.floor(offlineMinutes / 60)}h offline. Verifica la conexion a internet.
            </div>
          )}
          {children}
        </>
      )
    }
    return <>{children}</>
  }

  // Multiple active shifts make totals and KDS routing ambiguous. Block sales
  // until an authorized operator resolves every open shift with a real Corte Z.
  // Sesion vencida: ni abrir turno ni Corte Z — volver a autenticar.
  if (status === 'sesion') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-0)] p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Tu sesion vencio</h2>
          <p className="text-white/60 text-sm mb-6">
            No se pudo verificar el turno porque la sesion ya no es valida. Vuelve a
            entrar con tu huella o PIN. Las comandas guardadas no se pierden.
          </p>
          <button
            onClick={() => { void checkTurno() }}
            className="w-full rounded-xl bg-white/10 px-4 py-3 text-white hover:bg-white/15"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  if (status === 'conflict') {
    return (
      <div className="h-dvh flex items-center justify-center select-none" style={{ background: 'linear-gradient(180deg, #200a0a 0%, #160808 100%)' }}>
        <div className="text-center w-full max-w-sm mx-4">
          <AlertTriangle size={64} className="mx-auto mb-6 text-red-400" strokeWidth={1.5} />
          <h2 className="text-2xl font-bold text-white mb-2">Hay {activeCount} turnos abiertos</h2>
          <p className="text-red-200/70 text-sm mb-8">El POS queda bloqueado para evitar mezclar comandas y cortes. Cierra cada turno pendiente con Corte Z.</p>
          {canCloseTurno ? (
            <button onClick={() => { window.location.href = '/pos/turno' }} className="w-full py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold min-h-[56px]">
              Ir a resolver turnos
            </button>
          ) : (
            <p className="text-slate-400 text-sm">Solicita a un encargado que realice los cortes.</p>
          )}
        </div>
      </div>
    )
  }

  // ── No turno — gerente/admin/cajero can open ──
  // REGLA DE EDUARDO — bloquea ANTES de la pantalla de abrir turno.
  // Solo cuando la consulta SI se pudo hacer y encontro cuentas; un fallo de red
  // devuelve permitido=true y cae al flujo normal con aviso (regla dura #3).
  if (status === 'none' && veredicto && !veredicto.permitido) {
    const total = totalDeCuentas(veredicto.bloqueantes)
    return (
      <div className="h-dvh flex items-center justify-center select-none p-6" style={{ background: 'linear-gradient(180deg, #2a1a05 0%, #1a1004 100%)' }}>
        <div className="w-full max-w-md">
          <AlertTriangle size={40} className="mx-auto mb-4 text-amber-400" />
          <h2 className="text-2xl font-bold text-white text-center mb-2">
            Cuentas abiertas del turno anterior
          </h2>
          <p className="text-amber-200/80 text-sm text-center mb-5">
            {veredicto.aviso}
          </p>

          <div className="rounded-xl border border-amber-500/25 bg-black/25 divide-y divide-amber-500/10 mb-4 max-h-64 overflow-y-auto">
            {veredicto.bloqueantes.map(c => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="text-white font-semibold">Mesa {c.mesa}</div>
                  <div className="text-white/45 text-xs">
                    {openOrderStatusLabel(c.status)}{c.mesero ? ` · ${c.mesero}` : ''}
                  </div>
                </div>
                <div className="text-amber-300 font-mono">{formatMXN(c.total)}</div>
              </div>
            ))}
          </div>

          <p className="text-white/45 text-xs text-center mb-4">
            Total colgando: <span className="text-amber-300 font-mono">{formatMXN(total)}</span>
          </p>

          {errorCerrar && (
            <p className="text-red-300 text-sm text-center mb-3">{errorCerrar}</p>
          )}

          {canCloseTurno ? (
            <>
              <button
                onClick={() => { void cerrarCuentasHuerfanas() }}
                disabled={cerrandoCuentas}
                className="w-full rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-3 font-bold text-white"
              >
                {cerrandoCuentas
                  ? 'Cerrando…'
                  : `Cancelar ${veredicto.bloqueantes.length === 1 ? 'la cuenta' : `las ${veredicto.bloqueantes.length} cuentas`} y abrir turno`}
              </button>
              <p className="text-white/35 text-[11px] text-center mt-2">
                Se cancelan, no se borran. Cada una queda en la auditoría a tu nombre.
              </p>
            </>
          ) : (
            <p className="text-white/50 text-sm text-center">
              Pide a un encargado que las cierre. Tu perfil no tiene ese permiso.
            </p>
          )}

          <button
            onClick={() => { void revisarCuentasHuerfanas() }}
            className="w-full mt-3 text-white/50 hover:text-white text-sm py-2"
          >
            Volver a revisar
          </button>
        </div>
      </div>
    )
  }

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

          <p className="text-slate-400 text-xs mb-4">¿Eres el encargado? Entra con tu PIN de dueño o gerente
            y abre el turno en <span className="font-mono text-slate-300">POS → Turno</span>.</p>
          <a href="/pos/turno" className="inline-block px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400 hover:text-white transition-colors mb-6">Ir a abrir turno</a>
          <p className="text-slate-500 text-xs">Sesion: {staff.name}</p>
          <p className="text-slate-600 text-xs mt-1">Se desbloqueará automáticamente cuando el turno se abra</p>
        </div>
      </div>
    )
  }

  // ── Turno stale — gerente puede cerrar y abrir nuevo ──
  if (status === 'stale' && canCloseTurno) {
    const openedDate = turno ? new Date(turno.opened_at) : new Date()
    const dateStr = openedDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr = openedDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })

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
            onClick={() => { window.location.href = '/pos/turno' }}
            className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-[0.97] disabled:bg-slate-700 text-white font-bold text-base transition-all min-h-[56px] mb-3"
          >
            Ir a realizar Corte Z
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

  // Fallback — should not reach here; show safe loading state instead of passing children unprotected
  return (
    <div className="h-dvh flex items-center justify-center" style={{ background: '#0a0a14' }}>
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
