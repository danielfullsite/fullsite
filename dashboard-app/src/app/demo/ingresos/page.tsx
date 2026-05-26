'use client'

import Link from 'next/link'
import { ArrowLeft, TrendingUp, DollarSign, BarChart3, Percent } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const MESES = [
  {
    mes: 'Marzo 2026',
    ventas_brutas: 980500,
    descuentos: 29400,
    ventas_netas: 951100,
    propinas: 142665,
    total_ingresos: 1093765,
  },
  {
    mes: 'Abril 2026',
    ventas_brutas: 1012000,
    descuentos: 30360,
    ventas_netas: 981640,
    propinas: 147246,
    total_ingresos: 1128886,
  },
  {
    mes: 'Mayo 2026',
    ventas_brutas: 1052800,
    descuentos: 31584,
    ventas_netas: 1021216,
    propinas: 153182,
    total_ingresos: 1174398,
  },
]

export default function DemoIngresos() {
  const totalTrimestre = MESES.reduce((s, m) => s + m.total_ingresos, 0)
  const totalVentasNetas = MESES.reduce((s, m) => s + m.ventas_netas, 0)
  const promedioMensual = Math.round(totalTrimestre / MESES.length)
  const growth = ((MESES[2].ventas_netas - MESES[0].ventas_netas) / MESES[0].ventas_netas * 100).toFixed(1)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Ingresos</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Trimestre Mar-May 2026</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total trimestre', value: formatDemoMXN(totalTrimestre), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Promedio mensual', value: formatDemoMXN(promedioMensual), icon: BarChart3, color: 'text-blue-400' },
            { label: 'Ventas netas trimestre', value: formatDemoMXN(totalVentasNetas), icon: TrendingUp, color: 'text-purple-400' },
            { label: 'Crecimiento trimestre', value: `+${growth}%`, icon: Percent, color: 'text-emerald-400' },
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

        {/* Monthly income table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold">Ingresos mensuales</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="text-left px-5 py-3 font-medium">Mes</th>
                  <th className="text-right px-5 py-3 font-medium">Ventas brutas</th>
                  <th className="text-right px-5 py-3 font-medium">Descuentos</th>
                  <th className="text-right px-5 py-3 font-medium">Ventas netas</th>
                  <th className="text-right px-5 py-3 font-medium">Propinas</th>
                  <th className="text-right px-5 py-3 font-medium">Total ingresos</th>
                </tr>
              </thead>
              <tbody>
                {MESES.map((m, i) => (
                  <tr key={m.mes} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium">{m.mes}</td>
                    <td className="px-5 py-3 text-right text-zinc-300">{formatDemoMXN(m.ventas_brutas)}</td>
                    <td className="px-5 py-3 text-right text-red-400">-{formatDemoMXN(m.descuentos)}</td>
                    <td className="px-5 py-3 text-right font-medium">{formatDemoMXN(m.ventas_netas)}</td>
                    <td className="px-5 py-3 text-right text-[var(--text-2)]">{formatDemoMXN(m.propinas)}</td>
                    <td className="px-5 py-3 text-right font-bold text-emerald-400">{formatDemoMXN(m.total_ingresos)}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-white/[0.03] font-semibold">
                  <td className="px-5 py-3">Total trimestre</td>
                  <td className="px-5 py-3 text-right">{formatDemoMXN(MESES.reduce((s, m) => s + m.ventas_brutas, 0))}</td>
                  <td className="px-5 py-3 text-right text-red-400">-{formatDemoMXN(MESES.reduce((s, m) => s + m.descuentos, 0))}</td>
                  <td className="px-5 py-3 text-right">{formatDemoMXN(totalVentasNetas)}</td>
                  <td className="px-5 py-3 text-right">{formatDemoMXN(MESES.reduce((s, m) => s + m.propinas, 0))}</td>
                  <td className="px-5 py-3 text-right text-emerald-400">{formatDemoMXN(totalTrimestre)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Growth bar */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-4">Crecimiento ventas netas</h2>
          <div className="space-y-3">
            {MESES.map((m) => {
              const pct = (m.ventas_netas / MESES[2].ventas_netas) * 100
              return (
                <div key={m.mes} className="flex items-center gap-4">
                  <span className="text-sm text-[var(--text-2)] w-28 shrink-0">{m.mes}</span>
                  <div className="flex-1 bg-[var(--line-soft)] rounded-full h-6 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full flex items-center justify-end pr-3"
                      style={{ width: `${pct}%` }}
                    >
                      <span className="text-xs font-bold">{formatDemoMXN(m.ventas_netas)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
