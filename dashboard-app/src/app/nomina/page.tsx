'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Users, Clock, DollarSign, TrendingUp, Calendar, AlertTriangle, ChevronDown, Download, Wallet, Receipt, UserCheck, Timer } from 'lucide-react'
import { getRecentDays, getLatestDeep, getWansoftData, getWansoftDataRange, getDateRange, aggregateMeseros } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import type { WansoftDaily } from '@/lib/types'

// ── Types ───────────────────────────────────────────────────────────────

interface LaborEntry {
  empleado: string
  entrada: string
  salida: string
  horas: number
}

interface ShiftEntry {
  nombre: string
  total: number
  [key: string]: unknown
}

interface TipEntry {
  mesero: string
  ventas: number
  tickets: number
  propinas: number
  propina_promedio: number
}

interface Employee {
  nombre: string
  role: string
  hourlyRate: number
  daysWorked: number
  hoursTotal: number
  basePay: number
  tipsEarned: number
  salesTotal: number
  deductions: number
  totalPay: number
  avgSalesPerDay: number
  attendanceRate: number
}

type PeriodType = 'semanal' | 'quincenal' | 'mensual'
type TabType = 'prenomina' | 'rendimiento' | 'propinas' | 'asistencia'
type SortField = 'nombre' | 'totalPay' | 'salesTotal' | 'tipsEarned' | 'hoursTotal' | 'daysWorked'

const PERIOD_DAYS: Record<PeriodType, number> = { semanal: 7, quincenal: 15, mensual: 30 }
const PERIOD_LABELS: Record<PeriodType, string> = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' }

// Default hourly rates by known role patterns (MXN)
const DEFAULT_HOURLY_RATE = 62.5 // ~$500/day for 8hr shift
const MESERO_HOURLY_RATE = 50.0
const COCINA_HOURLY_RATE = 56.25

function guessHourlyRate(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('cocina') || lower.includes('chef') || lower.includes('cocinero')) return COCINA_HOURLY_RATE
  return MESERO_HOURLY_RATE
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getPeriodDates(period: PeriodType): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - PERIOD_DAYS[period])
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  }
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

// ── Component ───────────────────────────────────────────────────────────

export default function NominaPage() {
  const [dailyData, setDailyData] = useState<WansoftDaily[]>([])
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([])
  const [laborHistory, setLaborHistory] = useState<{ fecha: string; data: LaborEntry[] }[]>([])
  const [tips, setTips] = useState<TipEntry[]>([])
  const [hoursWorked, setHoursWorked] = useState<LaborEntry[]>([])
  const [hoursHistory, setHoursHistory] = useState<{ fecha: string; data: LaborEntry[] }[]>([])
  const [shifts, setShifts] = useState<ShiftEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  const [period, setPeriod] = useState<PeriodType>('semanal')
  const [tab, setTab] = useState<TabType>('prenomina')
  const [sortField, setSortField] = useState<SortField>('totalPay')
  const [sortAsc, setSortAsc] = useState(false)
  const [editingRates, setEditingRates] = useState<Record<string, number>>({})
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false)

  // ── Data fetching ──────────────────────────────────────────────────

  const loadData = useCallback(async (periodType: PeriodType) => {
    setLoading(true)
    try {
      const days = PERIOD_DAYS[periodType]
      const { from, to } = getPeriodDates(periodType)

      const [
        dailyRows,
        laborRow,
        tipsRawRow,
        tipsRow,
        hoursRow,
        shiftsRow,
        laborRange,
        hoursRange,
      ] = await Promise.all([
        getDateRange(from, to),
        getLatestDeep('wansoft_labor'),
        getWansoftData('tips_raw'),
        getLatestDeep('wansoft_tips'),
        getWansoftData('hours_worked'),
        getWansoftData('shifts'),
        getWansoftDataRange('labor', days),
        getWansoftDataRange('hours_worked', days),
      ])

      setDailyData(dailyRows.length > 0 ? dailyRows : await getRecentDays(days))

      if (laborRow?.data && Array.isArray(laborRow.data)) {
        setLaborEntries(laborRow.data)
        setFecha(laborRow.fecha || '')
      }

      // Labor history from multiple days
      if (laborRange && laborRange.length > 0) {
        setLaborHistory(laborRange.map(r => ({
          fecha: r.fecha,
          data: Array.isArray(r.data) ? r.data as LaborEntry[] : [],
        })).filter(r => r.data.length > 0))
      }

      // Tips: prefer tips_raw over wansoft_tips
      if (tipsRawRow?.data && Array.isArray(tipsRawRow.data) && tipsRawRow.data.length > 0) {
        setTips(tipsRawRow.data as TipEntry[])
      } else if (tipsRow?.data && Array.isArray(tipsRow.data)) {
        setTips(tipsRow.data as TipEntry[])
      }

      if (hoursRow?.data && Array.isArray(hoursRow.data)) setHoursWorked(hoursRow.data as LaborEntry[])
      if (hoursRange && hoursRange.length > 0) {
        setHoursHistory(hoursRange.map(r => ({
          fecha: r.fecha,
          data: Array.isArray(r.data) ? r.data as LaborEntry[] : [],
        })).filter(r => r.data.length > 0))
      }
      if (shiftsRow?.data && Array.isArray(shiftsRow.data)) setShifts(shiftsRow.data as ShiftEntry[])
    } catch (err) {
      console.error('[nomina] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData(period) }, [period, loadData])

  // ── Computed: aggregate meseros from daily data ────────────────────

  const meseros = useMemo(() => aggregateMeseros(dailyData), [dailyData])
  const totalVentas = useMemo(() => meseros.reduce((s, m) => s + m.total, 0), [meseros])
  const totalTipsDaily = useMemo(() => dailyData.reduce((s, d) => s + (d.propinas_total || 0), 0), [dailyData])
  const totalTipsToday = useMemo(() => tips.reduce((s, t) => s + (t.propinas || 0), 0), [tips])

  // ── Computed: aggregate hours from labor history ───────────────────

  const employeeHoursMap = useMemo(() => {
    const map: Record<string, { totalHours: number; daysPresent: Set<string> }> = {}
    // From labor history
    for (const day of laborHistory) {
      for (const entry of day.data) {
        if (!entry.empleado) continue
        if (!map[entry.empleado]) map[entry.empleado] = { totalHours: 0, daysPresent: new Set() }
        map[entry.empleado].totalHours += entry.horas || 0
        map[entry.empleado].daysPresent.add(day.fecha)
      }
    }
    // Supplement with hours_worked history
    for (const day of hoursHistory) {
      for (const entry of day.data) {
        if (!entry.empleado) continue
        if (!map[entry.empleado]) map[entry.empleado] = { totalHours: 0, daysPresent: new Set() }
        // Only add if we don't already have data from labor for this date
        if (!map[entry.empleado].daysPresent.has(day.fecha)) {
          map[entry.empleado].totalHours += entry.horas || 0
          map[entry.empleado].daysPresent.add(day.fecha)
        }
      }
    }
    // Fallback: if no history, use today's snapshot
    if (Object.keys(map).length === 0) {
      const allEntries = laborEntries.length > 0 ? laborEntries : hoursWorked
      for (const entry of allEntries) {
        if (!entry.empleado) continue
        if (!map[entry.empleado]) map[entry.empleado] = { totalHours: 0, daysPresent: new Set() }
        map[entry.empleado].totalHours += entry.horas || 0
        map[entry.empleado].daysPresent.add(fecha || 'today')
      }
    }
    return map
  }, [laborHistory, hoursHistory, laborEntries, hoursWorked, fecha])

  // ── Computed: tips per mesero from daily data ─────────────────────

  const tipsByMesero = useMemo(() => {
    const map: Record<string, number> = {}
    // From tips_raw (today's detailed data)
    for (const t of tips) {
      if (t.mesero) map[t.mesero] = (map[t.mesero] || 0) + (t.propinas || 0)
    }
    // If daily propinas exist, distribute proportionally by sales share
    if (totalTipsDaily > 0 && meseros.length > 0 && Object.keys(map).length === 0) {
      for (const m of meseros) {
        const share = totalVentas > 0 ? m.total / totalVentas : 1 / meseros.length
        map[m.nombre] = Math.round(totalTipsDaily * share)
      }
    }
    return map
  }, [tips, totalTipsDaily, meseros, totalVentas])

  // ── Computed: build employee list ─────────────────────────────────

  const employees = useMemo((): Employee[] => {
    const allNames = new Set<string>()
    meseros.forEach(m => allNames.add(m.nombre))
    Object.keys(employeeHoursMap).forEach(n => allNames.add(n))
    Object.keys(tipsByMesero).forEach(n => allNames.add(n))

    const totalDaysInPeriod = PERIOD_DAYS[period]

    return Array.from(allNames).map(nombre => {
      const mesero = meseros.find(m => m.nombre === nombre)
      const hours = employeeHoursMap[nombre]
      const daysWorked = hours?.daysPresent?.size || mesero?.dias || 0
      const hoursTotal = hours?.totalHours || (daysWorked * 8) // Estimate 8hr if no hours data
      const hourlyRate = editingRates[nombre] || guessHourlyRate(nombre)
      const basePay = Math.round(hoursTotal * hourlyRate)
      const tipsEarned = tipsByMesero[nombre] || 0
      const salesTotal = mesero?.total || 0
      const deductions = 0 // Placeholder for future deduction logic
      const totalPay = basePay + tipsEarned - deductions
      const attendanceRate = totalDaysInPeriod > 0 ? Math.min(100, Math.round((daysWorked / totalDaysInPeriod) * 100)) : 0

      return {
        nombre,
        role: 'Mesero',
        hourlyRate,
        daysWorked,
        hoursTotal: Math.round(hoursTotal * 10) / 10,
        basePay,
        tipsEarned,
        salesTotal,
        deductions,
        totalPay,
        avgSalesPerDay: mesero?.promedio || 0,
        attendanceRate,
      }
    })
  }, [meseros, employeeHoursMap, tipsByMesero, editingRates, period])

  // ── Sorted employees ──────────────────────────────────────────────

  const sortedEmployees = useMemo(() => {
    const sorted = [...employees].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      if (typeof av === 'string' && typeof bv === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return sorted
  }, [employees, sortField, sortAsc])

  // ── Summary KPIs ──────────────────────────────────────────────────

  const totalNomina = useMemo(() => employees.reduce((s, e) => s + e.totalPay, 0), [employees])
  const totalBasePay = useMemo(() => employees.reduce((s, e) => s + e.basePay, 0), [employees])
  const totalHoursAll = useMemo(() => employees.reduce((s, e) => s + e.hoursTotal, 0), [employees])
  const avgCostPerHour = useMemo(() => totalHoursAll > 0 ? Math.round(totalNomina / totalHoursAll) : 0, [totalNomina, totalHoursAll])
  const tipsTotal = useMemo(() => employees.reduce((s, e) => s + e.tipsEarned, 0), [employees])

  // ── Handlers ──────────────────────────────────────────────────────

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  function handleRateChange(nombre: string, value: string) {
    const rate = parseFloat(value)
    if (!isNaN(rate) && rate >= 0) {
      setEditingRates(prev => ({ ...prev, [nombre]: rate }))
    }
  }

  // Column sort indicator
  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown size={12} className="text-[var(--text-4)] opacity-0 group-hover:opacity-100 transition-opacity" />
    return <ChevronDown size={12} className={`text-[var(--text-2)] transition-transform ${sortAsc ? 'rotate-180' : ''}`} />
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { from, to } = getPeriodDates(period)
  const periodLabel = `${formatDateShort(from)} — ${formatDateShort(to)}`
  const activeEmployees = employees.filter(e => e.daysWorked > 0).length

  return (
    <>
      <PageHeader
        title="Nomina"
        subtitle={`Pre-nomina y rendimiento del equipo ${periodLabel}`}
        action={
          <div className="relative">
            <button
              onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--line)] text-sm font-medium text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <Calendar size={14} className="text-[var(--text-3)]" />
              {PERIOD_LABELS[period]}
              <ChevronDown size={14} className="text-[var(--text-3)]" />
            </button>
            {showPeriodDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPeriodDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-lg overflow-hidden min-w-[140px]">
                  {(['semanal', 'quincenal', 'mensual'] as PeriodType[]).map(p => (
                    <button
                      key={p}
                      onClick={() => { setPeriod(p); setShowPeriodDropdown(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-2)] transition-colors ${
                        period === p ? 'text-emerald-500 font-semibold bg-emerald-500/5' : 'text-[var(--text-2)]'
                      }`}
                    >
                      {PERIOD_LABELS[p]} ({PERIOD_DAYS[p]}d)
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KPICard
          label="Total Nomina"
          value={formatCurrency(totalNomina)}
          subtitle={`Base ${formatCurrency(totalBasePay)} + Propinas ${formatCurrency(tipsTotal)}`}
          icon={Wallet}
          accentClass="kpi-accent-green"
          index={0}
        />
        <KPICard
          label="Empleados Activos"
          value={`${activeEmployees}`}
          subtitle={`de ${employees.length} en periodo`}
          icon={UserCheck}
          accentClass="kpi-accent-blue"
          index={1}
        />
        <KPICard
          label="Horas Totales"
          value={`${formatNumber(Math.round(totalHoursAll))}h`}
          subtitle={`${PERIOD_LABELS[period]}`}
          icon={Timer}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Costo / Hora"
          value={formatCurrency(avgCostPerHour)}
          subtitle="promedio del equipo"
          icon={Receipt}
          accentClass="kpi-accent-purple"
          index={3}
        />
        <KPICard
          label="Propinas Periodo"
          value={formatCurrency(tipsTotal > 0 ? tipsTotal : totalTipsDaily)}
          subtitle={totalTipsToday > 0 ? `Hoy: ${formatCurrency(totalTipsToday)}` : undefined}
          icon={TrendingUp}
          accentClass="kpi-accent-cyan"
          index={4}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 bg-[var(--surface)] rounded-lg p-1 border border-[var(--line)] w-fit">
        {([
          { key: 'prenomina' as TabType, label: 'Pre-Nomina', color: 'bg-emerald-600' },
          { key: 'rendimiento' as TabType, label: 'Rendimiento', color: 'bg-blue-600' },
          { key: 'propinas' as TabType, label: 'Propinas', color: 'bg-violet-600' },
          { key: 'asistencia' as TabType, label: 'Asistencia', color: 'bg-amber-600' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === t.key
                ? `${t.color} text-white shadow-sm`
                : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">

        {/* ── PRE-NOMINA TAB ──────────────────────────────────────── */}
        {tab === 'prenomina' && (
          employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin datos de empleados"
              description="Los datos se generan automaticamente desde las ventas de Wansoft. Verifica que haya datos en el periodo seleccionado."
              iconColor="text-emerald-500"
              iconBg="bg-emerald-500/10"
            />
          ) : (
            <div>
              {/* Summary bar */}
              <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)] flex flex-wrap items-center gap-4 text-xs">
                <span className="text-[var(--text-3)]">Periodo: <span className="font-semibold text-[var(--text-2)]">{periodLabel}</span></span>
                <span className="text-[var(--text-3)]">Dias: <span className="font-semibold text-[var(--text-2)]">{PERIOD_DAYS[period]}</span></span>
                <span className="text-[var(--text-3)]">Ventas equipo: <span className="font-semibold text-[var(--text-1)]">{formatCurrency(totalVentas)}</span></span>
                <div className="ml-auto flex gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold">
                    <DollarSign size={10} /> {formatCurrency(totalNomina)}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                      <th className="text-left px-4 py-3 font-medium w-8">#</th>
                      <th className="text-left px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('nombre')}>
                        <span className="inline-flex items-center gap-1">Empleado <SortIcon field="nombre" /></span>
                      </th>
                      <th className="text-center px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('daysWorked')}>
                        <span className="inline-flex items-center gap-1">Dias <SortIcon field="daysWorked" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('hoursTotal')}>
                        <span className="inline-flex items-center gap-1 justify-end">Horas <SortIcon field="hoursTotal" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium w-[100px]">$/hora</th>
                      <th className="text-right px-4 py-3 font-medium">Sueldo base</th>
                      <th className="text-right px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('tipsEarned')}>
                        <span className="inline-flex items-center gap-1 justify-end">Propinas <SortIcon field="tipsEarned" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('salesTotal')}>
                        <span className="inline-flex items-center gap-1 justify-end">Ventas <SortIcon field="salesTotal" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium group cursor-pointer select-none" onClick={() => toggleSort('totalPay')}>
                        <span className="inline-flex items-center gap-1 justify-end font-bold text-emerald-500">Total <SortIcon field="totalPay" /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEmployees.map((emp, i) => (
                      <tr key={emp.nombre} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 text-[var(--text-4)]">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-medium text-[var(--text-1)]">{emp.nombre}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-[var(--text-4)]">{emp.role}</span>
                              {emp.attendanceRate >= 80 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                                  {emp.attendanceRate}% asist.
                                </span>
                              )}
                              {emp.attendanceRate > 0 && emp.attendanceRate < 60 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium flex items-center gap-0.5">
                                  <AlertTriangle size={8} /> {emp.attendanceRate}% asist.
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums text-[var(--text-2)]">{emp.daysWorked}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{emp.hoursTotal > 0 ? `${emp.hoursTotal}h` : '--'}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={editingRates[emp.nombre] ?? emp.hourlyRate}
                            onChange={(e) => handleRateChange(emp.nombre, e.target.value)}
                            className="w-[80px] text-right text-sm bg-transparent border border-[var(--line-soft)] rounded px-2 py-1 text-[var(--text-2)] focus:border-emerald-500 focus:outline-none tabular-nums"
                            step="5"
                            min="0"
                          />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(emp.basePay)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-500 font-medium">{emp.tipsEarned > 0 ? formatCurrency(emp.tipsEarned) : '--'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{emp.salesTotal > 0 ? formatCurrency(emp.salesTotal) : '--'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-[var(--text-1)]">{formatCurrency(emp.totalPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals footer */}
                  <tfoot>
                    <tr className="bg-[var(--surface-2)] font-bold border-t-2 border-[var(--line)]">
                      <td className="px-4 py-3" colSpan={2}>
                        <span className="text-[var(--text-1)]">Total ({activeEmployees} empleados)</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-[var(--text-2)]">
                        {Math.round(employees.reduce((s, e) => s + e.daysWorked, 0) / Math.max(employees.length, 1))} prom
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{Math.round(totalHoursAll)}h</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-3)]">{formatCurrency(avgCostPerHour)}/h</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(totalBasePay)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{formatCurrency(tipsTotal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(totalVentas)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-400 text-base">{formatCurrency(totalNomina)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Disclaimer */}
              <div className="px-4 py-3 border-t border-[var(--line-soft)] bg-amber-500/5">
                <p className="text-[11px] text-amber-500/80 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Pre-nomina estimada. Las horas de asistencia provienen de Wansoft. Ajusta la tarifa por hora manualmente si es necesario.
                </p>
              </div>
            </div>
          )
        )}

        {/* ── RENDIMIENTO TAB ─────────────────────────────────────── */}
        {tab === 'rendimiento' && (
          meseros.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Sin datos de rendimiento"
              description="No hay ventas por mesero en el periodo seleccionado."
              iconColor="text-blue-500"
              iconBg="bg-blue-500/10"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                    <th className="text-left px-4 py-3 font-medium">#</th>
                    <th className="text-left px-4 py-3 font-medium">Mesero</th>
                    <th className="text-right px-4 py-3 font-medium">Ventas {PERIOD_LABELS[period]}</th>
                    <th className="text-right px-4 py-3 font-medium">Dias</th>
                    <th className="text-right px-4 py-3 font-medium">Prom/dia</th>
                    <th className="text-right px-4 py-3 font-medium">% del total</th>
                    <th className="text-right px-4 py-3 font-medium">Propinas est.</th>
                  </tr>
                </thead>
                <tbody>
                  {meseros.map((m, i) => {
                    const share = totalVentas > 0 ? m.total / totalVentas : 0
                    const estTips = tipsByMesero[m.nombre] || Math.round(totalTipsDaily * share)
                    return (
                      <tr key={m.nombre} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 text-[var(--text-4)]">{i + 1}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-[var(--text-1)]">{m.nombre}</span>
                          {/* Sales bar */}
                          <div className="mt-1 w-full h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-1)]">{formatCurrency(m.total)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{m.dias}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(m.promedio)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{Math.round(share * 100)}%</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-500 font-medium">{estTips > 0 ? formatCurrency(estTips) : '--'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--surface-2)] font-bold">
                    <td className="px-4 py-3" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(totalVentas)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{dailyData.length}d</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{dailyData.length > 0 ? formatCurrency(Math.round(totalVentas / dailyData.length)) : '--'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">100%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{formatCurrency(tipsTotal > 0 ? tipsTotal : totalTipsDaily)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}

        {/* ── PROPINAS TAB ────────────────────────────────────────── */}
        {tab === 'propinas' && (
          tips.length === 0 && totalTipsDaily === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="Sin datos de propinas"
              description="Las propinas se actualizan diario desde Wansoft. Verifica que haya datos en el periodo seleccionado."
              iconColor="text-violet-500"
              iconBg="bg-violet-500/10"
            />
          ) : (
            <div>
              {/* Daily tips summary */}
              {totalTipsDaily > 0 && (
                <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                  <div className="flex items-center gap-6 text-xs">
                    <span className="text-[var(--text-3)]">Propinas acumuladas periodo: <span className="font-bold text-emerald-500 text-sm">{formatCurrency(totalTipsDaily)}</span></span>
                    {totalVentas > 0 && (
                      <span className="text-[var(--text-3)]">% sobre ventas: <span className="font-semibold text-[var(--text-2)]">{(totalTipsDaily / totalVentas * 100).toFixed(1)}%</span></span>
                    )}
                    {dailyData.length > 0 && (
                      <span className="text-[var(--text-3)]">Prom/dia: <span className="font-semibold text-[var(--text-2)]">{formatCurrency(Math.round(totalTipsDaily / dailyData.length))}</span></span>
                    )}
                  </div>
                </div>
              )}
              {tips.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                        <th className="text-left px-4 py-3 font-medium">#</th>
                        <th className="text-left px-4 py-3 font-medium">Mesero</th>
                        <th className="text-right px-4 py-3 font-medium">Ventas</th>
                        <th className="text-right px-4 py-3 font-medium">Tickets</th>
                        <th className="text-right px-4 py-3 font-medium">Propinas</th>
                        <th className="text-right px-4 py-3 font-medium">Prom/ticket</th>
                        <th className="text-right px-4 py-3 font-medium">% propina</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tips.sort((a, b) => (b.propinas || 0) - (a.propinas || 0)).map((t, i) => (
                        <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                          <td className="px-4 py-3 text-[var(--text-4)]">{i + 1}</td>
                          <td className="px-4 py-3 font-medium text-[var(--text-1)]">{t.mesero}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(t.ventas)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{t.tickets}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-500">{formatCurrency(t.propinas)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(t.propina_promedio)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-3)]">{t.ventas > 0 ? `${(t.propinas / t.ventas * 100).toFixed(1)}%` : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--surface-2)] font-bold">
                        <td className="px-4 py-3" colSpan={2}>Total</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(tips.reduce((s, t) => s + (t.ventas || 0), 0))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{tips.reduce((s, t) => s + (t.tickets || 0), 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{formatCurrency(totalTipsToday)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">
                          {tips.reduce((s, t) => s + (t.tickets || 0), 0) > 0
                            ? formatCurrency(Math.round(totalTipsToday / tips.reduce((s, t) => s + (t.tickets || 0), 0)))
                            : '--'
                          }
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-3)]">
                          {tips.reduce((s, t) => s + (t.ventas || 0), 0) > 0
                            ? `${(totalTipsToday / tips.reduce((s, t) => s + (t.ventas || 0), 0) * 100).toFixed(1)}%`
                            : '--'
                          }
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                /* No detailed tips but we have daily aggregates — show daily propinas from wansoft_daily */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                        <th className="text-left px-4 py-3 font-medium">Fecha</th>
                        <th className="text-right px-4 py-3 font-medium">Ventas dia</th>
                        <th className="text-right px-4 py-3 font-medium">Propinas</th>
                        <th className="text-right px-4 py-3 font-medium">% propina</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dailyData].reverse().filter(d => d.propinas_total > 0).map((d, i) => (
                        <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                          <td className="px-4 py-3 font-medium text-[var(--text-1)]">{formatDateShort(d.fecha)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(d.ventas_dia)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-500">{formatCurrency(d.propinas_total)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-3)]">{d.ventas_dia > 0 ? `${(d.propinas_total / d.ventas_dia * 100).toFixed(1)}%` : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        )}

        {/* ── ASISTENCIA TAB ──────────────────────────────────────── */}
        {tab === 'asistencia' && (
          laborEntries.length === 0 && hoursWorked.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Sin datos de asistencia"
              description="La asistencia se actualiza diario desde Wansoft. Verifica que haya datos de labor/hours_worked."
              iconColor="text-amber-500"
              iconBg="bg-amber-500/10"
            />
          ) : (
            <div>
              {/* Shifts summary */}
              {shifts.length > 0 && (
                <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                  <p className="text-xs font-medium text-[var(--text-3)] mb-2">Turnos del dia</p>
                  <div className="flex flex-wrap gap-3">
                    {shifts.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="font-medium text-[var(--text-1)]">{s.nombre}</span>
                        <span className="text-[var(--text-3)]">{s.total}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Attendance summary bar */}
              <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                <div className="flex items-center gap-6 text-xs">
                  <span className="text-[var(--text-3)]">Empleados: <span className="font-semibold text-[var(--text-2)]">{new Set([...laborEntries, ...hoursWorked].map(e => e.empleado)).size}</span></span>
                  <span className="text-[var(--text-3)]">Horas totales hoy: <span className="font-semibold text-amber-500">{[...laborEntries, ...hoursWorked].reduce((s, e) => s + (e.horas || 0), 0).toFixed(1)}h</span></span>
                  {fecha && <span className="text-[var(--text-4)]">Datos de: {fecha}</span>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                      <th className="text-left px-4 py-3 font-medium">#</th>
                      <th className="text-left px-4 py-3 font-medium">Empleado</th>
                      <th className="text-left px-4 py-3 font-medium">Entrada</th>
                      <th className="text-left px-4 py-3 font-medium">Salida</th>
                      <th className="text-right px-4 py-3 font-medium">Horas</th>
                      <th className="text-center px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(laborEntries.length > 0 ? laborEntries : hoursWorked)
                      .sort((a, b) => (b.horas || 0) - (a.horas || 0))
                      .map((l, i) => {
                        const isActive = l.entrada && !l.salida
                        const isLong = l.horas > 10
                        return (
                          <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                            <td className="px-4 py-3 text-[var(--text-4)]">{i + 1}</td>
                            <td className="px-4 py-3 font-medium text-[var(--text-1)]">{l.empleado}</td>
                            <td className="px-4 py-3 text-[var(--text-2)]">
                              <span className="inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                {l.entrada || '--:--'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[var(--text-2)]">
                              {l.salida ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  {l.salida}
                                </span>
                              ) : (
                                <span className="text-[var(--text-4)]">--:--</span>
                              )}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${isLong ? 'text-amber-400' : 'text-[var(--text-1)]'}`}>
                              {l.horas > 0 ? `${l.horas}h` : '--'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  Activo
                                </span>
                              ) : l.salida ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-3)] font-medium">
                                  Finalizado
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium">
                                  Sin registro
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--surface-2)] font-bold">
                      <td className="px-4 py-3" colSpan={4}>Total</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-400">
                        {(laborEntries.length > 0 ? laborEntries : hoursWorked).reduce((s, l) => s + (l.horas || 0), 0).toFixed(1)}h
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-[var(--text-3)]">
                        {(laborEntries.length > 0 ? laborEntries : hoursWorked).filter(l => l.entrada && !l.salida).length} activos
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Multi-day attendance history if available */}
              {laborHistory.length > 1 && (
                <div className="border-t border-[var(--line-soft)]">
                  <div className="px-4 py-3 bg-[var(--surface-2)]">
                    <p className="text-xs font-medium text-[var(--text-3)]">Historial de asistencia ({laborHistory.length} dias con datos)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                          <th className="text-left px-4 py-2 font-medium text-xs">Fecha</th>
                          <th className="text-right px-4 py-2 font-medium text-xs">Empleados</th>
                          <th className="text-right px-4 py-2 font-medium text-xs">Horas totales</th>
                          <th className="text-right px-4 py-2 font-medium text-xs">Prom/persona</th>
                        </tr>
                      </thead>
                      <tbody>
                        {laborHistory.slice(0, 14).map((day, i) => {
                          const totalH = day.data.reduce((s, e) => s + (e.horas || 0), 0)
                          const count = new Set(day.data.map(e => e.empleado)).size
                          return (
                            <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] text-xs">
                              <td className="px-4 py-2 text-[var(--text-2)]">{formatDateShort(day.fecha)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-[var(--text-2)]">{count}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-medium text-amber-400">{totalH.toFixed(1)}h</td>
                              <td className="px-4 py-2 text-right tabular-nums text-[var(--text-3)]">{count > 0 ? (totalH / count).toFixed(1) : '--'}h</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </>
  )
}
