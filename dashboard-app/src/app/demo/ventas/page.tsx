'use client'

import Link from 'next/link'
import { ArrowLeft, DollarSign, CreditCard, BarChart3, Receipt, TrendingUp } from 'lucide-react'
import {
  DEMO_RESTAURANT, DEMO_HISTORY_14, DEMO_PAGOS, DEMO_GRUPOS, DEMO_KPIS,
  formatDemoMXN,
} from '@/lib/demo-data'

const CARD_STYLE = { background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' } as const
const MONO = { fontFamily: 'var(--font-mono)' } as const

export default function DemoVentas() {
  const totalVentas14 = DEMO_HISTORY_14.reduce((s, d) => s + d.ventas_dia, 0)
  const totalTickets14 = DEMO_HISTORY_14.reduce((s, d) => s + d.tickets_count, 0)
  const promDia = Math.round(totalVentas14 / DEMO_HISTORY_14.length)
  const totalPagos = DEMO_PAGOS.reduce((s, p) => s + p.total, 0)
  const totalGrupos = DEMO_GRUPOS.reduce((s, g) => s + g.total, 0)
  const maxGrupo = DEMO_GRUPOS[0].total

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Ventas</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Ultimos 14 dias</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Ventas hoy', value: formatDemoMXN(DEMO_KPIS.ventas_dia), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Total 14 dias', value: formatDemoMXN(totalVentas14), icon: TrendingUp, color: 'text-blue-400' },
            { label: 'Promedio/dia', value: formatDemoMXN(promDia), icon: BarChart3, color: 'text-purple-400' },
            { label: 'Tickets 14 dias', value: totalTickets14.toLocaleString(), icon: Receipt, color: 'text-amber-400' },
          ].map(card => (
            <div key={card.label} className="border border-[var(--line)] rounded-2xl p-5" style={CARD_STYLE}>
              <div className="flex items-center gap-2 mb-3">
                <card.icon size={18} className={card.color} />
              </div>
              <p className="text-2xl font-bold tabular-nums" style={MONO}>{card.value}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        {/* 14-day sales table */}
        <div className="border border-[var(--line)] rounded-2xl p-5 overflow-x-auto" style={CARD_STYLE}>
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <DollarSign size={18} className="text-emerald-400" /> Ventas diarias (14 dias)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-3)] text-xs uppercase border-b border-[var(--line)]" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.12em' }}>
                <th className="text-left py-3 pr-4">Fecha</th>
                <th className="text-left py-3 pr-4">Dia</th>
                <th className="text-right py-3 pr-4">Ventas</th>
                <th className="text-right py-3 pr-4">Tickets</th>
                <th className="text-right py-3">Ticket Promedio</th>
              </tr>
            </thead>
            <tbody>
              {[...DEMO_HISTORY_14].reverse().map((d, i) => {
                const dow = new Date(d.fecha + 'T12:00:00').getDay()
                const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']
                const dayName = dayNames[dow]
                const isWeekend = dow === 0 || dow === 6
                const tp = d.tickets_count > 0 ? Math.round(d.ventas_dia / d.tickets_count) : 0
                return (
                  <tr key={d.fecha} className={`border-b border-[var(--line)] last:border-0 ${isWeekend ? 'bg-purple-500/5' : ''}`}>
                    <td className="py-3 pr-4 text-[var(--text-2)] tabular-nums" style={MONO}>{d.fecha}</td>
                    <td className={`py-3 pr-4 ${isWeekend ? 'text-purple-400 font-medium' : 'text-[var(--text-3)]'}`}>{dayName}</td>
                    <td className="py-3 pr-4 text-right font-bold text-emerald-400 tabular-nums" style={MONO}>{formatDemoMXN(d.ventas_dia)}</td>
                    <td className="py-3 pr-4 text-right text-[var(--text-2)] tabular-nums" style={MONO}>{d.tickets_count}</td>
                    <td className="py-3 text-right text-[var(--text-2)] tabular-nums" style={MONO}>{formatDemoMXN(tp)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Payment methods */}
          <div className="border border-[var(--line)] rounded-2xl p-5" style={CARD_STYLE}>
            <h3 className="flex items-center gap-2 font-bold mb-4">
              <CreditCard size={18} className="text-blue-400" /> Metodos de pago
            </h3>
            <div className="space-y-4">
              {DEMO_PAGOS.map(p => {
                const pct = (p.total / totalPagos) * 100
                return (
                  <div key={p.nombre}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-[var(--text-2)]">{p.nombre}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--text-4)] tabular-nums" style={MONO}>{pct.toFixed(1)}%</span>
                        <span className="font-bold tabular-nums" style={MONO}>{formatDemoMXN(p.total)}</span>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-[var(--line-soft)] rounded-full">
                      <div className="h-2.5 bg-blue-500/50 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--line)] flex justify-between">
              <span className="text-sm text-[var(--text-3)]">Total</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums" style={MONO}>{formatDemoMXN(totalPagos)}</span>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="border border-[var(--line)] rounded-2xl p-5" style={CARD_STYLE}>
            <h3 className="flex items-center gap-2 font-bold mb-4">
              <BarChart3 size={18} className="text-purple-400" /> Categorias
            </h3>
            <div className="space-y-3">
              {DEMO_GRUPOS.map(g => {
                const pct = (g.total / maxGrupo) * 100
                return (
                  <div key={g.nombre}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-[var(--text-2)]">{g.nombre}</span>
                      <span className="font-semibold tabular-nums" style={MONO}>{formatDemoMXN(g.total)}</span>
                    </div>
                    <div className="w-full h-2 bg-[var(--line-soft)] rounded-full">
                      <div className="h-2 bg-purple-500/40 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--line)] flex justify-between">
              <span className="text-sm text-[var(--text-3)]">Total</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums" style={MONO}>{formatDemoMXN(totalGrupos)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-[var(--text-4)]">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
        </div>
      </div>
    </div>
  )
}
