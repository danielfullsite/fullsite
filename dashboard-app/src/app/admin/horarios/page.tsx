'use client'

import { useState, useEffect, useCallback } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Trash2, Save, X, Clock } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const DAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']

interface Schedule {
  id?: number
  name: string
  start_time: string
  end_time: string
  days_of_week: number[] // 0=Lun...6=Dom
  item_count?: number
}

async function sbFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts?.method === 'POST' ? 'return=representation' : opts?.method === 'DELETE' ? '' : 'return=representation',
      ...opts?.headers,
    },
  })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const empty: Schedule = { name: '', start_time: '07:00', end_time: '12:00', days_of_week: [0, 1, 2, 3, 4, 5, 6] }

export default function AdminHorariosPage() {
  const CLIENT_ID = useClientId()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Schedule>({ ...empty })
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [loading, setLoading] = useState(true)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    try {
      const data = await sbFetch(`pos_schedules?client_id=eq.${CLIENT_ID}&order=start_time.asc`)
      setSchedules(data || [])
    } catch { showToast('Error cargando horarios', 'err') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleDay = (day: number, target: 'form' | 'editing') => {
    const src = target === 'form' ? form : editing!
    const set = target === 'form' ? setForm : (v: Schedule) => setEditing(v)
    const days = src.days_of_week.includes(day)
      ? src.days_of_week.filter(d => d !== day)
      : [...src.days_of_week, day].sort()
    ;(set as (v: Schedule) => void)({ ...src, days_of_week: days })
  }

  const handleAdd = async () => {
    if (!form.name) return
    try {
      await sbFetch('pos_schedules', {
        method: 'POST',
        body: JSON.stringify({ ...form, client_id: CLIENT_ID }),
      })
      showToast(`${form.name} agregado`); setForm({ ...empty }); setAdding(false); load()
    } catch { showToast('Error al agregar', 'err') }
  }

  const handleSave = async () => {
    if (!editing?.id) return
    try {
      const { id, item_count, ...body } = editing
      await sbFetch(`pos_schedules?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`${editing.name} actualizado`); setEditing(null); load()
    } catch { showToast('Error al guardar', 'err') }
  }

  const handleDelete = async (s: Schedule) => {
    if (!confirm(`Eliminar "${s.name}"?`)) return
    try {
      await sbFetch(`pos_schedules?id=eq.${s.id}`, { method: 'DELETE' })
      showToast(`${s.name} eliminado`); load()
    } catch { showToast('Error al eliminar', 'err') }
  }

  const DayPills = ({ days, target }: { days: number[]; target: 'form' | 'editing' }) => (
    <div className="flex gap-1">
      {DAYS.map((d, i) => (
        <button key={i} type="button" onClick={() => toggleDay(i, target)}
          className={`w-9 h-8 rounded-lg text-xs font-semibold transition-colors ${days.includes(i) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
          {d}
        </button>
      ))}
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Horarios"
        subtitle={`${schedules.length} horarios configurados`}
        eyebrow="Admin"
        action={
          <button onClick={() => setAdding(true)}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
            <Plus size={16} /> Agregar horario
          </button>
        }
      />

      {adding && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-emerald-800 mb-3">Nuevo horario</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Nombre (ej. Desayuno)" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
            <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
            <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
          </div>
          <DayPills days={form.days_of_week} target="form" />
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1">
              <Save size={14} /> Guardar
            </button>
            <button onClick={() => { setAdding(false); setForm({ ...empty }) }} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-sm">Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center py-12 text-slate-400 text-sm">Cargando...</p>
        ) : schedules.length === 0 ? (
          <p className="text-center py-12 text-slate-400 text-sm">No hay horarios configurados</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Horario</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Rango</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Dias</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    {editing && editing.id === s.id ? (
                      <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                        className="border border-emerald-300 rounded px-2 py-1 text-sm w-full" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-slate-400" />
                        <span className="text-sm font-medium text-slate-900">{s.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {editing && editing.id === s.id ? (
                      <div className="flex gap-1 items-center">
                        <input type="time" value={editing.start_time} onChange={e => setEditing({ ...editing, start_time: e.target.value })}
                          className="border border-emerald-300 rounded px-2 py-1 text-sm w-28" />
                        <span className="text-slate-400">-</span>
                        <input type="time" value={editing.end_time} onChange={e => setEditing({ ...editing, end_time: e.target.value })}
                          className="border border-emerald-300 rounded px-2 py-1 text-sm w-28" />
                      </div>
                    ) : (
                      <span className="text-sm text-slate-700">{s.start_time} — {s.end_time}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {editing && editing.id === s.id ? (
                      <DayPills days={editing.days_of_week} target="editing" />
                    ) : (
                      <div className="flex gap-1">
                        {DAYS.map((d, i) => (
                          <span key={i} className={`w-7 h-6 rounded text-[10px] font-semibold flex items-center justify-center ${s.days_of_week?.includes(i) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-300'}`}>
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {editing && editing.id === s.id ? (
                      <div className="flex gap-1 justify-end">
                        <button onClick={handleSave} className="w-8 h-8 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center"><Save size={14} /></button>
                        <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditing(s)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(s)} className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium ${toast.type === 'ok' ? 'bg-slate-800 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
