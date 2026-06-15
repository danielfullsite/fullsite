'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users, Clock, TrendingUp, DollarSign, Trophy } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }
const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

interface MeseroProfile {
  name: string
  totalVentas: number
  totalTickets: number
  ticketPromedio: number
  totalPersonas: number
  totalPropinas: number
  diasTrabajados: number
  ventasPorDia: number
  horasPromedio: number | null
  ventasPorHora: number | null
  mejorDia: { fecha: string; ventas: number } | null
  ventasPorHoraDia: { hora: number; ventas: number }[]
}

export default function StaffAnalyticsPage() {
  const [days, setDays] = useState(7)
  const [profiles, setProfiles] = useState<MeseroProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [days])

  async function fetchData() {
    setLoading(true)
    try {
      const from = new Date()
      from.setDate(from.getDate() - days)
      const fromStr = from.toISOString()

      const [ordersRes, attRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?select=mesero,total,personas,propina,created_at&status=eq.cerrada&client_id=eq.${_cid()}&created_at=gte.${fromStr}&order=created_at.asc&limit=5000`, { headers: H }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_attendance?select=staff_name,type,registered_at&client_id=eq.${_cid()}&registered_at=gte.${fromStr}&order=registered_at.asc&limit=2000`, { headers: H }).catch(() => null),
      ])

      const orders = ordersRes.ok ? await ordersRes.json() : []
      const attendance = attRes?.ok ? await attRes.json() : []

      // Build attendance: hours per mesero per day
      const hoursMap = new Map<string, number>() // name → total hours
      const daysWorked = new Map<string, Set<string>>() // name → set of dates
      if (attendance.length > 0) {
        const entries = new Map<string, string>() // name → last entrada ts
        for (const a of attendance) {
          if (a.type === 'entrada') entries.set(a.staff_name, a.registered_at)
          if (a.type === 'salida') {
            const entradaTs = entries.get(a.staff_name)
            if (entradaTs) {
              const hours = (new Date(a.registered_at).getTime() - new Date(entradaTs).getTime()) / 3600000
              hoursMap.set(a.staff_name, (hoursMap.get(a.staff_name) || 0) + hours)
              entries.delete(a.staff_name)
            }
          }
        }
      }

      // Build profiles
      const byMesero = new Map<string, { ventas: number; tickets: number; personas: number; propinas: number; byDate: Map<string, number>; byHour: Map<number, number> }>()
      for (const o of orders) {
        const name = o.mesero || 'Sin mesero'
        if (!byMesero.has(name)) byMesero.set(name, { ventas: 0, tickets: 0, personas: 0, propinas: 0, byDate: new Map(), byHour: new Map() })
        const m = byMesero.get(name)!
        const total = Number(o.total) || 0
        m.ventas += total
        m.tickets += 1
        m.personas += Number(o.personas) || 0
        m.propinas += Number(o.propina) || 0

        const fecha = o.created_at?.slice(0, 10) || ''
        m.byDate.set(fecha, (m.byDate.get(fecha) || 0) + total)

        const hora = new Date(o.created_at).getHours()
        m.byHour.set(hora, (m.byHour.get(hora) || 0) + total)

        if (!daysWorked.has(name)) daysWorked.set(name, new Set())
        if (fecha) daysWorked.get(name)!.add(fecha)
      }

      const result: MeseroProfile[] = []
      for (const [name, m] of byMesero) {
        const diasTrabajados = daysWorked.get(name)?.size || 1
        const totalHours = hoursMap.get(name) || null

        // Best day
        let mejorDia: { fecha: string; ventas: number } | null = null
        for (const [fecha, ventas] of m.byDate) {
          if (!mejorDia || ventas > mejorDia.ventas) mejorDia = { fecha, ventas }
        }

        // Ventas by hour of day
        const ventasPorHoraDia: { hora: number; ventas: number }[] = []
        for (let h = 7; h <= 22; h++) {
          ventasPorHoraDia.push({ hora: h, ventas: m.byHour.get(h) || 0 })
        }

        result.push({
          name,
          totalVentas: m.ventas,
          totalTickets: m.tickets,
          ticketPromedio: m.tickets > 0 ? m.ventas / m.tickets : 0,
          totalPersonas: m.personas,
          totalPropinas: m.propinas,
          diasTrabajados,
          ventasPorDia: m.ventas / diasTrabajados,
          horasPromedio: totalHours !== null ? totalHours / diasTrabajados : null,
          ventasPorHora: totalHours !== null && totalHours > 0 ? m.ventas / totalHours : null,
          mejorDia,
          ventasPorHoraDia,
        })
      }

      result.sort((a, b) => b.totalVentas - a.totalVentas)
      setProfiles(result)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const selectedProfile = profiles.find(p => p.name === selected)
  const maxHourVentas = selectedProfile ? Math.max(...selectedProfile.ventasPorHoraDia.map(h => h.ventas), 1) : 1

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <Users size={24} className="text-emerald-400" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Rutina de Meseros</h1>
          <p className="text-sm text-[var(--text-3)]">Patrones de venta, horarios, rendimiento por hora</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${days === d ? 'bg-emerald-600 text-white' : 'bg-[var(--surface)] text-[var(--text-3)] border border-[var(--line)]'}`}>
            {d} dias
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: mesero list */}
          <div className="space-y-2">
            {profiles.map((p, i) => (
              <button key={p.name} onClick={() => setSelected(p.name)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${selected === p.name ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[var(--surface)] border-[var(--line)] hover:border-emerald-500/20'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-[var(--text-1)]">
                    {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i+1}. `}
                    {p.name.split(' ').slice(0, 2).join(' ')}
                  </span>
                  <span className="text-emerald-400 font-bold">{fmt(p.totalVentas)}</span>
                </div>
                <div className="flex gap-3 text-xs text-[var(--text-3)]">
                  <span>{p.totalTickets} tickets</span>
                  <span>TP {fmt(p.ticketPromedio)}</span>
                  <span>{p.diasTrabajados}d</span>
                  {p.ventasPorHora !== null && <span className="text-amber-400">{fmt(p.ventasPorHora)}/h</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Right: selected mesero detail */}
          <div className="lg:col-span-2">
            {selectedProfile ? (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-[var(--text-1)]">{selectedProfile.name}</h2>

                {/* KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1"><DollarSign size={14} className="text-emerald-400" /><span className="text-xs text-[var(--text-3)]">Ventas/dia</span></div>
                    <p className="text-lg font-bold text-emerald-400">{fmt(selectedProfile.ventasPorDia)}</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1"><Clock size={14} className="text-sky-400" /><span className="text-xs text-[var(--text-3)]">Horas/dia prom</span></div>
                    <p className="text-lg font-bold text-sky-400">{selectedProfile.horasPromedio !== null ? `${selectedProfile.horasPromedio.toFixed(1)}h` : 'Sin datos'}</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1"><TrendingUp size={14} className="text-amber-400" /><span className="text-xs text-[var(--text-3)]">Ventas/hora</span></div>
                    <p className="text-lg font-bold text-amber-400">{selectedProfile.ventasPorHora !== null ? fmt(selectedProfile.ventasPorHora) : 'Sin datos'}</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1"><Trophy size={14} className="text-violet-400" /><span className="text-xs text-[var(--text-3)]">Propinas</span></div>
                    <p className="text-lg font-bold text-violet-400">{fmt(selectedProfile.totalPropinas)}</p>
                  </div>
                </div>

                {/* Best day */}
                {selectedProfile.mejorDia && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-sm">
                    <span className="text-amber-400 font-semibold">Mejor dia:</span>{' '}
                    <span className="text-[var(--text-1)]">{selectedProfile.mejorDia.fecha} — {fmt(selectedProfile.mejorDia.ventas)}</span>
                  </div>
                )}

                {/* Hourly pattern (bar chart) */}
                <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
                  <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Patron de ventas por hora</h3>
                  <div className="flex items-end gap-1 h-32">
                    {selectedProfile.ventasPorHoraDia.map(h => {
                      const pct = maxHourVentas > 0 ? (h.ventas / maxHourVentas) * 100 : 0
                      return (
                        <div key={h.hora} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full rounded-t-sm bg-emerald-500/80 transition-all" style={{ height: `${Math.max(pct, 2)}%` }}
                            title={`${h.hora}:00 — ${fmt(h.ventas)}`} />
                          <span className="text-[9px] text-[var(--text-3)]">{h.hora}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-[var(--text-3)] mt-2 text-center">Hora del dia (7am - 10pm)</p>
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <p className="text-2xl font-bold text-[var(--text-1)]">{selectedProfile.totalTickets}</p>
                    <p className="text-xs text-[var(--text-3)]">Tickets totales</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <p className="text-2xl font-bold text-[var(--text-1)]">{selectedProfile.totalPersonas}</p>
                    <p className="text-xs text-[var(--text-3)]">Personas atendidas</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-3">
                    <p className="text-2xl font-bold text-[var(--text-1)]">{selectedProfile.diasTrabajados}</p>
                    <p className="text-xs text-[var(--text-3)]">Dias trabajados</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-[var(--text-3)]">
                <p>Selecciona un mesero para ver su rutina</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
