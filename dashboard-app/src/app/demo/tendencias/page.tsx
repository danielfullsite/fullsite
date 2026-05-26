'use client'

import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown, BarChart3, Calendar, DollarSign } from 'lucide-react'
import {
  DEMO_RESTAURANT, DEMO_HISTORY_14, DEMO_MONTHLY, DEMO_WOW, DEMO_HISTORY,
  formatDemoMXN,
} from '@/lib/demo-data'

export default function DemoTendencias() {
  const maxVenta14 = Math.max(...DEMO_HISTORY_14.map(d => d.ventas_dia))

  // Growth: compare last 30 days vs previous 30
  const last30 = DEMO_HISTORY.slice(-30)
  const prev30 = DEMO_HISTORY.slice(-60, -30)
  const sumLast30 = last30.reduce((s, d) => s + d.ventas_dia, 0)
  const sumPrev30 = prev30.reduce((s, d) => s + d.ventas_dia, 0)
  const growthPct = sumPrev30 > 0 ? (((sumLast30 - sumPrev30) / sumPrev30) * 100).toFixed(1) : '0'
  const growthPositive = parseFloat(growthPct) >= 0

  // Best/worst day in 14 days
  const best14 = [...DEMO_HISTORY_14].sort((a, b) => b.ventas_dia - a.ventas_dia)[0]
  const worst14 = [...DEMO_HISTORY_14].sort((a, b) => a.ventas_dia - b.ventas_dia)[0]

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Tendencias</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · 90 dias de historia</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* WOW comparison */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: growthPositive ? 'linear-gradient(90deg, #10b981, #34d399)' : 'linear-gradient(90deg, #f43f5e, #fb7185)' }} />
          <h3 className="flex items-center gap-2 font-bold mb-4">
            {growthPositive ? <TrendingUp size={18} className="text-emerald-400" /> : <TrendingDown size={18} className="text-rose-400" />}
            Semana vs semana
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Ventas', thisW: DEMO_WOW.thisWeek.ventas, lastW: DEMO_WOW.lastWeek.ventas, change: DEMO_WOW.change.ventas },
              { label: 'Tickets', thisW: DEMO_WOW.thisWeek.tickets, lastW: DEMO_WOW.lastWeek.tickets, change: DEMO_WOW.change.tickets },
              { label: 'Personas', thisW: DEMO_WOW.thisWeek.personas, lastW: DEMO_WOW.lastWeek.personas, change: DEMO_WOW.change.personas },
            ].map(item => (
              <div key={item.label} className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                <p className="text-xl font-bold">{item.label === 'Ventas' ? formatDemoMXN(item.thisW) : item.thisW.toLocaleString()}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs font-semibold ${item.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {item.change >= 0 ? '+' : ''}{item.change}%
                  </span>
                  <span className="text-xs text-zinc-600">vs {item.label === 'Ventas' ? formatDemoMXN(item.lastW) : item.lastW.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Growth + best/worst */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={18} className="text-emerald-400" />
            </div>
            <p className={`text-3xl font-bold ${growthPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {growthPositive ? '+' : ''}{growthPct}%
            </p>
            <p className="text-xs text-zinc-500 mt-1">Crecimiento mensual</p>
            <p className="text-xs text-zinc-600 mt-0.5">{formatDemoMXN(sumLast30)} vs {formatDemoMXN(sumPrev30)}</p>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={18} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold text-emerald-400">{formatDemoMXN(best14.ventas_dia)}</p>
            <p className="text-xs text-zinc-500 mt-1">Mejor dia (14d)</p>
            <p className="text-xs text-zinc-600 mt-0.5">{best14.fecha}</p>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={18} className="text-rose-400" />
            </div>
            <p className="text-xl font-bold text-rose-400">{formatDemoMXN(worst14.ventas_dia)}</p>
            <p className="text-xs text-zinc-500 mt-1">Dia mas bajo (14d)</p>
            <p className="text-xs text-zinc-600 mt-0.5">{worst14.fecha}</p>
          </div>
        </div>

        {/* 14-day trend chart */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-1">
            <BarChart3 size={18} className="text-emerald-400" /> Tendencia 14 dias
          </h3>
          <p className="text-xs text-zinc-500 mb-4">
            Semana actual vs anterior: <span className={`font-bold ${DEMO_WOW.change.ventas >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>+{DEMO_WOW.change.ventas}%</span>
          </p>
          <div className="flex items-end gap-1.5 h-40">
            {DEMO_HISTORY_14.map((d, i) => {
              const height = (d.ventas_dia / maxVenta14) * 100
              const isToday = i === DEMO_HISTORY_14.length - 1
              const isWeekend = [0, 6].includes(new Date(d.fecha + 'T12:00:00').getDay())
              return (
                <div key={d.fecha} className="flex-1 flex flex-col items-center gap-1" title={`${d.fecha}: ${formatDemoMXN(d.ventas_dia)}`}>
                  <div
                    className={`w-full rounded-t-md ${isToday ? 'bg-emerald-500' : isWeekend ? 'bg-purple-500/40' : 'bg-white/10'}`}
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-zinc-600">{d.fecha.slice(8)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-white/10 rounded" /> L-V</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500/40 rounded" /> S-D</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded" /> Hoy</span>
          </div>
        </div>

        {/* Monthly summary */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Calendar size={18} className="text-amber-400" /> Resumen mensual
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {DEMO_MONTHLY.map((m, i) => {
              const prevMonth = i > 0 ? DEMO_MONTHLY[i - 1] : null
              const mGrowth = prevMonth ? (((m.ventas - prevMonth.ventas) / prevMonth.ventas) * 100).toFixed(1) : null
              return (
                <div key={m.month} className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">{m.month}</p>
                  <p className="text-xl font-bold text-emerald-400">{formatDemoMXN(m.ventas)}</p>
                  <div className="flex justify-between text-xs text-zinc-500 mt-2">
                    <span>{m.dias} dias</span>
                    <span>TP: {formatDemoMXN(m.ticketPromedio)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-zinc-600">Prom/dia: {formatDemoMXN(m.promedioDia)}</span>
                    {mGrowth && (
                      <span className={`font-semibold ${parseFloat(mGrowth) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {parseFloat(mGrowth) >= 0 ? '+' : ''}{mGrowth}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-zinc-600">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
        </div>
      </div>
    </div>
  )
}
