'use client'

import Link from 'next/link'
import { ArrowLeft, Wallet, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const CORTES = [
  { fecha: '2026-05-25', turno: 'Vespertino', fondo_inicial: 5000, efectivo_contado: 18420, esperado: 18350, cerrado_por: 'Alejandro Treviño', status: 'cerrado' },
  { fecha: '2026-05-25', turno: 'Matutino', fondo_inicial: 5000, efectivo_contado: 12780, esperado: 12830, cerrado_por: 'Sofía Garza', status: 'cerrado' },
  { fecha: '2026-05-24', turno: 'Vespertino', fondo_inicial: 5000, efectivo_contado: 19100, esperado: 18870, cerrado_por: 'Alejandro Treviño', status: 'cerrado' },
  { fecha: '2026-05-24', turno: 'Matutino', fondo_inicial: 5000, efectivo_contado: 11950, esperado: 11960, cerrado_por: 'Diego Cantú', status: 'cerrado' },
  { fecha: '2026-05-23', turno: 'Vespertino', fondo_inicial: 5000, efectivo_contado: 17600, esperado: 17850, cerrado_por: 'Valeria Lozano', status: 'cerrado' },
  { fecha: '2026-05-23', turno: 'Matutino', fondo_inicial: 5000, efectivo_contado: 10200, esperado: 10180, cerrado_por: 'Sofía Garza', status: 'cerrado' },
  { fecha: '2026-05-22', turno: 'Vespertino', fondo_inicial: 5000, efectivo_contado: 16340, esperado: 16290, cerrado_por: 'Emilio Salinas', status: 'cerrado' },
]

function getDiferencia(corte: typeof CORTES[0]) {
  return corte.efectivo_contado - corte.esperado
}

function getDiferenciaColor(diff: number) {
  const abs = Math.abs(diff)
  if (abs <= 50) return 'text-emerald-400'
  if (abs <= 200) return 'text-yellow-400'
  return 'text-red-400'
}

function getDiferenciaBg(diff: number) {
  const abs = Math.abs(diff)
  if (abs <= 50) return 'bg-emerald-400/10'
  if (abs <= 200) return 'bg-yellow-400/10'
  return 'bg-red-400/10'
}

export default function DemoCortes() {
  const diferencias = CORTES.map(c => getDiferencia(c))
  const totalDiferencia = diferencias.reduce((s, d) => s + d, 0)
  const promedioFondo = CORTES.reduce((s, c) => s + c.fondo_inicial, 0) / CORTES.length
  const cortesOk = diferencias.filter(d => Math.abs(d) <= 50).length
  const cortesAlerta = diferencias.filter(d => Math.abs(d) > 200).length

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Cortes de Caja</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Ultimos 7 cortes</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total diferencias', value: (totalDiferencia >= 0 ? '+' : '') + formatDemoMXN(totalDiferencia), icon: Wallet, color: getDiferenciaColor(totalDiferencia) },
            { label: 'Promedio fondo', value: formatDemoMXN(promedioFondo), icon: Clock, color: 'text-blue-400' },
            { label: 'Cortes sin diferencia', value: `${cortesOk} / ${CORTES.length}`, icon: CheckCircle, color: 'text-emerald-400' },
            { label: 'Cortes con alerta', value: `${cortesAlerta}`, icon: AlertTriangle, color: cortesAlerta > 0 ? 'text-red-400' : 'text-emerald-400' },
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

        {/* Table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold">Detalle de cortes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="text-left px-5 py-3 font-medium">Fecha</th>
                  <th className="text-left px-5 py-3 font-medium">Turno</th>
                  <th className="text-right px-5 py-3 font-medium">Fondo inicial</th>
                  <th className="text-right px-5 py-3 font-medium">Efectivo contado</th>
                  <th className="text-right px-5 py-3 font-medium">Esperado</th>
                  <th className="text-right px-5 py-3 font-medium">Diferencia</th>
                  <th className="text-left px-5 py-3 font-medium">Cerrado por</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {CORTES.map((corte, i) => {
                  const diff = getDiferencia(corte)
                  return (
                    <tr key={i} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-mono text-zinc-300">{corte.fecha}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${corte.turno === 'Matutino' ? 'bg-amber-400/10 text-amber-400' : 'bg-indigo-400/10 text-indigo-400'}`}>
                          {corte.turno}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-[var(--text-2)]">{formatDemoMXN(corte.fondo_inicial)}</td>
                      <td className="px-5 py-3 text-right font-medium">{formatDemoMXN(corte.efectivo_contado)}</td>
                      <td className="px-5 py-3 text-right text-[var(--text-2)]">{formatDemoMXN(corte.esperado)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getDiferenciaBg(diff)} ${getDiferenciaColor(diff)}`}>
                          {diff >= 0 ? '+' : ''}{formatDemoMXN(diff)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-300">{corte.cerrado_por}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400">
                          {corte.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
