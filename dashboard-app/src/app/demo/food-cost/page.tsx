'use client'

import Link from 'next/link'
import { ArrowLeft, ChefHat, TrendingUp, Percent, Star } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const PLATILLOS = [
  { nombre: 'Rib Eye 300g', costo: 185, precio: 580 },
  { nombre: 'Salmón a la plancha', costo: 145, precio: 480 },
  { nombre: 'Chilaquiles verdes', costo: 32, precio: 145 },
  { nombre: 'Huevos benedictinos', costo: 48, precio: 165 },
  { nombre: 'Bowl mediterráneo', costo: 55, precio: 195 },
  { nombre: 'Panini caprese', costo: 42, precio: 155 },
  { nombre: 'Enchiladas suizas', costo: 38, precio: 135 },
  { nombre: 'Pancakes con berries', costo: 35, precio: 125 },
  { nombre: 'Ceviche de camarón', costo: 95, precio: 265 },
  { nombre: 'Ensalada Caesar', costo: 40, precio: 155 },
  { nombre: 'Pasta al pesto', costo: 52, precio: 175 },
  { nombre: 'Croissant jamón queso', costo: 28, precio: 95 },
]

function foodCostColor(pct: number) {
  if (pct < 30) return 'text-emerald-400'
  if (pct <= 35) return 'text-amber-400'
  return 'text-red-400'
}

function foodCostBadge(pct: number) {
  if (pct < 30) return 'text-emerald-400 bg-emerald-400/10'
  if (pct <= 35) return 'text-amber-400 bg-amber-400/10'
  return 'text-red-400 bg-red-400/10'
}

export default function DemoFoodCost() {
  const platillosConCalc = PLATILLOS.map(p => ({
    ...p,
    foodCost: (p.costo / p.precio) * 100,
    margen: p.precio - p.costo,
  }))

  const avgFoodCost = platillosConCalc.reduce((s, p) => s + p.foodCost, 0) / platillosConCalc.length
  const avgMargen = platillosConCalc.reduce((s, p) => s + p.margen, 0) / platillosConCalc.length
  const masRentable = [...platillosConCalc].sort((a, b) => b.margen - a.margen)[0]

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Food Cost</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Análisis de costos</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Food cost promedio', value: `${avgFoodCost.toFixed(1)}%`, icon: Percent, color: foodCostColor(avgFoodCost) },
            { label: 'Margen promedio', value: formatDemoMXN(Math.round(avgMargen)), icon: TrendingUp, color: 'text-emerald-400' },
            { label: 'Más rentable', value: masRentable.nombre, icon: Star, color: 'text-amber-400' },
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

        {/* Table */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-white/5">
            <h3 className="font-bold flex items-center gap-2">
              <ChefHat size={18} className="text-orange-400" /> Análisis por platillo
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs border-b border-white/5">
                  <th className="text-left px-5 py-3 font-medium">Platillo</th>
                  <th className="text-right px-5 py-3 font-medium">Costo ingredientes</th>
                  <th className="text-right px-5 py-3 font-medium">Precio venta</th>
                  <th className="text-center px-5 py-3 font-medium">Food cost %</th>
                  <th className="text-right px-5 py-3 font-medium">Margen</th>
                </tr>
              </thead>
              <tbody>
                {platillosConCalc.map(p => (
                  <tr key={p.nombre} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium">{p.nombre}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-400">{formatDemoMXN(p.costo)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatDemoMXN(p.precio)}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${foodCostBadge(p.foodCost)}`}>
                        {p.foodCost.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-400 font-medium">{formatDemoMXN(p.margen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
