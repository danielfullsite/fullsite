'use client'

import { Minus, Plus } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const QUITAR = [
  'Sin cebolla', 'Sin chile', 'Sin crema', 'Sin queso', 'Sin aguacate', 'Sin salsa', 'Sin gluten',
]

const AGREGAR = [
  { nombre: 'Extra queso', precio: 25 },
  { nombre: 'Extra aguacate', precio: 35 },
  { nombre: 'Extra proteina', precio: 45 },
  { nombre: 'Huevo extra', precio: 20 },
  { nombre: 'Tocino', precio: 30 },
]

export default function PosModificadoresPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
          <span className="text-orange-400 font-bold text-lg">M</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Modificadores</h1>
          <p className="text-sm text-[var(--text-3)]">Personaliza platillos &middot; Casa Montana</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quitar */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Minus size={16} className="text-red-400" />
            </div>
            <h2 className="text-lg font-semibold">Quitar</h2>
            <span className="text-xs text-[var(--text-4)] ml-auto">{QUITAR.length} opciones</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUITAR.map(q => (
              <span
                key={q}
                className="px-4 py-2 rounded-xl bg-red-500/5 border border-red-500/10 text-red-400 text-sm font-medium"
              >
                {q}
              </span>
            ))}
          </div>
        </div>

        {/* Agregar */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Plus size={16} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold">Agregar</h2>
            <span className="text-xs text-[var(--text-4)] ml-auto">{AGREGAR.length} opciones</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {AGREGAR.map(a => (
              <span
                key={a.nombre}
                className="px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-sm font-medium"
              >
                {a.nombre} <span className="text-emerald-500/60 ml-1">+{formatDemoMXN(a.precio)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
