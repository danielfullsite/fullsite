'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, TrendingDown, TrendingUp, Calculator } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getMonthlyData } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface MonthlyPL {
  mes: string
  mesLabel: string
  ventasBrutas: number
  descuentos: number
  ventasNetas: number
  costoEstimado: number
  margenBruto: number
  margenPct: number
}

export default function EstadoResultadosPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMonthlyData().then(d => {
      setData(d)
      setLoading(false)
    })
  }, [])

  const monthlyPL = useMemo(() => {
    const map: Record<string, { brutas: number; descuentos: number; netas: number }> = {}

    for (const day of data) {
      const month = day.fecha.slice(0, 7)
      if (!map[month]) map[month] = { brutas: 0, descuentos: 0, netas: 0 }
      map[month].brutas += day.ventas_brutas || 0
      map[month].descuentos += day.descuentos || 0
      map[month].netas += day.ventas_dia || 0
    }

    return Object.entries(map)
      .map(([mes, vals]): MonthlyPL => {
        const costoEstimado = vals.netas * 0.35
        const margenBruto = vals.netas - costoEstimado
        const margenPct = vals.netas > 0 ? (margenBruto / vals.netas) * 100 : 0
        return {
          mes,
          mesLabel: new Date(mes + '-15T12:00:00').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
          ventasBrutas: vals.brutas,
          descuentos: vals.descuentos,
          ventasNetas: vals.netas,
          costoEstimado,
          margenBruto,
          margenPct,
        }
      })
      .sort((a, b) => b.mes.localeCompare(a.mes))
  }, [data])

  const totalBrutas = data.reduce((s, d) => s + (d.ventas_brutas || 0), 0)
  const totalDescuentos = data.reduce((s, d) => s + (d.descuentos || 0), 0)
  const totalNetas = data.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const totalCostoEstimado = totalNetas * 0.35
  const totalMargenBruto = totalNetas - totalCostoEstimado

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Estado de Resultados"
        subtitle="Profit & Loss - Resumen financiero mensual"
      />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 text-sm font-medium">Cargando datos...</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <KPICard
              label="Ventas brutas"
              value={formatCurrency(totalBrutas)}
              subtitle="Total historico"
              icon={DollarSign}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Descuentos"
              value={formatCurrency(totalDescuentos)}
              subtitle={totalBrutas > 0 ? `${((totalDescuentos / totalBrutas) * 100).toFixed(1)}% de ventas brutas` : ''}
              icon={TrendingDown}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="Ventas netas"
              value={formatCurrency(totalNetas)}
              subtitle="Despues de descuentos"
              icon={TrendingUp}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Margen bruto estimado"
              value={formatCurrency(totalMargenBruto)}
              subtitle="Food cost estimado al 35%"
              icon={Calculator}
              accentClass="kpi-accent-purple"
            />
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-blue-700 font-medium">
              Costos estimados
            </p>
            <p className="text-xs text-blue-600 mt-1">
              El costo de alimentos se estima al 35% de ventas netas. Para datos reales de food cost y labor cost,
              conecta los modulos de inventario y nomina de Wansoft.
            </p>
          </div>

          {/* Revenue section */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Ingresos
            </h3>
            <p className="text-xs text-slate-400 mb-5">Desglose de ventas</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-700">Ventas brutas</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(totalBrutas)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-red-600">(-) Descuentos</span>
                <span className="text-sm font-bold text-red-600 tabular-nums">-{formatCurrency(totalDescuentos)}</span>
              </div>
              <div className="flex items-center justify-between py-2 bg-slate-50 rounded-lg px-3">
                <span className="text-sm font-semibold text-slate-900">Ventas netas</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(totalNetas)}</span>
              </div>
            </div>
          </div>

          {/* Costs section */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Costos (estimado)
            </h3>
            <p className="text-xs text-slate-400 mb-5">Basado en porcentajes de industria</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-700">Food cost (35%)</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(totalCostoEstimado)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-400">Labor cost</span>
                <span className="text-sm text-slate-400">Conectar nomina</span>
              </div>
              <div className="flex items-center justify-between py-2 bg-emerald-50 rounded-lg px-3">
                <span className="text-sm font-semibold text-emerald-700">Margen bruto estimado</span>
                <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(totalMargenBruto)}</span>
              </div>
            </div>
          </div>

          {/* Monthly P&L table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              P&L mensual
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Estado de resultados por mes
            </p>

            {monthlyPL.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Mes</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">V. Brutas</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Descuentos</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">V. Netas</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Costo est.</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Margen</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyPL.map(row => (
                      <tr key={row.mes} className="hover:bg-slate-50/50 border-b border-slate-100">
                        <td className="py-3 px-3 text-slate-700 font-medium capitalize">{row.mesLabel}</td>
                        <td className="py-3 px-3 text-right text-slate-700 tabular-nums">{formatCurrency(row.ventasBrutas)}</td>
                        <td className="py-3 px-3 text-right text-red-500 tabular-nums">-{formatCurrency(row.descuentos)}</td>
                        <td className="py-3 px-3 text-right text-slate-900 font-semibold tabular-nums">{formatCurrency(row.ventasNetas)}</td>
                        <td className="py-3 px-3 text-right text-slate-500 tabular-nums">{formatCurrency(row.costoEstimado)}</td>
                        <td className="py-3 px-3 text-right text-emerald-600 font-semibold tabular-nums">{formatCurrency(row.margenBruto)}</td>
                        <td className="py-3 px-3 text-right text-slate-500 tabular-nums">{row.margenPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-400 text-sm py-8 text-center">Sin datos mensuales</p>
            )}
          </div>
        </>
      )}
    </>
  )
}
