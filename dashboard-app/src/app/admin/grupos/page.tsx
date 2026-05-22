'use client'

import { MENU_CATEGORIES } from '@/lib/pos-data'
import { Layers, ArrowRight, Package } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Link from 'next/link'

export default function AdminGruposPage() {
  const groups = MENU_CATEGORIES.map(cat => ({
    id: cat.id,
    name: cat.name,
    color: cat.color || 'bg-slate-500',
    itemCount: cat.items.length,
    priceRange: {
      min: Math.min(...cat.items.map(i => i.price)),
      max: Math.max(...cat.items.map(i => i.price)),
    },
  }))

  const totalItems = groups.reduce((s, g) => s + g.itemCount, 0)

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Grupos del Menu"
        subtitle={`${groups.length} grupos · ${totalItems} platillos`}
        eyebrow="Admin"
        action={
          <Link
            href="/admin/menu"
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"
          >
            <Package size={16} />
            Administrar platillos
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map(g => (
          <div
            key={g.id}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl ${g.color} flex items-center justify-center`}>
                <Layers size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">{g.name}</h3>
                <p className="text-xs text-slate-400">{g.id}</p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div>
                <p className="text-2xl font-bold text-slate-900">{g.itemCount}</p>
                <p className="text-xs text-slate-400">platillos</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-slate-700">
                  ${g.priceRange.min} — ${g.priceRange.max}
                </p>
                <p className="text-xs text-slate-400">rango de precios</p>
              </div>
            </div>

            <Link
              href="/admin/menu"
              className="mt-4 w-full flex items-center justify-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 font-medium py-2 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              Ver platillos <ArrowRight size={14} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
