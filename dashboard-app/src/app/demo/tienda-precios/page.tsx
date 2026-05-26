'use client'

import Link from 'next/link'
import { ArrowLeft, Tag } from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const TIPOS_PRECIO = [
  { tipo: 'Regular', descuento: 0, descripcion: 'Precio de venta al publico general' },
  { tipo: 'Empleado', descuento: 30, descripcion: 'Descuento para colaboradores del restaurante' },
  { tipo: 'Mayoreo', descuento: 15, descripcion: 'Compras a partir de 10 unidades' },
  { tipo: 'Evento', descuento: 10, descripcion: 'Precio especial para eventos y catering' },
]

export default function DemoTiendaPrecios() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Tipos de Precio</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · {TIPOS_PRECIO.length} tipos</p>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--text-3)]">
                <th className="text-left px-5 py-3 font-medium">Tipo</th>
                <th className="text-center px-5 py-3 font-medium">Descuento</th>
                <th className="text-left px-5 py-3 font-medium">Descripcion</th>
                <th className="text-center px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {TIPOS_PRECIO.map((tp) => (
                <tr key={tp.tipo} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-[var(--text-3)]" />
                      <span className="font-medium">{tp.tipo}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    {tp.descuento === 0 ? (
                      <span className="text-[var(--text-3)]">--</span>
                    ) : (
                      <span className="text-amber-400 font-semibold">-{tp.descuento}%</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--text-2)]">{tp.descripcion}</td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                      Activo
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
