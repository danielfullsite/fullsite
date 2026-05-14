'use client'

import { useState, useMemo, useCallback } from 'react'
import { FileBarChart, Download, DollarSign, Users, UtensilsCrossed, TrendingUp } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { getDateRange, aggregateMeseros, aggregateGrupos, aggregatePayments } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

type ReportType = 'ventas' | 'meseros' | 'platillos' | 'tendencias'

const reportOptions: { key: ReportType; label: string; icon: typeof DollarSign; description: string }[] = [
  { key: 'ventas', label: 'Reporte de Ventas', icon: DollarSign, description: 'Resumen de ventas netas, brutas, descuentos y metodos de pago' },
  { key: 'meseros', label: 'Reporte de Meseros', icon: Users, description: 'Ranking de meseros por ventas, promedio diario y dias activos' },
  { key: 'platillos', label: 'Reporte de Platillos', icon: UtensilsCrossed, description: 'Desglose por categoria de menu y productos mas vendidos' },
  { key: 'tendencias', label: 'Reporte de Tendencias', icon: TrendingUp, description: 'Comparativos mensuales, dia de la semana y ticket promedio' },
]

export default function ReportesPage() {
  const [reportType, setReportType] = useState<ReportType>('ventas')
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    setGenerated(false)
    try {
      const result = await getDateRange(from, to)
      setData(result)
      setGenerated(true)
    } catch (err) {
      console.error('Error generating report:', err)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  const selectedReport = reportOptions.find(r => r.key === reportType)!

  // Report data
  const reportData = useMemo(() => {
    if (!generated || data.length === 0) return null

    const totalVentas = data.reduce((s, d) => s + (d.ventas_dia || 0), 0)
    const totalBrutas = data.reduce((s, d) => s + (d.ventas_brutas || 0), 0)
    const totalDescuentos = data.reduce((s, d) => s + (d.descuentos || 0), 0)
    const totalTickets = data.reduce((s, d) => s + (d.tickets_count || 0), 0)
    const totalPersonas = data.reduce((s, d) => s + (d.personas_restaurant || 0), 0)
    const avgTicket = totalTickets > 0 ? Math.round(totalVentas / totalTickets) : 0

    return {
      totalVentas,
      totalBrutas,
      totalDescuentos,
      totalTickets,
      totalPersonas,
      avgTicket,
      meseros: aggregateMeseros(data),
      grupos: aggregateGrupos(data),
      payments: aggregatePayments(data),
      dias: data.length,
    }
  }, [data, generated])

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Generador de Reportes"
        subtitle="Selecciona un tipo de reporte, rango de fechas y genera"
      />

      {/* Report selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {reportOptions.map(opt => {
          const Icon = opt.icon
          const isActive = reportType === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => { setReportType(opt.key); setGenerated(false) }}
              className={`text-left p-4 rounded-xl border transition-all ${
                isActive
                  ? 'border-accent bg-accent/5 shadow-sm'
                  : 'border-border bg-card hover:border-accent/30'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${
                isActive ? 'bg-accent/15' : 'bg-surface'
              }`}>
                <Icon size={18} className={isActive ? 'text-accent' : 'text-text-muted'} />
              </div>
              <p className={`text-sm font-semibold mb-0.5 ${isActive ? 'text-accent' : 'text-text'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-text-muted">{opt.description}</p>
            </button>
          )
        })}
      </div>

      {/* Date range + generate */}
      <div className="bg-card rounded-xl border border-border p-5 card-shadow mb-8">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-text-soft mb-1.5">Fecha inicio</label>
            <input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setGenerated(false) }}
              className="px-3 py-2 rounded-lg text-sm border border-border bg-white text-text"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-soft mb-1.5">Fecha fin</label>
            <input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setGenerated(false) }}
              className="px-3 py-2 rounded-lg text-sm border border-border bg-white text-text"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <FileBarChart size={16} />
            {loading ? 'Generando...' : 'Generar reporte'}
          </button>
          <button
            disabled
            className="px-4 py-2 bg-surface border border-border text-text-muted rounded-lg text-sm font-medium flex items-center gap-2 cursor-not-allowed opacity-50"
            title="Proximamente"
          >
            <Download size={16} />
            Generar PDF
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-text-soft text-sm font-medium">Generando reporte...</p>
          </div>
        </div>
      )}

      {/* Report output */}
      {generated && reportData && !loading && (
        <div className="bg-card rounded-xl border border-border card-shadow overflow-hidden">
          {/* Report header */}
          <div className="p-6 border-b border-border bg-surface/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center">
                <selectedReport.icon size={20} className="text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-text">{selectedReport.label}</h2>
                <p className="text-xs text-text-muted">
                  Del {from} al {to} - {reportData.dias} dias con datos
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Ventas netas</p>
                <p className="text-lg font-bold text-text">{formatCurrency(reportData.totalVentas)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Ventas brutas</p>
                <p className="text-lg font-bold text-text">{formatCurrency(reportData.totalBrutas)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Descuentos</p>
                <p className="text-lg font-bold text-text">{formatCurrency(reportData.totalDescuentos)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Tickets</p>
                <p className="text-lg font-bold text-text">{formatNumber(reportData.totalTickets)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Personas</p>
                <p className="text-lg font-bold text-text">{formatNumber(reportData.totalPersonas)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 text-center">
                <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Ticket prom.</p>
                <p className="text-lg font-bold text-text">{formatCurrency(reportData.avgTicket)}</p>
              </div>
            </div>

            {/* Report-specific content */}
            {reportType === 'ventas' && (
              <div>
                <h3 className="text-sm font-semibold text-text mb-3">Metodos de pago</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-border bg-surface/50">
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Metodo</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Total</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.payments.map(p => (
                        <tr key={p.nombre} className="border-b border-border/50">
                          <td className="py-2.5 px-4 text-sm font-medium text-text">{p.nombre}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-text">{formatCurrency(p.total)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">
                            {reportData.totalVentas > 0 ? ((p.total / reportData.totalVentas) * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'meseros' && (
              <div>
                <h3 className="text-sm font-semibold text-text mb-3">Ranking de meseros</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-border bg-surface/50">
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">#</th>
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Mesero</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Total ventas</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Prom. diario</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Dias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.meseros.map((m, i) => (
                        <tr key={m.nombre} className="border-b border-border/50">
                          <td className="py-2.5 px-4 text-sm text-text-muted">{i + 1}</td>
                          <td className="py-2.5 px-4 text-sm font-medium text-text">{m.nombre}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-text">{formatCurrency(m.total)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">{formatCurrency(m.promedio)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">{m.dias}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'platillos' && (
              <div>
                <h3 className="text-sm font-semibold text-text mb-3">Ventas por categoria</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-border bg-surface/50">
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">#</th>
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Categoria</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Total</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.grupos.map((g, i) => {
                        const totalG = reportData.grupos.reduce((s, x) => s + x.total, 0)
                        return (
                          <tr key={g.nombre} className="border-b border-border/50">
                            <td className="py-2.5 px-4 text-sm text-text-muted">{i + 1}</td>
                            <td className="py-2.5 px-4 text-sm font-medium text-text">{g.nombre}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-text">{formatCurrency(g.total)}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">
                              {totalG > 0 ? ((g.total / totalG) * 100).toFixed(1) : 0}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'tendencias' && (
              <div>
                <h3 className="text-sm font-semibold text-text mb-3">Tendencia diaria</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full table-striped">
                    <thead className="sticky top-0">
                      <tr className="border-b border-border bg-surface">
                        <th className="text-left text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Fecha</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Ventas</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Tickets</th>
                        <th className="text-right text-xs font-semibold text-text-soft py-3 px-4 uppercase tracking-wider">Ticket prom.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map(d => (
                        <tr key={d.fecha} className="border-b border-border/50">
                          <td className="py-2.5 px-4 text-sm font-medium text-text">
                            {new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            })}
                          </td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-text">{formatCurrency(d.ventas_dia)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">{formatNumber(d.tickets_count)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-text-soft">{formatCurrency(d.ticket_promedio_restaurant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!generated && !loading && (
        <div className="bg-card rounded-xl border border-border p-12 card-shadow text-center">
          <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileBarChart size={32} className="text-accent" />
          </div>
          <p className="text-text-soft text-sm">
            Selecciona un tipo de reporte y rango de fechas, luego presiona &quot;Generar reporte&quot;
          </p>
        </div>
      )}
    </>
  )
}
