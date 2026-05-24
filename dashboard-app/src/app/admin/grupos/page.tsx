'use client'

import { useState, useEffect } from 'react'
import { getMenuCategoriesFromDB } from '@/lib/pos-data'
import { Layers, ArrowRight, Package } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Link from 'next/link'

export default function AdminGruposPage() {
  const [groups, setGroups] = useState<{ id: string; name: string; color: string; itemCount: number; priceRange: { min: number; max: number } }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const cats = await getMenuCategoriesFromDB()
      setGroups(cats.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color || 'bg-slate-500',
        itemCount: cat.items.length,
        priceRange: {
          min: cat.items.length > 0 ? Math.min(...cat.items.map(i => i.price)) : 0,
          max: cat.items.length > 0 ? Math.max(...cat.items.map(i => i.price)) : 0,
        },
      })))
      setLoading(false)
    })()
  }, [])

  const totalItems = groups.reduce((s, g) => s + g.itemCount, 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Cargando grupos...</div>

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
        {groups.map(group => (
          <Link
            key={group.id}
            href={`/admin/menu?cat=${group.id}`}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-emerald-300 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${group.color} flex items-center justify-center`}>
                  <Layers size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{group.name}</h3>
                  <p className="text-xs text-slate-400">{group.itemCount} platillos</p>
                </div>
              </div>
              <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors mt-1" />
            </div>
            {group.priceRange.max > 0 && (
              <p className="text-xs text-slate-500">
                ${group.priceRange.min} – ${group.priceRange.max} MXN
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
