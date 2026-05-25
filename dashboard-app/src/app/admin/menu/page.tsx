'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Search, Save, X, ChevronDown, GripVertical } from 'lucide-react'
import { useClientId } from '@/hooks/useClientId'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Category {
  id: string
  name: string
  color: string
  sort_order: number
  active: boolean
}

interface MenuItem {
  id: string
  category_id: string
  name: string
  price: number
  barcode: string | null
  sort_order: number
  active: boolean
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts?.headers,
    },
  })
  return res.ok ? res.json() : []
}

export default function AdminMenuPage() {
  const CLIENT_ID = useClientId()
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [toast, setToast] = useState<string | null>(null)

  // Item modal
  const [editItem, setEditItem] = useState<MenuItem | null>(null)
  const [isNewItem, setIsNewItem] = useState(false)

  // Category modal
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [isNewCat, setIsNewCat] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const [cats, menuItems] = await Promise.all([
      api(`pos_menu_categories?client_id=eq.${CLIENT_ID}&order=sort_order.asc`),
      api(`pos_menu_items?client_id=eq.${CLIENT_ID}&order=sort_order.asc`),
    ])
    setCategories(cats)
    setItems(menuItems)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Item CRUD ──────────────────────────────────────────────

  const handleSaveItem = async () => {
    if (!editItem || !editItem.name) return
    const body = {
      client_id: CLIENT_ID,
      category_id: editItem.category_id,
      name: editItem.name,
      price: editItem.price,
      barcode: editItem.barcode || null,
      sort_order: editItem.sort_order,
      active: editItem.active,
    }
    if (isNewItem) {
      const id = editItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + Date.now().toString(36)
      await api('pos_menu_items', { method: 'POST', body: JSON.stringify({ id, ...body }) })
      showToast(`${editItem.name} agregado`)
    } else {
      await api(`pos_menu_items?id=eq.${editItem.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`${editItem.name} actualizado`)
    }
    setEditItem(null)
    load()
  }

  const handleToggleItem = async (item: MenuItem) => {
    await api(`pos_menu_items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !item.active }),
    })
    load()
  }

  // ── Category CRUD ──────────────────────────────────────────

  const handleSaveCat = async () => {
    if (!editCat || !editCat.name) return
    const body = {
      client_id: CLIENT_ID,
      name: editCat.name,
      color: editCat.color,
      sort_order: editCat.sort_order,
      active: editCat.active,
    }
    if (isNewCat) {
      const id = editCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
      await api('pos_menu_categories', { method: 'POST', body: JSON.stringify({ id, ...body }) })
      showToast(`Categoria "${editCat.name}" creada`)
    } else {
      await api(`pos_menu_categories?id=eq.${editCat.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`Categoria "${editCat.name}" actualizada`)
    }
    setEditCat(null)
    load()
  }

  const handleToggleCat = async (cat: Category) => {
    await api(`pos_menu_categories?id=eq.${cat.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !cat.active }),
    })
    load()
  }

  // ── Filter ─────────────────────────────────────────────────

  const filtered = items.filter(i => {
    if (filterCat !== 'all' && i.category_id !== filterCat) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const getCatName = (catId: string) => categories.find(c => c.id === catId)?.name || catId
  const activeItems = items.filter(i => i.active).length
  const activeCats = categories.filter(c => c.active).length

  // ── Color options ──────────────────────────────────────────
  const COLORS = [
    'bg-red-600','bg-rose-700','bg-yellow-500/100','bg-amber-700','bg-orange-500/100',
    'bg-yellow-600','bg-yellow-400','bg-lime-600','bg-green-500/100','bg-green-700',
    'bg-emerald-600','bg-cyan-500','bg-sky-600','bg-blue-500/100','bg-indigo-500/100',
    'bg-purple-600','bg-violet-700','bg-fuchsia-500','bg-pink-500/100','bg-[var(--surface-2)]0',
    'bg-amber-500/100','bg-rose-600',
  ]

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-3)]">Cargando menu...</div>

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Administrar Menu</h2>
          <p className="text-sm text-[var(--text-2)]">{activeItems} platillos activos · {activeCats} categorias</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditCat({ id: '', name: '', color: 'bg-[var(--surface-2)]0', sort_order: categories.length, active: true }); setIsNewCat(true) }}
            className="px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-1)] rounded-xl text-sm font-semibold flex items-center gap-2"
          >
            <Plus size={16} /> Categoria
          </button>
          <button
            onClick={() => { setEditItem({ id: '', category_id: categories[0]?.id || '', name: '', price: 0, barcode: null, sort_order: 0, active: true }); setIsNewItem(true) }}
            className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"
          >
            <Plus size={16} /> Platillo
          </button>
        </div>
      </div>

      {/* Categories bar */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setEditCat({ ...cat })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              cat.active
                ? 'bg-[var(--surface)] border-[var(--line)] text-[var(--text-1)] hover:border-emerald-300'
                : 'bg-[var(--surface-2)] border-[var(--line-soft)] text-[var(--text-3)] line-through'
            }`}
          >
            <div className={`w-3 h-3 rounded ${cat.color}`}></div>
            {cat.name}
            <span className="text-[var(--text-3)] font-normal">({items.filter(i => i.category_id === cat.id && i.active).length})</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar platillo..."
            className="w-full pl-10 pr-4 py-2.5 border border-[var(--line)] rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="border border-[var(--line)] rounded-xl px-3 py-2.5 text-sm"
        >
          <option value="all">Todas las categorias</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Platillo</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Categoria</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Precio</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Estado</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${!item.active ? 'opacity-40' : ''}`}>
                <td className="px-5 py-3">
                  <span className="text-sm font-medium text-[var(--text-1)]">{item.name}</span>
                  {item.barcode && <span className="ml-2 text-xs text-[var(--text-3)]">{item.barcode}</span>}
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm text-[var(--text-2)] flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded ${categories.find(c => c.id === item.category_id)?.color || 'bg-slate-400'}`}></div>
                    {getCatName(item.category_id)}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <span className="text-sm font-semibold text-[var(--text-1)]">
                    {item.price > 0 ? `$${item.price}` : <span className="text-[var(--text-3)] font-normal">Variable</span>}
                  </span>
                </td>
                <td className="px-5 py-3 text-center">
                  <button onClick={() => handleToggleItem(item)}
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${item.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditItem({ ...item }); setIsNewItem(false) }}
                    className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center ml-auto">
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-[var(--text-3)] text-sm">Sin resultados</p>
        )}
      </div>

      {/* ── Item Modal ──────────────────────────────────────── */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditItem(null)}>
          <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-4">{isNewItem ? 'Nuevo platillo' : 'Editar platillo'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Nombre</label>
                <input value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Precio (MXN)</label>
                  <input type="number" value={editItem.price} onChange={e => setEditItem({ ...editItem, price: Number(e.target.value) })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Categoria</label>
                  <select value={editItem.category_id} onChange={e => setEditItem({ ...editItem, category_id: e.target.value })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1">
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Codigo de barras (opcional)</label>
                <input value={editItem.barcode || ''} onChange={e => setEditItem({ ...editItem, barcode: e.target.value || null })}
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500"
                  placeholder="Escanear o escribir codigo" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveItem}
                className="flex-1 px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                <Save size={14} /> Guardar
              </button>
              <button onClick={() => setEditItem(null)}
                className="px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-xl text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Category Modal ──────────────────────────────────── */}
      {editCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditCat(null)}>
          <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-4">{isNewCat ? 'Nueva categoria' : 'Editar categoria'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Nombre</label>
                <input value={editCat.name} onChange={e => setEditCat({ ...editCat, name: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase mb-2 block">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setEditCat({ ...editCat, color: c })}
                      className={`w-8 h-8 rounded-lg ${c} ${editCat.color === c ? 'ring-2 ring-offset-2 ring-emerald-500' : ''}`} />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-[var(--text-2)]">Estado</span>
                <button onClick={() => setEditCat({ ...editCat, active: !editCat.active })}
                  className={`text-xs font-semibold px-3 py-1 rounded-full ${editCat.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                  {editCat.active ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveCat}
                className="flex-1 px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                <Save size={14} /> Guardar
              </button>
              {!isNewCat && (
                <button onClick={() => { handleToggleCat(editCat); setEditCat(null) }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${editCat.active ? 'bg-red-500/100/10 text-red-400 hover:bg-red-500/15' : 'bg-emerald-500/100/10 text-emerald-400 hover:bg-emerald-500/15'}`}>
                  {editCat.active ? 'Desactivar' : 'Activar'}
                </button>
              )}
              <button onClick={() => setEditCat(null)}
                className="px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-xl text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
