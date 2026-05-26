'use client'

import Link from 'next/link'
import { ArrowLeft, Gift, CreditCard, CheckCircle, Clock } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const STATS = [
  { label: 'Vendidas este mes', value: '23', icon: Gift, color: 'text-violet-400' },
  { label: 'Monto total', value: formatDemoMXN(8050), icon: CreditCard, color: 'text-emerald-400' },
  { label: 'Canjeadas', value: '15', icon: CheckCircle, color: 'text-blue-400' },
  { label: 'Pendientes', value: '8', icon: Clock, color: 'text-amber-400' },
]

const TARJETAS = [
  { codigo: 'GC-2401', monto: 500, comprador: 'Ana Trevino', fecha: '2026-05-24', status: 'Activa' },
  { codigo: 'GC-2402', monto: 300, comprador: 'Roberto Cantu', fecha: '2026-05-23', status: 'Canjeada' },
  { codigo: 'GC-2403', monto: 1000, comprador: 'Maria Gonzalez', fecha: '2026-05-22', status: 'Activa' },
  { codigo: 'GC-2404', monto: 250, comprador: 'Luis Garza', fecha: '2026-05-20', status: 'Canjeada' },
  { codigo: 'GC-2405', monto: 500, comprador: 'Sofia Hernandez', fecha: '2026-05-19', status: 'Activa' },
  { codigo: 'GC-2406', monto: 200, comprador: 'Carlos Salinas', fecha: '2026-05-15', status: 'Expirada' },
  { codigo: 'GC-2407', monto: 750, comprador: 'Diana Flores', fecha: '2026-05-12', status: 'Canjeada' },
  { codigo: 'GC-2408', monto: 350, comprador: 'Fernando Leal', fecha: '2026-05-10', status: 'Activa' },
]

const statusColor: Record<string, string> = {
  'Activa': 'bg-emerald-500/10 text-emerald-400',
  'Canjeada': 'bg-blue-500/10 text-blue-400',
  'Expirada': 'bg-zinc-500/10 text-[var(--text-3)]',
}

export default function DemoGiftCards() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Tarjetas de Regalo</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Mayo 2026</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-[var(--text-3)]">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--line)]">
            <p className="text-sm font-medium">Historial de tarjetas</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--text-3)]">
                <th className="text-left px-5 py-3 font-medium">Codigo</th>
                <th className="text-right px-5 py-3 font-medium">Monto</th>
                <th className="text-left px-5 py-3 font-medium">Comprado por</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Fecha</th>
                <th className="text-center px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {TARJETAS.map((t) => (
                <tr key={t.codigo} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-5 py-3 text-sm font-mono text-[var(--text-2)]">{t.codigo}</td>
                  <td className="px-5 py-3 text-sm text-right font-medium">{formatDemoMXN(t.monto)}</td>
                  <td className="px-5 py-3 text-sm">{t.comprador}</td>
                  <td className="px-5 py-3 text-sm text-[var(--text-2)] hidden md:table-cell">{t.fecha}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[t.status]}`}>
                      {t.status}
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
