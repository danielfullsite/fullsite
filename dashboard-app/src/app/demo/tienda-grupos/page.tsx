'use client'

import Link from 'next/link'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const GRUPOS = [
  { nombre: 'Conservas', productos: 3, ventas_mes: 8450 },
  { nombre: 'Cafe & Te', productos: 4, ventas_mes: 12300 },
  { nombre: 'Snacks', productos: 5, ventas_mes: 6780 },
  { nombre: 'Accesorios', productos: 2, ventas_mes: 2150 },
  { nombre: 'Gift Cards', productos: 3, ventas_mes: 8050 },
]

const totalVentas = GRUPOS.reduce((s, g) => s + g.ventas_mes, 0)

export default function DemoTiendaGrupos() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Grupos Tienda</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · {GRUPOS.length} categorias</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-4">
        {GRUPOS.map((g) => {
          const pct = Math.round((g.ventas_mes / totalVentas) * 100)
          return (
            <div
              key={g.nombre}
              className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--line-soft)] flex items-center justify-center">
                    <FolderOpen size={18} className="text-[var(--text-2)]" />
                  </div>
                  <div>
                    <p className="font-semibold">{g.nombre}</p>
                    <p className="text-xs text-[var(--text-3)]">{g.productos} productos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">{formatDemoMXN(g.ventas_mes)}</p>
                  <p className="text-xs text-[var(--text-3)]">ventas del mes</p>
                </div>
              </div>
              <div className="w-full bg-[var(--line-soft)] rounded-full h-1.5">
                <div
                  className="bg-white/20 rounded-full h-1.5"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-3)] mt-1">{pct}% del total</p>
            </div>
          )
        })}
      </main>
    </div>
  )
}
