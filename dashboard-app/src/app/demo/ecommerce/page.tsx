'use client'

import Link from 'next/link'
import { ArrowLeft, ShoppingBag, DollarSign, Smartphone, CheckCircle, Clock, ChefHat } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const PEDIDOS = [
  { plataforma: 'UberEats', pedido: 'UE-4821', items: 'Chilaquiles verdes, Café americano', total: 210, status: 'Entregado' as const },
  { plataforma: 'Rappi', pedido: 'RP-7733', items: 'Bowl mediterráneo, Smoothie verde', total: 320, status: 'Entregado' as const },
  { plataforma: 'Didi Food', pedido: 'DD-1092', items: 'Rib Eye 300g, Limonada', total: 650, status: 'Preparando' as const },
  { plataforma: 'UberEats', pedido: 'UE-4822', items: 'Pancakes con berries x2', total: 250, status: 'Preparando' as const },
  { plataforma: 'Rappi', pedido: 'RP-7734', items: 'Ensalada Caesar, Croissant jamón queso', total: 250, status: 'Entregado' as const },
  { plataforma: 'Didi Food', pedido: 'DD-1093', items: 'Enchiladas suizas, Agua fresca', total: 195, status: 'Preparando' as const },
]

const plataformaColor: Record<string, string> = {
  UberEats: 'text-green-400 bg-green-400/10',
  Rappi: 'text-orange-400 bg-orange-400/10',
  'Didi Food': 'text-blue-400 bg-blue-400/10',
}

export default function DemoEcommerce() {
  const totalPedidos = PEDIDOS.length
  const totalVentas = PEDIDOS.reduce((s, p) => s + p.total, 0)
  const plataformas = [...new Set(PEDIDOS.map(p => p.plataforma))]

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">eCommerce</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Pedidos online</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Pedidos online hoy', value: totalPedidos.toString(), icon: ShoppingBag, color: 'text-purple-400' },
            { label: 'Ventas online', value: formatDemoMXN(totalVentas), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Plataformas', value: plataformas.join(', '), icon: Smartphone, color: 'text-blue-400' },
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

        {/* Orders table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-[var(--line)]">
            <h3 className="font-bold flex items-center gap-2">
              <ShoppingBag size={18} className="text-purple-400" /> Pedidos recientes
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-3)] text-xs border-b border-[var(--line)]">
                  <th className="text-left px-5 py-3 font-medium">Plataforma</th>
                  <th className="text-left px-5 py-3 font-medium">Pedido #</th>
                  <th className="text-left px-5 py-3 font-medium">Items</th>
                  <th className="text-right px-5 py-3 font-medium">Total</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {PEDIDOS.map(p => (
                  <tr key={p.pedido} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${plataformaColor[p.plataforma]}`}>
                        {p.plataforma}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[var(--text-2)]">{p.pedido}</td>
                    <td className="px-5 py-3 text-zinc-300">{p.items}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{formatDemoMXN(p.total)}</td>
                    <td className="px-5 py-3 text-center">
                      {p.status === 'Entregado' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-emerald-400 bg-emerald-400/10">
                          <CheckCircle size={12} />
                          Entregado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-amber-400 bg-amber-400/10">
                          <ChefHat size={12} />
                          Preparando
                        </span>
                      )}
                    </td>
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
