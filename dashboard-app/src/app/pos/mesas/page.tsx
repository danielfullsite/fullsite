'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users } from 'lucide-react'
import { MESAS_CONFIG, formatMXN } from '@/lib/pos-data'
import type { Mesa } from '@/lib/pos-data'

// Simulated occupied tables for demo
const DEMO_STATE: Record<number, Partial<Mesa>> = {
  2: { status: 'ocupada', mesero: 'Omar Aguilera', personas: 3, total: 485 },
  5: { status: 'ocupada', mesero: 'Brayan Berlanga', personas: 2, total: 310 },
  7: { status: 'cuenta', mesero: 'Daniela Rico', personas: 4, total: 1250 },
  9: { status: 'ocupada', mesero: 'Hector Rodriguez', personas: 6, total: 890 },
  12: { status: 'cuenta', mesero: 'Oscar Rios', personas: 2, total: 620 },
}

export default function MesasPage() {
  const router = useRouter()
  const [mesas] = useState<Mesa[]>(() =>
    MESAS_CONFIG.map((m) => ({
      ...m,
      ...(DEMO_STATE[m.number] || {}),
    }))
  )

  const statusColor: Record<string, string> = {
    disponible: 'bg-emerald-900/50 border-emerald-600 hover:bg-emerald-800/60',
    ocupada: 'bg-blue-900/50 border-blue-600 hover:bg-blue-800/60',
    cuenta: 'bg-amber-900/50 border-amber-600 hover:bg-amber-800/60',
  }

  const statusLabel: Record<string, string> = {
    disponible: 'Disponible',
    ocupada: 'Ocupada',
    cuenta: 'Esperando pago',
  }

  const statusDot: Record<string, string> = {
    disponible: 'bg-emerald-400',
    ocupada: 'bg-blue-400',
    cuenta: 'bg-amber-400',
  }

  const counts = {
    disponible: mesas.filter((m) => m.status === 'disponible').length,
    ocupada: mesas.filter((m) => m.status === 'ocupada').length,
    cuenta: mesas.filter((m) => m.status === 'cuenta').length,
  }

  const handleTableClick = (mesa: Mesa) => {
    // Navigate to POS with table pre-selected
    router.push(`/pos?mesa=${mesa.number}`)
  }

  return (
    <div className="h-screen flex flex-col text-white">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/pos"
            className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Mesas</h1>
            <p className="text-slate-400 text-sm">AMALAY Coffee & Market</p>
          </div>
        </div>

        {/* Status legend */}
        <div className="flex items-center gap-6">
          {Object.entries(counts).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${statusDot[status]}`}
              />
              <span className="text-sm text-slate-300">
                {statusLabel[status]}{' '}
                <span className="text-slate-500">({count})</span>
              </span>
            </div>
          ))}
        </div>
      </header>

      {/* Table Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
          {mesas.map((mesa) => (
            <button
              key={mesa.number}
              onClick={() => handleTableClick(mesa)}
              className={`rounded-2xl border-2 p-5 transition-all active:scale-95 min-h-[160px] flex flex-col justify-between ${statusColor[mesa.status]}`}
            >
              {/* Table number */}
              <div className="flex items-start justify-between">
                <span className="text-3xl font-bold">{mesa.number}</span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    mesa.status === 'disponible'
                      ? 'bg-emerald-600/30 text-emerald-300'
                      : mesa.status === 'ocupada'
                      ? 'bg-blue-600/30 text-blue-300'
                      : 'bg-amber-600/30 text-amber-300'
                  }`}
                >
                  {statusLabel[mesa.status]}
                </span>
              </div>

              {/* Table info */}
              <div className="mt-3">
                {mesa.status !== 'disponible' ? (
                  <>
                    <p className="text-slate-300 text-sm truncate">
                      {mesa.mesero}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-1 text-slate-400 text-sm">
                        <Users size={14} />
                        <span>{mesa.personas}</span>
                      </div>
                      {mesa.total != null && (
                        <span className="text-white font-semibold">
                          {formatMXN(mesa.total)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">
                    {mesa.capacity} lugares
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
