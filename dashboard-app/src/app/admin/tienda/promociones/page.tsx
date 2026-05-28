'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Save, X, Tag, Trash2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Promo {
  id?: string; name: string; type: 'percent' | 'fixed' | '2x1' | 'combo'
  value: number; applies_to: string[]; start_date: string; end_date: string
  active: boolean; min_qty: number
}

const empty: Promo = { name: '', type: 'percent', value: 0, applies_to: [], start_date: '', end_date: '', active: true, min_qty: 1 }

async function sbFetch(path: string, opts?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: opts?.method === 'POST' ? 'return=representation' : 'return=minimal', ...opts?.headers },
  })
}

const TYPE_LABELS: Record<string, string> = { percent: '% Descuento', fixed: '$ Fijo', '2x1': '2x1', combo: 'Combo' }
const TYPE_COLORS: Record<string, string> = { percent: 'bg-blue-500/15 text-blue-400', fixed: 'bg-emerald-500/15 text-emerald-400', '2x1': 'bg-purple-500/15 text-purple-400', combo: 'bg-amber-500/15 text-amber-400' }

export default function PromosTiendaPage() {
  const CLIENT_ID = useClientId()
  const [promos, setPromos] = useState<Promo[]>([])
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Promo | null>(null)
  const [form, setForm] = useState<Promo>({ ...empty })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const [pRes, iRes] = await Promise.all([
      sbFetch(`pos_retail_promos?client_id=eq.${CLIENT_ID}&order=active.desc,name`),
      sbFetch(`pos_retail_items?client_id=eq.${CLIENT_ID}&select=id,name&active=eq.true&order=name`),
    ])
    if (pRes.ok) setPromos(await pRes.json())
    if (iRes.ok) setItems(await iRes.json())
  }

  useEffect(() => { load() }, [CLIENT_ID])

  const handleSave = async (p: Promo, isNew: boolean) => {
    const { id, ...body } = p
    if (isNew) {
      const r = await sbFetch('pos_retail_promos', { method: 'POST', body: JSON.stringify({ ...body, client_id: CLIENT_ID }) })
      if (r.ok) { showToast('Promocion creada'); setAdding(false); setForm({ ...empty }); load() }
    } else {
      await sbFetch(`pos_retail_promos?id=eq.${id}&client_id=eq.${CLIENT_ID}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast('Promocion actualizada'); setEditing(null); load()
    }
  }

  const handleDelete = async (p: Promo) => {
    if (!confirm(`Eliminar "${p.name}"?`)) return
    await sbFetch(`pos_retail_promos?id=eq.${p.id}&client_id=eq.${CLIENT_ID}`, { method: 'DELETE' })
    showToast('Promocion eliminada'); load()
  }

  const toggleAppliesTo = (f: Promo, set: (v: Promo) => void, itemId: string) => {
    const arr = f.applies_to.includes(itemId) ? f.applies_to.filter(i => i !== itemId) : [...f.applies_to, itemId]
    set({ ...f, applies_to: arr })
  }

  const renderForm = (f: Promo, set: (v: Promo) => void, isNew: boolean) => (
    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 mb-6">
      <h3 className="font-semibold text-emerald-800 mb-3">{isNew ? 'Nueva promocion' : `Editando: ${f.name}`}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <input value={f.name} onChange={e => set({ ...f, name: e.target.value })} placeholder="Nombre" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm col-span-2" />
        <select value={f.type} onChange={e => set({ ...f, type: e.target.value as Promo['type'] })} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm">
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="number" value={f.value || ''} onChange={e => set({ ...f, value: +e.target.value })} placeholder={f.type === 'percent' ? '% descuento' : '$ valor'} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={f.start_date} onChange={e => set({ ...f, start_date: e.target.value })} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={f.end_date} onChange={e => set({ ...f, end_date: e.target.value })} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
        <input type="number" value={f.min_qty || ''} onChange={e => set({ ...f, min_qty: +e.target.value })} placeholder="Cant. minima" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
      </div>
      {items.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-[var(--text-2)] mb-2">Aplica a ({f.applies_to.length} seleccionados):</p>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {items.map(i => (
              <button key={i.id} onClick={() => toggleAppliesTo(f, set, i.id)}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${f.applies_to.includes(i.id) ? 'bg-emerald-500/100 text-white' : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--line)]'}`}>
                {i.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={() => handleSave(f, isNew)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14}/> Guardar</button>
        <button onClick={() => { setAdding(false); setEditing(null); setForm({ ...empty }) }} className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm">Cancelar</button>
      </div>
    </div>
  )

  const active = promos.filter(p => p.active)
  const inactive = promos.filter(p => !p.active)

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Promociones Tienda" subtitle={`${active.length} activas · ${inactive.length} inactivas`} eyebrow="Tienda"
        action={<button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"><Plus size={16}/>Nueva promo</button>} />

      {adding && renderForm(form, setForm, true)}
      {editing && renderForm(editing, (v) => setEditing(v), false)}

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
              {['Promocion', 'Tipo', 'Valor', 'Vigencia', 'Productos', 'Estado', ''].map(h =>
                <th key={h} className="px-4 py-3 text-xs font-semibold text-[var(--text-2)] uppercase text-left">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {promos.map(p => (
              <tr key={p.id} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${!p.active ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-[var(--text-1)] flex items-center gap-2"><Tag size={14} className="text-[var(--text-3)]" />{p.name}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${TYPE_COLORS[p.type]}`}>{TYPE_LABELS[p.type]}</span></td>
                <td className="px-4 py-3 text-sm font-semibold">{p.type === 'percent' ? `${p.value}%` : `$${p.value}`}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-2)]">{p.start_date || '-'} → {p.end_date || '-'}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-2)]">{p.applies_to?.length || 0} items</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${p.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{p.active ? 'Activa' : 'Inactiva'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => setEditing(p)} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><Pencil size={14}/></button>
                    <button onClick={() => handleDelete(p)} className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-500 flex items-center justify-center"><Trash2 size={14}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {promos.length === 0 && <p className="text-center text-[var(--text-3)] py-10 text-sm">No hay promociones. Crea la primera.</p>}
      </div>

      {toast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">{toast}</div>}
    </div>
  )
}
