'use client'

import Link from 'next/link'
import { ArrowLeft, Trophy, Users, DollarSign, Receipt } from 'lucide-react'
import { DEMO_RESTAURANT, DEMO_MESEROS, formatDemoMXN } from '@/lib/demo-data'

export default function DemoMeseros() {
  const totalVentas = DEMO_MESEROS.reduce((s, m) => s + m.total, 0)
  const totalTickets = DEMO_MESEROS.reduce((s, m) => s + m.tickets, 0)
  const totalPropinas = DEMO_MESEROS.reduce((s, m) => s + m.propinas, 0)
  const totalPersonas = DEMO_MESEROS.reduce((s, m) => s + m.personas, 0)
  const promedioPorMesero = Math.round(totalVentas / DEMO_MESEROS.length)
  const maxVenta = DEMO_MESEROS[0].total

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Meseros</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Hoy</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Ventas del equipo', value: formatDemoMXN(totalVentas), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Promedio por mesero', value: formatDemoMXN(promedioPorMesero), icon: Trophy, color: 'text-amber-400' },
            { label: 'Total tickets', value: totalTickets.toString(), icon: Receipt, color: 'text-blue-400' },
            { label: 'Total personas', value: totalPersonas.toString(), icon: Users, color: 'text-purple-400' },
          ].map(card => (
            <div key={card.label} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <card.icon size={18} className={card.color} />
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Trophy size={18} className="text-amber-400" /> Ventas por mesero
          </h3>
          <div className="space-y-3">
            {DEMO_MESEROS.map((m, i) => {
              const pct = (m.total / maxVenta) * 100
              return (
                <div key={m.nombre} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-3)] w-6 text-right">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">{m.nombre}</span>
                      <span className="text-sm font-bold text-emerald-400">{formatDemoMXN(m.total)}</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--line-soft)] rounded-full">
                      <div
                        className="h-3 rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: i === 0 ? '#10b981' : i === 1 ? '#34d399' : i === 2 ? '#6ee7b7' : 'rgba(255,255,255,0.1)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Full table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5 overflow-x-auto">
          <h3 className="font-bold mb-4">Ranking detallado</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-3)] text-xs uppercase tracking-wider border-b border-[var(--line)]">
                <th className="text-left py-3 pr-4">Rank</th>
                <th className="text-left py-3 pr-4">Nombre</th>
                <th className="text-right py-3 pr-4">Ventas</th>
                <th className="text-right py-3 pr-4">Tickets</th>
                <th className="text-right py-3 pr-4">Ticket Promedio</th>
                <th className="text-right py-3 pr-4">Propinas</th>
                <th className="text-right py-3">Personas</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_MESEROS.map((m, i) => {
                const tp = m.tickets > 0 ? Math.round(m.total / m.tickets) : 0
                return (
                  <tr key={m.nombre} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-3 pr-4">
                      <span className={`font-bold ${i < 3 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>{i + 1}</span>
                    </td>
                    <td className="py-3 pr-4 font-medium">{m.nombre}</td>
                    <td className="py-3 pr-4 text-right font-bold text-emerald-400">{formatDemoMXN(m.total)}</td>
                    <td className="py-3 pr-4 text-right text-[var(--text-2)]">{m.tickets}</td>
                    <td className="py-3 pr-4 text-right text-[var(--text-2)]">{formatDemoMXN(tp)}</td>
                    <td className="py-3 pr-4 text-right text-emerald-400/70">{formatDemoMXN(m.propinas)}</td>
                    <td className="py-3 text-right text-[var(--text-2)]">{m.personas}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-bold">
                <td className="py-3 pr-4" colSpan={2}>Total</td>
                <td className="py-3 pr-4 text-right text-emerald-400">{formatDemoMXN(totalVentas)}</td>
                <td className="py-3 pr-4 text-right">{totalTickets}</td>
                <td className="py-3 pr-4 text-right">{formatDemoMXN(Math.round(totalVentas / totalTickets))}</td>
                <td className="py-3 pr-4 text-right text-emerald-400/70">{formatDemoMXN(totalPropinas)}</td>
                <td className="py-3 text-right">{totalPersonas}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-[var(--text-4)]">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
        </div>
      </div>
    </div>
  )
}
