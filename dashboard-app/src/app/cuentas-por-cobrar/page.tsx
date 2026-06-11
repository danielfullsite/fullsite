'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  DollarSign,
  Users,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Search,
  Filter,
  Loader2,
  Check,
  X,
  CreditCard,
  Clock,
  Receipt,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import { formatCurrency } from '@/lib/format'

// ── Types ───────────────────────────────────────────────────────────

type AccountStatus = 'al_corriente' | 'proximo_a_vencer' | 'vencida' | 'pagada'

interface Account {
  id: string
  cliente: string
  fecha: string
  total: number
  descripcion: string
  vencimiento: string
  abonos: Payment[]
  created_at: string
}

interface Payment {
  fecha: string
  monto: number
  metodo: string
}

const STATUS_CONFIG: Record<AccountStatus, { label: string; bg: string; text: string; dot: string }> = {
  al_corriente: { label: 'Al corriente', bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  proximo_a_vencer: { label: 'Prox. a vencer', bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  vencida: { label: 'Vencida', bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
  pagada: { label: 'Pagada', bg: 'bg-zinc-500/15', text: 'text-zinc-400', dot: 'bg-zinc-400' },
}

const METODOS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia'] as const

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ─────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function defaultVencimiento() {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

function generateAccountKey() {
  const now = new Date()
  return `accounts_receivable_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`
}

function generatePaymentKey() {
  const now = new Date()
  return `ar_payment_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`
}

function getAccountStatus(account: Account): AccountStatus {
  const totalAbonado = account.abonos.reduce((s, p) => s + p.monto, 0)
  const pendiente = account.total - totalAbonado

  if (pendiente <= 0) return 'pagada'

  const today = new Date()
  const venc = new Date(account.vencimiento + 'T12:00:00')
  const diffDays = Math.ceil((venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'vencida'
  if (diffDays <= 7) return 'proximo_a_vencer'
  return 'al_corriente'
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// ── Component ───────────────────────────────────────────────────────

export default function CuentasPorCobrarPage() {
  const clientId = getActiveClientSlug()

  // State
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saved, setSaved] = useState(false)

  // New account form
  const [cliente, setCliente] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(todayStr())
  const [descripcion, setDescripcion] = useState('')
  const [vencimiento, setVencimiento] = useState(defaultVencimiento())

  // Payment modal
  const [paymentAccount, setPaymentAccount] = useState<Account | null>(null)
  const [paymentMonto, setPaymentMonto] = useState('')
  const [paymentMetodo, setPaymentMetodo] = useState<string>('Efectivo')
  const [paymentFecha, setPaymentFecha] = useState(todayStr())
  const [savingPayment, setSavingPayment] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  // ── Load data ─────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    try {
      // Load accounts
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.accounts_receivable_%&order=fecha.desc&limit=500`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return

      const rows: { data_key: string; fecha: string; data: unknown }[] = await res.json()

      // Load payments
      const payRes = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.ar_payment_%&order=fecha.desc&limit=2000`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const payRows: { data_key: string; fecha: string; data: unknown }[] = payRes.ok ? await payRes.json() : []

      // Group payments by account_id
      const paymentsByAccount: Record<string, Payment[]> = {}
      for (const row of payRows) {
        const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>
        const accountId = d.account_id as string
        if (!accountId) continue
        if (!paymentsByAccount[accountId]) paymentsByAccount[accountId] = []
        paymentsByAccount[accountId].push({
          fecha: (d.fecha as string) || row.fecha,
          monto: Number(d.monto) || 0,
          metodo: (d.metodo as string) || 'Efectivo',
        })
      }

      const parsed: Account[] = rows
        .map((row) => {
          const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>
          return {
            id: row.data_key,
            cliente: (d.cliente as string) || '',
            fecha: (d.fecha as string) || row.fecha,
            total: Number(d.total) || 0,
            descripcion: (d.descripcion as string) || '',
            vencimiento: (d.vencimiento as string) || '',
            abonos: paymentsByAccount[row.data_key] || [],
            created_at: row.fecha,
          }
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha))

      setAccounts(parsed)
    } catch (err) {
      console.error('Error loading accounts:', err)
    }
  }, [clientId])

  useEffect(() => {
    loadAccounts().then(() => setLoading(false))
  }, [loadAccounts])

  // ── Save new account ──────────────────────────────────────────────

  async function handleSaveAccount() {
    const amount = parseFloat(monto)
    if (!amount || amount <= 0 || !cliente.trim()) return
    setSaving(true)

    const dataKey = generateAccountKey()
    const payload = {
      cliente: cliente.trim(),
      total: amount,
      fecha,
      descripcion: descripcion.trim(),
      vencimiento,
    }

    const ok = await sbPost('wansoft_data', clientId, {
      data_key: dataKey,
      fecha,
      data: payload,
    })

    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setCliente('')
      setMonto('')
      setFecha(todayStr())
      setDescripcion('')
      setVencimiento(defaultVencimiento())
      setShowForm(false)
      await loadAccounts()
    }
    setSaving(false)
  }

  // ── Register payment (abono) ──────────────────────────────────────

  async function handleSavePayment() {
    if (!paymentAccount) return
    const amount = parseFloat(paymentMonto)
    if (!amount || amount <= 0) return
    setSavingPayment(true)

    const dataKey = generatePaymentKey()
    const payload = {
      account_id: paymentAccount.id,
      cliente: paymentAccount.cliente,
      monto: amount,
      metodo: paymentMetodo,
      fecha: paymentFecha,
    }

    const ok = await sbPost('wansoft_data', clientId, {
      data_key: dataKey,
      fecha: paymentFecha,
      data: payload,
    })

    if (ok) {
      setPaymentAccount(null)
      setPaymentMonto('')
      setPaymentMetodo('Efectivo')
      setPaymentFecha(todayStr())
      await loadAccounts()
    }
    setSavingPayment(false)
  }

  // ── Computed ──────────────────────────────────────────────────────

  const accountsWithStatus = useMemo(
    () => accounts.map((a) => ({ ...a, status: getAccountStatus(a) })),
    [accounts]
  )

  const totalPorCobrar = useMemo(
    () =>
      accountsWithStatus
        .filter((a) => a.status !== 'pagada')
        .reduce((s, a) => s + a.total - a.abonos.reduce((p, ab) => p + ab.monto, 0), 0),
    [accountsWithStatus]
  )

  const cuentasAbiertas = useMemo(
    () => accountsWithStatus.filter((a) => a.status !== 'pagada').length,
    [accountsWithStatus]
  )

  const cuentasVencidas = useMemo(
    () => accountsWithStatus.filter((a) => a.status === 'vencida').length,
    [accountsWithStatus]
  )

  const monthStart = startOfMonth(new Date()).toISOString().slice(0, 10)
  const cobradoEsteMes = useMemo(
    () =>
      accounts.reduce(
        (s, a) => s + a.abonos.filter((p) => p.fecha >= monthStart).reduce((ps, p) => ps + p.monto, 0),
        0
      ),
    [accounts, monthStart]
  )

  // Filtered
  const filtered = useMemo(() => {
    let list = accountsWithStatus
    if (filterStatus) list = list.filter((a) => a.status === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (a) => a.cliente.toLowerCase().includes(q) || a.descripcion.toLowerCase().includes(q)
      )
    }
    return list
  }, [accountsWithStatus, filterStatus, search])

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--text-3)]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas por Cobrar"
        subtitle="Cuentas abiertas y abonos parciales"
        action={
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Cancelar' : 'Nueva cuenta'}
          </button>
        }
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Total por cobrar"
          value={formatCurrency(totalPorCobrar)}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Cuentas abiertas"
          value={String(cuentasAbiertas)}
          icon={Users}
          accentClass="kpi-accent-purple"
          index={1}
        />
        <KPICard
          label="Vencidas"
          value={String(cuentasVencidas)}
          icon={AlertTriangle}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Cobrado este mes"
          value={formatCurrency(cobradoEsteMes)}
          icon={CheckCircle2}
          accentClass="kpi-accent-green"
          index={3}
        />
      </div>

      {/* ── New account form ── */}
      {showForm && (
        <div
          className="rounded-2xl border border-[var(--accent-line)] p-5 space-y-4"
          style={{ background: 'var(--bento-card)' }}
        >
          <h3 className="text-sm font-bold text-[var(--text-1)]">Nueva cuenta por cobrar</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Cliente */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                Cliente *
              </label>
              <input
                type="text"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Nombre del cliente"
                className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            {/* Monto */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                Monto original *
              </label>
              <input
                type="number"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            {/* Fecha */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                Fecha
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            {/* Descripcion */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                Descripcion
              </label>
              <input
                type="text"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Evento, consumo, etc."
                className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            {/* Vencimiento */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                Vencimiento
              </label>
              <input
                type="date"
                value={vencimiento}
                onChange={(e) => setVencimiento(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSaveAccount}
              disabled={saving || !cliente.trim() || !monto}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Guardar
            </button>
            {saved && (
              <span className="text-emerald-400 text-sm font-semibold flex items-center gap-1">
                <Check size={14} /> Guardado
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--text-4)]" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="">Todos los estados</option>
            <option value="al_corriente">Al corriente</option>
            <option value="proximo_a_vencer">Proximo a vencer</option>
            <option value="vencida">Vencida</option>
            <option value="pagada">Pagada</option>
          </select>
        </div>
      </div>

      {/* ── Accounts table ── */}
      <div
        className="rounded-2xl border border-[var(--accent-line)] overflow-hidden"
        style={{ background: 'var(--bento-card)' }}
      >
        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--accent-line)]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Cliente
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Fecha
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Total
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Abonado
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Pendiente
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Vencimiento
                </th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Estado
                </th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-[var(--text-4)]">
                    {accounts.length === 0
                      ? 'No hay cuentas registradas. Crea la primera.'
                      : 'No hay cuentas con este filtro.'}
                  </td>
                </tr>
              )}
              {filtered.map((account) => {
                const totalAbonado = account.abonos.reduce((s, p) => s + p.monto, 0)
                const pendiente = Math.max(0, account.total - totalAbonado)
                const cfg = STATUS_CONFIG[account.status]
                return (
                  <tr
                    key={account.id}
                    className="border-b border-[var(--accent-line)] last:border-0 hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--text-1)]">{account.cliente}</p>
                      {account.descripcion && (
                        <p className="text-[11px] text-[var(--text-4)] mt-0.5 truncate max-w-[200px]">
                          {account.descripcion}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)] tabular-nums">{account.fecha}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--text-1)] tabular-nums">
                      {formatCurrency(account.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 tabular-nums">
                      {formatCurrency(totalAbonado)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--text-1)] tabular-nums">
                      {formatCurrency(pendiente)}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)] tabular-nums">{account.vencimiento}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {account.status !== 'pagada' && (
                        <button
                          onClick={() => {
                            setPaymentAccount(account)
                            setPaymentMonto('')
                            setPaymentFecha(todayStr())
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                        >
                          <CreditCard size={12} />
                          Abonar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-[var(--accent-line)]">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-[var(--text-4)] text-sm">
              {accounts.length === 0
                ? 'No hay cuentas registradas.'
                : 'No hay cuentas con este filtro.'}
            </div>
          )}
          {filtered.map((account) => {
            const totalAbonado = account.abonos.reduce((s, p) => s + p.monto, 0)
            const pendiente = Math.max(0, account.total - totalAbonado)
            const cfg = STATUS_CONFIG[account.status]
            return (
              <div key={account.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-[var(--text-1)] text-sm">{account.cliente}</p>
                    {account.descripcion && (
                      <p className="text-[11px] text-[var(--text-4)] mt-0.5">{account.descripcion}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[var(--text-4)] text-[10px] uppercase">Total</p>
                    <p className="font-semibold text-[var(--text-1)] tabular-nums">{formatCurrency(account.total)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-4)] text-[10px] uppercase">Abonado</p>
                    <p className="font-semibold text-emerald-400 tabular-nums">{formatCurrency(totalAbonado)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-4)] text-[10px] uppercase">Pendiente</p>
                    <p className="font-semibold text-[var(--text-1)] tabular-nums">{formatCurrency(pendiente)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--text-4)] flex items-center gap-1">
                    <Clock size={11} /> Vence: {account.vencimiento}
                  </span>
                  {account.status !== 'pagada' && (
                    <button
                      onClick={() => {
                        setPaymentAccount(account)
                        setPaymentMonto('')
                        setPaymentFecha(todayStr())
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/20 text-emerald-400"
                    >
                      <CreditCard size={11} />
                      Abonar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Payment modal ── */}
      {paymentAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--accent-line)] p-6 space-y-4"
            style={{ background: 'var(--bento-card)' }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-1)]">Registrar abono</h3>
              <button
                onClick={() => setPaymentAccount(null)}
                className="p-1 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 text-sm">
              <p className="text-[var(--text-2)]">
                <span className="text-[var(--text-4)]">Cliente:</span>{' '}
                <span className="font-semibold text-[var(--text-1)]">{paymentAccount.cliente}</span>
              </p>
              <p className="text-[var(--text-2)]">
                <span className="text-[var(--text-4)]">Total:</span>{' '}
                {formatCurrency(paymentAccount.total)}
              </p>
              <p className="text-[var(--text-2)]">
                <span className="text-[var(--text-4)]">Abonado:</span>{' '}
                <span className="text-emerald-400">
                  {formatCurrency(paymentAccount.abonos.reduce((s, p) => s + p.monto, 0))}
                </span>
              </p>
              <p className="text-[var(--text-2)]">
                <span className="text-[var(--text-4)]">Pendiente:</span>{' '}
                <span className="font-bold text-[var(--text-1)]">
                  {formatCurrency(
                    Math.max(0, paymentAccount.total - paymentAccount.abonos.reduce((s, p) => s + p.monto, 0))
                  )}
                </span>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                  Monto a abonar *
                </label>
                <input
                  type="number"
                  value={paymentMonto}
                  onChange={(e) => setPaymentMonto(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                  Metodo de pago
                </label>
                <select
                  value={paymentMetodo}
                  onChange={(e) => setPaymentMetodo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  {METODOS_PAGO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1.5">
                  Fecha
                </label>
                <input
                  type="date"
                  value={paymentFecha}
                  onChange={(e) => setPaymentFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-[var(--surface-2)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSavePayment}
                disabled={savingPayment || !paymentMonto || parseFloat(paymentMonto) <= 0}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingPayment ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Receipt size={16} />
                )}
                Registrar abono
              </button>
              <button
                onClick={() => setPaymentAccount(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-3)] hover:bg-[var(--surface-2)] transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
