'use client'

import Link from 'next/link'
import { ArrowLeft, FileText, DollarSign, Hash, Percent } from 'lucide-react'
import { DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const CFDIS = [
  { folio: 'CM-00412', rfc: 'GARA850320KL9', razon_social: 'Alejandra Garcia Ramirez', monto: 4850, fecha: '2026-05-25', status: 'timbrada' },
  { folio: 'CM-00411', rfc: 'TRE9104156P3', razon_social: 'Treviño & Asociados SC', monto: 12680, fecha: '2026-05-24', status: 'timbrada' },
  { folio: 'CM-00410', rfc: 'GNM070215QA8', razon_social: 'Grupo Nuevo Monterrey SA de CV', monto: 28400, fecha: '2026-05-24', status: 'timbrada' },
  { folio: 'CM-00409', rfc: 'LOPH880912MN2', razon_social: 'Hugo Lopez Perez', monto: 3200, fecha: '2026-05-23', status: 'cancelada' },
  { folio: 'CM-00408', rfc: 'CDI150430R67', razon_social: 'Corporativo Delta Industrial SA', monto: 45200, fecha: '2026-05-23', status: 'timbrada' },
  { folio: 'CM-00407', rfc: 'MEVS910725JK4', razon_social: 'Sandra Medina Villarreal', monto: 6750, fecha: '2026-05-22', status: 'timbrada' },
  { folio: 'CM-00406', rfc: 'RSM200610FT1', razon_social: 'Restaurantes San Miguel SA de CV', monto: 18900, fecha: '2026-05-21', status: 'pendiente' },
  { folio: 'CM-00405', rfc: 'CANT760508LR3', razon_social: 'Tomas Cantu Elizondo', monto: 8420, fecha: '2026-05-20', status: 'timbrada' },
]

const STATUS_COLORS: Record<string, string> = {
  'timbrada': 'bg-emerald-400/10 text-emerald-400',
  'cancelada': 'bg-red-400/10 text-red-400',
  'pendiente': 'bg-yellow-400/10 text-yellow-400',
}

export default function DemoFacturacion() {
  const timbradas = CFDIS.filter(c => c.status === 'timbrada')
  const totalFacturado = timbradas.reduce((s, c) => s + c.monto, 0)
  const numFacturas = CFDIS.length
  const ventasMes = 1021216 // same as estado-resultados
  const pctFacturado = ((totalFacturado / ventasMes) * 100).toFixed(1)
  const canceladas = CFDIS.filter(c => c.status === 'cancelada').length
  const pendientes = CFDIS.filter(c => c.status === 'pendiente').length

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Facturacion CFDI</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Mayo 2026</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total facturado', value: formatDemoMXN(totalFacturado), icon: DollarSign, color: 'text-emerald-400' },
            { label: 'Facturas emitidas', value: numFacturas.toString(), icon: Hash, color: 'text-blue-400' },
            { label: '% facturado vs ventas', value: `${pctFacturado}%`, icon: Percent, color: 'text-purple-400' },
            { label: 'Pendientes / Canceladas', value: `${pendientes} / ${canceladas}`, icon: FileText, color: pendientes > 0 ? 'text-yellow-400' : 'text-emerald-400' },
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

        {/* CFDI Table */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold">Facturas recientes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-3)]">
                  <th className="text-left px-5 py-3 font-medium">Folio</th>
                  <th className="text-left px-5 py-3 font-medium">RFC receptor</th>
                  <th className="text-left px-5 py-3 font-medium">Razon social</th>
                  <th className="text-right px-5 py-3 font-medium">Monto</th>
                  <th className="text-left px-5 py-3 font-medium">Fecha</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {CFDIS.map((cfdi) => (
                  <tr key={cfdi.folio} className="border-b border-[var(--line)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-mono font-medium text-blue-400">{cfdi.folio}</td>
                    <td className="px-5 py-3 font-mono text-[var(--text-2)] text-xs">{cfdi.rfc}</td>
                    <td className="px-5 py-3 text-zinc-300">{cfdi.razon_social}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium">
                      {cfdi.status === 'cancelada'
                        ? <span className="line-through text-[var(--text-4)]">{formatDemoMXN(cfdi.monto)}</span>
                        : formatDemoMXN(cfdi.monto)
                      }
                    </td>
                    <td className="px-5 py-3 font-mono text-[var(--text-2)]">{cfdi.fecha}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[cfdi.status]}`}>
                        {cfdi.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Status breakdown */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-4">Resumen por status</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Timbradas', count: timbradas.length, total: totalFacturado, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
              { label: 'Pendientes', count: pendientes, total: CFDIS.filter(c => c.status === 'pendiente').reduce((s, c) => s + c.monto, 0), color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              { label: 'Canceladas', count: canceladas, total: CFDIS.filter(c => c.status === 'cancelada').reduce((s, c) => s + c.monto, 0), color: 'text-red-400', bg: 'bg-red-400/10' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
                <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-xs text-[var(--text-2)] mt-1">{s.label}</p>
                <p className="text-sm font-mono mt-2">{formatDemoMXN(s.total)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
