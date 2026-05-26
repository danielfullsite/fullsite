'use client'

import Link from 'next/link'
import { ArrowLeft, Package, Tag } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const ARTICULOS = [
  { nombre: 'Mermelada artesanal', precio: 120, stock: 34, categoria: 'Conservas' },
  { nombre: 'Granola premium', precio: 95, stock: 22, categoria: 'Snacks' },
  { nombre: 'Miel organica', precio: 85, stock: 18, categoria: 'Conservas' },
  { nombre: 'Cafe molido 250g', precio: 180, stock: 41, categoria: 'Cafe & Te' },
  { nombre: 'Salsa macha', precio: 75, stock: 27, categoria: 'Conservas' },
  { nombre: 'Aceite de oliva', precio: 220, stock: 12, categoria: 'Conservas' },
  { nombre: 'Galletas artesanales', precio: 65, stock: 56, categoria: 'Snacks' },
  { nombre: 'Bolsa ecologica', precio: 45, stock: 83, categoria: 'Accesorios' },
]

export default function DemoTiendaArticulos() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Articulos Tienda</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · {ARTICULOS.length} productos</p>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ARTICULOS.map((a) => (
            <div
              key={a.nombre}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                  <Package size={18} className="text-zinc-400" />
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 flex items-center gap-1">
                  <Tag size={10} />
                  {a.categoria}
                </span>
              </div>
              <div>
                <p className="font-semibold">{a.nombre}</p>
                <p className="text-2xl font-bold mt-1">{formatDemoMXN(a.precio)}</p>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-500 pt-2 border-t border-white/5">
                <span>Stock: {a.stock} unidades</span>
                <span className={a.stock < 15 ? 'text-amber-400' : 'text-emerald-400'}>
                  {a.stock < 15 ? 'Stock bajo' : 'Disponible'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
