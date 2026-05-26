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
  DEMO_HISTORY, DEMO_MESEROS, DEMO_PLATILLOS, DEMO_GRUPOS, DEMO_PAGOS,
  DEMO_PROPINAS, formatDemoMXN,
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
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      {/* Top bar */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">
              fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
            </h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · {DEMO_RESTAURANT.location}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/demo/pos" className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm font-bold rounded-lg hover:bg-emerald-600">
            <Utensils size={16} /> Ver POS <ArrowRight size={14} />
          </Link>
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <Zap size={12} className="text-emerald-400" /> En vivo
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Prediction widget */}
        {projected > 0 && (
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Target className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Predicción de cierre</p>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
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
                <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                  <span>Progreso del día</span>
                  <span>{pctDay.toFixed(0)}% completado</span>
                </div>
                <div className="w-full bg-white/5 rounded-full h-3 overflow-hidden">
                  <div className="h-3 rounded-full" style={{ width: `${pctDay}%`, background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-white/5">
                <div>
                  <p className="text-xs text-zinc-500">Falta por vender</p>
                  <p className="text-sm font-semibold">{formatDemoMXN(Math.max(0, projected - kpi.ventas_dia))}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">vs ayer</p>
                  <p className={`text-sm font-semibold ${vsYesterday >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{vsYesterday >= 0 ? '+' : ''}{vsYesterday.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Meta: {formatDemoMXN(meta)}</p>
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
            <div key={card.label} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <card.icon size={18} className={card.color} />
                {card.change !== 0 && (
                  <span className={`text-xs font-medium ${card.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {card.change >= 0 ? '+' : ''}{card.change.toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-zinc-500 mt-1">{card.label}</p>
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
            <div key={card.label} className="bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
                <card.icon size={12} />
                {card.label}
              </div>
              <p className="text-sm font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Top meseros */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
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
                      <div className="w-full h-1.5 bg-white/5 rounded-full">
                        <div className="h-1.5 bg-emerald-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">{m.tickets} tickets · Propinas: {formatDemoMXN(m.propinas)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top platillos */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><ChefHat size={18} className="text-orange-400" /> Top platillos</h3>
            <div className="space-y-2">
              {DEMO_PLATILLOS.map((p, i) => (
                <div key={p.nombre} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-600 text-sm w-5">{i + 1}</span>
                    <span className="text-sm">{p.nombre}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500">{p.cantidad} vendidos</span>
                    <span className="text-sm font-semibold w-20 text-right">{formatDemoMXN(p.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Payment methods + categories */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><CreditCard size={18} className="text-blue-400" /> Métodos de pago</h3>
            <div className="space-y-3">
              {DEMO_PAGOS.map(p => {
                const pct = (p.total / kpi.ventas_dia) * 100
                return (
                  <div key={p.nombre}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-400">{p.nombre}</span>
                      <span className="font-semibold">{formatDemoMXN(p.total)}</span>
                    </div>
                    <div className="w-full h-2 bg-white/5 rounded-full">
                      <div className="h-2 bg-blue-500/50 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-zinc-600 mt-0.5">{pct.toFixed(1)}%</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <h3 className="flex items-center gap-2 font-bold mb-4"><BarChart3 size={18} className="text-purple-400" /> Categorías</h3>
            <div className="space-y-2">
              {DEMO_GRUPOS.slice(0, 8).map(g => (
                <div key={g.nombre} className="flex items-center justify-between py-1">
                  <span className="text-sm text-zinc-400">{g.nombre}</span>
                  <span className="text-sm font-semibold">{formatDemoMXN(g.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sales trend chart (simple bars) */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4"><TrendingUp size={18} className="text-emerald-400" /> Tendencia de ventas (14 días)</h3>
          <div className="flex items-end gap-1.5 h-40">
            {DEMO_HISTORY.map((d, i) => {
              const maxVenta = Math.max(...DEMO_HISTORY.map(h => h.ventas_dia))
              const height = (d.ventas_dia / maxVenta) * 100
              const isToday = i === DEMO_HISTORY.length - 1
              const isWeekend = new Date(d.fecha).getDay() >= 5
              return (
                <div key={d.fecha} className="flex-1 flex flex-col items-center gap-1" title={`${d.fecha}: ${formatDemoMXN(d.ventas_dia)}`}>
                  <div
                    className={`w-full rounded-t-md transition-all ${isToday ? 'bg-emerald-500' : isWeekend ? 'bg-purple-500/40' : 'bg-white/10'}`}
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-zinc-600">{d.fecha.slice(8)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-white/10 rounded" /> L-V</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500/40 rounded" /> S-D</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded" /> Hoy</span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-zinc-600">Demo de fullsite — datos simulados de <strong>{DEMO_RESTAURANT.name}</strong></p>
          <Link href="/demo/pos" className="text-emerald-400 text-sm font-medium hover:underline mt-1 inline-block">
            Probar el POS →
          </Link>
        </div>
      </div>
    </div>
  )
}
