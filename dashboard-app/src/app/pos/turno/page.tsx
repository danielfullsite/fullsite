'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, DoorOpen, DoorClosed, DollarSign, Clock, Users } from 'lucide-react'
import { formatMXN, logAudit, MANAGER_PINS } from '@/lib/pos-data'
import dynamic from 'next/dynamic'

const StaffShiftPanel = dynamic(() => import('@/components/pos/StaffShiftPanel'), { ssr: false })
const CierreCajaWizard = dynamic(() => import('@/components/pos/CierreCajaWizard'), { ssr: false })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Turno {
  id: string
  opened_by: string
  fondo_inicial: number
  opened_at: string
  closed_by: string | null
  fondo_final: number | null
  efectivo_sistema: number | null
  diferencia: number | null
  closed_at: string | null
  notas: string | null
}

export default function TurnoPage() {
  const [activeTurno, setActiveTurno] = useState<Turno | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [tab, setTab] = useState<'turno' | 'personal'>('turno')
  const [showCierreWizard, setShowCierreWizard] = useState(false)

  // Open shift state
  const [fondoInicial, setFondoInicial] = useState('')
  const [openedBy, setOpenedBy] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchTurno = async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_turnos?closed_at=is.null&client_id=eq.amalay&order=opened_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
      )
      if (res.ok) {
        const rows = await res.json()
        setActiveTurno(rows[0] || null)
      }
    } catch { /* */ }
    setLoading(false)
  }

  useEffect(() => { fetchTurno() }, [])

  const handleOpenTurno = async () => {
    if (!openedBy.trim() || !fondoInicial) return
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_turnos`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id, client_id: 'amalay', opened_by: openedBy, fondo_inicial: Number(fondoInicial),
      }),
    })
    if (res.ok) {
      logAudit({ action: 'status_changed', actor: openedBy, details: { type: 'turno_opened', fondo: Number(fondoInicial) } })
      showToast(`Turno abierto — Fondo: ${formatMXN(Number(fondoInicial))}`)
      setFondoInicial('')
      setOpenedBy('')
      fetchTurno()
    }
  }

  // Get staff name from session
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) {
        const s = JSON.parse(saved)
        setOpenedBy(s.name || '')
      }
    } catch { /* */ }
  }, [])

  return (
    <div className="h-screen flex flex-col text-[var(--text-1)] bg-[var(--surface)]">
      <header className="flex items-center gap-4 px-6 py-4 bg-[var(--surface-2)] border-b border-[var(--line)] flex-shrink-0">
        <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line-soft)] flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Clock size={24} className="text-blue-400" />
          <h1 className="text-xl font-bold">Turnos</h1>
        </div>
      </header>

      {/* Tab switcher */}
      <div className="flex border-b border-[var(--line)] px-6">
        <button
          onClick={() => setTab('turno')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'turno'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
        >
          <DollarSign size={16} className="inline mr-1.5" />
          Caja
        </button>
        <button
          onClick={() => setTab('personal')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'personal'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'
          }`}
        >
          <Users size={16} className="inline mr-1.5" />
          Personal
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'turno' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : activeTurno ? (
              <div className="max-w-md mx-auto">
                {/* Active turno info */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <DoorOpen size={28} className="text-emerald-400" />
                    <div>
                      <h2 className="text-lg font-bold text-emerald-400">Turno activo</h2>
                      <p className="text-[var(--text-3)] text-sm">
                        Abierto por {activeTurno.opened_by} a las {new Date(activeTurno.opened_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-[var(--surface)]/50 rounded-xl px-4 py-3">
                    <span className="text-[var(--text-3)]">Fondo inicial</span>
                    <span className="font-bold text-xl">{formatMXN(activeTurno.fondo_inicial)}</span>
                  </div>
                </div>

                {/* Cierre de Caja button */}
                <button
                  onClick={() => setShowCierreWizard(true)}
                  className="w-full py-4 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-bold rounded-xl text-lg transition-colors flex items-center justify-center gap-3"
                >
                  <DoorClosed size={24} />
                  Cierre de Caja
                </button>

                <p className="text-center text-xs text-[var(--text-3)] mt-3">
                  Wizard paso a paso: contar billetes, monedas, cuadrar y firmar
                </p>
              </div>
            ) : (
              <div className="max-w-md mx-auto">
                <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <DoorOpen size={28} className="text-blue-400" />
                    <div>
                      <h2 className="text-lg font-bold">Abrir turno</h2>
                      <p className="text-[var(--text-3)] text-sm">Cuenta el efectivo en caja antes de empezar</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-[var(--text-3)] block mb-1">Quien abre</label>
                      <input
                        type="text"
                        value={openedBy}
                        onChange={e => setOpenedBy(e.target.value)}
                        placeholder="Tu nombre"
                        className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-[var(--text-3)] block mb-1">Fondo de caja (efectivo contado)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={fondoInicial}
                        onChange={e => setFondoInicial(e.target.value)}
                        placeholder="$0.00"
                        className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] text-lg text-center focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      onClick={handleOpenTurno}
                      disabled={!openedBy.trim() || !fondoInicial}
                      className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-[var(--line)] disabled:text-[var(--text-3)] text-white font-bold rounded-xl text-lg transition-colors"
                    >
                      Abrir turno
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'personal' && (
          <div className="max-w-md mx-auto">
            <StaffShiftPanel />
          </div>
        )}
      </div>

      {/* Cierre Wizard */}
      {showCierreWizard && activeTurno && (
        <CierreCajaWizard
          turnoId={activeTurno.id}
          turnoOpenedAt={activeTurno.opened_at}
          fondoInicial={activeTurno.fondo_inicial}
          onClose={() => setShowCierreWizard(false)}
          onComplete={() => {
            setShowCierreWizard(false)
            showToast('Cierre completado exitosamente')
            fetchTurno()
          }}
        />
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
