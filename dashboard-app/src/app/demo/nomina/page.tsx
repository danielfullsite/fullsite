'use client'

import Link from 'next/link'
import { ArrowLeft, Users, DollarSign, Clock, Briefcase } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const STAFF = [
  { nombre: 'Alejandro Treviño', puesto: 'Gerente', sueldo_base: 28000, propinas: 0, horas_semana: 48, antiguedad: '3 anios' },
  { nombre: 'Sofía Garza', puesto: 'Mesero', sueldo_base: 9500, propinas: 8200, horas_semana: 44, antiguedad: '2 anios' },
  { nombre: 'Diego Cantú', puesto: 'Mesero', sueldo_base: 9500, propinas: 7100, horas_semana: 44, antiguedad: '1.5 anios' },
  { nombre: 'Valeria Lozano', puesto: 'Mesero', sueldo_base: 9000, propinas: 6400, horas_semana: 40, antiguedad: '1 anio' },
  { nombre: 'Emilio Salinas', puesto: 'Mesero', sueldo_base: 8500, propinas: 5800, horas_semana: 40, antiguedad: '8 meses' },
  { nombre: 'Roberto Villarreal', puesto: 'Chef ejecutivo', sueldo_base: 25000, propinas: 0, horas_semana: 50, antiguedad: '4 anios' },
  { nombre: 'Ana Lucia Medina', puesto: 'Cocinero', sueldo_base: 13000, propinas: 0, horas_semana: 48, antiguedad: '2 anios' },
  { nombre: 'Carlos Elizondo', puesto: 'Cocinero', sueldo_base: 12000, propinas: 0, horas_semana: 48, antiguedad: '1 anio' },
  { nombre: 'Mariana Trevino', puesto: 'Barista', sueldo_base: 10500, propinas: 3200, horas_semana: 40, antiguedad: '1.5 anios' },
  { nombre: 'Fernanda Rios', puesto: 'Barista', sueldo_base: 10000, propinas: 2800, horas_semana: 40, antiguedad: '10 meses' },
  { nombre: 'Isabella Flores', puesto: 'Hostess', sueldo_base: 9000, propinas: 1200, horas_semana: 36, antiguedad: '6 meses' },
  { nombre: 'Camila Ruiz', puesto: 'Mesero', sueldo_base: 8500, propinas: 4800, horas_semana: 40, antiguedad: '4 meses' },
]

const PUESTO_COLORS: Record<string, string> = {
  'Gerente': 'bg-purple-400/10 text-purple-400',
  'Chef ejecutivo': 'bg-red-400/10 text-red-400',
  'Cocinero': 'bg-orange-400/10 text-orange-400',
  'Mesero': 'bg-blue-400/10 text-blue-400',
  'Barista': 'bg-amber-400/10 text-amber-400',
  'Hostess': 'bg-pink-400/10 text-pink-400',
}

export default function DemoNomina() {
  const totalNomina = STAFF.reduce((s, e) => s + e.sueldo_base, 0)
  const totalPropinas = STAFF.reduce((s, e) => s + e.propinas, 0)
  const totalComp = totalNomina + totalPropinas
  const headcount = STAFF.length
  const costoPromedio = Math.round(totalNomina / headcount)

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Nomina</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Mayo 2026</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total nomina mensual', value: formatDemoMXN(totalNomina), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Headcount', value: headcount.toString(), icon: Users, color: 'text-blue-400' },
            { label: 'Costo promedio/empleado', value: formatDemoMXN(costoPromedio), icon: Briefcase, color: 'text-purple-400' },
            { label: 'Total compensacion', value: formatDemoMXN(totalComp), icon: Clock, color: 'text-amber-400' },
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

        {/* Staff table */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <h2 className="text-sm font-semibold">Detalle de empleados</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-zinc-500">
                  <th className="text-left px-5 py-3 font-medium">Nombre</th>
                  <th className="text-left px-5 py-3 font-medium">Puesto</th>
                  <th className="text-right px-5 py-3 font-medium">Sueldo base</th>
                  <th className="text-right px-5 py-3 font-medium">Propinas</th>
                  <th className="text-right px-5 py-3 font-medium">Total comp.</th>
                  <th className="text-center px-5 py-3 font-medium">Hrs/semana</th>
                  <th className="text-left px-5 py-3 font-medium">Antiguedad</th>
                </tr>
              </thead>
              <tbody>
                {STAFF.map((e, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium">{e.nombre}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${PUESTO_COLORS[e.puesto] || 'bg-zinc-400/10 text-zinc-400'}`}>
                        {e.puesto}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono">{formatDemoMXN(e.sueldo_base)}</td>
                    <td className="px-5 py-3 text-right font-mono text-zinc-400">
                      {e.propinas > 0 ? formatDemoMXN(e.propinas) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-emerald-400">
                      {formatDemoMXN(e.sueldo_base + e.propinas)}
                    </td>
                    <td className="px-5 py-3 text-center text-zinc-400">{e.horas_semana}</td>
                    <td className="px-5 py-3 text-zinc-400">{e.antiguedad}</td>
                  </tr>
                ))}
                {/* Totals */}
                <tr className="bg-white/[0.03] font-semibold">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3">{headcount} empleados</td>
                  <td className="px-5 py-3 text-right font-mono">{formatDemoMXN(totalNomina)}</td>
                  <td className="px-5 py-3 text-right font-mono">{formatDemoMXN(totalPropinas)}</td>
                  <td className="px-5 py-3 text-right font-mono text-emerald-400">{formatDemoMXN(totalComp)}</td>
                  <td className="px-5 py-3"></td>
                  <td className="px-5 py-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Breakdown by role */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-4">Nomina por puesto</h2>
          <div className="space-y-3">
            {Object.entries(
              STAFF.reduce<Record<string, { count: number; total: number }>>((acc, e) => {
                if (!acc[e.puesto]) acc[e.puesto] = { count: 0, total: 0 }
                acc[e.puesto].count++
                acc[e.puesto].total += e.sueldo_base
                return acc
              }, {})
            )
              .sort((a, b) => b[1].total - a[1].total)
              .map(([puesto, data]) => {
                const pct = (data.total / totalNomina) * 100
                return (
                  <div key={puesto} className="flex items-center gap-4">
                    <span className="text-sm text-zinc-400 w-32 shrink-0">{puesto} ({data.count})</span>
                    <div className="flex-1 bg-white/5 rounded-full h-6 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full flex items-center justify-end pr-3"
                        style={{ width: `${pct}%` }}
                      >
                        <span className="text-xs font-bold">{formatDemoMXN(data.total)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500 w-12 text-right">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
