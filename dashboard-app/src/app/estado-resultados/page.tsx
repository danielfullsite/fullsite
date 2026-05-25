'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, TrendingDown, TrendingUp, Calculator, FileText } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getMonthlyData, getLatestDeep } from '@/lib/data'
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

interface FoodCostItem {
  platillo: string
  qty: number
  precio: number
  costo: number
  margen_pct: number
}

interface PnlData {
  year: number
  months: Record<string, number[]>
}

export default function EstadoResultadosPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [foodCostPct, setFoodCostPct] = useState<number | null>(null)
  const [foodCostFecha, setFoodCostFecha] = useState<string | null>(null)
  const [foodCostItems, setFoodCostItems] = useState<FoodCostItem[]>([])
  const [pnlData, setPnlData] = useState<PnlData | null>(null)
  const [pnlPeriodo, setPnlPeriodo] = useState<string | null>(null)

  useEffect(() => {
    // Fetch all data in parallel
    Promise.all([
      getMonthlyData(),
      getLatestDeep('wansoft_food_cost'),
      getLatestDeep('wansoft_pnl'),
    ]).then(([monthly, foodCost, pnl]) => {
      setData(monthly)

      // Process food cost data
      if (foodCost && Array.isArray(foodCost.data)) {
        const items = foodCost.data as FoodCostItem[]
        setFoodCostItems(items)
        setFoodCostFecha(foodCost.fecha)
        const totalCosto = items.reduce((s, i) => s + (i.costo || 0), 0)
        const totalPrecio = items.reduce((s, i) => s + (i.precio || 0), 0)
        if (totalPrecio > 0) {
          setFoodCostPct(totalCosto / totalPrecio)
        }
      }

      // Process P&L data
      if (pnl && pnl.data) {
        const d = pnl.data as PnlData
        setPnlData(d)
        setPnlPeriodo((pnl as { periodo?: string }).periodo || pnl.fecha)
      }

      setLoading(false)
    })
  }, [])

  const effectiveFoodCostPct = foodCostPct ?? 0.35
  const isRealFoodCost = foodCostPct !== null

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
        const costoEstimado = vals.netas * effectiveFoodCostPct
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
  }, [data, effectiveFoodCostPct])

  const totalBrutas = data.reduce((s, d) => s + (d.ventas_brutas || 0), 0)
  const totalDescuentos = data.reduce((s, d) => s + (d.descuentos || 0), 0)
  const totalNetas = data.reduce((s, d) => s + (d.ventas_dia || 0), 0)
  const totalCostoEstimado = totalNetas * effectiveFoodCostPct
  const totalMargenBruto = totalNetas - totalCostoEstimado
  const foodCostLabel = isRealFoodCost
    ? `Food cost real ${(effectiveFoodCostPct * 100).toFixed(1)}%`
    : 'Food cost estimado al 35%'

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
            <p className="text-[var(--text-2)] text-sm font-medium">Cargando datos...</p>
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
              label={isRealFoodCost ? 'Margen bruto real' : 'Margen bruto estimado'}
              value={formatCurrency(totalMargenBruto)}
              subtitle={foodCostLabel}
              icon={Calculator}
              accentClass="kpi-accent-purple"
            />
          </div>

          {/* Info banner */}
          {isRealFoodCost ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-emerald-700 font-medium">
                Food cost real de Wansoft
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                El costo de alimentos se calcula con datos reales de Wansoft ({(effectiveFoodCostPct * 100).toFixed(1)}% promedio).
                {foodCostFecha && ` Ultima actualizacion: ${foodCostFecha}.`}
                {' '}Para labor cost, conecta el modulo de nomina.
              </p>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-blue-700 font-medium">
                Costos estimados
              </p>
              <p className="text-xs text-blue-600 mt-1">
                El costo de alimentos se estima al 35% de ventas netas. Para datos reales de food cost y labor cost,
                conecta los modulos de inventario y nomina de Wansoft.
              </p>
            </div>
          )}

          {/* Revenue section */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
              Ingresos
            </h3>
            <p className="text-xs text-[var(--text-3)] mb-5">Desglose de ventas</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-[var(--line-soft)]">
                <span className="text-sm text-[var(--text-1)]">Ventas brutas</span>
                <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(totalBrutas)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-[var(--line-soft)]">
                <span className="text-sm text-red-600">(-) Descuentos</span>
                <span className="text-sm font-bold text-red-600 tabular-nums">-{formatCurrency(totalDescuentos)}</span>
              </div>
              <div className="flex items-center justify-between py-2 bg-[var(--surface-2)] rounded-lg px-3">
                <span className="text-sm font-semibold text-[var(--text-1)]">Ventas netas</span>
                <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(totalNetas)}</span>
              </div>
            </div>
          </div>

          {/* Costs section */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
              Costos {isRealFoodCost ? '(real)' : '(estimado)'}
            </h3>
            <p className="text-xs text-[var(--text-3)] mb-5">
              {isRealFoodCost ? 'Basado en datos reales de Wansoft' : 'Basado en porcentajes de industria'}
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-[var(--line-soft)]">
                <span className="text-sm text-[var(--text-1)]">
                  Food cost ({(effectiveFoodCostPct * 100).toFixed(1)}%)
                  {isRealFoodCost && <span className="ml-1 text-xs text-emerald-600 font-medium">REAL</span>}
                </span>
                <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(totalCostoEstimado)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-[var(--line-soft)]">
                <span className="text-sm text-[var(--text-3)]">Labor cost</span>
                <span className="text-sm text-[var(--text-3)]">Conectar nomina</span>
              </div>
              <div className="flex items-center justify-between py-2 bg-emerald-50 rounded-lg px-3">
                <span className="text-sm font-semibold text-emerald-700">
                  Margen bruto {isRealFoodCost ? 'real' : 'estimado'}
                </span>
                <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(totalMargenBruto)}</span>
              </div>
            </div>
          </div>

          {/* Food cost detail table — only when real data exists */}
          {isRealFoodCost && foodCostItems.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
              <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
                Detalle de Food Cost
              </h3>
              <p className="text-xs text-[var(--text-3)] mb-5">
                Top platillos por costo — datos reales de Wansoft
                {foodCostFecha && ` (${foodCostFecha})`}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Platillo</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Qty</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Precio</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Costo</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Margen %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foodCostItems
                      .sort((a, b) => (b.costo || 0) - (a.costo || 0))
                      .slice(0, 20)
                      .map((item, i) => (
                        <tr key={i} className="hover:bg-[var(--surface-2)]/50 border-b border-[var(--line-soft)]">
                          <td className="py-3 px-3 text-[var(--text-1)] font-medium">{item.platillo}</td>
                          <td className="py-3 px-3 text-right text-[var(--text-1)] tabular-nums">{item.qty}</td>
                          <td className="py-3 px-3 text-right text-[var(--text-1)] tabular-nums">{formatCurrency(item.precio)}</td>
                          <td className="py-3 px-3 text-right text-[var(--text-1)] font-semibold tabular-nums">{formatCurrency(item.costo)}</td>
                          <td className={`py-3 px-3 text-right tabular-nums font-medium ${
                            (item.margen_pct || 0) >= 60 ? 'text-emerald-600' :
                            (item.margen_pct || 0) >= 40 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {(item.margen_pct || 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* P&L de Wansoft section */}
          {pnlData && pnlData.months && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-[var(--text-2)]" />
                <h3 className="text-sm font-semibold text-[var(--text-1)]">
                  P&L de Wansoft
                </h3>
              </div>
              <p className="text-xs text-[var(--text-3)] mb-5">
                Estado de resultados oficial
                {pnlPeriodo && ` — ${pnlPeriodo}`}
                {pnlData.year && ` (${pnlData.year})`}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Concepto</th>
                      {Object.keys(pnlData.months).length > 0 &&
                        (pnlData.months[Object.keys(pnlData.months)[0]] || []).map((_, idx) => (
                          <th key={idx} className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">
                            {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][idx] || `M${idx + 1}`}
                          </th>
                        ))
                      }
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pnlData.months).map(([label, values]) => {
                      const isTotal = label.toLowerCase().includes('total') || label.toLowerCase().includes('utilidad') || label.toLowerCase().includes('margen')
                      return (
                        <tr key={label} className={`border-b border-[var(--line-soft)] ${isTotal ? 'bg-[var(--surface-2)] font-semibold' : 'hover:bg-[var(--surface-2)]/50'}`}>
                          <td className={`py-2 px-3 ${isTotal ? 'text-[var(--text-1)] font-semibold' : 'text-[var(--text-1)]'}`}>{label}</td>
                          {(values || []).map((val, idx) => (
                            <td key={idx} className={`py-2 px-3 text-right tabular-nums ${
                              isTotal ? 'text-[var(--text-1)] font-semibold' :
                              val < 0 ? 'text-red-600' : 'text-[var(--text-1)]'
                            }`}>
                              {typeof val === 'number' ? formatCurrency(val) : val}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly P&L table */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
              P&L mensual
            </h3>
            <p className="text-xs text-[var(--text-3)] mb-5">
              Estado de resultados por mes
            </p>

            {monthlyPL.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Mes</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">V. Brutas</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Descuentos</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">V. Netas</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">
                        {isRealFoodCost ? 'Costo real' : 'Costo est.'}
                      </th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Margen</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyPL.map(row => (
                      <tr key={row.mes} className="hover:bg-[var(--surface-2)]/50 border-b border-[var(--line-soft)]">
                        <td className="py-3 px-3 text-[var(--text-1)] font-medium capitalize">{row.mesLabel}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-1)] tabular-nums">{formatCurrency(row.ventasBrutas)}</td>
                        <td className="py-3 px-3 text-right text-red-500 tabular-nums">-{formatCurrency(row.descuentos)}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-1)] font-semibold tabular-nums">{formatCurrency(row.ventasNetas)}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-2)] tabular-nums">{formatCurrency(row.costoEstimado)}</td>
                        <td className="py-3 px-3 text-right text-emerald-600 font-semibold tabular-nums">{formatCurrency(row.margenBruto)}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-2)] tabular-nums">{row.margenPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[var(--text-3)] text-sm py-8 text-center">Sin datos mensuales</p>
            )}
          </div>
        </>
      )}
    </>
  )
}
