'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useClientId } from '@/hooks/useClientId'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type Tab = 'mods' | 'assign' | 'order-type'
type OrderType = 'dine-in' | 'takeout' | 'delivery'

interface ModGroup { id: string; name: string; sort_order: number; active: boolean }
interface Modifier { id: string; group_id: string; name: string; price: number; active: boolean }
interface Category { id: string; name: string; color: string; active: boolean }
interface Assignment { id: number; category_id: string; modifier_group_id: string }

const GROUP_COLORS: Record<string, string> = {
  quitar: 'bg-red-100 text-red-700',
  food: 'bg-amber-100 text-amber-400',
  coffee: 'bg-yellow-100 text-yellow-700',
  drinks: 'bg-cyan-100 text-cyan-700',
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...opts?.headers,
    },
  })
  return res.ok ? res.json() : []
}

// Default order-type config (in-memory for now)
const DEFAULT_ORDER_TYPES: Record<string, OrderType[]> = {
  quitar: ['dine-in', 'takeout', 'delivery'],
  food: ['dine-in', 'takeout', 'delivery'],
  coffee: ['dine-in', 'takeout', 'delivery'],
  drinks: ['dine-in', 'takeout', 'delivery'],
}

const ORDER_TYPE_LABELS: Record<OrderType, string> = { 'dine-in': 'Restaurante', takeout: 'Para llevar', delivery: 'Domicilio' }

export default function ModificadoresPage() {
  const CLIENT_ID = useClientId()
  const [tab, setTab] = useState<Tab>('mods')
  const [groups, setGroups] = useState<ModGroup[]>([])
  const [mods, setMods] = useState<Modifier[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [orderTypes, setOrderTypes] = useState<Record<string, OrderType[]>>(DEFAULT_ORDER_TYPES)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newMod, setNewMod] = useState({ name: '', price: '', group_id: 'food' })
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    const [g, m, c, a] = await Promise.all([
      api(`pos_modifier_groups?client_id=eq.${CLIENT_ID}&order=sort_order.asc`),
      api(`pos_modifiers?client_id=eq.${CLIENT_ID}&order=sort_order.asc`),
      api(`pos_menu_categories?client_id=eq.${CLIENT_ID}&active=eq.true&order=sort_order.asc`),
      api(`pos_category_modifiers?client_id=eq.${CLIENT_ID}`),
    ])
    setGroups(g); setMods(m); setCategories(c); setAssignments(a)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Add modifier ───────────────────────────────────────────
  const handleAdd = async () => {
    if (!newMod.name) return
    const id = newMod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' + Date.now().toString(36)
    await api('pos_modifiers', {
      method: 'POST',
      body: JSON.stringify({ id, client_id: CLIENT_ID, group_id: newMod.group_id, name: newMod.name, price: Number(newMod.price) || 0, sort_order: mods.length }),
    })
    showToast(`${newMod.name} agregado`)
    setNewMod({ name: '', price: '', group_id: 'food' })
    setAdding(false)
    load()
  }

  // ── Delete modifier ────────────────────────────────────────
  const handleDelete = async (mod: Modifier) => {
    await api(`pos_modifiers?id=eq.${mod.id}`, { method: 'DELETE' })
    showToast(`${mod.name} eliminado`)
    load()
  }

  // ── Toggle assignment ──────────────────────────────────────
  const toggleAssign = async (catId: string, groupId: string) => {
    const existing = assignments.find(a => a.category_id === catId && a.modifier_group_id === groupId)
    if (existing) {
      await api(`pos_category_modifiers?id=eq.${existing.id}`, { method: 'DELETE' })
    } else {
      await api('pos_category_modifiers', {
        method: 'POST',
        body: JSON.stringify({ client_id: CLIENT_ID, category_id: catId, modifier_group_id: groupId }),
      })
    }
    load()
  }

  // ── Toggle order type (in-memory) ──────────────────────────
  const toggleOrderType = (groupId: string, ot: OrderType) => {
    setOrderTypes(prev => {
      const cur = prev[groupId] || []
      return { ...prev, [groupId]: cur.includes(ot) ? cur.filter(t => t !== ot) : [...cur, ot] }
    })
  }

  const isAssigned = (catId: string, groupId: string) => assignments.some(a => a.category_id === catId && a.modifier_group_id === groupId)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'mods', label: 'Modificadores' },
    { id: 'assign', label: 'Asignacion' },
    { id: 'order-type', label: 'Por Tipo de Orden' },
  ]

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-3)]">Cargando modificadores...</div>

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Modificadores" subtitle={`${mods.length} modificadores · ${groups.length} grupos`} eyebrow="Admin" />

      <div className="flex gap-1 mb-6 bg-[var(--surface-2)] rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {toast && <div className="fixed top-4 right-4 z-50 bg-[var(--surface)] text-white px-4 py-2.5 rounded-xl text-sm shadow-lg">{toast}</div>}

      {/* Tab 1: Modifier list */}
      {tab === 'mods' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setAdding(true)} className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
              <Plus size={16} /> Agregar
            </button>
          </div>

          {adding && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 mb-4">
              <h3 className="font-semibold text-emerald-800 mb-3 text-sm">Nuevo modificador</h3>
              <div className="grid grid-cols-3 gap-3">
                <input value={newMod.name} onChange={e => setNewMod({ ...newMod, name: e.target.value })}
                  placeholder="Nombre" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" autoFocus />
                <input type="number" value={newMod.price} onChange={e => setNewMod({ ...newMod, price: e.target.value })}
                  placeholder="Precio extra ($0 si quitar)" className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
                <select value={newMod.group_id} onChange={e => setNewMod({ ...newMod, group_id: e.target.value })}
                  className="border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm">
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14} /> Guardar</button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm">Cancelar</button>
              </div>
            </div>
          )}

          {groups.map(group => {
            const groupMods = mods.filter(m => m.group_id === group.id)
            if (!groupMods.length) return null
            return (
              <div key={group.id} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${GROUP_COLORS[group.id] || 'bg-[var(--surface-2)] text-[var(--text-1)]'}`}>{group.name}</span>
                  <span className="text-xs text-[var(--text-3)]">{groupMods.length}</span>
                </div>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm divide-y divide-slate-100">
                  {groupMods.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-[var(--text-1)]">{m.name}</span>
                      <div className="flex items-center gap-3">
                        {m.price > 0 && <span className="text-sm font-semibold text-emerald-600">+${m.price}</span>}
                        <button onClick={() => handleDelete(m)} className="w-7 h-7 rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-500 flex items-center justify-center">
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
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-2)] uppercase sticky left-0 bg-[var(--surface-2)]">Categoria</th>
                {groups.map(g => (
                  <th key={g.id} className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">{g.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text-1)] sticky left-0 bg-[var(--surface)]">
                    <span className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded ${cat.color}`}></div>
                      {cat.name}
                    </span>
                  </td>
                  {groups.map(g => {
                    const on = isAssigned(cat.id, g.id)
                    return (
                      <td key={g.id} className="text-center px-4 py-3">
                        <button onClick={() => toggleAssign(cat.id, g.id)}
                          className={`w-8 h-8 rounded-lg border-2 transition-colors ${on ? 'bg-emerald-500/100 border-emerald-500 text-white' : 'border-[var(--line)] text-transparent hover:border-[var(--line)]'}`}>
                          {on && <span className="text-xs font-bold">&#10003;</span>}
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
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Grupo</th>
                {(['dine-in', 'takeout', 'delivery'] as OrderType[]).map(ot => (
                  <th key={ot} className="text-center px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">{ORDER_TYPE_LABELS[ot]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                  <td className="px-5 py-4">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${GROUP_COLORS[g.id] || 'bg-[var(--surface-2)] text-[var(--text-1)]'}`}>{g.name}</span>
                  </td>
                  {(['dine-in', 'takeout', 'delivery'] as OrderType[]).map(ot => {
                    const on = (orderTypes[g.id] || []).includes(ot)
                    return (
                      <td key={ot} className="text-center px-5 py-4">
                        <button onClick={() => toggleOrderType(g.id, ot)}
                          className={`w-10 h-6 rounded-full transition-colors relative ${on ? 'bg-emerald-500/100' : 'bg-[var(--line)]'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-[var(--surface)] shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 bg-[var(--surface-2)] border-t border-[var(--line)]">
            <p className="text-xs text-[var(--text-3)]">Desactiva un grupo para excluir esos modificadores de un tipo de orden.</p>
          </div>
        </div>
      )}
    </div>
  )
}
