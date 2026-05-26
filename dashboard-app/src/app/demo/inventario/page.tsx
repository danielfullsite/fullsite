'use client'

import Link from 'next/link'
import { ArrowLeft, Package, AlertTriangle, XCircle, CheckCircle } from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const INVENTARIO = [
  { nombre: 'Rib Eye', stock: 12, unidad: 'kg', reorden: 15, status: 'Bajo' as const },
  { nombre: 'Salmón', stock: 8, unidad: 'kg', reorden: 10, status: 'Bajo' as const },
  { nombre: 'Aguacate', stock: 2, unidad: 'kg', reorden: 8, status: 'Crítico' as const },
  { nombre: 'Café grano', stock: 18, unidad: 'kg', reorden: 10, status: 'OK' as const },
  { nombre: 'Leche entera', stock: 45, unidad: 'lt', reorden: 30, status: 'OK' as const },
  { nombre: 'Huevo', stock: 120, unidad: 'pz', reorden: 100, status: 'OK' as const },
  { nombre: 'Pan artesanal', stock: 15, unidad: 'pz', reorden: 40, status: 'Crítico' as const },
  { nombre: 'Queso manchego', stock: 6, unidad: 'kg', reorden: 5, status: 'OK' as const },
  { nombre: 'Tocino', stock: 4, unidad: 'kg', reorden: 8, status: 'Crítico' as const },
  { nombre: 'Pollo pechuga', stock: 14, unidad: 'kg', reorden: 12, status: 'OK' as const },
  { nombre: 'Tortilla harina', stock: 200, unidad: 'pz', reorden: 150, status: 'OK' as const },
  { nombre: 'Crema ácida', stock: 7, unidad: 'lt', reorden: 5, status: 'OK' as const },
  { nombre: 'Aceite oliva', stock: 3, unidad: 'lt', reorden: 5, status: 'Bajo' as const },
  { nombre: 'Camarón', stock: 1.5, unidad: 'kg', reorden: 6, status: 'Crítico' as const },
  { nombre: 'Arúgula', stock: 2, unidad: 'kg', reorden: 3, status: 'Bajo' as const },
]

const statusConfig = {
  OK: { color: 'text-emerald-400 bg-emerald-400/10', icon: CheckCircle },
  Bajo: { color: 'text-amber-400 bg-amber-400/10', icon: AlertTriangle },
  Crítico: { color: 'text-red-400 bg-red-400/10', icon: XCircle },
}

export default function DemoInventario() {
  const totalItems = INVENTARIO.length
  const bajoStock = INVENTARIO.filter(i => i.status === 'Bajo').length
  const criticos = INVENTARIO.filter(i => i.status === 'Crítico').length

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Inventario</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Control de stock</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total ingredientes', value: totalItems, icon: Package, color: 'text-blue-400' },
            { label: 'Bajo stock', value: bajoStock, icon: AlertTriangle, color: 'text-amber-400' },
            { label: 'Críticos', value: criticos, icon: XCircle, color: 'text-red-400' },
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
          <div className="p-5 border-b border-[var(--line)]">
            <h3 className="font-bold flex items-center gap-2">
              <Package size={18} className="text-blue-400" /> Ingredientes
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-3)] text-xs border-b border-[var(--line)]">
                  <th className="text-left px-5 py-3 font-medium">Nombre</th>
                  <th className="text-right px-5 py-3 font-medium">Stock actual</th>
                  <th className="text-center px-5 py-3 font-medium">Unidad</th>
                  <th className="text-right px-5 py-3 font-medium">Punto de reorden</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {INVENTARIO.map(item => {
                  const cfg = statusConfig[item.status]
                  const StatusIcon = cfg.icon
                  return (
                    <tr key={item.nombre} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-medium">{item.nombre}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{item.stock}</td>
                      <td className="px-5 py-3 text-center text-[var(--text-2)]">{item.unidad}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-[var(--text-2)]">{item.reorden}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                          <StatusIcon size={12} />
                          {item.status}
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
