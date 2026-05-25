'use client'

import { useState, useMemo, useCallback } from 'react'
import { FileBarChart, Download, DollarSign, Users, UtensilsCrossed, TrendingUp } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { getDateRange, aggregateMeseros, aggregateGrupos, aggregatePayments } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

type ReportType = 'ventas' | 'meseros' | 'platillos' | 'tendencias'

const reportOptions: { key: ReportType; label: string; icon: typeof DollarSign; description: string; color: string }[] = [
  { key: 'ventas', label: 'Reporte de Ventas', icon: DollarSign, description: 'Resumen de ventas netas, brutas, descuentos y métodos de pago', color: 'blue' },
  { key: 'meseros', label: 'Reporte de Meseros', icon: Users, description: 'Ranking de meseros por ventas, promedio diario y días activos', color: 'emerald' },
  { key: 'platillos', label: 'Reporte de Platillos', icon: UtensilsCrossed, description: 'Desglose por categoría de menú y productos más vendidos', color: 'amber' },
  { key: 'tendencias', label: 'Reporte de Tendencias', icon: TrendingUp, description: 'Comparativos mensuales, dia de la semana y ticket promedio', color: 'purple' },
]

const iconColorMap: Record<string, { active: string; inactive: string; activeBg: string; inactiveBg: string }> = {
  blue: { active: 'text-blue-400', inactive: 'text-[var(--text-3)]', activeBg: 'bg-blue-500/10', inactiveBg: 'bg-[var(--surface-2)]' },
  emerald: { active: 'text-emerald-600', inactive: 'text-[var(--text-3)]', activeBg: 'bg-emerald-500/10', inactiveBg: 'bg-[var(--surface-2)]' },
  amber: { active: 'text-amber-400', inactive: 'text-[var(--text-3)]', activeBg: 'bg-amber-500/10', inactiveBg: 'bg-[var(--surface-2)]' },
  purple: { active: 'text-purple-600', inactive: 'text-[var(--text-3)]', activeBg: 'bg-purple-500/10', inactiveBg: 'bg-[var(--surface-2)]' },
}

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

  const exportExcel = useCallback(() => {
    if (!data || data.length === 0) return

    // Build CSV (opens in Excel)
    const headers = ['Fecha', 'Ventas Netas', 'Ventas Brutas', 'Descuentos', 'Tickets', 'Personas', 'Ticket Promedio', 'Propinas']
    const rows = data.map(d => [
      d.fecha,
      d.ventas_dia || 0,
      d.ventas_brutas || 0,
      d.descuentos || 0,
      d.tickets_count || 0,
      d.personas_restaurant || 0,
      d.ticket_promedio_restaurant ? Math.round(d.ticket_promedio_restaurant) : 0,
      d.propinas_total || 0,
    ])

    // Add meseros sheet data
    const meseros = aggregateMeseros(data)
    const meserosHeaders = ['Mesero', 'Ventas', 'Dias Activos', 'Promedio Diario']
    const meserosRows = meseros.map(m => [m.nombre, m.total, m.dias, Math.round(m.total / (m.dias || 1))])

    // Build CSV with BOM for Excel compatibility
    const bom = '\uFEFF'
    let csv = bom
    csv += 'REPORTE DE ' + reportType.toUpperCase() + ' — ' + from + ' a ' + to + '\n\n'
    csv += headers.join(',') + '\n'
    rows.forEach(r => { csv += r.join(',') + '\n' })
    csv += '\n\nMESEROS\n'
    csv += meserosHeaders.join(',') + '\n'
    meserosRows.forEach(r => { csv += r.join(',') + '\n' })

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_${reportType}_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, reportType, from, to])

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {reportOptions.map(opt => {
          const Icon = opt.icon
          const isActive = reportType === opt.key
          const colors = iconColorMap[opt.color]
          return (
            <button
              key={opt.key}
              onClick={() => { setReportType(opt.key); setGenerated(false) }}
              className={`text-left p-5 rounded-xl border transition-all duration-200 ${
                isActive
                  ? 'border-blue-500/20 bg-[var(--surface)] shadow-md ring-1 ring-blue-500/10'
                  : 'border-[var(--line)] bg-[var(--surface)] shadow-sm hover:shadow-md hover:border-[var(--line)]'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                isActive ? colors.activeBg : colors.inactiveBg
              }`}>
                <Icon size={20} className={isActive ? colors.active : colors.inactive} />
              </div>
              <p className={`text-sm font-semibold mb-0.5 ${isActive ? 'text-[var(--text-1)]' : 'text-[var(--text-1)]'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-[var(--text-3)] leading-relaxed">{opt.description}</p>
            </button>
          )
        })}
      </div>

      {/* Date range + generate */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Fecha inicio</label>
            <input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setGenerated(false) }}
              className="px-3 py-2 rounded-lg text-sm border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Fecha fin</label>
            <input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setGenerated(false) }}
              className="px-3 py-2 rounded-lg text-sm border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-500/100 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
          >
            <FileBarChart size={16} />
            {loading ? 'Generando...' : 'Generar reporte'}
          </button>
          <button
            onClick={() => window.print()}
            disabled={!generated || data.length === 0}
            className="px-4 py-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-700 hover:bg-blue-100 disabled:bg-[var(--surface-2)] disabled:border-[var(--line)] disabled:text-[var(--text-3)] disabled:cursor-not-allowed rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Download size={16} />
            Generar PDF
          </button>
          <button
            onClick={exportExcel}
            disabled={!generated || data.length === 0}
            className="px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/15 disabled:bg-[var(--surface-2)] disabled:border-[var(--line)] disabled:text-[var(--text-3)] disabled:cursor-not-allowed rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Download size={16} />
            Generar Excel
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--text-2)] text-sm font-medium">Generando reporte...</p>
          </div>
        </div>
      )}

      {/* Report output */}
      {generated && reportData && !loading && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
          {/* Report header */}
          <div className="p-6 border-b border-[var(--line)] bg-[var(--surface-2)]/30">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconColorMap[selectedReport.color].activeBg}`}>
                <selectedReport.icon size={20} className={iconColorMap[selectedReport.color].active} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-1)]">{selectedReport.label}</h2>
                <p className="text-xs text-[var(--text-3)]">
                  Del {from} al {to} - {reportData.dias} días con datos
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Ventas netas', value: formatCurrency(reportData.totalVentas) },
                { label: 'Ventas brutas', value: formatCurrency(reportData.totalBrutas) },
                { label: 'Descuentos', value: formatCurrency(reportData.totalDescuentos) },
                { label: 'Tickets', value: formatNumber(reportData.totalTickets) },
                { label: 'Personas', value: formatNumber(reportData.totalPersonas) },
                { label: 'Ticket prom.', value: formatCurrency(reportData.avgTicket) },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-[var(--surface-2)] rounded-lg p-3 text-center border border-[var(--line-soft)]">
                  <p className="text-[10px] font-medium text-[var(--text-2)] uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-lg font-bold text-[var(--text-1)]">{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* Report-specific content */}
            {reportType === 'ventas' && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-1)] mb-3">Métodos de pago</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/50">
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Método</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Total</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.payments.map(p => (
                        <tr key={p.nombre} className="border-b border-[var(--line-soft)] hover:bg-blue-500/10/30 transition-colors">
                          <td className="py-2.5 px-4 text-sm font-medium text-[var(--text-1)]">{p.nombre}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">{formatCurrency(p.total)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">
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
                <h3 className="text-sm font-semibold text-[var(--text-1)] mb-3">Ranking de meseros</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/50">
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">#</th>
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Mesero</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Total ventas</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Prom. diario</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Dias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.meseros.map((m, i) => {
                        const meseroMax = reportData.meseros[0]?.total || 1
                        const barWidth = meseroMax > 0 ? ((m.total / meseroMax) * 100) : 0
                        return (
                          <tr key={m.nombre} className="border-b border-[var(--line-soft)] hover:bg-blue-500/10/30 transition-colors">
                            <td className="py-2.5 px-4 text-sm text-[var(--text-3)] font-medium">{i + 1}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-[var(--text-1)]">{m.nombre}</span>
                              </div>
                              <div className="mt-1 w-32 bg-[var(--surface-2)] rounded-full h-1">
                                <div className="h-1 rounded-full bg-blue-500/100 animate-progress" style={{ width: `${barWidth}%` }} />
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">{formatCurrency(m.total)}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">{formatCurrency(m.promedio)}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">{m.dias}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'platillos' && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-1)] mb-3">Ventas por categoría</h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-striped">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/50">
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">#</th>
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Categoría</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Total</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.grupos.map((g, i) => {
                        const totalG = reportData.grupos.reduce((s, x) => s + x.total, 0)
                        return (
                          <tr key={g.nombre} className="border-b border-[var(--line-soft)] hover:bg-blue-500/10/30 transition-colors">
                            <td className="py-2.5 px-4 text-sm text-[var(--text-3)]">{i + 1}</td>
                            <td className="py-2.5 px-4 text-sm font-medium text-[var(--text-1)]">{g.nombre}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">{formatCurrency(g.total)}</td>
                            <td className="py-2.5 px-4 text-sm text-right tabular-nums">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400">
                                {totalG > 0 ? ((g.total / totalG) * 100).toFixed(1) : 0}%
                              </span>
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
                <h3 className="text-sm font-semibold text-[var(--text-1)] mb-3">Tendencia diaria</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full table-striped">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/80 backdrop-blur-sm">
                        <th className="text-left text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Fecha</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Ventas</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Tickets</th>
                        <th className="text-right text-xs font-semibold text-[var(--text-2)] py-3 px-4 uppercase tracking-wider">Ticket prom.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map(d => (
                        <tr key={d.fecha} className="border-b border-[var(--line-soft)] hover:bg-blue-500/10/30 transition-colors">
                          <td className="py-2.5 px-4 text-sm font-medium text-[var(--text-1)]">
                            {new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            })}
                          </td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums font-bold text-[var(--text-1)]">{formatCurrency(d.ventas_dia)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">{formatNumber(d.tickets_count)}</td>
                          <td className="py-2.5 px-4 text-sm text-right tabular-nums text-[var(--text-2)]">{formatCurrency(d.ticket_promedio_restaurant)}</td>
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
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-12 text-center hover:shadow-md transition-shadow">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileBarChart size={32} className="text-blue-500" />
          </div>
          <p className="text-[var(--text-2)] text-sm">
            Selecciona un tipo de reporte y rango de fechas, luego presiona &quot;Generar reporte&quot;
          </p>
        </div>
      )}
    </>
  )
}
