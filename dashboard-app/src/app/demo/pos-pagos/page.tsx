'use client'

import { CreditCard, Banknote, Send, Truck, Gift, Wallet } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const METODOS = [
  { id: 1, nombre: 'Efectivo', icon: Banknote, activo: true, comision: 0, color: 'emerald' },
  { id: 2, nombre: 'Tarjeta de credito', icon: CreditCard, activo: true, comision: 3.5, color: 'blue' },
  { id: 3, nombre: 'Tarjeta de debito', icon: CreditCard, activo: true, comision: 2.1, color: 'cyan' },
  { id: 4, nombre: 'Transferencia', icon: Send, activo: true, comision: 0, color: 'violet' },
  { id: 5, nombre: 'UberEats', icon: Truck, activo: true, comision: 30, color: 'green' },
  { id: 6, nombre: 'Rappi', icon: Truck, activo: true, comision: 25, color: 'orange' },
  { id: 7, nombre: 'Didi Food', icon: Truck, activo: false, comision: 28, color: 'amber' },
  { id: 8, nombre: 'Vales de despensa', icon: Wallet, activo: true, comision: 4.0, color: 'pink' },
  { id: 9, nombre: 'Gift card', icon: Gift, activo: false, comision: 0, color: 'rose' },
]

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  green: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
}

export default function PosPagosPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <CreditCard size={20} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Formas de Pago</h1>
          <p className="text-sm text-zinc-500">{METODOS.length} metodos &middot; Casa Montana</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{METODOS.filter(m => m.activo).length}</div>
          <div className="text-xs text-zinc-500 mt-1">Activos</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-zinc-500">{METODOS.filter(m => !m.activo).length}</div>
          <div className="text-xs text-zinc-500 mt-1">Inactivos</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-center sm:col-span-1 col-span-2">
          <div className="text-2xl font-bold text-blue-400">3</div>
          <div className="text-xs text-zinc-500 mt-1">Delivery apps</div>
        </div>
      </div>

      {/* Payment method cards */}
      <div className="space-y-3">
        {METODOS.map(m => {
          const c = colorMap[m.color]
          const Icon = m.icon
          return (
            <div
              key={m.id}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex items-center gap-4 hover:border-white/10 transition-colors"
            >
              <div className={`w-11 h-11 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center shrink-0`}>
                <Icon size={20} className={c.text} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">{m.nombre}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Comision: {m.comision === 0 ? 'Sin comision' : `${m.comision}%`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${
                  m.activo ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-500'
                }`}>
                  {m.activo ? 'Activo' : 'Inactivo'}
                </span>
                <div
                  className={`w-9 h-5 rounded-full flex items-center transition-colors ${
                    m.activo ? 'bg-emerald-500/30 justify-end' : 'bg-zinc-700/50 justify-start'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full mx-0.5 ${m.activo ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
