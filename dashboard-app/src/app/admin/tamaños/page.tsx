'use client'

import { useState, useEffect, useCallback } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Size {
  id?: number
  name: string
  multiplier: number
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

export default function AdminTamañosPage() {
  const CLIENT_ID = useClientId()
  const [sizes, setSizes] = useState<Size[]>([])
  const [editing, setEditing] = useState<Size | null>(null)
  const [adding, setAdding] = useState(false)
  const [newSize, setNewSize] = useState<Size>({ name: '', multiplier: 1.0 })
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [loading, setLoading] = useState(true)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    try {
      const data = await sbFetch(`pos_sizes?client_id=eq.${CLIENT_ID}&order=name.asc`)
      setSizes(data || [])
    } catch { showToast('Error cargando tamaños', 'err') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newSize.name) return
    try {
      await sbFetch('pos_sizes', {
        method: 'POST',
        body: JSON.stringify({ ...newSize, client_id: CLIENT_ID }),
      })
      showToast(`${newSize.name} agregado`)
      setNewSize({ name: '', multiplier: 1.0 }); setAdding(false); load()
    } catch { showToast('Error al agregar', 'err') }
  }

  const handleSave = async () => {
    if (!editing?.id) return
    try {
      await sbFetch(`pos_sizes?id=eq.${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editing.name, multiplier: editing.multiplier }),
      })
      showToast(`${editing.name} actualizado`); setEditing(null); load()
    } catch { showToast('Error al guardar', 'err') }
  }

  const handleDelete = async (s: Size) => {
    if (!confirm(`Eliminar "${s.name}"?`)) return
    try {
      await sbFetch(`pos_sizes?id=eq.${s.id}`, { method: 'DELETE' })
      showToast(`${s.name} eliminado`); load()
    } catch { showToast('Error al eliminar', 'err') }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Tamaños"
        subtitle={`${sizes.length} tamaños configurados`}
        eyebrow="Admin"
        action={
          <button onClick={() => setAdding(true)}
            className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
            <Plus size={16} /> Agregar tamaño
          </button>
        }
      />

      {adding && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-emerald-800 mb-3">Nuevo tamaño</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={newSize.name} onChange={e => setNewSize({ ...newSize, name: e.target.value })}
              placeholder="Nombre (ej. Grande)" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
            <input type="number" step="0.01" value={newSize.multiplier}
              onChange={e => setNewSize({ ...newSize, multiplier: Number(e.target.value) })}
              placeholder="Multiplicador (ej. 1.3)" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1">
              <Save size={14} /> Guardar
            </button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm">Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center py-12 text-[var(--text-3)] text-sm">Cargando...</p>
        ) : sizes.length === 0 ? (
          <p className="text-center py-12 text-[var(--text-3)] text-sm">No hay tamaños configurados</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Nombre</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Multiplicador</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Ejemplo ($100)</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sizes.map(s => (
                <tr key={s.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                  <td className="px-5 py-3">
                    {editing && editing.id === s.id ? (
                      <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                        className="border border-emerald-300 rounded px-2 py-1 text-sm w-full" />
                    ) : (
                      <span className="text-sm font-medium text-[var(--text-1)]">{s.name}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {editing && editing.id === s.id ? (
                      <input type="number" step="0.01" value={editing.multiplier}
                        onChange={e => setEditing({ ...editing, multiplier: Number(e.target.value) })}
                        className="border border-emerald-300 rounded px-2 py-1 text-sm w-24 text-right" />
                    ) : (
                      <span className="text-sm text-[var(--text-1)]">{s.multiplier}x</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-semibold text-[var(--text-1)]">${(100 * s.multiplier).toFixed(2)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {editing && editing.id === s.id ? (
                      <div className="flex gap-1 justify-end">
                        <button onClick={handleSave} className="w-8 h-8 rounded-lg bg-emerald-500/15 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center"><Save size={14} /></button>
                        <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditing(s)} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(s)} className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
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
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium ${toast.type === 'ok' ? 'bg-[var(--surface-2)] text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
