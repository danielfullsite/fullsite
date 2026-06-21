'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, DoorOpen, DoorClosed, DollarSign, Clock, Users, FileText, Printer, X, ChevronDown, ChevronRight } from 'lucide-react'
import { formatMXN, logAudit } from '@/lib/pos-data'
import dynamic from 'next/dynamic'

const StaffShiftPanel = dynamic(() => import('@/components/pos/StaffShiftPanel'), { ssr: false })
const CierreCajaWizard = dynamic(() => import('@/components/pos/CierreCajaWizard'), { ssr: false })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

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

interface ShiftSummary {
  efectivo: number
  tarjeta: number
  transferencias: number
  totalVentas: number
  ticketsCount: number
  cancelaciones: number
  descuentos: number
  propinas: number
}

interface CorteXModalProps {
  turno: Turno
  onClose: () => void
}

function CorteXModal({ turno, onClose }: CorteXModalProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ShiftSummary>({
    efectivo: 0, tarjeta: 0, transferencias: 0, totalVentas: 0,
    ticketsCount: 0, cancelaciones: 0, descuentos: 0, propinas: 0,
  })

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?select=total,metodo_pago,status,descuento,propina&client_id=eq.${_cid()}&turno_id=eq.${encodeURIComponent(turno.id)}`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (res.ok) {
          const orders = await res.json()
          let efectivo = 0, tarjeta = 0, transferencias = 0, totalVentas = 0
          let ticketsCount = 0, cancelaciones = 0, descuentos = 0, propinas = 0
          for (const o of orders) {
            if (o.status === 'cancelada') { cancelaciones++; continue }
            if (o.status === 'cerrada') {
              ticketsCount++
              totalVentas += Number(o.total) || 0
              descuentos += Number(o.descuento) || 0
              propinas += Number(o.propina) || 0
              const m = (o.metodo_pago || '').toLowerCase()
              if (m.includes('efectivo') || m.includes('cash')) efectivo += Number(o.total) || 0
              else if (m.includes('transferencia')) transferencias += Number(o.total) || 0
              else tarjeta += Number(o.total) || 0
            }
          }
          setData({ efectivo, tarjeta, transferencias, totalVentas, ticketsCount, cancelaciones, descuentos, propinas })
        }
      } catch { /* */ }
      setLoading(false)
    }
    fetchData()

    // Audit log
    try {
      const saved = sessionStorage.getItem('pos_staff')
      const actor = saved ? (JSON.parse(saved)?.name || 'desconocido') : 'desconocido'
      logAudit({ action: 'status_changed', actor, details: { type: 'corte_x', turno_id: turno.id } })
    } catch { /* */ }
  }, [turno.opened_at, turno.id])

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=400,height=600')
    if (!w) return
    const now = new Date()
    const openedAt = new Date(turno.opened_at)
    w.document.write(`
      <html><head><title>Corte X</title>
      <style>
        body{font-family:monospace;font-size:12px;padding:20px;max-width:300px;margin:0 auto}
        h2{text-align:center;margin:0 0 4px}
        .sub{text-align:center;font-size:11px;margin:0 0 10px;color:#666}
        .line{border-top:1px dashed #000;margin:8px 0}
        .row{display:flex;justify-content:space-between;margin:3px 0}
        .total{font-weight:bold;font-size:14px}
      </style></head><body>
      <h2>CORTE X</h2>
      <p class="sub">Reporte parcial — turno NO cerrado</p>
      <p style="text-align:center">${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
      <div class="line"></div>
      <div class="row"><span>Turno desde:</span><span>${openedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="row"><span>Abierto por:</span><span>${turno.opened_by}</span></div>
      <div class="row"><span>Fondo inicial:</span><span>${formatMXN(turno.fondo_inicial)}</span></div>
      <div class="line"></div>
      <div class="row"><span>Ventas efectivo:</span><span>${formatMXN(data.efectivo)}</span></div>
      <div class="row"><span>Ventas tarjeta:</span><span>${formatMXN(data.tarjeta)}</span></div>
      <div class="row"><span>Transferencias:</span><span>${formatMXN(data.transferencias)}</span></div>
      <div class="line"></div>
      <div class="row total"><span>Total ventas:</span><span>${formatMXN(data.totalVentas)}</span></div>
      <div class="row"><span>Tickets:</span><span>${data.ticketsCount}</span></div>
      <div class="row"><span>Cancelaciones:</span><span>${data.cancelaciones}</span></div>
      <div class="row"><span>Descuentos:</span><span>${formatMXN(data.descuentos)}</span></div>
      <div class="row"><span>Propinas:</span><span>${formatMXN(data.propinas)}</span></div>
      <div class="line"></div>
      <p style="text-align:center;font-size:10px;color:#666">*** CORTE PARCIAL — TURNO SIGUE ABIERTO ***</p>
      </body></html>
    `)
    w.document.close()
    w.print()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-amber-400" />
            <div>
              <h2 className="font-bold text-[var(--text-1)]">Corte X</h2>
              <p className="text-xs text-[var(--text-3)]">Reporte parcial — turno no cierra</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--line)]">
            <X size={18} className="text-[var(--text-3)]" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Fondo inicial</span>
                <span className="font-medium">{formatMXN(turno.fondo_inicial)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Ventas efectivo</span>
                <span className="font-medium">{formatMXN(data.efectivo)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Ventas tarjeta</span>
                <span className="font-medium">{formatMXN(data.tarjeta)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Transferencias</span>
                <span className="font-medium">{formatMXN(data.transferencias)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)] text-base">
                <span className="font-bold text-[var(--text-1)]">Total ventas</span>
                <span className="font-bold text-emerald-400">{formatMXN(data.totalVentas)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Tickets</span>
                <span className="font-medium">{data.ticketsCount}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Cancelaciones</span>
                <span className="font-medium text-red-400">{data.cancelaciones}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--text-3)]">Descuentos</span>
                <span className="font-medium text-amber-400">{formatMXN(data.descuentos)}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-[var(--text-3)]">Propinas</span>
                <span className="font-medium">{formatMXN(data.propinas)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={handlePrint}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--line)] transition-colors disabled:opacity-40"
          >
            <Printer size={16} />
            Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-1)] font-medium hover:bg-[var(--line-soft)] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

interface Cierre {
  id: string
  fecha: string
  total_ventas: number
  tickets_count: number
  diferencia: number
  closed_by: string
  created_at: string
  fondo_inicial: number
  total_contado: number
}

function HistorialCierres() {
  const [cierres, setCierres] = useState<Cierre[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_cierres?client_id=eq.${_cid()}&order=created_at.desc&limit=10&select=id,fecha,total_ventas,tickets_count,diferencia,closed_by,created_at,fondo_inicial,total_contado`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (res.ok) setCierres(await res.json())
      } catch { /* */ }
      setLoading(false)
    }
    fetch_()
  }, [])

  if (loading) return <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-[var(--text-3)] border-t-transparent rounded-full animate-spin" /></div>
  if (cierres.length === 0) return <p className="text-center text-[var(--text-3)] text-sm py-4">Sin cierres registrados</p>

  return (
    <div className="space-y-2">
      {cierres.map(c => {
        const isOpen = expanded === c.id
        const d = c.diferencia ?? 0
        return (
          <div key={c.id} className="bg-[var(--surface-2)] border border-[var(--line)] rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : c.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--line)]/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown size={14} className="text-[var(--text-3)]" /> : <ChevronRight size={14} className="text-[var(--text-3)]" />}
                <span className="font-medium text-[var(--text-1)]">{new Date(c.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <span className="text-[var(--text-3)]">{new Date(c.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-bold text-emerald-400">{formatMXN(c.total_ventas)}</span>
                <span className={`text-xs font-medium ${Math.abs(d) <= 10 ? 'text-emerald-400' : Math.abs(d) <= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {d >= 0 ? '+' : ''}{formatMXN(d)}
                </span>
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-3 pt-1 border-t border-[var(--line)] grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <div className="flex justify-between"><span className="text-[var(--text-3)]">Tickets</span><span>{c.tickets_count}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-3)]">Fondo inicial</span><span>{formatMXN(c.fondo_inicial)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-3)]">Total contado</span><span>{formatMXN(c.total_contado)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-3)]">Cerrado por</span><span className="truncate max-w-[80px]">{c.closed_by}</span></div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function TurnoPage() {
  const [activeTurno, setActiveTurno] = useState<Turno | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [tab, setTab] = useState<'turno' | 'personal'>('turno')
  const [showCierreWizard, setShowCierreWizard] = useState(false)
  const [showCorteX, setShowCorteX] = useState(false)

  // Open shift state
  const [fondoInicial, setFondoInicial] = useState('')
  const [openedBy, setOpenedBy] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchTurno = async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_turnos?closed_at=is.null&client_id=eq.${_cid()}&order=opened_at.desc&limit=1`,
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
        id, client_id: _cid(), opened_by: openedBy, fondo_inicial: Number(fondoInicial),
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
              <div className="max-w-md mx-auto space-y-4">
                {/* Active turno info */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6">
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

                {/* Corte X + Cierre de Caja buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCorteX(true)}
                    className="flex-1 py-3.5 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-400 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <FileText size={20} />
                    Corte X
                  </button>
                  <button
                    onClick={() => setShowCierreWizard(true)}
                    className="flex-1 py-3.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <DoorClosed size={20} />
                    Cierre de Caja
                  </button>
                </div>
                <p className="text-center text-xs text-[var(--text-3)]">
                  Corte X: snapshot sin cerrar — Cierre: wizard completo + PIN gerente
                </p>

                {/* Historial de cierres */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-[var(--text-2)] mb-3">Últimos cierres</h3>
                  <HistorialCierres />
                </div>
              </div>
            ) : (
              <div className="max-w-md mx-auto space-y-6">
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

                {/* Historial de cierres también visible sin turno activo */}
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-2)] mb-3">Últimos cierres</h3>
                  <HistorialCierres />
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

      {/* Corte X Modal */}
      {showCorteX && activeTurno && (
        <CorteXModal turno={activeTurno} onClose={() => setShowCorteX(false)} />
      )}

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
