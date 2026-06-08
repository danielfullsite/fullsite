'use client'

import { useEffect, useState } from 'react'
import { Building2, TrendingUp, Users, UtensilsCrossed, DollarSign } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getRecentDays, aggregateMeseros } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'

interface LocationStats {
  locationId: string
  locationName: string
  ventasTotal: number
  ticketPromedio: number
  ticketsTotal: number
  diasConDatos: number
  topMesero: string
  topMeseroVentas: number
  topGrupo: string
  topGrupoVentas: number
}

export default function SucursalesPage() {
  const { clientId, locations } = useAuth()
  const [stats, setStats] = useState<LocationStats[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (!clientId || locations.length === 0) {
      setLoading(false)
      return
    }

    async function loadAll() {
      setLoading(true)
      const results: LocationStats[] = []

      for (const loc of locations) {
        const data = await getRecentDays(days, clientId!, loc.id)
        const meseros = aggregateMeseros(data)
        const grupos: Record<string, number> = {}
        for (const day of data) {
          for (const g of (day.ventas_por_grupo || [])) {
            if (g.nombre) grupos[g.nombre] = (grupos[g.nombre] || 0) + (g.total || 0)
          }
        }
        const topGrupoEntry = Object.entries(grupos).sort((a, b) => b[1] - a[1])[0]

        const ventasTotal = data.reduce((s, d) => s + d.ventas_dia, 0)
        const ticketsTotal = data.reduce((s, d) => s + d.tickets_count, 0)

        results.push({
          locationId: loc.id,
          locationName: loc.name,
          ventasTotal,
          ticketPromedio: ticketsTotal > 0 ? ventasTotal / ticketsTotal : 0,
          ticketsTotal,
          diasConDatos: data.length,
          topMesero: meseros[0]?.nombre || '—',
          topMeseroVentas: meseros[0]?.total || 0,
          topGrupo: topGrupoEntry?.[0] || '—',
          topGrupoVentas: topGrupoEntry?.[1] || 0,
        })
      }

      setStats(results)
      setLoading(false)
    }

    loadAll()
  }, [clientId, locations, days])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (locations.length < 2) {
    return (
      <>
        <PageHeader title="Sucursales" subtitle="Comparativo entre ubicaciones" />
        <EmptyState
          icon={Building2}
          title="Una sola ubicación"
          description="Cuando tengas más de una sucursal, aquí verás el comparativo lado a lado: ventas, ticket promedio, top meseros y categorías por ubicación."
        />
      </>
    )
  }

  const maxVentas = Math.max(...stats.map(s => s.ventasTotal), 1)

  return (
    <>
      <PageHeader
        title="Sucursales"
        subtitle={`Comparativo ${days} días · ${locations.length} ubicaciones`}
      />

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              days === d ? 'bg-emerald-500 text-black' : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >{d}d</button>
        ))}
      </div>

      {/* Location cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stats.map(loc => (
          <div key={loc.locationId} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Building2 size={18} className="text-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--text-1)]">{loc.locationName}</h3>
                <p className="text-xs text-[var(--text-3)]">{loc.diasConDatos} días con datos</p>
              </div>
            </div>

            {/* Revenue bar */}
            <div className="mb-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-[var(--text-3)]">Ventas totales</span>
                <span className="text-lg font-bold text-[var(--text-1)]">{formatCurrency(loc.ventasTotal)}</span>
              </div>
              <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${(loc.ventasTotal / maxVentas) * 100}%` }} />
              </div>
            </div>

            {/* KPIs grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--surface-2)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign size={12} className="text-[var(--text-3)]" />
                  <span className="text-[11px] text-[var(--text-3)]">Ticket promedio</span>
                </div>
                <p className="text-sm font-bold text-[var(--text-1)]">{formatCurrency(loc.ticketPromedio)}</p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp size={12} className="text-[var(--text-3)]" />
                  <span className="text-[11px] text-[var(--text-3)]">Tickets</span>
                </div>
                <p className="text-sm font-bold text-[var(--text-1)]">{loc.ticketsTotal.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users size={12} className="text-[var(--text-3)]" />
                  <span className="text-[11px] text-[var(--text-3)]">Top mesero</span>
                </div>
                <p className="text-sm font-bold text-[var(--text-1)] truncate">{loc.topMesero}</p>
                <p className="text-[11px] text-[var(--text-3)]">{formatCurrency(loc.topMeseroVentas)}</p>
              </div>
              <div className="bg-[var(--surface-2)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <UtensilsCrossed size={12} className="text-[var(--text-3)]" />
                  <span className="text-[11px] text-[var(--text-3)]">Top categoría</span>
                </div>
                <p className="text-sm font-bold text-[var(--text-1)] truncate">{loc.topGrupo}</p>
                <p className="text-[11px] text-[var(--text-3)]">{formatCurrency(loc.topGrupoVentas)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
