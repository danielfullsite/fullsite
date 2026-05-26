'use client'

import Link from 'next/link'
import { ArrowLeft, Truck, Clock, MapPin, Users } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const STATS = [
  { label: 'Pedidos hoy', value: '12', icon: Truck, color: 'text-blue-400' },
  { label: 'Tiempo promedio entrega', value: '35 min', icon: Clock, color: 'text-amber-400' },
  { label: 'Zona de cobertura', value: '5 km', icon: MapPin, color: 'text-emerald-400' },
  { label: 'Repartidores activos', value: '2', icon: Users, color: 'text-violet-400' },
]

const PEDIDOS = [
  { id: '#D-401', cliente: 'Maria Gonzalez', direccion: 'Col. Del Valle, Av. Roble 234', total: 580, status: 'Entregado', tiempo: '28 min' },
  { id: '#D-402', cliente: 'Roberto Cantu', direccion: 'Col. Contry, Calle 5 de Mayo 112', total: 420, status: 'En camino', tiempo: '15 min' },
  { id: '#D-403', cliente: 'Ana Trevino', direccion: 'Col. Cumbres, Paseo de los Leones 890', total: 760, status: 'En camino', tiempo: '22 min' },
  { id: '#D-404', cliente: 'Luis Garza', direccion: 'Col. Mitras, Av. Gonzalitos 456', total: 350, status: 'Preparando', tiempo: '--' },
  { id: '#D-405', cliente: 'Sofia Hernandez', direccion: 'Col. San Jeronimo, Rio Amazonas 78', total: 680, status: 'Entregado', tiempo: '32 min' },
  { id: '#D-406', cliente: 'Carlos Salinas', direccion: 'Col. Valle Oriente, Av. Lazaro Cardenas 2100', total: 920, status: 'Entregado', tiempo: '41 min' },
]

const statusColor: Record<string, string> = {
  'Entregado': 'bg-emerald-500/10 text-emerald-400',
  'En camino': 'bg-blue-500/10 text-blue-400',
  'Preparando': 'bg-amber-500/10 text-amber-400',
}

export default function DemoDomicilio() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Domicilio</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Entregas del dia</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-zinc-500">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5">
            <p className="text-sm font-medium">Pedidos recientes</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-xs text-zinc-500">
                <th className="text-left px-5 py-3 font-medium">#</th>
                <th className="text-left px-5 py-3 font-medium">Cliente</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Direccion</th>
                <th className="text-right px-5 py-3 font-medium">Total</th>
                <th className="text-center px-5 py-3 font-medium">Status</th>
                <th className="text-center px-5 py-3 font-medium">Tiempo</th>
              </tr>
            </thead>
            <tbody>
              {PEDIDOS.map((p) => (
                <tr key={p.id} className="border-b border-white/5 last:border-0">
                  <td className="px-5 py-3 text-sm font-mono text-zinc-400">{p.id}</td>
                  <td className="px-5 py-3 text-sm font-medium">{p.cliente}</td>
                  <td className="px-5 py-3 text-sm text-zinc-400 hidden md:table-cell">{p.direccion}</td>
                  <td className="px-5 py-3 text-sm text-right font-medium">{formatDemoMXN(p.total)}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-center text-zinc-400">{p.tiempo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
