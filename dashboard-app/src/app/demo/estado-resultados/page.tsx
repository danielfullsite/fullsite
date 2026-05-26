'use client'

import Link from 'next/link'
import { ArrowLeft, TrendingUp, PieChart, DollarSign, Percent } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

// P&L for May 2026 — ~$1.02M revenue month
const PL = {
  ingresos: 1021216,
  costo_ventas: 326789,  // ~32%
  utilidad_bruta: 694427, // ~68%
  gastos_operativos: {
    nomina: 180000,
    renta: 85000,
    servicios: 25000,
    marketing: 15000,
    otros: 30000,
  },
  total_gastos_op: 335000,
  ebitda: 359427,
  depreciacion: 18000,
  intereses: 8500,
  impuestos: 99878,
  utilidad_neta: 233049,
}

type PLLine = {
  label: string
  amount: number
  pct: number
  indent?: boolean
  bold?: boolean
  color?: string
  separator?: boolean
}

function buildLines(): PLLine[] {
  const rev = PL.ingresos
  const pct = (n: number) => Number(((n / rev) * 100).toFixed(1))
  return [
    { label: 'Ingresos netos', amount: PL.ingresos, pct: 100, bold: true, color: 'text-emerald-400' },
    { label: 'Costo de ventas', amount: -PL.costo_ventas, pct: pct(PL.costo_ventas), color: 'text-red-400' },
    { label: 'Utilidad bruta', amount: PL.utilidad_bruta, pct: pct(PL.utilidad_bruta), bold: true, separator: true },
    { label: 'Nomina', amount: -PL.gastos_operativos.nomina, pct: pct(PL.gastos_operativos.nomina), indent: true },
    { label: 'Renta', amount: -PL.gastos_operativos.renta, pct: pct(PL.gastos_operativos.renta), indent: true },
    { label: 'Servicios (luz, agua, gas)', amount: -PL.gastos_operativos.servicios, pct: pct(PL.gastos_operativos.servicios), indent: true },
    { label: 'Marketing', amount: -PL.gastos_operativos.marketing, pct: pct(PL.gastos_operativos.marketing), indent: true },
    { label: 'Otros gastos', amount: -PL.gastos_operativos.otros, pct: pct(PL.gastos_operativos.otros), indent: true },
    { label: 'Total gastos operativos', amount: -PL.total_gastos_op, pct: pct(PL.total_gastos_op), bold: true, color: 'text-red-400', separator: true },
    { label: 'EBITDA', amount: PL.ebitda, pct: pct(PL.ebitda), bold: true, color: 'text-blue-400' },
    { label: 'Depreciacion', amount: -PL.depreciacion, pct: pct(PL.depreciacion), indent: true },
    { label: 'Intereses', amount: -PL.intereses, pct: pct(PL.intereses), indent: true },
    { label: 'Impuestos (ISR + IVA neto)', amount: -PL.impuestos, pct: pct(PL.impuestos), indent: true },
    { label: 'Utilidad neta', amount: PL.utilidad_neta, pct: pct(PL.utilidad_neta), bold: true, color: 'text-emerald-400', separator: true },
  ]
}

export default function DemoEstadoResultados() {
  const lines = buildLines()
  const margenNeto = ((PL.utilidad_neta / PL.ingresos) * 100).toFixed(1)
  const margenBruto = ((PL.utilidad_bruta / PL.ingresos) * 100).toFixed(1)
  const margenEbitda = ((PL.ebitda / PL.ingresos) * 100).toFixed(1)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Estado de Resultados</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Mayo 2026</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Ingresos', value: formatDemoMXN(PL.ingresos), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Margen bruto', value: `${margenBruto}%`, icon: PieChart, color: 'text-blue-400' },
            { label: 'EBITDA', value: formatDemoMXN(PL.ebitda), icon: TrendingUp, color: 'text-purple-400' },
            { label: 'Margen neto', value: `${margenNeto}%`, icon: Percent, color: 'text-emerald-400' },
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

        {/* P&L Table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold">Perdidas y Ganancias — Mayo 2026</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="text-left px-5 py-3 font-medium">Concepto</th>
                  <th className="text-right px-5 py-3 font-medium">Monto</th>
                  <th className="text-right px-5 py-3 font-medium">% de ingresos</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr
                    key={i}
                    className={`
                      ${line.separator ? 'border-t border-white/10' : 'border-b border-[var(--line)]'}
                      ${line.bold ? 'bg-white/[0.02]' : ''}
                      hover:bg-white/[0.03]
                    `}
                  >
                    <td className={`px-5 py-3 ${line.indent ? 'pl-10 text-[var(--text-2)]' : ''} ${line.bold ? 'font-semibold' : ''}`}>
                      {line.label}
                    </td>
                    <td className={`px-5 py-3 text-right font-mono ${line.bold ? 'font-semibold' : ''} ${line.color || 'text-zinc-300'}`}>
                      {line.amount < 0 ? '-' : ''}{formatDemoMXN(Math.abs(line.amount))}
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-3)]">
                      {line.pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Margin breakdown */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-4">Desglose de margenes</h2>
          <div className="space-y-4">
            {[
              { label: 'Margen bruto', pct: Number(margenBruto), color: 'from-blue-600 to-blue-400' },
              { label: 'Margen EBITDA', pct: Number(margenEbitda), color: 'from-purple-600 to-purple-400' },
              { label: 'Margen neto', pct: Number(margenNeto), color: 'from-emerald-600 to-emerald-400' },
            ].map(m => (
              <div key={m.label} className="flex items-center gap-4">
                <span className="text-sm text-[var(--text-2)] w-32 shrink-0">{m.label}</span>
                <div className="flex-1 bg-[var(--line-soft)] rounded-full h-6 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${m.color} rounded-full flex items-center justify-end pr-3`}
                    style={{ width: `${m.pct}%` }}
                  >
                    <span className="text-xs font-bold">{m.pct}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
