'use client'

import { useEffect, useState } from 'react'
import { Users, Clock, DollarSign, TrendingUp } from 'lucide-react'
import { getLatestDeep, getRecentDays, aggregateMeseros, getWansoftData } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface LaborEntry {
  empleado: string
  entrada: string
  salida: string
  horas: number
}

interface HoursEntry {
  empleado: string
  entrada: string
  salida: string
  horas: number
}

interface ShiftEntry {
  nombre: string
  total: number
  [key: string]: unknown
}

interface TipEntry {
  mesero: string
  ventas: number
  tickets: number
  propinas: number
  propina_promedio: number
}

export default function NominaPage() {
  const [labor, setLabor] = useState<LaborEntry[]>([])
  const [tips, setTips] = useState<TipEntry[]>([])
  const [hoursWorked, setHoursWorked] = useState<HoursEntry[]>([])
  const [shifts, setShifts] = useState<ShiftEntry[]>([])
  const [dailyData, setDailyData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')
  const [tab, setTab] = useState<'rendimiento' | 'asistencia' | 'propinas' | 'horas'>('rendimiento')

  useEffect(() => {
    async function load() {
      try {
        const [laborRow, tipsRow, recent, hoursRow, shiftsRow] = await Promise.all([
          getLatestDeep('wansoft_labor'),
          getLatestDeep('wansoft_tips'),
          getRecentDays(7),
          getWansoftData('hours_worked'),
          getWansoftData('shifts'),
        ])
        if (laborRow?.data && Array.isArray(laborRow.data)) {
          setLabor(laborRow.data)
          setFecha(laborRow.fecha as string || '')
        }
        if (tipsRow?.data && Array.isArray(tipsRow.data)) setTips(tipsRow.data)
        if (hoursRow?.data && Array.isArray(hoursRow.data)) setHoursWorked(hoursRow.data as HoursEntry[])
        if (shiftsRow?.data && Array.isArray(shiftsRow.data)) setShifts(shiftsRow.data as ShiftEntry[])
        setDailyData(recent)
      } catch (err) {
        console.error('Error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const meseros = aggregateMeseros(dailyData)
  const totalVentas = meseros.reduce((s, m) => s + m.total, 0)
  const totalTips = tips.reduce((s, t) => s + (t.propinas || 0), 0)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Nomina y Rendimiento</h2>
        <p className="text-sm text-[var(--text-3)]">Asistencia, ventas por empleado y propinas {fecha && `· ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Users size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Empleados activos</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{meseros.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Ventas semana</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalVentas)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingUp size={16} className="text-violet-500" /><span className="text-xs text-[var(--text-2)] font-medium">Propinas hoy</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalTips)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Clock size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Registros asistencia</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{labor.length}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('rendimiento')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'rendimiento' ? 'bg-[var(--surface)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>Rendimiento</button>
        <button onClick={() => setTab('propinas')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'propinas' ? 'bg-emerald-600 text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>Propinas ({tips.length})</button>
        <button onClick={() => setTab('asistencia')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'asistencia' ? 'bg-blue-600 text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>Asistencia ({labor.length})</button>
        {hoursWorked.length > 0 && (
          <button onClick={() => setTab('horas')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'horas' ? 'bg-amber-600 text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>Horas ({hoursWorked.length})</button>
        )}
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        {tab === 'rendimiento' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Mesero</th>
                <th className="text-right px-4 py-3 font-medium">Ventas 7d</th>
                <th className="text-right px-4 py-3 font-medium">Dias</th>
                <th className="text-right px-4 py-3 font-medium">Prom/dia</th>
                <th className="text-right px-4 py-3 font-medium">% del total</th>
              </tr></thead>
              <tbody>{meseros.map((m, i) => (
                <tr key={m.nombre} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3 text-[var(--text-3)]">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-[var(--text-1)]">{m.nombre}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(m.total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{m.dias}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(m.promedio)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{totalVentas > 0 ? Math.round(m.total / totalVentas * 100) : 0}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {tab === 'propinas' && (
          tips.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-3)] text-sm">Sin datos de propinas. Se actualizan diario.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                  <th className="text-left px-4 py-3 font-medium">Mesero</th>
                  <th className="text-right px-4 py-3 font-medium">Ventas</th>
                  <th className="text-right px-4 py-3 font-medium">Tickets</th>
                  <th className="text-right px-4 py-3 font-medium">Propinas</th>
                  <th className="text-right px-4 py-3 font-medium">Prom/ticket</th>
                </tr></thead>
                <tbody>{tips.sort((a, b) => (b.propinas || 0) - (a.propinas || 0)).map((t, i) => (
                  <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{t.mesero}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(t.ventas)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{t.tickets}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600">{formatCurrency(t.propinas)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{formatCurrency(t.propina_promedio)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )
        )}

        {tab === 'asistencia' && (
          labor.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-3)] text-sm">Sin datos de asistencia. Se actualizan diario.</div>
          ) : (
            <div>
              {shifts.length > 0 && (
                <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                  <p className="text-xs font-medium text-[var(--text-2)] mb-2">Turnos del dia</p>
                  <div className="flex flex-wrap gap-3">
                    {shifts.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                        <span className="w-2 h-2 rounded-full bg-blue-500/100" />
                        <span className="font-medium text-[var(--text-1)]">{s.nombre}</span>
                        <span className="text-[var(--text-3)]">{s.total}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                    <th className="text-left px-4 py-3 font-medium">Empleado</th>
                    <th className="text-left px-4 py-3 font-medium">Entrada</th>
                    <th className="text-left px-4 py-3 font-medium">Salida</th>
                    <th className="text-right px-4 py-3 font-medium">Horas</th>
                  </tr></thead>
                  <tbody>{labor.map((l, i) => (
                    <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                      <td className="px-4 py-3 font-medium text-[var(--text-1)]">{l.empleado}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{l.entrada || '--:--'}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{l.salida || '--:--'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{l.horas > 0 ? `${l.horas}h` : '--'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )
        )}

        {tab === 'horas' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Empleado</th>
                <th className="text-left px-4 py-3 font-medium">Entrada</th>
                <th className="text-left px-4 py-3 font-medium">Salida</th>
                <th className="text-right px-4 py-3 font-medium">Horas trabajadas</th>
              </tr></thead>
              <tbody>
                {hoursWorked.sort((a, b) => b.horas - a.horas).map((h, i) => (
                  <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3 text-[var(--text-3)]">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{h.empleado}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{h.entrada || '--:--'}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{h.salida || '--:--'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-400">{h.horas > 0 ? `${h.horas}h` : '--'}</td>
                  </tr>
                ))}
                <tr className="bg-[var(--surface-2)] font-bold">
                  <td className="px-4 py-3" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-400">
                    {hoursWorked.reduce((s, h) => s + (h.horas || 0), 0).toFixed(1)}h
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
