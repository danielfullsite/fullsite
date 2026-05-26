'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, FileText, Calendar, CalendarDays, CalendarRange,
  Package, Users, Receipt, ChefHat, Coins, Download
} from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const REPORTES = [
  { nombre: 'Reporte Diario', desc: 'Ventas, tickets, meseros, platillos top del día', icon: Calendar, lastGenerated: '2026-05-26', color: 'text-emerald-400' },
  { nombre: 'Reporte Semanal', desc: 'Resumen ejecutivo de la semana con tendencias', icon: CalendarDays, lastGenerated: '2026-05-19', color: 'text-blue-400' },
  { nombre: 'Reporte Mensual', desc: 'Métricas financieras, comparativa mes anterior', icon: CalendarRange, lastGenerated: '2026-04-30', color: 'text-purple-400' },
  { nombre: 'Reporte de Inventario', desc: 'Stock actual, consumos, alertas de reorden', icon: Package, lastGenerated: '2026-05-25', color: 'text-orange-400' },
  { nombre: 'Reporte de Nómina', desc: 'Horas trabajadas, salarios, propinas asignadas', icon: Users, lastGenerated: '2026-05-15', color: 'text-cyan-400' },
  { nombre: 'Reporte Fiscal', desc: 'Facturación, IVA, desglose de impuestos', icon: Receipt, lastGenerated: '2026-04-30', color: 'text-red-400' },
  { nombre: 'Análisis de Menú', desc: 'Clasificación BCG: estrellas, vacas, perros, enigmas', icon: ChefHat, lastGenerated: '2026-05-19', color: 'text-amber-400' },
  { nombre: 'Reporte de Propinas', desc: 'Desglose por mesero, promedios, distribución', icon: Coins, lastGenerated: '2026-05-25', color: 'text-pink-400' },
]

export default function DemoReportes() {
  const [toast, setToast] = useState<string | null>(null)

  function handleGenerar(nombre: string) {
    setToast(`${nombre} generado y enviado a tu email`)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white relative">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Reportes</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Centro de reportes</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto">
        {/* Summary */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={18} className="text-blue-400" />
            <h3 className="font-bold">Reportes disponibles</h3>
          </div>
          <p className="text-sm text-zinc-500">{REPORTES.length} reportes configurados. Genera y recibe en tu email en segundos.</p>
        </div>

        {/* Report grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {REPORTES.map(r => (
            <div key={r.nombre} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex items-start gap-4">
              <div className={`p-3 rounded-xl bg-white/[0.03] ${r.color}`}>
                <r.icon size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm">{r.nombre}</h4>
                <p className="text-xs text-zinc-500 mt-0.5">{r.desc}</p>
                <p className="text-[11px] text-zinc-600 mt-2">Último: {r.lastGenerated}</p>
              </div>
              <button
                onClick={() => handleGenerar(r.nombre)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-colors"
              >
                <Download size={13} />
                Generar
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-2xl backdrop-blur-sm animate-in slide-in-from-bottom-4 z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
