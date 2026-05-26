'use client'

import Link from 'next/link'
import { ArrowLeft, ChefHat, DollarSign, Hash } from 'lucide-react'
import { DEMO_RESTAURANT, DEMO_PLATILLOS, formatDemoMXN } from '@/lib/demo-data'

export default function DemoPlatillos() {
  const sorted = [...DEMO_PLATILLOS].sort((a, b) => b.total - a.total)
  const totalVentas = sorted.reduce((s, p) => s + p.total, 0)
  const totalCantidad = sorted.reduce((s, p) => s + p.cantidad, 0)
  const maxTotal = sorted[0].total

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Platillos</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Hoy</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total ventas platillos', value: formatDemoMXN(totalVentas), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Unidades vendidas', value: totalCantidad.toString(), icon: Hash, color: 'text-blue-400' },
            { label: 'Platillos activos', value: sorted.length.toString(), icon: ChefHat, color: 'text-orange-400' },
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
            <ChefHat size={18} className="text-orange-400" /> Ventas por platillo
          </h3>
          <div className="space-y-2.5">
            {sorted.map((p, i) => {
              const pct = (p.total / maxTotal) * 100
              return (
                <div key={p.nombre} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-3)] w-6 text-right">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">{p.nombre}</span>
                      <span className="text-sm font-bold text-emerald-400">{formatDemoMXN(p.total)}</span>
                    </div>
                    <div className="w-full h-2 bg-[var(--line-soft)] rounded-full">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: i < 3 ? '#f97316' : i < 6 ? '#fb923c' : 'rgba(255,255,255,0.08)',
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
          <h3 className="font-bold mb-4">Detalle completo</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-3)] text-xs uppercase tracking-wider border-b border-[var(--line)]">
                <th className="text-left py-3 pr-4">Rank</th>
                <th className="text-left py-3 pr-4">Platillo</th>
                <th className="text-right py-3 pr-4">Cantidad</th>
                <th className="text-right py-3 pr-4">Total ventas</th>
                <th className="text-right py-3 pr-4">Precio unitario</th>
                <th className="text-right py-3">% del total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const precioUnit = p.cantidad > 0 ? Math.round(p.total / p.cantidad) : 0
                const pctTotal = ((p.total / totalVentas) * 100).toFixed(1)
                return (
                  <tr key={p.nombre} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-3 pr-4">
                      <span className={`font-bold ${i < 3 ? 'text-orange-400' : 'text-[var(--text-3)]'}`}>{i + 1}</span>
                    </td>
                    <td className="py-3 pr-4 font-medium">{p.nombre}</td>
                    <td className="py-3 pr-4 text-right text-[var(--text-2)]">{p.cantidad}</td>
                    <td className="py-3 pr-4 text-right font-bold text-emerald-400">{formatDemoMXN(p.total)}</td>
                    <td className="py-3 pr-4 text-right text-[var(--text-2)]">{formatDemoMXN(precioUnit)}</td>
                    <td className="py-3 text-right text-[var(--text-3)]">{pctTotal}%</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-bold">
                <td className="py-3 pr-4" colSpan={2}>Total</td>
                <td className="py-3 pr-4 text-right">{totalCantidad}</td>
                <td className="py-3 pr-4 text-right text-emerald-400">{formatDemoMXN(totalVentas)}</td>
                <td className="py-3 pr-4 text-right text-[var(--text-3)]">-</td>
                <td className="py-3 text-right">100%</td>
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
