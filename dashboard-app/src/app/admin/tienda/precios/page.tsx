'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { DollarSign, Check, Save } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Item { id: string; name: string; department: string; price: number; cost: number }

async function sbFetch(path: string, opts?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...opts?.headers },
  })
}

function tierLabel(p: number) {
  if (p >= 500) return '$500+'
  if (p >= 200) return '$200-499'
  if (p >= 100) return '$100-199'
  if (p >= 50) return '$50-99'
  return '$0-49'
}
const TIERS = ['$0-49', '$50-99', '$100-199', '$200-499', '$500+']
const TIER_COLORS: Record<string, string> = { '$0-49': 'bg-[var(--surface-2)] text-[var(--text-1)]', '$50-99': 'bg-blue-500/15 text-blue-400', '$100-199': 'bg-amber-500/15 text-amber-400', '$200-499': 'bg-purple-500/15 text-purple-400', '$500+': 'bg-emerald-500/15 text-emerald-400' }

export default function PreciosPage() {
  const CLIENT_ID = useClientId()
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [newPrice, setNewPrice] = useState('')
  const [activeTier, setActiveTier] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const r = await sbFetch(`pos_retail_items?client_id=eq.${CLIENT_ID}&select=id,name,department,price,cost&active=eq.true&order=price.desc`)
    if (r.ok) setItems(await r.json())
  }

  useEffect(() => { load() }, [])

  const grouped = TIERS.map(t => ({ tier: t, items: items.filter(i => tierLabel(i.price) === t) })).filter(g => g.items.length > 0)

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const selectTier = (tier: string) => {
    const tierItems = items.filter(i => tierLabel(i.price) === tier)
    const allSelected = tierItems.every(i => selected.has(i.id))
    setSelected(prev => {
      const s = new Set(prev)
      tierItems.forEach(i => allSelected ? s.delete(i.id) : s.add(i.id))
      return s
    })
  }

  const handleBulkUpdate = async () => {
    if (!newPrice || selected.size === 0) return
    const price = Number(newPrice)
    if (price <= 0) return
    const ids = Array.from(selected)
    // Batch update using IN filter
    const filter = `id=in.(${ids.join(',')})&client_id=eq.${CLIENT_ID}`
    await sbFetch(`pos_retail_items?${filter}`, { method: 'PATCH', body: JSON.stringify({ price }) })
    showToast(`${ids.length} precios actualizados a $${price.toFixed(2)}`)
    setSelected(new Set()); setNewPrice(''); load()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Gestion de Precios" subtitle={`${items.length} productos activos`} eyebrow="Tienda" />

      {selected.size > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 mb-6 flex items-center gap-4">
          <span className="text-sm font-semibold text-blue-800">{selected.size} seleccionados</span>
          <div className="flex items-center gap-2 flex-1">
            <DollarSign size={16} className="text-blue-500" />
            <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Nuevo precio"
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:border-blue-500" />
            <button onClick={handleBulkUpdate} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Save size={14}/> Aplicar</button>
          </div>
          <button onClick={() => setSelected(new Set())} className="text-xs text-blue-500 hover:underline">Deseleccionar</button>
        </div>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        {TIERS.map(t => {
          const count = items.filter(i => tierLabel(i.price) === t).length
          if (count === 0) return null
          return (
            <button key={t} onClick={() => setActiveTier(activeTier === t ? null : t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTier === t ? 'bg-[var(--surface)] text-white' : TIER_COLORS[t]}`}>
              {t} ({count})
            </button>
          )
        })}
      </div>

      <div className="space-y-4">
        {(activeTier ? grouped.filter(g => g.tier === activeTier) : grouped).map(({ tier, items: tierItems }) => (
          <div key={tier} className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
            <div className="bg-[var(--surface-2)] border-b border-[var(--line)] px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${TIER_COLORS[tier]}`}>{tier}</span>
                <span className="text-xs text-[var(--text-3)]">{tierItems.length} productos</span>
              </div>
              <button onClick={() => selectTier(tier)} className="text-xs text-emerald-600 hover:underline font-medium">
                {tierItems.every(i => selected.has(i.id)) ? 'Deseleccionar' : 'Seleccionar'} todos
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {tierItems.map(item => {
                const m = item.price > 0 ? ((item.price - item.cost) / item.price * 100) : 0
                return (
                  <div key={item.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-[var(--surface-2)]">
                    <button onClick={() => toggleSelect(item.id)}
                      className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${selected.has(item.id) ? 'bg-emerald-500/100 border-emerald-500 text-white' : 'border-[var(--line)]'}`}>
                      {selected.has(item.id) && <Check size={12} />}
                    </button>
                    <span className="text-sm font-medium text-[var(--text-1)] flex-1">{item.name}</span>
                    <span className="text-xs text-[var(--text-3)]">{item.department}</span>
                    <span className="text-sm font-semibold text-[var(--text-1)] w-20 text-right">${item.price.toFixed(2)}</span>
                    <span className={`text-xs font-semibold w-12 text-right ${m >= 50 ? 'text-emerald-600' : m >= 30 ? 'text-amber-400' : 'text-red-600'}`}>{m.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-[var(--text-3)] py-10 text-sm">No hay productos registrados</p>}
      </div>

      {toast && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">{toast}</div>}
    </div>
  )
}
