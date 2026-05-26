'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, DollarSign, Users, Receipt, Clock,
  ChefHat, CreditCard, Banknote, Target, Zap, BarChart3, Trophy,
  ArrowRight, Utensils,
} from 'lucide-react'
import {
  DEMO_RESTAURANT, DEMO_KPIS, DEMO_YESTERDAY, DEMO_LAST_WEEK, DEMO_DOW_AVG,
  DEMO_HISTORY_14, DEMO_MONTHLY, DEMO_MESEROS, DEMO_PLATILLOS, DEMO_GRUPOS, DEMO_PAGOS,
  DEMO_INSIGHTS, DEMO_HOURLY, DEMO_WOW, formatDemoMXN,
} from '@/lib/demo-data'

export default function DemoDashboard() {
  const [period] = useState<'dia' | 'semana'>('dia')
  const kpi = DEMO_KPIS

  const vsYesterday = ((kpi.ventas_dia - DEMO_YESTERDAY.ventas_dia) / DEMO_YESTERDAY.ventas_dia * 100)
  const vsLastWeek = ((kpi.ventas_dia - DEMO_LAST_WEEK.ventas_dia) / DEMO_LAST_WEEK.ventas_dia * 100)

  // Prediction
  const now = new Date()
  const hour = now.getHours()
  const pctDay = Math.min(((hour - 8) / 12) * 100, 100)
  const projected = hour >= 8 ? Math.round(kpi.ventas_dia / (pctDay / 100)) : 0
  const meta = 60000

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      {/* Top bar */}
      <header className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <h1 className="text-lg font-bold">{DEMO_RESTAURANT.name}</h1>
          <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.location} · {DEMO_RESTAURANT.type}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/demo/pos" className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-[var(--text-1)] text-sm font-bold rounded-lg hover:bg-emerald-600">
            <Utensils size={16} /> Abrir POS <ArrowRight size={14} />
          </Link>
          <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            <Zap size={12} className="text-emerald-400" /> En vivo
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Prediction widget */}
        {projected > 0 && (
          <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-white/[0.02]">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Target className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Predicción de cierre</p>
                </div>
                <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
                  <Zap className="w-3 h-3" /> Tiempo real
                </div>
              </div>
              <div className="flex items-end gap-4 mb-4">
                <p className="text-4xl font-bold tracking-tight">{formatDemoMXN(projected)}</p>
                <div className="flex items-center gap-1 text-sm font-semibold mb-1 text-emerald-500">
                  <TrendingUp className="w-4 h-4" />
                  <span>+{vsLastWeek.toFixed(1)}% vs semana pasada</span>
                </div>
              </div>
              <div className="mb-2">
                <div className="flex justify-between text-xs text-[var(--text-3)] mb-1.5">
                  <span>Progreso del día</span>
                  <span>{pctDay.toFixed(0)}% completado</span>
                </div>
                <div className="w-full bg-[var(--line-soft)] rounded-full h-3 overflow-hidden">
                  <div className="h-3 rounded-full" style={{ width: `${pctDay}%`, background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[var(--line)]">
                <div>
                  <p className="text-xs text-[var(--text-3)]">Falta por vender</p>
                  <p className="text-sm font-semibold">{formatDemoMXN(Math.max(0, projected - kpi.ventas_dia))}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)]">vs ayer</p>
                  <p className={`text-sm font-semibold ${vsYesterday >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{vsYesterday >= 0 ? '+' : ''}{vsYesterday.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)]">Meta: {formatDemoMXN(meta)}</p>
                  <p className={`text-sm font-semibold ${projected >= meta ? 'text-emerald-500' : 'text-amber-500'}`}>{((kpi.ventas_dia / meta) * 100).toFixed(0)}%</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Ventas del día', value: formatDemoMXN(kpi.ventas_dia), icon: DollarSign, color: 'text-emerald-400', change: vsYesterday },
            { label: 'Tickets', value: kpi.tickets_count.toString(), icon: Receipt, color: 'text-blue-400', change: ((kpi.tickets_count - DEMO_YESTERDAY.tickets_count) / DEMO_YESTERDAY.tickets_count * 100) },
            { label: 'Ticket promedio', value: formatDemoMXN(kpi.ticket_promedio), icon: BarChart3, color: 'text-purple-400', change: ((kpi.ticket_promedio - DEMO_YESTERDAY.ticket_promedio) / DEMO_YESTERDAY.ticket_promedio * 100) },
            { label: 'Personas', value: kpi.personas_restaurant.toString(), icon: Users, color: 'text-amber-400', change: 0 },
          ].map(card => (
            <div key={card.label} className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <card.icon size={18} className={card.color} />
                {card.change !== 0 && (
                  <span className={`text-xs font-medium ${card.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {card.change >= 0 ? '+' : ''}{card.change.toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        {/* Extra KPIs row */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Efectivo', value: formatDemoMXN(kpi.efectivo), icon: Banknote },
            { label: 'Tarjeta', value: formatDemoMXN(kpi.tarjeta), icon: CreditCard },
            { label: 'Propinas', value: formatDemoMXN(kpi.propinas_total), icon: DollarSign },
            { label: 'Hora pico', value: kpi.hora_pico, icon: Clock },
            { label: 'Mesas', value: `${kpi.mesas_atendidas}/${DEMO_RESTAURANT.mesas}`, icon: ChefHat },
            { label: 'Para llevar', value: kpi.ordenes_llevar.toString(), icon: Receipt },
          ].map(card => (
            <div key={card.label} className="bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-[var(--text-3)] text-xs mb-1">
                <card.icon size={12} />
                {card.label}
              </div>
              <p className="text-sm font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Top meseros */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><Trophy size={18} className="text-amber-400" /> Top meseros</h3>
            <div className="space-y-3">
              {DEMO_MESEROS.map((m, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`
                const pct = DEMO_MESEROS[0].total > 0 ? (m.total / DEMO_MESEROS[0].total) * 100 : 0
                return (
                  <div key={m.nombre} className="flex items-center gap-3">
                    <span className="text-lg w-8 text-center">{medal}</span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium">{m.nombre}</span>
                        <span className="text-sm font-bold text-emerald-400">{formatDemoMXN(m.total)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-[var(--line-soft)] rounded-full">
                        <div className="h-1.5 bg-emerald-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-[var(--text-3)] mt-0.5">{m.tickets} tickets · Propinas: {formatDemoMXN(m.propinas)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top platillos */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><ChefHat size={18} className="text-orange-400" /> Top platillos</h3>
            <div className="space-y-2">
              {DEMO_PLATILLOS.map((p, i) => (
                <div key={p.nombre} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--text-4)] text-sm w-5">{i + 1}</span>
                    <span className="text-sm">{p.nombre}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-[var(--text-3)]">{p.cantidad} vendidos</span>
                    <span className="text-sm font-semibold w-20 text-right">{formatDemoMXN(p.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Payment methods + categories */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><CreditCard size={18} className="text-blue-400" /> Métodos de pago</h3>
            <div className="space-y-3">
              {DEMO_PAGOS.map(p => {
                const pct = (p.total / kpi.ventas_dia) * 100
                return (
                  <div key={p.nombre}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-[var(--text-3)]">{p.nombre}</span>
                      <span className="font-semibold">{formatDemoMXN(p.total)}</span>
                    </div>
                    <div className="w-full h-2 bg-[var(--line-soft)] rounded-full">
                      <div className="h-2 bg-blue-500/50 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-[var(--text-4)] mt-0.5">{pct.toFixed(1)}%</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><BarChart3 size={18} className="text-purple-400" /> Categorías</h3>
            <div className="space-y-2">
              {DEMO_GRUPOS.slice(0, 8).map(g => (
                <div key={g.nombre} className="flex items-center justify-between py-1">
                  <span className="text-sm text-[var(--text-3)]">{g.nombre}</span>
                  <span className="text-sm font-semibold">{formatDemoMXN(g.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Insights */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Zap size={18} className="text-emerald-400" /> Insights de IA
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {DEMO_INSIGHTS.map((insight, i) => (
              <div key={i} className={`rounded-xl border p-4 ${
                insight.type === 'alert' ? 'bg-red-500/5 border-red-500/20' :
                insight.type === 'upsell' ? 'bg-amber-500/5 border-amber-500/20' :
                insight.type === 'staff' ? 'bg-purple-500/5 border-purple-500/20' :
                'bg-emerald-500/5 border-emerald-500/20'
              }`}>
                <p className="text-sm font-bold mb-1">{insight.title}</p>
                <p className="text-xs text-[var(--text-3)] leading-relaxed">{insight.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Hourly distribution */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4"><Clock size={18} className="text-blue-400" /> Ventas por hora (hoy)</h3>
          <div className="flex items-end gap-1 h-32">
            {DEMO_HOURLY.map(h => {
              const max = Math.max(...DEMO_HOURLY.map(x => x.ventas))
              const height = (h.ventas / max) * 100
              const isCurrent = parseInt(h.hora) <= new Date().getHours() && parseInt(h.hora) >= new Date().getHours() - 1
              return (
                <div key={h.hora} className="flex-1 flex flex-col items-center gap-1" title={`${h.hora}: ${formatDemoMXN(h.ventas)}`}>
                  <div className={`w-full rounded-t-sm ${isCurrent ? 'bg-blue-500' : 'bg-[var(--line-soft)]'}`} style={{ height: `${height}%` }} />
                  <span className="text-[8px] text-[var(--text-4)]">{h.hora.slice(0, 2)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Sales trend chart (14 days) */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-1"><TrendingUp size={18} className="text-emerald-400" /> Tendencia de ventas</h3>
          <p className="text-xs text-[var(--text-3)] mb-4">Semana actual vs anterior: <span className={`font-bold ${DEMO_WOW.change.ventas >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>+{DEMO_WOW.change.ventas}%</span> ({formatDemoMXN(DEMO_WOW.thisWeek.ventas)} vs {formatDemoMXN(DEMO_WOW.lastWeek.ventas)})</p>
          <div className="flex items-end gap-1.5 h-40">
            {DEMO_HISTORY_14.map((d, i) => {
              const maxVenta = Math.max(...DEMO_HISTORY_14.map(h => h.ventas_dia))
              const height = (d.ventas_dia / maxVenta) * 100
              const isToday = i === DEMO_HISTORY_14.length - 1
              const isWeekend = [0, 6].includes(new Date(d.fecha).getDay())
              return (
                <div key={d.fecha} className="flex-1 flex flex-col items-center gap-1" title={`${d.fecha}: ${formatDemoMXN(d.ventas_dia)}`}>
                  <div className={`w-full rounded-t-md ${isToday ? 'bg-emerald-500' : isWeekend ? 'bg-purple-500/40' : 'bg-[var(--line-soft)]'}`} style={{ height: `${height}%` }} />
                  <span className="text-[9px] text-[var(--text-4)]">{d.fecha.slice(8)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-4)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--line-soft)] rounded" /> L-V</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500/40 rounded" /> S-D</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded" /> Hoy</span>
          </div>
        </div>

        {/* Monthly summary */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4"><BarChart3 size={18} className="text-amber-400" /> Resumen mensual</h3>
          <div className="grid grid-cols-3 gap-4">
            {DEMO_MONTHLY.map(m => (
              <div key={m.month} className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
                <p className="text-xs text-[var(--text-3)] mb-1">{m.month}</p>
                <p className="text-xl font-bold text-emerald-400">{formatDemoMXN(m.ventas)}</p>
                <div className="flex justify-between text-xs text-[var(--text-3)] mt-2">
                  <span>{m.dias} días</span>
                  <span>TP: {formatDemoMXN(m.ticketPromedio)}</span>
                </div>
                <p className="text-xs text-[var(--text-4)] mt-1">Prom/día: {formatDemoMXN(m.promedioDia)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-[var(--text-4)]">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <Link href="/demo/pos" className="text-emerald-400 text-sm font-medium hover:underline">Probar POS</Link>
            <a href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20vi%20el%20demo%20y%20me%20interesa." target="_blank" rel="noopener noreferrer" className="text-emerald-400 text-sm font-medium hover:underline">Contactar ventas</a>
          </div>
        </div>
      </div>
    </div>
  )
}
