'use client'

import { useEffect, useState, useMemo } from 'react'
import { Banknote, ArrowDownCircle, ArrowUpCircle, Building2, Wallet, Calendar } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const CLIENT_ID = 'amalay'

type DatePreset = 'hoy' | 'semana' | 'mes' | 'custom'

interface CashMovement {
  id: string
  client_id: string
  turno_id: string
  type: 'retiro' | 'deposito' | 'deposito_bancario'
  amount: number
  reason: string
  actor: string
  approved_by: string | null
  created_at: string
}

interface PosOrder {
  id: string
  client_id: string
  total: number
  metodo_pago: string
  pagos: Record<string, number> | null
  status: string
  created_at: string
}

interface FlowEntry {
  id: string
  created_at: string
  concept: string
  type: 'ingreso' | 'retiro' | 'deposito' | 'deposito_bancario'
  amount: number
  actor: string
  balance: number
}

function toLocalDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  if (preset === 'custom' && customFrom && customTo) {
    return { from: customFrom + 'T00:00:00', to: customTo + 'T23:59:59' }
  }
  if (preset === 'semana') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return { from: d.toISOString().slice(0, 10) + 'T00:00:00', to: today + 'T23:59:59' }
  }
  if (preset === 'mes') {
    const d = new Date(now)
    d.setDate(d.getDate() - 30)
    return { from: d.toISOString().slice(0, 10) + 'T00:00:00', to: today + 'T23:59:59' }
  }
  // hoy
  return { from: today + 'T00:00:00', to: today + 'T23:59:59' }
}

async function supaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  return res.json()
}

export default function ControlEfectivoPage() {
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [orders, setOrders] = useState<PosOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<DatePreset>('hoy')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Bank deposit form
  const [depositAmount, setDepositAmount] = useState('')
  const [depositBank, setDepositBank] = useState('')
  const [depositRef, setDepositRef] = useState('')
  const [depositActor, setDepositActor] = useState('')
  const [depositSaving, setDepositSaving] = useState(false)
  const [depositSuccess, setDepositSuccess] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    const { from, to } = getDateRange(preset, customFrom, customTo)
    try {
      const [mvs, ords] = await Promise.all([
        supaFetch<CashMovement[]>(
          `pos_cash_movements?client_id=eq.${CLIENT_ID}&created_at=gte.${from}&created_at=lte.${to}&order=created_at.asc&limit=500`
        ),
        supaFetch<PosOrder[]>(
          `pos_orders?client_id=eq.${CLIENT_ID}&created_at=gte.${from}&created_at=lte.${to}&status=eq.pagada&order=created_at.asc&limit=1000`
        ),
      ])
      setMovements(mvs)
      setOrders(ords)
    } catch (e) {
      console.error('Error fetching data:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo])

  // Compute cash sales from orders
  const cashSales = useMemo(() => {
    return orders.filter(o => {
      if (o.metodo_pago === 'efectivo') return true
      if (o.pagos && typeof o.pagos === 'object') {
        return Object.keys(o.pagos).some(k => k.toLowerCase().includes('efectivo'))
      }
      return false
    }).map(o => {
      let cashAmount = o.total
      if (o.pagos && typeof o.pagos === 'object') {
        const cashKey = Object.keys(o.pagos).find(k => k.toLowerCase().includes('efectivo'))
        if (cashKey) cashAmount = o.pagos[cashKey]
      }
      return { id: o.id, created_at: o.created_at, amount: cashAmount }
    })
  }, [orders])

  // KPI calculations
  const totalCashIn = cashSales.reduce((s, o) => s + o.amount, 0)
  const totalDepositos = movements.filter(m => m.type === 'deposito').reduce((s, m) => s + m.amount, 0)
  const totalRetiros = movements.filter(m => m.type === 'retiro').reduce((s, m) => s + m.amount, 0)
  const totalBankDeposits = movements.filter(m => m.type === 'deposito_bancario').reduce((s, m) => s + m.amount, 0)
  const saldoCaja = totalCashIn + totalDepositos - totalRetiros - totalBankDeposits

  // Build chronological cash flow
  const flowEntries: FlowEntry[] = useMemo(() => {
    const entries: Omit<FlowEntry, 'balance'>[] = []

    cashSales.forEach(cs => {
      entries.push({
        id: cs.id,
        created_at: cs.created_at,
        concept: 'Venta en efectivo',
        type: 'ingreso',
        amount: cs.amount,
        actor: '',
      })
    })

    movements.forEach(m => {
      let concept = ''
      if (m.type === 'retiro') concept = `Retiro: ${m.reason || 'sin razon'}`
      else if (m.type === 'deposito') concept = `Deposito a caja: ${m.reason || ''}`
      else if (m.type === 'deposito_bancario') concept = `Deposito bancario: ${m.reason || ''}`

      entries.push({
        id: m.id,
        created_at: m.created_at,
        concept,
        type: m.type,
        amount: m.amount,
        actor: m.actor,
      })
    })

    entries.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    let balance = 0
    return entries.map(e => {
      if (e.type === 'ingreso' || e.type === 'deposito') {
        balance += e.amount
      } else {
        balance -= e.amount
      }
      return { ...e, balance }
    })
  }, [cashSales, movements])

  // Summary by type
  const summaryByType = [
    { label: 'Ventas en efectivo', count: cashSales.length, total: totalCashIn, color: 'text-emerald-500' },
    { label: 'Depositos a caja', count: movements.filter(m => m.type === 'deposito').length, total: totalDepositos, color: 'text-blue-400' },
    { label: 'Retiros', count: movements.filter(m => m.type === 'retiro').length, total: totalRetiros, color: 'text-amber-500' },
    { label: 'Depositos bancarios', count: movements.filter(m => m.type === 'deposito_bancario').length, total: totalBankDeposits, color: 'text-purple-400' },
  ]

  const handleBankDeposit = async () => {
    if (!depositAmount || !depositBank || !depositActor) return
    setDepositSaving(true)
    setDepositSuccess(false)
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_cash_movements`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          type: 'deposito_bancario',
          amount: parseFloat(depositAmount),
          reason: `${depositBank} — Ref: ${depositRef}`,
          actor: depositActor,
        }),
      })
      if (!res.ok) throw new Error('Error al guardar')
      setDepositAmount('')
      setDepositBank('')
      setDepositRef('')
      setDepositActor('')
      setDepositSuccess(true)
      setTimeout(() => setDepositSuccess(false), 3000)
      fetchData()
    } catch (e) {
      console.error('Error saving bank deposit:', e)
      alert('Error al registrar deposito bancario')
    } finally {
      setDepositSaving(false)
    }
  }

  const presetButtons: { label: string; value: DatePreset }[] = [
    { label: 'Hoy', value: 'hoy' },
    { label: 'Semana', value: 'semana' },
    { label: 'Mes', value: 'mes' },
    { label: 'Rango', value: 'custom' },
  ]

  return (
    <>
      <PageHeader
        title="Control de Efectivo"
        subtitle="Flujo de caja, retiros, depositos y depositos bancarios"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {presetButtons.map(p => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  preset === p.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-2)]/80'
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <Calendar size={14} className="text-[var(--text-3)]" />
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)]"
                />
                <span className="text-[var(--text-3)] text-xs">a</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)]"
                />
              </div>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard
              label="Efectivo recibido"
              value={formatCurrency(totalCashIn)}
              subtitle={`${cashSales.length} ventas`}
              icon={Banknote}
              accentClass="kpi-accent-green"
              index={0}
            />
            <KPICard
              label="Retiros"
              value={formatCurrency(totalRetiros)}
              subtitle={`${movements.filter(m => m.type === 'retiro').length} movimientos`}
              icon={ArrowUpCircle}
              accentClass="kpi-accent-amber"
              index={1}
            />
            <KPICard
              label="Depositos"
              value={formatCurrency(totalDepositos)}
              subtitle={`${movements.filter(m => m.type === 'deposito').length} movimientos`}
              icon={ArrowDownCircle}
              accentClass="kpi-accent-blue"
              index={2}
            />
            <KPICard
              label="Saldo en caja"
              value={formatCurrency(saldoCaja)}
              subtitle="Efectivo disponible"
              icon={Wallet}
              accentClass="kpi-accent-purple"
              index={3}
            />
          </div>

          {/* Summary by type */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6 mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Resumen por tipo</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {summaryByType.map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-1">{s.label}</p>
                  <p className={`text-lg font-bold tabular-nums ${s.color}`}>{formatCurrency(s.total)}</p>
                  <p className="text-xs text-[var(--text-3)]">{s.count} movimientos</p>
                </div>
              ))}
            </div>
          </div>

          {/* Cash flow table */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Flujo de caja</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                    <th className="text-left px-4 py-2 font-medium">Hora</th>
                    <th className="text-left px-4 py-2 font-medium">Concepto</th>
                    <th className="text-left px-4 py-2 font-medium">Responsable</th>
                    <th className="text-right px-4 py-2 font-medium">Entrada</th>
                    <th className="text-right px-4 py-2 font-medium">Salida</th>
                    <th className="text-right px-4 py-2 font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {flowEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-3)]">
                        Sin movimientos en este periodo
                      </td>
                    </tr>
                  ) : (
                    flowEntries.map(e => {
                      const isIn = e.type === 'ingreso' || e.type === 'deposito'
                      return (
                        <tr key={e.id + e.created_at} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]/50">
                          <td className="px-4 py-2 text-[var(--text-3)] text-xs whitespace-nowrap">{toLocalDate(e.created_at)}</td>
                          <td className="px-4 py-2 text-[var(--text-2)]">{e.concept}</td>
                          <td className="px-4 py-2 text-[var(--text-3)] text-xs">{e.actor || '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium text-emerald-500">
                            {isIn ? formatCurrency(e.amount) : ''}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium text-red-400">
                            {!isIn ? formatCurrency(e.amount) : ''}
                          </td>
                          <td className={`px-4 py-2 text-right tabular-nums font-bold ${e.balance >= 0 ? 'text-[var(--text-1)]' : 'text-red-500'}`}>
                            {formatCurrency(e.balance)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bank deposit form */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building2 size={18} className="text-purple-400" />
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Registrar deposito bancario</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-1">Monto</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="$0.00"
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] placeholder:text-[var(--text-3)]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-1">Banco</label>
                <input
                  type="text"
                  placeholder="BBVA, Banorte..."
                  value={depositBank}
                  onChange={e => setDepositBank(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] placeholder:text-[var(--text-3)]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-1">Referencia</label>
                <input
                  type="text"
                  placeholder="No. referencia"
                  value={depositRef}
                  onChange={e => setDepositRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] placeholder:text-[var(--text-3)]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-1">Responsable</label>
                <input
                  type="text"
                  placeholder="Nombre"
                  value={depositActor}
                  onChange={e => setDepositActor(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] placeholder:text-[var(--text-3)]"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleBankDeposit}
                disabled={depositSaving || !depositAmount || !depositBank || !depositActor}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {depositSaving ? 'Guardando...' : 'Registrar deposito'}
              </button>
              {depositSuccess && (
                <span className="text-xs text-emerald-500 font-medium">Deposito registrado correctamente</span>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
