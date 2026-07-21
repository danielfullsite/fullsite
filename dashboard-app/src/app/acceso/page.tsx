'use client'

import { useEffect, useState } from 'react'
import { Clock, Users, LogIn, LogOut } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


interface LaborEntry {
  empleado: string
  entrada: string
  salida: string
  horas: number
}

export default function AccesoPage() {
  const [data, setData] = useState<LaborEntry[]>([])
  const [hoursData, setHoursData] = useState<LaborEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      try {
        // Get latest labor data
        const laborRes = await fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_labor?client_id=eq.${_cid()}&order=fecha.desc&limit=1&select=fecha,data`,
          { headers }
        )
        if (laborRes.ok) {
          const rows = await laborRes.json()
          if (rows.length > 0) {
            const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
            if (Array.isArray(d)) setData(d)
            setFecha(rows[0].fecha)
          }
        }

        // Get hours worked from wansoft_data
        const hoursRes = await fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${_cid()}&data_key=eq.hours_worked&order=fecha.desc&limit=1&select=data`,
          { headers }
        )
        if (hoursRes.ok) {
          const rows = await hoursRes.json()
          if (rows.length > 0) {
            let d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
            if (typeof d === 'string') d = JSON.parse(d)
            if (Array.isArray(d)) setHoursData(d)
          }
        }
      } catch (e) {
        console.error('[acceso] Error:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  const allEntries = data.length > 0 ? data : hoursData
  const totalEmpleados = new Set(allEntries.map(e => e.empleado)).size
  const totalHoras = allEntries.reduce((s, e) => s + (e.horas || 0), 0)
  const promedioHoras = totalEmpleados > 0 ? totalHoras / totalEmpleados : 0
  const presentes = allEntries.filter(e => e.entrada && !e.salida).length

  return (
    <>
      <PageHeader title="Control de Acceso" subtitle={`Entrada/salida del personal ${fecha ? `— ${fecha}` : ''}`} />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Empleados" value={`${totalEmpleados}`} icon={Users} accentClass="kpi-accent-blue" />
            <KPICard label="Horas totales" value={`${totalHoras.toFixed(1)}h`} icon={Clock} accentClass="kpi-accent-green" />
            <KPICard label="Promedio/persona" value={`${promedioHoras.toFixed(1)}h`} icon={Clock} accentClass="kpi-accent-amber" />
            <KPICard label="Presentes ahora" value={`${presentes}`} icon={LogIn} accentClass="kpi-accent-purple" />
          </div>

          {allEntries.length > 0 ? (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--line)]">
                <h3 className="text-sm font-semibold text-[var(--text-1)]">Registro del día</h3>
              </div>
              <div className="divide-y divide-[var(--line-soft)]">
                {allEntries.filter(e => e.empleado).map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${e.salida ? 'bg-[var(--text-3)]' : 'bg-emerald-500'}`} />
                      <span className="text-sm font-medium text-[var(--text-1)]">{e.empleado}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1 text-emerald-500">
                        <LogIn size={12} />
                        <span>{e.entrada || '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-red-400">
                        <LogOut size={12} />
                        <span>{e.salida || 'Activo'}</span>
                      </div>
                      {e.horas > 0 && (
                        <span className="font-medium text-[var(--text-2)] bg-[var(--line-soft)] px-2 py-0.5 rounded">
                          {e.horas.toFixed(1)}h
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Clock}
              title="Sin datos de acceso"
              description="Los registros de entrada y salida se llenan automáticamente cada noche desde Wansoft."
              iconColor="text-blue-500"
              iconBg="bg-blue-500/10"
            />
          )}
        </>
      )}
    </>
  )
}
