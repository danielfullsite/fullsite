'use client'

import { useState } from 'react'
import { Plus, Trash2, Save, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { MENU_CATEGORIES, MODIFIERS_QUITAR, MODIFIERS_AGREGAR_FOOD, MODIFIERS_AGREGAR_COFFEE, MODIFIERS_AGREGAR_DRINKS } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type Tab = 'mods' | 'assign' | 'order-type'
type OrderType = 'dine-in' | 'takeout' | 'delivery'

interface Modifier { id: string; name: string; price: number; group: string }

const MODIFIER_GROUPS = [
  { id: 'quitar', name: 'Quitar', color: 'bg-red-100 text-red-700' },
  { id: 'food', name: 'Extras Comida', color: 'bg-amber-100 text-amber-700' },
  { id: 'coffee', name: 'Extras Café', color: 'bg-yellow-100 text-yellow-700' },
  { id: 'drinks', name: 'Extras Bebidas', color: 'bg-cyan-100 text-cyan-700' },
]

function buildInitialMods(): Modifier[] {
  const mods: Modifier[] = []
  MODIFIERS_QUITAR.forEach((m, i) => mods.push({ id: `q${i}`, name: m, price: 0, group: 'quitar' }))
  MODIFIERS_AGREGAR_FOOD.forEach((m, i) => mods.push({ id: `f${i}`, name: m.name, price: m.price, group: 'food' }))
  MODIFIERS_AGREGAR_COFFEE.forEach((m, i) => mods.push({ id: `c${i}`, name: m.name, price: m.price, group: 'coffee' }))
  MODIFIERS_AGREGAR_DRINKS.forEach((m, i) => mods.push({ id: `d${i}`, name: m.name, price: m.price, group: 'drinks' }))
  return mods
}

// Default assignment: which modifier groups apply to which categories
const DEFAULT_ASSIGNMENTS: Record<string, string[]> = {
  promos: ['quitar', 'food'], chilaquiles: ['quitar', 'food'], eggs: ['quitar', 'food'],
  toast: ['quitar', 'food'], croissants: ['quitar', 'food'], pancakes: ['quitar', 'food'],
  paninis: ['quitar', 'food'], pizzas: ['quitar', 'food'], bowls: ['quitar', 'food'],
  ceviche: ['quitar', 'food'], postres: ['food'],
  coffee: ['coffee'], tea: ['coffee'],
  fresh: ['drinks'], smoothies: ['drinks'], frappes: ['drinks'], jugos: ['drinks'],
  signature: ['drinks'],
}

// Default order-type config: which groups are available per order type
const DEFAULT_ORDER_TYPES: Record<string, OrderType[]> = {
  quitar: ['dine-in', 'takeout', 'delivery'],
  food: ['dine-in', 'takeout', 'delivery'],
  coffee: ['dine-in', 'takeout', 'delivery'],
  drinks: ['dine-in', 'takeout', 'delivery'],
}

export default function ModificadoresPage() {
  const [tab, setTab] = useState<Tab>('mods')
  const [mods, setMods] = useState<Modifier[]>(buildInitialMods)
  const [assignments, setAssignments] = useState<Record<string, string[]>>(DEFAULT_ASSIGNMENTS)
  const [orderTypes, setOrderTypes] = useState<Record<string, OrderType[]>>(DEFAULT_ORDER_TYPES)
  const [adding, setAdding] = useState(false)
  const [newMod, setNewMod] = useState({ name: '', price: '', group: 'food' })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  const handleAdd = () => {
    if (!newMod.name) return
    setMods(p => [...p, { id: `n${Date.now()}`, name: newMod.name, price: Number(newMod.price) || 0, group: newMod.group }])
    showToast(`${newMod.name} agregado`)
    setNewMod({ name: '', price: '', group: 'food' })
    setAdding(false)
  }

  const handleDelete = (id: string) => {
    const m = mods.find(x => x.id === id)
    setMods(p => p.filter(x => x.id !== id))
    if (m) showToast(`${m.name} eliminado`)
  }

  const toggleAssign = (catId: string, groupId: string) => {
    setAssignments(prev => {
      const cur = prev[catId] || []
      return { ...prev, [catId]: cur.includes(groupId) ? cur.filter(g => g !== groupId) : [...cur, groupId] }
    })
  }

  const toggleOrderType = (groupId: string, ot: OrderType) => {
    setOrderTypes(prev => {
      const cur = prev[groupId] || []
      return { ...prev, [groupId]: cur.includes(ot) ? cur.filter(t => t !== ot) : [...cur, ot] }
    })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'mods', label: 'Modificadores' },
    { id: 'assign', label: 'Asignacion' },
    { id: 'order-type', label: 'Por Tipo de Orden' },
  ]

  const ORDER_TYPE_LABELS: Record<OrderType, string> = { 'dine-in': 'Restaurante', takeout: 'Para llevar', delivery: 'Domicilio' }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Modificadores" subtitle={`${mods.length} modificadores · ${MODIFIER_GROUPS.length} grupos`} eyebrow="Admin" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toast */}
      {toast && <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm shadow-lg">{toast}</div>}

      {/* Tab 1: Modifier list */}
      {tab === 'mods' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
              <Plus size={16} /> Agregar
            </button>
          </div>

          {adding && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-4">
              <h3 className="font-semibold text-emerald-800 mb-3 text-sm">Nuevo modificador</h3>
              <div className="grid grid-cols-3 gap-3">
                <input value={newMod.name} onChange={e => setNewMod({ ...newMod, name: e.target.value })}
                  placeholder="Nombre" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
                <input type="number" value={newMod.price} onChange={e => setNewMod({ ...newMod, price: e.target.value })}
                  placeholder="Precio extra ($0 si quitar)" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
                <select value={newMod.group} onChange={e => setNewMod({ ...newMod, group: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
                  {MODIFIER_GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14} /> Guardar</button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-sm">Cancelar</button>
              </div>
            </div>
          )}

          {MODIFIER_GROUPS.map(group => {
            const groupMods = mods.filter(m => m.group === group.id)
            if (!groupMods.length) return null
            return (
              <div key={group.id} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${group.color}`}>{group.name}</span>
                  <span className="text-xs text-slate-400">{groupMods.length}</span>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                  {groupMods.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-slate-900">{m.name}</span>
                      <div className="flex items-center gap-3">
                        {m.price > 0 && <span className="text-sm font-semibold text-emerald-600">+${m.price}</span>}
                        <button onClick={() => handleDelete(m.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 flex items-center justify-center">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Tab 2: Assignment matrix */}
      {tab === 'assign' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase sticky left-0 bg-slate-50">Categoria</th>
                {MODIFIER_GROUPS.map(g => (
                  <th key={g.id} className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{g.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MENU_CATEGORIES.map(cat => (
                <tr key={cat.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 sticky left-0 bg-white">{cat.name}</td>
                  {MODIFIER_GROUPS.map(g => {
                    const on = (assignments[cat.id] || []).includes(g.id)
                    return (
                      <td key={g.id} className="text-center px-4 py-3">
                        <button onClick={() => toggleAssign(cat.id, g.id)}
                          className={`w-8 h-8 rounded-lg border-2 transition-colors ${on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-transparent hover:border-slate-300'}`}>
                          {on && <span className="text-xs font-bold">✓</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Order type config */}
      {tab === 'order-type' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Grupo</th>
                {(['dine-in', 'takeout', 'delivery'] as OrderType[]).map(ot => (
                  <th key={ot} className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase">{ORDER_TYPE_LABELS[ot]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODIFIER_GROUPS.map(g => (
                <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-4">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${g.color}`}>{g.name}</span>
                  </td>
                  {(['dine-in', 'takeout', 'delivery'] as OrderType[]).map(ot => {
                    const on = (orderTypes[g.id] || []).includes(ot)
                    return (
                      <td key={ot} className="text-center px-5 py-4">
                        <button onClick={() => toggleOrderType(g.id, ot)}
                          className={`w-10 h-6 rounded-full transition-colors relative ${on ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200">
            <p className="text-xs text-slate-400">Desactiva un grupo para excluir esos modificadores de un tipo de orden.</p>
          </div>
        </div>
      )}
    </div>
  )
}
