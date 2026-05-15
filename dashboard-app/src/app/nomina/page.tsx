'use client'

import { useEffect, useState, useMemo } from 'react'
import { Users, Clock, DollarSign, Calculator } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getRecentDays } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface AttendanceRow {
  fecha: string
  empleado: string
  horas: number
}

export default function NominaPage() {
  const [data, setData] = useState<WansoftDaily[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRecentDays(30).then(d => {
      setData(d)
      setLoading(false)
    })
  }, [])

  const attendance = useMemo(() => {
    const rows: AttendanceRow[] = []
    for (const day of data) {
      if (!day.meseros || !Array.isArray(day.meseros)) continue
      for (const m of day.meseros) {
        if (!m.nombre || m.nombre === 'MESERO EVENTO') continue
        rows.push({
          fecha: day.fecha,
          empleado: m.nombre,
          horas: 8,
        })
      }
    }
    return rows.sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [data])

  const uniqueEmployees = useMemo(() => {
    const set = new Set<string>()
    attendance.forEach(r => set.add(r.empleado))
    return set.size
  }, [attendance])

  const totalHoras = attendance.length * 8
  const promedioPorEmpleado = uniqueEmployees > 0 ? totalHoras / uniqueEmployees : 0

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Nomina y Asistencia"
        subtitle="Control de asistencia y horas trabajadas"
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
              label="Total nomina del mes"
              value="Conectar datos"
              subtitle="Datos de nomina no disponibles aun"
              icon={DollarSign}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Empleados activos"
              value={formatNumber(uniqueEmployees)}
              subtitle="Basado en meseros registrados"
              icon={Users}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Horas trabajadas"
              value={formatNumber(totalHoras)}
              subtitle="Estimado (8h por turno)"
              icon={Clock}
              accentClass="kpi-accent-amber"
            />
            <KPICard
              label="Promedio por empleado"
              value={`${formatNumber(Math.round(promedioPorEmpleado))}h`}
              subtitle="Horas estimadas por empleado"
              icon={Calculator}
              accentClass="kpi-accent-purple"
            />
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-blue-700 font-medium">
              Conectar datos de nomina
            </p>
            <p className="text-xs text-blue-600 mt-1">
              La informacion de asistencia se estima a partir de los meseros registrados en cada dia.
              Para datos exactos de nomina (sueldos, deducciones, horas extra), conecta el modulo de nomina de Wansoft.
            </p>
          </div>

          {/* Attendance table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Registro de asistencia
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Basado en meseros activos por dia ({attendance.length} registros)
            </p>

            {attendance.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fecha</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Empleado</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Entrada</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Salida</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.slice(0, 50).map((row, i) => (
                      <tr key={`${row.fecha}-${row.empleado}-${i}`} className="hover:bg-slate-50/50 border-b border-slate-100">
                        <td className="py-3 px-3 text-slate-700 font-medium">
                          {new Date(row.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="py-3 px-3 text-slate-700">{row.empleado}</td>
                        <td className="py-3 px-3 text-slate-400">--:--</td>
                        <td className="py-3 px-3 text-slate-400">--:--</td>
                        <td className="py-3 px-3 text-right text-slate-700 font-medium tabular-nums">{row.horas}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {attendance.length > 50 && (
                  <p className="text-xs text-slate-400 text-center mt-4">
                    Mostrando 50 de {attendance.length} registros
                  </p>
                )}
              </div>
            ) : (
              <p className="text-slate-400 text-sm py-8 text-center">Sin datos de asistencia</p>
            )}
          </div>
        </>
      )}
    </>
  )
}
