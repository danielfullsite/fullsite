'use client'

import { useEffect, useState, useMemo } from 'react'
import { HandCoins, Users, TrendingUp, CreditCard } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays, aggregatePayments, getLatestDeep } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

const PROPINA_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']

export default function PropinasPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [realTips, setRealTips] = useState<{ mesero: string; ventas: number; tickets: number; propinas: number; propina_promedio: number }[] | null>(null)

  useEffect(() => {
    Promise.all([
      getRecentDays(30),
      getLatestDeep('wansoft_tips'),
    ]).then(([d, tips]) => {
      setData(d)
      if (tips && Array.isArray(tips.data) && tips.data.length > 0) {
        setRealTips(tips.data as typeof realTips)
      }
      setLoading(false)
    })
  }, [])

  const totalPropinas = useMemo(() => data.reduce((s, d) => s + (d.propinas_total || 0), 0), [data])
  const totalVentas = useMemo(() => data.reduce((s, d) => s + (d.ventas_dia || 0), 0), [data])
  const diasConPropinas = useMemo(() => data.filter(d => (d.propinas_total || 0) > 0).length, [data])
  const propinaPromedio = diasConPropinas > 0 ? totalPropinas / diasConPropinas : 0
  const pctSobreVentas = totalVentas > 0 ? (totalPropinas / totalVentas) * 100 : 0

  // Propinas por mesero — real data from wansoft_tips, or estimated fallback
  const isRealTipsData = realTips !== null
  const propinasPorMesero = useMemo(() => {
    // Use real data if available
    if (realTips) {
      return realTips
        .filter(m => m.mesero && m.mesero !== 'MESERO EVENTO')
        .map(m => ({
          nombre: m.mesero,
          propinas: m.propinas || 0,
          ventas: m.ventas || 0,
          dias: m.tickets || 0,
        }))
        .sort((a, b) => b.propinas - a.propinas)
    }

    // Fallback: estimate from mesero ventas proportion
    const meseroMap: Record<string, { ventas: number; dias: number }> = {}
    let totalMeseroVentas = 0

    for (const day of data) {
      if (!day.meseros || !Array.isArray(day.meseros)) continue
      for (const m of day.meseros) {
        if (!m.nombre || m.nombre === 'MESERO EVENTO') continue
        if (!meseroMap[m.nombre]) meseroMap[m.nombre] = { ventas: 0, dias: 0 }
        meseroMap[m.nombre].ventas += m.total || 0
        meseroMap[m.nombre].dias++
        totalMeseroVentas += m.total || 0
      }
    }

    return Object.entries(meseroMap)
      .map(([nombre, info]) => ({
        nombre,
        propinas: totalMeseroVentas > 0 ? (info.ventas / totalMeseroVentas) * totalPropinas : 0,
        ventas: info.ventas,
        dias: info.dias,
      }))
      .sort((a, b) => b.propinas - a.propinas)
  }, [data, totalPropinas, realTips])

  const maxPropina = propinasPorMesero[0]?.propinas || 1

  // Propinas por metodo de pago (tarjeta credito vs debito)
  const payments = useMemo(() => aggregatePayments(data), [data])
  const tarjetaPayments = useMemo(() => {
    return payments.filter(p => {
      const n = p.nombre.toLowerCase()
      return n.includes('tarjeta') || n.includes('credito') || n.includes('debito')
    })
  }, [payments])

  const tarjetaTotal = tarjetaPayments.reduce((s, p) => s + p.total, 0)
  const tarjetaMax = tarjetaPayments[0]?.total || 1

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Modulo de Propinas"
        subtitle="Analisis de propinas por mesero y metodo de pago"
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
              label="Total propinas"
              value={formatCurrency(totalPropinas)}
              subtitle={`${diasConPropinas} dias con propinas`}
              icon={HandCoins}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Propina promedio"
              value={formatCurrency(propinaPromedio)}
              subtitle="Promedio por dia"
              icon={TrendingUp}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="% sobre ventas"
              value={`${pctSobreVentas.toFixed(1)}%`}
              subtitle="Proporcion propinas / ventas"
              icon={CreditCard}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="Meseros con propinas"
              value={`${propinasPorMesero.length}`}
              subtitle="Meseros activos en el periodo"
              icon={Users}
              accentClass="kpi-accent-purple"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Propinas por mesero */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Propinas por mesero
              </h3>
              <p className="text-xs mb-5">
                {isRealTipsData ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Datos reales de Wansoft
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Estimado proporcional
                  </span>
                )}
              </p>
              {propinasPorMesero.length > 0 ? (
                <div className="space-y-4">
                  {propinasPorMesero.map((m, i) => {
                    const barWidth = maxPropina > 0 ? ((m.propinas / maxPropina) * 100) : 0
                    return (
                      <div key={m.nombre}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: PROPINA_COLORS[i % PROPINA_COLORS.length] }}
                            />
                            <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]">{m.nombre}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatCurrency(m.propinas)}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full animate-progress"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: PROPINA_COLORS[i % PROPINA_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-slate-400 text-sm py-8 text-center">Sin datos de propinas por mesero</p>
              )}
            </div>

            {/* Propinas por metodo de pago */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Pagos con tarjeta
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Ventas por tipo de tarjeta (propinas se cobran aqui)
              </p>
              {tarjetaPayments.length > 0 ? (
                <div className="space-y-4">
                  {tarjetaPayments.map((p, i) => {
                    const pct = tarjetaTotal > 0 ? ((p.total / tarjetaTotal) * 100).toFixed(1) : '0'
                    const barWidth = tarjetaMax > 0 ? ((p.total / tarjetaMax) * 100) : 0
                    return (
                      <div key={p.nombre}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: PROPINA_COLORS[i % PROPINA_COLORS.length] }}
                            />
                            <span className="text-sm font-medium text-slate-700">{p.nombre}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatCurrency(p.total)}{' '}
                            <span className="text-slate-400 text-xs font-normal">({pct}%)</span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full animate-progress"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: PROPINA_COLORS[i % PROPINA_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-slate-400 text-sm py-8 text-center">Sin datos de pagos con tarjeta</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
