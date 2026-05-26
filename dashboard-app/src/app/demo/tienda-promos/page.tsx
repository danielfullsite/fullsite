'use client'

import Link from 'next/link'
import { ArrowLeft, Percent, Calendar, Tag } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const PROMOS = [
  {
    nombre: '2x1 Mermeladas',
    descripcion: 'Lleva dos mermeladas artesanales por el precio de una. Todas las variedades.',
    tipo: '2x1',
    vigencia: 'Hasta agotar existencias',
    condicion: 'Sin restricciones',
    ahorro: 120,
  },
  {
    nombre: '20% en Cafe Molido',
    descripcion: 'Descuento en todas las presentaciones de cafe molido de la casa.',
    tipo: 'Descuento',
    vigencia: 'Solo fines de semana',
    condicion: 'Viernes a domingo',
    ahorro: 36,
  },
  {
    nombre: 'Bundle Desayuno',
    descripcion: 'Granola + Miel organica + Mermelada artesanal. El regalo perfecto.',
    tipo: 'Bundle',
    vigencia: 'Permanente',
    condicion: 'Precio especial de paquete',
    ahorro: 50,
    precioBundle: 350,
  },
]

export default function DemoTiendaPromos() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Promos Tienda</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · {PROMOS.length} promociones activas</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-4">
        {PROMOS.map((p) => (
          <div
            key={p.nombre}
            className="bg-white/[0.02] border border-white/5 rounded-2xl p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Percent size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-lg">{p.nombre}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-zinc-400">
                    {p.tipo}
                  </span>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                Activa
              </span>
            </div>
            <p className="text-sm text-zinc-400 mb-4">{p.descripcion}</p>
            <div className="flex flex-wrap gap-4 text-xs text-zinc-500 pt-3 border-t border-white/5">
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {p.vigencia}
              </span>
              <span className="flex items-center gap-1">
                <Tag size={12} />
                {p.condicion}
              </span>
              <span className="text-emerald-400 font-medium ml-auto">
                Ahorro: {formatDemoMXN(p.ahorro)}
              </span>
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}
