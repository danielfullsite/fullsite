'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Save, X, Search, ScanBarcode } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface RetailItem {
  id?: string; name: string; barcode: string; department: string; group_name: string
  price: number; cost: number; stock: number; min_stock: number; unit: string; active: boolean
}

const empty: RetailItem = { name: '', barcode: '', department: '', group_name: '', price: 0, cost: 0, stock: 0, min_stock: 0, unit: 'pza', active: true }

async function sbFetch(path: string, opts?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: opts?.method === 'POST' ? 'return=representation' : 'return=minimal', ...opts?.headers },
  })
}

function margin(p: number, c: number) { return p > 0 ? ((p - c) / p) * 100 : 0 }
function marginColor(m: number) { return m >= 50 ? 'text-emerald-600' : m >= 30 ? 'text-amber-400' : 'text-red-600' }

export default function ArticulosPage() {
  const CLIENT_ID = useClientId()
  const [items, setItems] = useState<RetailItem[]>([])
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('all')
  const [editing, setEditing] = useState<RetailItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<RetailItem>({ ...empty })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const r = await sbFetch(`pos_retail_items?client_id=eq.${CLIENT_ID}&order=name`)
    if (r.ok) setItems(await r.json())
  }

  useEffect(() => { load() }, [CLIENT_ID])

  const departments = [...new Set(items.map(i => i.department).filter(Boolean))]

  const filtered = items.filter(i => {
    if (filterDept !== 'all' && i.department !== filterDept) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.barcode?.includes(search)) return false
    return true
  })

  const handleSave = async (item: RetailItem, isNew: boolean) => {
    const { id, ...body } = item
    if (isNew) {
      const r = await sbFetch('pos_retail_items', { method: 'POST', body: JSON.stringify({ ...body, client_id: CLIENT_ID }) })
      if (r.ok) { showToast(`${item.name} agregado`); setAdding(false); setForm({ ...empty }); load() }
    } else {
      await sbFetch(`pos_retail_items?id=eq.${id}&client_id=eq.${CLIENT_ID}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`${item.name} actualizado`); setEditing(null); load()
    }
  }

  const handleDelete = async (item: RetailItem) => {
    if (!confirm(`Eliminar ${item.name}?`)) return
    await sbFetch(`pos_retail_items?id=eq.${item.id}&client_id=eq.${CLIENT_ID}`, { method: 'DELETE' })
    showToast(`${item.name} eliminado`); load()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Articulos Tienda" subtitle={`${items.length} productos`} eyebrow="Tienda"
        action={<button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"><Plus size={16}/>Agregar</button>} />

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o codigo..."
            className="w-full pl-10 pr-4 py-2.5 border border-[var(--line)] rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
        </div>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="border border-[var(--line)] rounded-xl px-3 py-2.5 text-sm">
          <option value="all">Todos los departamentos</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {(adding || editing) && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-emerald-800 mb-3">{adding ? 'Nuevo artículo' : `Editando: ${editing?.name}`}</h3>
          {(() => { const f = adding ? form : editing!; const set = adding ? setForm : (v: RetailItem) => setEditing(v); return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={f.name} onChange={e => set({ ...f, name: e.target.value })} placeholder="Nombre" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm col-span-2" />
                <div className="relative">
                  <ScanBarcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                  <input value={f.barcode} onChange={e => set({ ...f, barcode: e.target.value })} placeholder="Codigo de barras" className="w-full pl-10 pr-3 py-2 border border-[var(--line)] rounded-lg text-sm" />
                </div>
                <input value={f.department} onChange={e => set({ ...f, department: e.target.value })} placeholder="Departamento" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input value={f.group_name} onChange={e => set({ ...f, group_name: e.target.value })} placeholder="Grupo" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={f.price||''} onChange={e => set({ ...f, price: +e.target.value })} placeholder="Precio" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={f.cost||''} onChange={e => set({ ...f, cost: +e.target.value })} placeholder="Costo" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={f.stock||''} onChange={e => set({ ...f, stock: +e.target.value })} placeholder="Stock" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={f.min_stock||''} onChange={e => set({ ...f, min_stock: +e.target.value })} placeholder="Stock min" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
                <input value={f.unit} onChange={e => set({ ...f, unit: e.target.value })} placeholder="Unidad" className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleSave(f, adding)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14}/> Guardar</button>
                <button onClick={() => { setAdding(false); setEditing(null); setForm({...empty}) }} className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm">Cancelar</button>
              </div>
            </>
          ); })()}
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
              {['Producto','Codigo','Depto','Precio','Costo','Margen','Stock',''].map(h =>
                <th key={h} className={`px-4 py-3 text-xs font-semibold text-[var(--text-2)] uppercase ${h==='Precio'||h==='Costo'||h==='Margen'||h==='Stock'?'text-right':'text-left'}`}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => { const m = margin(item.price, item.cost); return (
              <tr key={item.id} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${!item.active?'opacity-40':''}`}>
                <td className="px-4 py-3 text-sm font-medium text-[var(--text-1)]">{item.name}</td>
                <td className="px-4 py-3 text-sm text-[var(--text-2)] font-mono">{item.barcode}</td>
                <td className="px-4 py-3 text-sm text-[var(--text-2)]">{item.department}</td>
                <td className="px-4 py-3 text-sm text-right font-semibold">${item.price.toFixed(2)}</td>
                <td className="px-4 py-3 text-sm text-right text-[var(--text-2)]">${item.cost.toFixed(2)}</td>
                <td className={`px-4 py-3 text-sm text-right font-semibold ${marginColor(m)}`}>{m.toFixed(0)}%</td>
                <td className={`px-4 py-3 text-sm text-right ${item.stock<=item.min_stock?'text-red-600 font-semibold':'text-[var(--text-1)]'}`}>{item.stock} {item.unit}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => setEditing(item)} className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center"><Pencil size={14}/></button>
                    <button onClick={() => handleDelete(item)} className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-500 flex items-center justify-center"><X size={14}/></button>
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-[var(--text-3)] py-10 text-sm">No se encontraron artículos</p>}
      </div>

      {toast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">{toast}</div>}
    </div>
  )
}
