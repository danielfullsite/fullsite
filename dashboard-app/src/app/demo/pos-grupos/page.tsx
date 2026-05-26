'use client'

import { useState } from 'react'
import { Grid3X3, Plus } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const GRUPOS = [
  { id: 1, nombre: 'Desayunos', color: '#f59e0b', platillos: 12, activo: true },
  { id: 2, nombre: 'Carnes & Parrilla', color: '#ef4444', platillos: 9, activo: true },
  { id: 3, nombre: 'Mariscos', color: '#3b82f6', platillos: 8, activo: true },
  { id: 4, nombre: 'Pastas', color: '#a855f7', platillos: 6, activo: true },
  { id: 5, nombre: 'Bowls', color: '#10b981', platillos: 7, activo: true },
  { id: 6, nombre: 'Cafe & Bar', color: '#78716c', platillos: 14, activo: true },
  { id: 7, nombre: 'Bebidas', color: '#06b6d4', platillos: 11, activo: true },
  { id: 8, nombre: 'Postres', color: '#ec4899', platillos: 5, activo: false },
]

export default function PosGruposPage() {
  const [toast, setToast] = useState(false)

  const showToast = () => {
    setToast(true)
    setTimeout(() => setToast(false), 2000)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white p-6 md:p-10">
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-xl text-sm font-medium animate-in fade-in slide-in-from-top-2">
          Solo lectura en demo
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Grid3X3 size={20} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Grupos POS</h1>
            <p className="text-sm text-zinc-500">{GRUPOS.length} grupos &middot; Casa Montana</p>
          </div>
        </div>
        <button
          onClick={showToast}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/10 text-violet-400 text-sm font-medium border border-violet-500/20 hover:bg-violet-500/20 transition-colors cursor-not-allowed opacity-60"
        >
          <Plus size={16} />
          Agregar grupo
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {GRUPOS.map(g => (
          <div
            key={g.id}
            className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: g.color + '18' }}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: g.color }} />
              </div>
              <div
                className={`w-9 h-5 rounded-full flex items-center transition-colors ${
                  g.activo ? 'bg-emerald-500/30 justify-end' : 'bg-zinc-700/50 justify-start'
                }`}
              >
                <div className={`w-4 h-4 rounded-full mx-0.5 ${g.activo ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
              </div>
            </div>
            <h3 className="font-semibold text-base mb-1">{g.nombre}</h3>
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-zinc-500">{g.platillos} platillos</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                g.activo ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-500'
              }`}>
                {g.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
