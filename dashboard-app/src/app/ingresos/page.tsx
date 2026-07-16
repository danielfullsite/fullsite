'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { Banknote, CreditCard, ArrowRightLeft, DollarSign } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregatePayments, getDashboardFromPosOrders } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const PAYMENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']

export default function IngresosPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(30).then(async d => {
      if (d.length === 0) {
        d = await getDashboardFromPosOrders(30)
      }
      setData(d)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // efectivo/tarjeta in wansoft_daily are PERCENTAGES, not MXN
  // Multiply by ventas_dia to get real amounts
  const totalEfectivo = useMemo(() => data.reduce((s, d) => {
    const pct = d.efectivo || 0
    return s + (pct < 100 ? (pct / 100) * (d.ventas_dia || 0) : pct)
  }, 0), [data])
  const totalTarjeta = useMemo(() => data.reduce((s, d) => {
    const pct = d.tarjeta || 0
    return s + (pct < 100 ? (pct / 100) * (d.ventas_dia || 0) : pct)
  }, 0), [data])
  const totalVentas = useMemo(() => data.reduce((s, d) => s + (d.ventas_dia || 0), 0), [data])
  const totalTransferencia = useMemo(() => {
    let sum = 0
    for (const day of data) {
      if (!day.pago_métodos || !Array.isArray(day.pago_métodos)) continue
      for (const m of day.pago_métodos) {
        if ((m.nombre || '').toLowerCase().includes('transferencia')) {
          // m.total is percentage — convert to MXN
          const pct = m.total || 0
          sum += pct < 100 ? (pct / 100) * (day.ventas_dia || 0) : pct
        }
      }
    }
    return sum
  }, [data])

  const payments = useMemo(() => aggregatePayments(data), [data])
  const paymentTotal = payments.reduce((s, p) => s + p.total, 0)
  const paymentMax = payments[0]?.total || 1

  // Daily cash flow chart
  const dailyChart = useMemo(() => {
    return data.map(d => {
      const ventas = d.ventas_dia || 0
      const rawEf = d.efectivo || 0
      const rawTj = d.tarjeta || 0
      return {
        fecha: new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
        efectivo: rawEf < 100 ? Math.round((rawEf / 100) * ventas) : rawEf,
        tarjeta: rawTj < 100 ? Math.round((rawTj / 100) * ventas) : rawTj,
      }
    })
  }, [data])

  return (
    <>
      <PageHeader
        title="Control de Ingresos"
        subtitle="Desglose de métodos de pago y flujo diario"
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
              label="Efectivo"
              value={formatCurrency(totalEfectivo)}
              subtitle={totalVentas > 0 ? `${((totalEfectivo / totalVentas) * 100).toFixed(1)}% del total` : ''}
              icon={Banknote}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Tarjeta"
              value={formatCurrency(totalTarjeta)}
              subtitle={totalVentas > 0 ? `${((totalTarjeta / totalVentas) * 100).toFixed(1)}% del total` : ''}
              icon={CreditCard}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Transferencia"
              value={formatCurrency(totalTransferencia)}
              subtitle={totalVentas > 0 ? `${((totalTransferencia / totalVentas) * 100).toFixed(1)}% del total` : ''}
              icon={ArrowRightLeft}
              accentClass="kpi-accent-purple"
            />
            <KPICard
              label="Total ingresos"
              value={formatCurrency(totalVentas)}
              subtitle={`${data.length} dias`}
              icon={DollarSign}
              accentClass="kpi-accent-amber"
            />
          </div>

          {/* Payment methods breakdown */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
            <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
              Desglose por metodo de pago
            </h3>
            <p className="text-xs text-[var(--text-3)] mb-5">
              Total: {formatCurrency(paymentTotal)}
            </p>
            {payments.length > 0 ? (
              <div className="space-y-4">
                {payments.map((p, i) => {
                  const pct = paymentTotal > 0 ? ((p.total / paymentTotal) * 100).toFixed(1) : '0'
                  const barWidth = paymentMax > 0 ? ((p.total / paymentMax) * 100) : 0
                  return (
                    <div key={p.nombre}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }}
                          />
                          <span className="text-sm font-medium text-[var(--text-1)]">{p.nombre}</span>
                        </div>
                        <span className="text-sm font-bold text-[var(--text-1)] tabular-nums">
                          {formatCurrency(p.total)}{' '}
                          <span className="text-[var(--text-3)] text-xs font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                        <div
                          className="h-2 rounded-full animate-progress"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[var(--text-3)] text-sm py-8 text-center">Sin datos de métodos de pago</p>
            )}
          </div>

          {/* Daily cash flow chart */}
          {dailyChart.length > 1 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
              <h3 className="text-sm font-semibold text-[var(--text-1)] mb-1">
                Flujo diario de efectivo y tarjeta
              </h3>
              <p className="text-xs text-[var(--text-3)] mb-5">{data.length} dias</p>
              <div className="h-[250px] sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChart}>
                    <defs>
                      <linearGradient id="colorEfectivo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorTarjeta" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      width={55}
                    />
                    <Tooltip
                      formatter={(value, name) => [formatCurrency(Number(value)), name === 'efectivo' ? 'Efectivo' : 'Tarjeta']}
                      contentStyle={{
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderRadius: '8px',
                        fontSize: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="efectivo"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#colorEfectivo)"
                      dot={false}
                      activeDot={{ r: 4, stroke: '#10b981', strokeWidth: 2, fill: 'var(--text-3)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tarjeta"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorTarjeta)"
                      dot={false}
                      activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 2, fill: 'var(--text-3)' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-6 mt-4 justify-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-xs text-[var(--text-2)]">Efectivo</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-xs text-[var(--text-2)]">Tarjeta</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </>
  )
}
