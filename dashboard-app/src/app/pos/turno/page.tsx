'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, DoorOpen, DoorClosed, DollarSign, Clock, User, AlertTriangle } from 'lucide-react'
import { formatMXN, logAudit, MANAGER_PINS } from '@/lib/pos-data'

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

  // Open shift state
  const [fondoInicial, setFondoInicial] = useState('')
  const [openedBy, setOpenedBy] = useState('')

  // Close shift state
  const [fondoFinal, setFondoFinal] = useState('')
  const [closedBy, setClosedBy] = useState('')
  const [closePin, setClosePin] = useState('')
  const [closeError, setCloseError] = useState('')
  const [closingNotas, setClosingNotas] = useState('')

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

  const handleCloseTurno = async () => {
    if (!activeTurno || !fondoFinal || !closePin) return
    const manager = MANAGER_PINS[closePin]
    if (!manager) { setCloseError('PIN invalido'); return }

    // Calculate actual cash from orders during this shift
    let cashFromOrders = 0
    try {
      const ordersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?select=total,metodoPago&status=eq.cerrada&client_id=eq.amalay&createdAt=gte.${activeTurno.opened_at}`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (ordersRes.ok) {
        const orders = await ordersRes.json()
        cashFromOrders = orders
          .filter((o: Record<string, unknown>) => {
            const method = ((o.metodoPago as string) || '').toLowerCase()
            return method.includes('efectivo') || method.includes('cash')
          })
          .reduce((sum: number, o: Record<string, unknown>) => sum + (Number(o.total) || 0), 0)
      }
    } catch { /* fallback to fondo_inicial if query fails */ }

    const efectivoSistema = activeTurno.fondo_inicial + cashFromOrders
    const diferencia = Number(fondoFinal) - efectivoSistema

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_turnos?id=eq.${activeTurno.id}`,
      {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          closed_by: manager, fondo_final: Number(fondoFinal),
          efectivo_sistema: efectivoSistema, diferencia,
          closed_at: new Date().toISOString(), notas: closingNotas || null,
        }),
      }
    )
    if (res.ok) {
      logAudit({
        action: 'status_changed', actor: manager,
        details: { type: 'turno_closed', fondo_final: Number(fondoFinal), diferencia, approved_by: manager },
      })
      showToast(`Turno cerrado por ${manager} — Diferencia: ${formatMXN(diferencia)}`)
      setFondoFinal('')
      setClosePin('')
      setClosingNotas('')
      setCloseError('')
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
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      <header className="flex items-center gap-4 px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Clock size={24} className="text-blue-400" />
          <h1 className="text-xl font-bold">Turno</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeTurno ? (
          /* Turno activo — mostrar info + opción de cerrar */
          <div className="max-w-md mx-auto">
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <DoorOpen size={28} className="text-emerald-400" />
                <div>
                  <h2 className="text-lg font-bold text-emerald-400">Turno activo</h2>
                  <p className="text-[var(--text-3)] text-sm">
                    Abierto por {activeTurno.opened_by} a las {new Date(activeTurno.opened_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between bg-[var(--surface-2)]/50 rounded-xl px-4 py-3">
                <span className="text-[var(--text-3)]">Fondo inicial</span>
                <span className="text-white font-bold text-xl">{formatMXN(activeTurno.fondo_inicial)}</span>
              </div>
            </div>

            {/* Cerrar turno */}
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-2xl p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <DoorClosed size={20} className="text-red-400" />
                Cerrar turno
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-[var(--text-3)] block mb-1">Efectivo contado en caja</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={fondoFinal}
                    onChange={e => setFondoFinal(e.target.value)}
                    placeholder="$0.00"
                    className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--text-3)] block mb-1">Notas del cierre</label>
                  <input
                    type="text"
                    value={closingNotas}
                    onChange={e => setClosingNotas(e.target.value)}
                    placeholder="Observaciones opcionales..."
                    className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-slate-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--text-3)] block mb-1">PIN de gerente</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={closePin}
                    onChange={e => { setClosePin(e.target.value.replace(/\D/g, '')); setCloseError('') }}
                    placeholder="****"
                    className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500"
                  />
                </div>
                {closeError && <p className="text-red-400 text-sm text-center">{closeError}</p>}
                <button
                  onClick={handleCloseTurno}
                  disabled={!fondoFinal || !closePin}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold rounded-xl text-lg transition-colors"
                >
                  Cerrar turno
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* No turno — abrir uno */
          <div className="max-w-md mx-auto">
            <div className="bg-[var(--surface-2)]/60 border border-slate-700 rounded-2xl p-6">
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
                    className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
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
                    className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={handleOpenTurno}
                  disabled={!openedBy.trim() || !fondoInicial}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold rounded-xl text-lg transition-colors"
                >
                  Abrir turno
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
