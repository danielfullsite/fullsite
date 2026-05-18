'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Search, Save, X, Package } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface MenuItem {
  id: string
  name: string
  price: number
  category: string
  active: boolean
}

// Current menu from pos-data.ts categories
import { MENU_CATEGORIES } from '@/lib/pos-data'

export default function AdminMenuPage() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', price: '', category: MENU_CATEGORIES[0].id })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    // Load from MENU_CATEGORIES (static for now)
    const all: MenuItem[] = []
    for (const cat of MENU_CATEGORIES) {
      for (const item of cat.items) {
        all.push({ id: item.id, name: item.name, price: item.price, category: cat.name, active: true })
      }
    }
    setItems(all)
  }, [])

  const categories = [...new Set(items.map(i => i.category))]

  const filtered = items.filter(i => {
    if (filterCat !== 'all' && i.category !== filterCat) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleSaveEdit = () => {
    if (!editing) return
    setItems(prev => prev.map(i => i.id === editing.id ? editing : i))
    showToast(`${editing.name} actualizado`)
    setEditing(null)
  }

  const handleAdd = () => {
    if (!newItem.name || !newItem.price) return
    const cat = MENU_CATEGORIES.find(c => c.id === newItem.category)
    const item: MenuItem = {
      id: `new_${Date.now()}`,
      name: newItem.name,
      price: Number(newItem.price),
      category: cat?.name || newItem.category,
      active: true,
    }
    setItems(prev => [...prev, item])
    showToast(`${item.name} agregado`)
    setNewItem({ name: '', price: '', category: MENU_CATEGORIES[0].id })
    setAdding(false)
  }

  const handleToggle = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !i.active } : i))
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Administrar Menu</h2>
          <p className="text-sm text-slate-500">{items.length} platillos · {categories.length} categorias</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"
        >
          <Plus size={16} />
          Agregar platillo
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar platillo..."
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
        >
          <option value="all">Todas las categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Add modal */}
      {adding && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-emerald-800 mb-3">Nuevo platillo</h3>
          <div className="grid grid-cols-3 gap-3">
            <input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
              placeholder="Nombre del platillo" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
            <input type="number" value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })}
              placeholder="Precio" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
            <select value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
              {MENU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1">
              <Save size={14} /> Guardar
            </button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Platillo</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Categoria</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Precio</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Estado</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!item.active ? 'opacity-40' : ''}`}>
                <td className="px-5 py-3">
                  {editing?.id === item.id ? (
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                      className="border border-emerald-300 rounded px-2 py-1 text-sm w-full" />
                  ) : (
                    <span className="text-sm font-medium text-slate-900">{item.name}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500">{item.category}</td>
                <td className="px-5 py-3 text-right">
                  {editing?.id === item.id ? (
                    <input type="number" value={editing.price} onChange={e => setEditing({ ...editing, price: Number(e.target.value) })}
                      className="border border-emerald-300 rounded px-2 py-1 text-sm w-20 text-right" />
                  ) : (
                    <span className="text-sm font-semibold text-slate-900">${item.price.toFixed(2)}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-center">
                  <button onClick={() => handleToggle(item.id)}
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right">
                  {editing?.id === item.id ? (
                    <div className="flex gap-1 justify-end">
                      <button onClick={handleSaveEdit} className="w-8 h-8 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center">
                        <Save size={14} />
                      </button>
                      <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setEditing(item)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center">
                      <Pencil size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
