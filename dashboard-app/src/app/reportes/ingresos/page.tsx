'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { getMonthlyData } from '@/lib/data'
import type { WansoftDaily } from '@/lib/types'

type Period = 'dia' | 'semana' | 'mes' | 'año'

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function getWeekRange(date: Date): { start: Date; end: Date; label: string } {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const start = new Date(d.setDate(diff))
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const label = `${start.getDate()} ${MESES[start.getMonth()]} - ${end.getDate()} ${MESES[end.getMonth()]}`
  return { start, end, label }
}

function fmt(d: Date): string { return d.toISOString().slice(0, 10) }

export default function IngresosReportePage() {
  const [allData, setAllData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('mes')
  const [selectedYear, setSelectedYear] = useState(2026)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()) // 0-indexed
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() => getWeekRange(new Date()).start)
  const [selectedDay, setSelectedDay] = useState<string>(new Date().toISOString().slice(0, 10))

  // Load ALL data once (with POS fallback via getMonthlyData)
  useEffect(() => {
    getMonthlyData().then(data => {
      setAllData(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Available years
  const years = useMemo(() => {
    const yrs = new Set(allData.map(d => parseInt(d.fecha.slice(0, 4))))
    return Array.from(yrs).sort()
  }, [allData])

  // Filter data by current selection
  const { currentData, prevData, yoyData, chartData } = useMemo(() => {
    if (!allData.length) return { currentData: [], prevData: [], yoyData: [], chartData: [] }

    let current: WansoftDaily[] = []
    let prev: WansoftDaily[] = []
    let yoy: WansoftDaily[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any[] = []

    if (period === 'dia') {
      current = allData.filter(d => d.fecha === selectedDay)
      // Previous day
      const prevDate = new Date(selectedDay + 'T12:00:00')
      prevDate.setDate(prevDate.getDate() - 1)
      prev = allData.filter(d => d.fecha === fmt(prevDate))
      // Same day last year
      const yoyDate = new Date(selectedDay + 'T12:00:00')
      yoyDate.setFullYear(yoyDate.getFullYear() - 1)
      yoy = allData.filter(d => d.fecha === fmt(yoyDate))
      // Chart: last 14 days
      const start = new Date(selectedDay + 'T12:00:00')
      start.setDate(start.getDate() - 13)
      chart = allData
        .filter(d => d.fecha >= fmt(start) && d.fecha <= selectedDay)
        .map(d => ({ name: d.fecha.slice(5), ventas: d.ventas_dia || 0 }))

    } else if (period === 'semana') {
      const wEnd = new Date(selectedWeekStart)
      wEnd.setDate(wEnd.getDate() + 6)
      current = allData.filter(d => d.fecha >= fmt(selectedWeekStart) && d.fecha <= fmt(wEnd))
      // Previous week
      const prevStart = new Date(selectedWeekStart)
      prevStart.setDate(prevStart.getDate() - 7)
      const prevEnd = new Date(prevStart)
      prevEnd.setDate(prevEnd.getDate() + 6)
      prev = allData.filter(d => d.fecha >= fmt(prevStart) && d.fecha <= fmt(prevEnd))
      // Same week last year
      const yoyStart = new Date(selectedWeekStart)
      yoyStart.setFullYear(yoyStart.getFullYear() - 1)
      const yoyEnd = new Date(yoyStart)
      yoyEnd.setDate(yoyEnd.getDate() + 6)
      yoy = allData.filter(d => d.fecha >= fmt(yoyStart) && d.fecha <= fmt(yoyEnd))
      // Chart: last 10 weeks
      const weeks: { label: string; ventas: number; pct: string }[] = []
      for (let i = 9; i >= 0; i--) {
        const ws = new Date(selectedWeekStart)
        ws.setDate(ws.getDate() - i * 7)
        const we = new Date(ws)
        we.setDate(we.getDate() + 6)
        const weekData = allData.filter(d => d.fecha >= fmt(ws) && d.fecha <= fmt(we))
        const ventas = weekData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
        weeks.push({ label: `${ws.getDate()}-${we.getDate()} ${MESES[ws.getMonth()]}`, ventas, pct: '' })
      }
      // Calculate % vs current
      const currentTotal = weeks[weeks.length - 1]?.ventas || 1
      weeks.forEach(w => { w.pct = currentTotal > 0 ? `${((w.ventas / currentTotal - 1) * 100).toFixed(1)}%` : '' })
      chart = weeks

    } else if (period === 'mes') {
      const mm = String(selectedMonth + 1).padStart(2, '0')
      const prefix = `${selectedYear}-${mm}`
      current = allData.filter(d => d.fecha.startsWith(prefix))
      // Previous month
      const prevM = selectedMonth === 0 ? 11 : selectedMonth - 1
      const prevY = selectedMonth === 0 ? selectedYear - 1 : selectedYear
      const prevPrefix = `${prevY}-${String(prevM + 1).padStart(2, '0')}`
      prev = allData.filter(d => d.fecha.startsWith(prevPrefix))
      // Same month last year
      const yoyPrefix = `${selectedYear - 1}-${mm}`
      yoy = allData.filter(d => d.fecha.startsWith(yoyPrefix))
      // Chart: last 10 months
      const months: { label: string; ventas: number; pct: string }[] = []
      for (let i = 9; i >= 0; i--) {
        let mIdx = selectedMonth - i
        let yr = selectedYear
        while (mIdx < 0) { mIdx += 12; yr-- }
        const mp = `${yr}-${String(mIdx + 1).padStart(2, '0')}`
        const monthData = allData.filter(d => d.fecha.startsWith(mp))
        const ventas = monthData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
        months.push({ label: `${MESES[mIdx]} ${String(yr).slice(2)}`, ventas, pct: '' })
      }
      const currentTotal = months[months.length - 1]?.ventas || 1
      months.forEach(m => { m.pct = currentTotal > 0 ? `${((m.ventas / currentTotal - 1) * 100).toFixed(1)}%` : '' })
      chart = months

    } else if (period === 'año') {
      const prefix = `${selectedYear}`
      current = allData.filter(d => d.fecha.startsWith(prefix))
      prev = allData.filter(d => d.fecha.startsWith(`${selectedYear - 1}`))
      yoy = [] // No YoY for year view
      chart = years.map(y => {
        const yearData = allData.filter(d => d.fecha.startsWith(`${y}`))
        const ventas = yearData.reduce((s, d) => s + (d.ventas_dia || 0), 0)
        return { label: String(y), ventas, pct: '' }
      })
      const currentTotal = chart.find(c => c.label === String(selectedYear))?.ventas || 1
      chart.forEach(c => { c.pct = currentTotal > 0 ? `${((c.ventas / currentTotal - 1) * 100).toFixed(1)}%` : '' })
    }

    return { currentData: current, prevData: prev, yoyData: yoy, chartData: chart }
  }, [allData, period, selectedYear, selectedMonth, selectedWeekStart, selectedDay, years])

  // Aggregate helpers
  const sum = (data: WansoftDaily[], key: keyof WansoftDaily) => data.reduce((s, d) => s + (Number(d[key]) || 0), 0)

  const ventasNetas = sum(currentData, 'ventas_dia')
  const ventasBrutas = sum(currentData, 'ventas_brutas')
  const descuentos = sum(currentData, 'descuentos')
  const propinas = sum(currentData, 'propinas_total')
  const tickets = sum(currentData, 'tickets_count')
  const personas = sum(currentData, 'personas_restaurant')

  const prevVentas = sum(prevData, 'ventas_dia')
  const yoyVentas = sum(yoyData, 'ventas_dia')

  const pctVsPrev = prevVentas > 0 ? ((ventasNetas / prevVentas - 1) * 100) : 0
  const pctVsYoy = yoyVentas > 0 ? ((ventasNetas / yoyVentas - 1) * 100) : 0

  // Navigation
  const navigate = (dir: -1 | 1) => {
    if (period === 'dia') {
      const d = new Date(selectedDay + 'T12:00:00')
      d.setDate(d.getDate() + dir)
      setSelectedDay(fmt(d))
    } else if (period === 'semana') {
      const d = new Date(selectedWeekStart)
      d.setDate(d.getDate() + dir * 7)
      setSelectedWeekStart(d)
    } else if (period === 'mes') {
      let m = selectedMonth + dir
      let y = selectedYear
      if (m > 11) { m = 0; y++ }
      if (m < 0) { m = 11; y-- }
      setSelectedMonth(m)
      setSelectedYear(y)
    } else if (period === 'año') {
      setSelectedYear(y => y + dir)
    }
  }

  // Period label
  const periodLabel = useMemo(() => {
    if (period === 'dia') {
      const d = new Date(selectedDay + 'T12:00:00')
      const dow = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
      return `${dow[d.getDay()]} ${d.getDate()} ${MESES_FULL[d.getMonth()]} ${d.getFullYear()}`
    }
    if (period === 'semana') {
      const wr = getWeekRange(selectedWeekStart)
      return wr.label
    }
    if (period === 'mes') return `${MESES_FULL[selectedMonth]} ${selectedYear}`
    return `${selectedYear}`
  }, [period, selectedDay, selectedWeekStart, selectedMonth, selectedYear])

  const prevLabel = period === 'dia' ? 'Vs día anterior' : period === 'semana' ? 'Vs semana anterior' : period === 'mes' ? `Vs ${MESES_FULL[selectedMonth === 0 ? 11 : selectedMonth - 1]}` : `Vs ${selectedYear - 1}`
  const yoyLabel = period === 'año' ? '' : `Vs mismo ${period === 'dia' ? 'día' : period === 'semana' ? 'semana' : 'mes'} año anterior`

  return (
    <>
      <PageHeader title="Reporte de Ingresos" subtitle="Ventas por sucursal" />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Period tabs */}
          <div className="flex bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden">
            {(['dia', 'semana', 'mes', 'año'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${
                  period === p ? 'bg-blue-500 text-white' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Año'}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-lg bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center hover:bg-[var(--surface-2)]">
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-lg font-bold text-[var(--text-1)]">{periodLabel}</h2>
            <button onClick={() => navigate(1)} className="w-10 h-10 rounded-lg bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center hover:bg-[var(--surface-2)]">
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Period chips */}
          {period === 'mes' && (
            <div className="flex flex-wrap gap-2">
              {MESES.map((m, i) => (
                <button
                  key={m}
                  onClick={() => setSelectedMonth(i)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    selectedMonth === i ? 'bg-blue-500 text-white' : 'bg-[var(--surface)] text-[var(--text-2)] border border-[var(--line)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {period === 'año' && (
            <div className="flex flex-wrap gap-2">
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${
                    selectedYear === y ? 'bg-blue-500 text-white' : 'bg-[var(--surface)] text-[var(--text-2)] border border-[var(--line)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {/* Main KPI */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-6">
            <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">Ventas Netas</p>
            <div className="flex items-center justify-between">
              <p className="text-4xl font-black text-[var(--text-1)]">{formatCurrency(ventasNetas)}</p>
              <BarChart3 size={28} className="text-blue-500/30" />
            </div>

            <div className="flex gap-6 mt-3">
              {prevVentas > 0 && (
                <div>
                  <p className={`text-sm font-bold ${pctVsPrev >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {pctVsPrev >= 0 ? '+' : ''}{pctVsPrev.toFixed(1)}% ({formatCurrency(prevVentas)})
                  </p>
                  <p className="text-[10px] text-[var(--text-3)]">{prevLabel}</p>
                </div>
              )}
              {yoyVentas > 0 && yoyLabel && (
                <div>
                  <p className={`text-sm font-bold ${pctVsYoy >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {pctVsYoy >= 0 ? '+' : ''}{pctVsYoy.toFixed(1)}% ({formatCurrency(yoyVentas)})
                  </p>
                  <p className="text-[10px] text-[var(--text-3)]">{yoyLabel}</p>
                </div>
              )}
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 1 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey={chartData[0]?.label !== undefined ? 'label' : 'name'} tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    // @ts-expect-error recharts formatter type mismatch
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="ventas" stroke="#3b82f6" strokeWidth={2} fill="url(#colorVentas)" dot={{ r: 4, fill: '#3b82f6' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Resumen */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)]">
            <h3 className="px-5 py-4 text-sm font-bold text-[var(--text-1)] border-b border-[var(--line)]">Resumen</h3>
            <div className="divide-y divide-[var(--line-soft)]">
              {[
                { label: 'Ventas brutas', value: ventasBrutas },
                { label: 'Descuentos', value: descuentos, color: 'text-red-500' },
                { label: 'Ventas netas', value: ventasNetas, bold: true },
                { label: 'Propinas', value: propinas },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between px-5 py-3">
                  <span className={`text-sm ${row.bold ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>{row.label}</span>
                  <span className={`text-sm font-semibold tabular-nums ${row.color || 'text-[var(--text-1)]'}`}>{formatCurrency(row.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Tickets', value: tickets.toLocaleString() },
              { label: 'Personas', value: personas.toLocaleString() },
              { label: 'Ticket promedio', value: formatCurrency(personas > 0 ? ventasNetas / personas : 0) },
              { label: 'Pers/Orden', value: tickets > 0 ? (personas / tickets).toFixed(1) : '—' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
                <p className="text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider mb-1">{kpi.label}</p>
                <p className="text-xl font-bold text-[var(--text-1)]">{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
