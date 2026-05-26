'use client'

import Link from 'next/link'
import { ArrowLeft, DollarSign, Heart, Users, Receipt } from 'lucide-react'
import { DEMO_RESTAURANT, DEMO_MESEROS, DEMO_KPIS, formatDemoMXN } from '@/lib/demo-data'

export default function DemoPropinas() {
  const totalPropinas = DEMO_MESEROS.reduce((s, m) => s + m.propinas, 0)
  const totalVentas = DEMO_MESEROS.reduce((s, m) => s + m.total, 0)
  const totalTickets = DEMO_MESEROS.reduce((s, m) => s + m.tickets, 0)
  const pctPropinaGlobal = ((totalPropinas / totalVentas) * 100).toFixed(1)
  const propinaPorTicket = Math.round(totalPropinas / totalTickets)
  const sorted = [...DEMO_MESEROS].sort((a, b) => b.propinas - a.propinas)
  const maxPropina = sorted[0].propinas

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Propinas</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Hoy</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total propinas', value: formatDemoMXN(totalPropinas), icon: Heart, color: 'text-emerald-400' },
            { label: '% propina global', value: `${pctPropinaGlobal}%`, icon: DollarSign, color: 'text-purple-400' },
            { label: 'Propina/ticket', value: formatDemoMXN(propinaPorTicket), icon: Receipt, color: 'text-blue-400' },
            { label: 'Meseros activos', value: DEMO_MESEROS.length.toString(), icon: Users, color: 'text-amber-400' },
          ].map(card => (
            <div key={card.label} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <card.icon size={18} className={card.color} />
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-zinc-500 mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Heart size={18} className="text-emerald-400" /> Propinas por mesero
          </h3>
          <div className="space-y-3">
            {sorted.map((m, i) => {
              const pct = (m.propinas / maxPropina) * 100
              const pctPropina = m.total > 0 ? ((m.propinas / m.total) * 100).toFixed(1) : '0'
              return (
                <div key={m.nombre} className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500 w-6 text-right">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">{m.nombre}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500">{pctPropina}%</span>
                        <span className="text-sm font-bold text-emerald-400">{formatDemoMXN(m.propinas)}</span>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-white/5 rounded-full">
                      <div
                        className="h-2.5 rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: i < 3 ? '#10b981' : 'rgba(255,255,255,0.08)',
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
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 overflow-x-auto">
          <h3 className="font-bold mb-4">Detalle por mesero</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-white/5">
                <th className="text-left py-3 pr-4">Mesero</th>
                <th className="text-right py-3 pr-4">Propinas</th>
                <th className="text-right py-3 pr-4">% Propina</th>
                <th className="text-right py-3 pr-4">Ventas</th>
                <th className="text-right py-3 pr-4">Tickets</th>
                <th className="text-right py-3">Propina/Ticket</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(m => {
                const pctP = m.total > 0 ? ((m.propinas / m.total) * 100).toFixed(1) : '0'
                const propTicket = m.tickets > 0 ? Math.round(m.propinas / m.tickets) : 0
                const isHigh = parseFloat(pctP) >= 18
                return (
                  <tr key={m.nombre} className="border-b border-white/5 last:border-0">
                    <td className="py-3 pr-4 font-medium">{m.nombre}</td>
                    <td className="py-3 pr-4 text-right font-bold text-emerald-400">{formatDemoMXN(m.propinas)}</td>
                    <td className={`py-3 pr-4 text-right font-semibold ${isHigh ? 'text-emerald-400' : 'text-zinc-400'}`}>{pctP}%</td>
                    <td className="py-3 pr-4 text-right text-zinc-400">{formatDemoMXN(m.total)}</td>
                    <td className="py-3 pr-4 text-right text-zinc-400">{m.tickets}</td>
                    <td className="py-3 text-right text-zinc-400">{formatDemoMXN(propTicket)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-bold">
                <td className="py-3 pr-4">Total</td>
                <td className="py-3 pr-4 text-right text-emerald-400">{formatDemoMXN(totalPropinas)}</td>
                <td className="py-3 pr-4 text-right">{pctPropinaGlobal}%</td>
                <td className="py-3 pr-4 text-right">{formatDemoMXN(totalVentas)}</td>
                <td className="py-3 pr-4 text-right">{totalTickets}</td>
                <td className="py-3 text-right">{formatDemoMXN(propinaPorTicket)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-zinc-600">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
        </div>
      </div>
    </div>
  )
}
