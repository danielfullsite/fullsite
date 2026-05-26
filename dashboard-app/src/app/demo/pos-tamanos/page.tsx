'use client'

import { Maximize2 } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const TAMANOS = [
  { nombre: 'Chico', multiplicador: 0.8, label: '0.8x' },
  { nombre: 'Mediano', multiplicador: 1.0, label: '1.0x' },
  { nombre: 'Grande', multiplicador: 1.3, label: '1.3x' },
]

const APLICADOS = [
  { grupo: 'Cafe', items: ['Americano', 'Cappuccino', 'Latte', 'Mocha'], precioBase: 65 },
  { grupo: 'Jugos', items: ['Naranja', 'Verde', 'Zanahoria', 'Mixto'], precioBase: 55 },
  { grupo: 'Smoothies', items: ['Berry Blast', 'Tropical', 'Verde Detox', 'Mango'], precioBase: 85 },
]

export default function PosTamanosPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
          <Maximize2 size={20} className="text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Tamanos</h1>
          <p className="text-sm text-[var(--text-3)]">Opciones de tamano &middot; Casa Montana</p>
        </div>
      </div>

      {/* Multiplier cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {TAMANOS.map(t => (
          <div key={t.nombre} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-cyan-400 mb-1">{t.label}</div>
            <div className="text-sm text-[var(--text-2)]">{t.nombre}</div>
          </div>
        ))}
      </div>

      {/* Price table per group */}
      {APLICADOS.map(grupo => (
        <div key={grupo.grupo} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[var(--line)]">
            <h3 className="font-semibold text-base">{grupo.grupo}</h3>
            <p className="text-xs text-[var(--text-3)]">Precio base: {formatDemoMXN(grupo.precioBase)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="text-left px-6 py-3 text-xs text-[var(--text-3)] font-medium">Producto</th>
                  {TAMANOS.map(t => (
                    <th key={t.nombre} className="text-center px-4 py-3 text-xs text-[var(--text-3)] font-medium">{t.nombre}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupo.items.map(item => (
                  <tr key={item} className="border-b border-white/[0.03] last:border-b-0">
                    <td className="px-6 py-3 text-sm font-medium">{item}</td>
                    {TAMANOS.map(t => (
                      <td key={t.nombre} className="text-center px-4 py-3">
                        <span className={`text-sm font-semibold ${t.nombre === 'Grande' ? 'text-cyan-400' : t.nombre === 'Chico' ? 'text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>
                          {formatDemoMXN(Math.round(grupo.precioBase * t.multiplicador))}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
