'use client'

import { Tag, Percent } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const PROMOCIONES = [
  {
    id: 1,
    nombre: '2x1 Cafe',
    descripcion: 'Todos los cafes 2x1 de lunes a viernes antes de las 10am',
    vigencia: '2026-01-01 a 2026-12-31',
    status: 'activa' as const,
    usosMes: 342,
  },
  {
    id: 2,
    nombre: '15% Descuento Cumpleanos',
    descripcion: '15% de descuento en cuenta total presentando INE el dia de tu cumpleanos',
    vigencia: 'Permanente',
    status: 'activa' as const,
    usosMes: 28,
  },
  {
    id: 3,
    nombre: 'Happy Hour Cocteleria',
    descripcion: '2x1 en cocteles seleccionados de 4pm a 7pm todos los dias',
    vigencia: '2026-03-01 a 2026-08-31',
    status: 'activa' as const,
    usosMes: 189,
  },
  {
    id: 4,
    nombre: 'Combo Desayuno $199',
    descripcion: 'Chilaquiles o huevos + cafe + jugo de naranja por solo $199',
    vigencia: '2026-05-01 a 2026-06-30',
    status: 'pausada' as const,
    usosMes: 67,
  },
  {
    id: 5,
    nombre: '10% Primera Visita',
    descripcion: '10% de descuento en tu primera visita al registrarte en la app',
    vigencia: '2026-01-15 a 2026-04-30',
    status: 'expirada' as const,
    usosMes: 0,
  },
]

const statusStyles = {
  activa: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pausada: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  expirada: 'bg-zinc-700/50 text-zinc-500 border-zinc-600/30',
}

export default function PosPromocionesPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
          <Tag size={20} className="text-pink-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Promociones</h1>
          <p className="text-sm text-zinc-500">{PROMOCIONES.length} promociones &middot; Casa Montana</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{PROMOCIONES.filter(p => p.status === 'activa').length}</div>
          <div className="text-xs text-zinc-500 mt-1">Activas</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{PROMOCIONES.filter(p => p.status === 'pausada').length}</div>
          <div className="text-xs text-zinc-500 mt-1">Pausadas</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{PROMOCIONES.reduce((s, p) => s + p.usosMes, 0)}</div>
          <div className="text-xs text-zinc-500 mt-1">Usos este mes</div>
        </div>
      </div>

      {/* Promotion cards */}
      <div className="space-y-4">
        {PROMOCIONES.map(p => (
          <div
            key={p.id}
            className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-base">{p.nombre}</h3>
                  <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${statusStyles[p.status]}`}>
                    {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                  </span>
                </div>
                <p className="text-sm text-zinc-400 mb-2">{p.descripcion}</p>
                <p className="text-xs text-zinc-600">Vigencia: {p.vigencia}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold">{p.usosMes}</div>
                <div className="text-[10px] text-zinc-500">usos este mes</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
