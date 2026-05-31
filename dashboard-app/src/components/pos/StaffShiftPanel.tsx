'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, LogIn, LogOut, Coffee, Users, TrendingUp, DollarSign, Timer } from 'lucide-react'
import { formatMXN, MANAGER_PINS, logAudit } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

interface StaffShift {
  id: string
  staff_id: string
  staff_name: string
  clock_in: string
  clock_out: string | null
  breaks: { start: string; end?: string }[]
  hours_worked: number | null
  orders_count: number
  sales_total: number
  tips_total: number
}

interface StaffShiftPanelProps {
  onShiftChange?: () => void
}

export default function StaffShiftPanel({ onShiftChange }: StaffShiftPanelProps) {
  const [activeShifts, setActiveShifts] = useState<StaffShift[]>([])
  const [allShiftsToday, setAllShiftsToday] = useState<StaffShift[]>([])
  const [loading, setLoading] = useState(true)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [actionMode, setActionMode] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null)
  const [tab, setTab] = useState<'active' | 'report'>('active')

  const fetchShifts = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_staff_shifts?client_id=eq.${_cid()}&clock_in=gte.${today}T00:00:00&order=clock_in.desc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (res.ok) {
        const shifts = await res.json()
        setActiveShifts(shifts.filter((s: StaffShift) => !s.clock_out))
        setAllShiftsToday(shifts)
      }
    } catch { /* */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchShifts()
    const interval = setInterval(fetchShifts, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [fetchShifts])

  const handleClockIn = async () => {
    const staffName = MANAGER_PINS[pin]
    if (!staffName) {
      // Check if it's a mesero PIN (from env or staff list)
      setPinError('PIN no reconocido')
      return
    }

    // Check if already clocked in
    const existing = activeShifts.find(s => s.staff_name === staffName)
    if (existing) {
      setPinError(`${staffName} ya tiene turno activo`)
      return
    }

    const id = `shift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_staff_shifts`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id,
          client_id: _cid(),
          staff_id: pin,
          staff_name: staffName,
          clock_in: new Date().toISOString(),
          breaks: JSON.stringify([]),
        }),
      })
      if (res.ok) {
        logAudit({ action: 'status_changed', actor: staffName, details: { type: 'clock_in', shift_id: id } })
        setPin('')
        setPinError('')
        setActionMode(null)
        fetchShifts()
        onShiftChange?.()
      }
    } catch {
      setPinError('Error de conexion')
    }
  }

  const handleClockOut = async () => {
    if (!selectedStaff) return
    const shift = activeShifts.find(s => s.id === selectedStaff)
    if (!shift) return

    const clockOut = new Date()
    const clockIn = new Date(shift.clock_in)
    const breakMinutes = (shift.breaks || []).reduce((total, b) => {
      if (!b.end) return total
      return total + (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000
    }, 0)
    const hoursWorked = ((clockOut.getTime() - clockIn.getTime()) / 3600000) - (breakMinutes / 60)

    try {
      await fetch(`${SUPABASE_URL}/rest/v1/pos_staff_shifts?id=eq.${shift.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          clock_out: clockOut.toISOString(),
          hours_worked: Math.round(hoursWorked * 100) / 100,
        }),
      })
      logAudit({ action: 'status_changed', actor: shift.staff_name, details: { type: 'clock_out', hours: hoursWorked.toFixed(2) } })
      setSelectedStaff(null)
      setActionMode(null)
      fetchShifts()
      onShiftChange?.()
    } catch { /* */ }
  }

  const handleBreakStart = async () => {
    if (!selectedStaff) return
    const shift = activeShifts.find(s => s.id === selectedStaff)
    if (!shift) return

    const breaks = [...(shift.breaks || []), { start: new Date().toISOString() }]
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/pos_staff_shifts?id=eq.${shift.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ breaks: JSON.stringify(breaks) }),
      })
      setSelectedStaff(null)
      setActionMode(null)
      fetchShifts()
    } catch { /* */ }
  }

  const handleBreakEnd = async () => {
    if (!selectedStaff) return
    const shift = activeShifts.find(s => s.id === selectedStaff)
    if (!shift) return

    const breaks = [...(shift.breaks || [])]
    const lastBreak = breaks[breaks.length - 1]
    if (lastBreak && !lastBreak.end) {
      lastBreak.end = new Date().toISOString()
    }
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/pos_staff_shifts?id=eq.${shift.id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ breaks: JSON.stringify(breaks) }),
      })
      setSelectedStaff(null)
      setActionMode(null)
      fetchShifts()
    } catch { /* */ }
  }

  const getShiftDuration = (shift: StaffShift) => {
    const start = new Date(shift.clock_in)
    const end = shift.clock_out ? new Date(shift.clock_out) : new Date()
    const diffMs = end.getTime() - start.getTime()
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    return `${hours}h ${mins}m`
  }

  const isOnBreak = (shift: StaffShift) => {
    const breaks = shift.breaks || []
    const last = breaks[breaks.length - 1]
    return last && !last.end
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'active' ? 'bg-blue-500 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
        >
          <Users size={16} className="inline mr-1.5" />
          Activos ({activeShifts.length})
        </button>
        <button
          onClick={() => setTab('report')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'report' ? 'bg-blue-500 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
        >
          <TrendingUp size={16} className="inline mr-1.5" />
          Reporte del día
        </button>
      </div>

      {tab === 'active' && (
        <>
          {/* Clock In button */}
          <button
            onClick={() => { setActionMode('clock_in'); setPin(''); setPinError('') }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold hover:bg-emerald-500/20 transition-colors"
          >
            <LogIn size={20} />
            Registrar entrada
          </button>

          {/* PIN modal for clock in */}
          {actionMode === 'clock_in' && (
            <div className="bg-[var(--line)] rounded-xl p-4 space-y-3">
              <p className="text-sm text-[var(--text-2)] font-medium">Ingresa tu PIN de empleado</p>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => { setPin(e.target.value); setPinError('') }}
                placeholder="••••"
                autoFocus
                className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
              />
              {pinError && <p className="text-red-400 text-xs">{pinError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setActionMode(null)}
                  className="flex-1 py-2 rounded-lg border border-[var(--line)] text-[var(--text-3)] text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleClockIn}
                  disabled={pin.length < 4}
                  className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}

          {/* Active shifts list */}
          <div className="space-y-3">
            {activeShifts.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-3)]">
                <Users size={32} className="mx-auto mb-2 opacity-50" />
                <p>Nadie con turno activo</p>
              </div>
            ) : (
              activeShifts.map(shift => (
                <div
                  key={shift.id}
                  className={`bg-[var(--line)] rounded-xl p-4 border ${
                    isOnBreak(shift) ? 'border-amber-500/30' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isOnBreak(shift) ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                      <span className="font-bold text-[var(--text-1)]">{shift.staff_name}</span>
                    </div>
                    <span className="text-sm text-[var(--text-3)]">
                      <Timer size={14} className="inline mr-1" />
                      {getShiftDuration(shift)}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[var(--text-3)] mb-3">
                    <span>Entrada: {new Date(shift.clock_in).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                    {isOnBreak(shift) && <span className="text-amber-400 font-medium">En descanso</span>}
                  </div>

                  <div className="flex gap-2">
                    {isOnBreak(shift) ? (
                      <button
                        onClick={() => { setSelectedStaff(shift.id); handleBreakEnd() }}
                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20"
                      >
                        <Coffee size={14} /> Fin descanso
                      </button>
                    ) : (
                      <button
                        onClick={() => { setSelectedStaff(shift.id); handleBreakStart() }}
                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-[var(--surface)] text-[var(--text-3)] text-xs font-medium hover:text-amber-400"
                      >
                        <Coffee size={14} /> Descanso
                      </button>
                    )}
                    <button
                      onClick={() => { setSelectedStaff(shift.id); handleClockOut() }}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20"
                    >
                      <LogOut size={14} /> Salida
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === 'report' && (
        <div className="space-y-3">
          {allShiftsToday.length === 0 ? (
            <p className="text-center py-8 text-[var(--text-3)]">Sin turnos registrados hoy</p>
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-[var(--line)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--text-1)]">{allShiftsToday.length}</p>
                  <p className="text-xs text-[var(--text-3)]">Turnos</p>
                </div>
                <div className="bg-[var(--line)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">
                    {allShiftsToday.filter(s => s.clock_out).reduce((sum, s) => sum + (s.hours_worked || 0), 0).toFixed(1)}h
                  </p>
                  <p className="text-xs text-[var(--text-3)]">Horas totales</p>
                </div>
                <div className="bg-[var(--line)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">
                    {formatMXN(allShiftsToday.reduce((sum, s) => sum + (s.sales_total || 0), 0))}
                  </p>
                  <p className="text-xs text-[var(--text-3)]">Ventas</p>
                </div>
              </div>

              {/* Individual reports */}
              {allShiftsToday.map(shift => (
                <div key={shift.id} className="bg-[var(--line)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-[var(--text-1)]">{shift.staff_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      shift.clock_out ? 'bg-[var(--surface)] text-[var(--text-3)]' : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {shift.clock_out ? 'Finalizado' : 'Activo'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-[var(--text-3)]">Entrada</span>
                      <p className="text-[var(--text-1)] font-medium">
                        {new Date(shift.clock_in).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-3)]">Salida</span>
                      <p className="text-[var(--text-1)] font-medium">
                        {shift.clock_out
                          ? new Date(shift.clock_out).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-3)]">Horas</span>
                      <p className="text-[var(--text-1)] font-medium">
                        {shift.hours_worked ? `${shift.hours_worked.toFixed(1)}h` : getShiftDuration(shift)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-3)]">Descansos</span>
                      <p className="text-[var(--text-1)] font-medium">
                        {(shift.breaks || []).length}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
