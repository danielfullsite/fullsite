'use client'

import { useState } from 'react'
import { Search, Plus, ChefHat } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const PLATILLOS = [
  { id: 1, nombre: 'Chilaquiles Verdes', precio: 189, grupo: 'Desayunos', activo: true },
  { id: 2, nombre: 'Huevos Rancheros', precio: 159, grupo: 'Desayunos', activo: true },
  { id: 3, nombre: 'Omelette Keto', precio: 175, grupo: 'Desayunos', activo: true },
  { id: 4, nombre: 'Rib Eye 400g', precio: 589, grupo: 'Carnes & Parrilla', activo: true },
  { id: 5, nombre: 'Arrachera a la Parrilla', precio: 389, grupo: 'Carnes & Parrilla', activo: true },
  { id: 6, nombre: 'Hamburguesa Casa Montana', precio: 229, grupo: 'Carnes & Parrilla', activo: true },
  { id: 7, nombre: 'Aguachile Rojo', precio: 259, grupo: 'Mariscos', activo: true },
  { id: 8, nombre: 'Ceviche de Camaron', precio: 239, grupo: 'Mariscos', activo: true },
  { id: 9, nombre: 'Tacos de Pescado', precio: 219, grupo: 'Mariscos', activo: false },
  { id: 10, nombre: 'Pasta Alfredo con Pollo', precio: 209, grupo: 'Pastas', activo: true },
  { id: 11, nombre: 'Spaghetti Bolognesa', precio: 189, grupo: 'Pastas', activo: true },
  { id: 12, nombre: 'Bowl de Salmon', precio: 269, grupo: 'Bowls', activo: true },
  { id: 13, nombre: 'Poke Bowl Atun', precio: 249, grupo: 'Bowls', activo: true },
  { id: 14, nombre: 'Bowl Mediterraneo', precio: 219, grupo: 'Bowls', activo: true },
  { id: 15, nombre: 'Cappuccino', precio: 75, grupo: 'Cafe & Bar', activo: true },
  { id: 16, nombre: 'Latte de Vainilla', precio: 85, grupo: 'Cafe & Bar', activo: true },
  { id: 17, nombre: 'Limonada de la Casa', precio: 65, grupo: 'Bebidas', activo: true },
  { id: 18, nombre: 'Smoothie Verde', precio: 95, grupo: 'Bebidas', activo: true },
  { id: 19, nombre: 'Cheesecake NY', precio: 129, grupo: 'Postres', activo: true },
  { id: 20, nombre: 'Brownie con Helado', precio: 119, grupo: 'Postres', activo: false },
]

export default function PosPlatillosPage() {
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState(false)

  const filtered = PLATILLOS.filter(p =>
    p.nombre.toLowerCase().includes(search.toLowerCase()) ||
    p.grupo.toLowerCase().includes(search.toLowerCase())
  )

  const showToast = () => {
    setToast(true)
    setTimeout(() => setToast(false), 2000)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white p-6 md:p-10">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-xl text-sm font-medium animate-in fade-in slide-in-from-top-2">
          Solo lectura en demo
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ChefHat size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Platillos POS</h1>
            <p className="text-sm text-zinc-500">{PLATILLOS.length} platillos &middot; Casa Montana</p>
          </div>
        </div>
        <button
          onClick={showToast}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-sm font-medium border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors cursor-not-allowed opacity-60"
        >
          <Plus size={16} />
          Agregar platillo
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar platillo o grupo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white/[0.02] border border-white/5 rounded-2xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/10 transition-colors"
        />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(p => (
          <div
            key={p.id}
            className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col justify-between gap-3 hover:border-white/10 transition-colors"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-sm leading-tight">{p.nombre}</h3>
                <div
                  className={`w-9 h-5 rounded-full flex items-center transition-colors ${
                    p.activo ? 'bg-emerald-500/30 justify-end' : 'bg-zinc-700/50 justify-start'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full mx-0.5 ${p.activo ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{p.grupo}</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-emerald-400 font-bold text-lg">{formatDemoMXN(p.precio)}</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                p.activo ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-500'
              }`}>
                {p.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-zinc-600">
          No se encontraron platillos
        </div>
      )}
    </div>
  )
}
