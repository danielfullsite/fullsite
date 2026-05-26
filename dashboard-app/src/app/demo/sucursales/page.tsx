'use client'

import Link from 'next/link'
import { ArrowLeft, MapPin, Users, LayoutGrid, DollarSign, Clock } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const SUCURSALES = [
  {
    nombre: 'Casa Montaña Valle Oriente',
    direccion: 'Av. Lázaro Cárdenas 2400, Valle Oriente, Monterrey, NL',
    mesas: 28,
    meseros: 8,
    status: 'Activa' as const,
    ventasHoy: 38450,
    horario: '8:00 AM - 11:00 PM',
  },
  {
    nombre: 'Casa Montaña Cumbres',
    direccion: 'Av. Lincoln 1500, Cumbres, Monterrey, NL',
    mesas: 22,
    meseros: 6,
    status: 'Próximamente' as const,
    ventasHoy: 0,
    horario: 'Por definir',
  },
]

export default function DemoSucursales() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Sucursales</h1>
            <p className="text-xs text-zinc-500">Casa Montaña · Multi-sucursal</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SUCURSALES.map(s => {
            const isActive = s.status === 'Activa'
            return (
              <div
                key={s.nombre}
                className={`bg-white/[0.02] border border-white/5 rounded-2xl p-6 relative ${
                  !isActive ? 'opacity-50' : ''
                }`}
              >
                {/* Status badge */}
                <div className="absolute top-4 right-4">
                  {isActive ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-emerald-400 bg-emerald-400/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Activa
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-400 bg-zinc-400/10">
                      Próximamente
                    </span>
                  )}
                </div>

                {/* Name and address */}
                <h3 className="text-lg font-bold mb-1 pr-28">{s.nombre}</h3>
                <p className="text-sm text-zinc-500 flex items-center gap-1.5 mb-6">
                  <MapPin size={14} />
                  {s.direccion}
                </p>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/[0.03] rounded-xl p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <LayoutGrid size={14} />
                      <span className="text-xs">Mesas</span>
                    </div>
                    <p className="text-xl font-bold">{s.mesas}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-xl p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <Users size={14} />
                      <span className="text-xs">Meseros</span>
                    </div>
                    <p className="text-xl font-bold">{s.meseros}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-xl p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <DollarSign size={14} />
                      <span className="text-xs">Ventas hoy</span>
                    </div>
                    <p className="text-xl font-bold">{isActive ? formatDemoMXN(s.ventasHoy) : '—'}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-xl p-4">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <Clock size={14} />
                      <span className="text-xs">Horario</span>
                    </div>
                    <p className="text-sm font-bold mt-1">{s.horario}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
