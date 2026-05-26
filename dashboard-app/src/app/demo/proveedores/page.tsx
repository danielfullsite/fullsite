'use client'

import Link from 'next/link'
import { ArrowLeft, Truck, Phone, DollarSign, CheckCircle, Clock } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const PROVEEDORES = [
  { nombre: 'Carnes MTY', categoria: 'Cárnicos', contacto: 'José Garza · 81 1234 5678', ultimoPedido: '2026-05-24', monto: 85400, status: 'Activo' as const },
  { nombre: 'Frutas del Norte', categoria: 'Frutas y verduras', contacto: 'Ana Treviño · 81 2345 6789', ultimoPedido: '2026-05-25', monto: 42300, status: 'Activo' as const },
  { nombre: 'Café Especial MX', categoria: 'Café y té', contacto: 'Roberto Leal · 81 3456 7890', ultimoPedido: '2026-05-20', monto: 28500, status: 'Activo' as const },
  { nombre: 'Panadería San Juan', categoria: 'Panadería', contacto: 'María Sánchez · 81 4567 8901', ultimoPedido: '2026-05-25', monto: 18200, status: 'Activo' as const },
  { nombre: 'Lácteos Monterrey', categoria: 'Lácteos', contacto: 'Carlos Ramírez · 81 5678 9012', ultimoPedido: '2026-05-23', monto: 35600, status: 'Activo' as const },
  { nombre: 'Mariscos del Golfo', categoria: 'Mariscos', contacto: 'Pedro Villarreal · 81 6789 0123', ultimoPedido: '2026-05-22', monto: 52800, status: 'Activo' as const },
  { nombre: 'Distribuidora Regia', categoria: 'Abarrotes', contacto: 'Laura Martínez · 81 7890 1234', ultimoPedido: '2026-05-21', monto: 22100, status: 'Activo' as const },
  { nombre: 'Vinos y Licores NL', categoria: 'Bebidas', contacto: 'Fernando López · 81 8901 2345', ultimoPedido: '2026-05-18', monto: 31400, status: 'Pendiente' as const },
]

export default function DemoProveedores() {
  const totalCompras = PROVEEDORES.reduce((s, p) => s + p.monto, 0)
  const activos = PROVEEDORES.filter(p => p.status === 'Activo').length

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Proveedores</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Gestión de proveedores</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Compras del mes', value: formatDemoMXN(totalCompras), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Proveedores activos', value: activos.toString(), icon: Truck, color: 'text-blue-400' },
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

        {/* Table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-[var(--line)]">
            <h3 className="font-bold flex items-center gap-2">
              <Truck size={18} className="text-blue-400" /> Directorio de proveedores
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-3)] text-xs border-b border-[var(--line)]">
                  <th className="text-left px-5 py-3 font-medium">Proveedor</th>
                  <th className="text-left px-5 py-3 font-medium">Categoría</th>
                  <th className="text-left px-5 py-3 font-medium">Contacto</th>
                  <th className="text-center px-5 py-3 font-medium">Último pedido</th>
                  <th className="text-right px-5 py-3 font-medium">Monto mensual</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {PROVEEDORES.map(p => (
                  <tr key={p.nombre} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium">{p.nombre}</td>
                    <td className="px-5 py-3 text-[var(--text-2)]">{p.categoria}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                        <Phone size={12} />
                        {p.contacto}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center text-[var(--text-2)] tabular-nums">{p.ultimoPedido}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{formatDemoMXN(p.monto)}</td>
                    <td className="px-5 py-3 text-center">
                      {p.status === 'Activo' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-emerald-400 bg-emerald-400/10">
                          <CheckCircle size={12} />
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-amber-400 bg-amber-400/10">
                          <Clock size={12} />
                          Pendiente
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
