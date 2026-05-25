'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Save, X, Layers } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Group { department: string; group_name: string; count: number }

async function sbFetch(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  return r.ok ? r.json() : []
}

async function sbPatch(filter: string, body: Record<string, string>, clientId: string = 'amalay') {
  return fetch(`${SUPABASE_URL}/rest/v1/pos_retail_items?${filter}&client_id=eq.${clientId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
}

export default function GruposTiendaPage() {
  const CLIENT_ID = useClientId()
  const [groups, setGroups] = useState<Group[]>([])
  const [editing, setEditing] = useState<{ orig: Group; department: string; group_name: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ department: '', group_name: '' })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const items = await sbFetch(`pos_retail_items?client_id=eq.${CLIENT_ID}&select=department,group_name`)
    const map = new Map<string, number>()
    for (const i of items) {
      const key = `${i.department}|||${i.group_name}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    setGroups(Array.from(map.entries()).map(([k, count]) => {
      const [department, group_name] = k.split('|||')
      return { department, group_name, count }
    }).sort((a, b) => a.department.localeCompare(b.department) || a.group_name.localeCompare(b.group_name)))
  }

  useEffect(() => { load() }, [])

  const departments = [...new Set(groups.map(g => g.department).filter(Boolean))]

  const handleSaveEdit = async () => {
    if (!editing) return
    const { orig, department, group_name } = editing
    await sbPatch(`department=eq.${encodeURIComponent(orig.department)}&group_name=eq.${encodeURIComponent(orig.group_name)}`, { department, group_name })
    showToast('Grupo actualizado')
    setEditing(null); load()
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Grupos y Departamentos" subtitle={`${departments.length} departamentos · ${groups.length} grupos`} eyebrow="Tienda"
        action={<button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"><Plus size={16}/>Nuevo grupo</button>} />

      {adding && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-emerald-800 mb-3">Nuevo grupo</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="Departamento" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" list="depts" />
            <datalist id="depts">{departments.map(d => <option key={d} value={d} />)}</datalist>
            <input value={form.group_name} onChange={e => setForm({ ...form, group_name: e.target.value })} placeholder="Nombre del grupo" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
          </div>
          <p className="text-xs text-[var(--text-3)] mt-2">Los grupos se crean al asignar articulos a ellos desde Articulos.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => { showToast('Grupo registrado'); setAdding(false); setForm({ department: '', group_name: '' }) }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14}/> Guardar</button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {departments.map(dept => (
          <div key={dept} className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
            <div className="bg-[var(--surface-2)] border-b border-[var(--line)] px-5 py-3 flex items-center gap-2">
              <Layers size={16} className="text-[var(--text-3)]" />
              <h3 className="font-semibold text-[var(--text-1)] text-sm">{dept}</h3>
              <span className="text-xs text-[var(--text-3)] ml-auto">{groups.filter(g => g.department === dept).length} grupos</span>
            </div>
            <div className="divide-y divide-slate-100">
              {groups.filter(g => g.department === dept).map(g => (
                <div key={`${g.department}-${g.group_name}`} className="px-5 py-3 flex items-center justify-between hover:bg-[var(--surface-2)]">
                  {editing?.orig === g ? (
                    <div className="flex gap-2 flex-1">
                      <input value={editing.department} onChange={e => setEditing({ ...editing, department: e.target.value })} className="border border-emerald-300 rounded px-2 py-1 text-sm flex-1" />
                      <input value={editing.group_name} onChange={e => setEditing({ ...editing, group_name: e.target.value })} className="border border-emerald-300 rounded px-2 py-1 text-sm flex-1" />
                      <button onClick={handleSaveEdit} className="w-8 h-8 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center"><Save size={14}/></button>
                      <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><X size={14}/></button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="text-sm font-medium text-[var(--text-1)]">{g.group_name}</span>
                        <span className="text-xs text-[var(--text-3)] ml-2">{g.count} articulos</span>
                      </div>
                      <button onClick={() => setEditing({ orig: g, department: g.department, group_name: g.group_name })} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><Pencil size={14}/></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-center text-[var(--text-3)] py-10 text-sm">No hay grupos todavia. Agrega articulos primero.</p>}
      </div>

      {toast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">{toast}</div>}
    </div>
  )
}
