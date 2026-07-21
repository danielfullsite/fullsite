'use client'

import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Check, ArrowLeft, Send, Download } from 'lucide-react'
import { getIngredients, getInventory } from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'
import { getActiveClientSlug } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit?: number
  supplier?: string
}

interface OCItem {
  ingredient_id: string
  name: string
  unit: string
  quantity: number
  cost_per_unit: number
  supplier: string
  total: number
}

export default function OrdenCompraPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [inventory, setInventory] = useState<Map<string, number>>(new Map())
  const [items, setItems] = useState<OCItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<string>('')

  useEffect(() => {
    async function load() {
      const [ings, inv] = await Promise.all([getIngredients(), getInventory()])
      setIngredients((ings as any[]).sort((a, b) => a.name.localeCompare(b.name)))
      const invMap = new Map<string, number>()
      for (const i of inv as any[]) invMap.set(i.ingredient_id, Number(i.stock) || 0)
      setInventory(invMap)
      setLoading(false)
    }
    load()
  }, [])

  const suppliers = [...new Set(ingredients.map(i => i.supplier).filter(Boolean))] as string[]

  const filtered = search.length >= 2
    ? ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase())
      && (!selectedSupplier || i.supplier === selectedSupplier)).slice(0, 10)
    : []

  const addItem = (ing: Ingredient) => {
    if (items.some(i => i.ingredient_id === ing.id)) return
    const stock = inventory.get(ing.id) || 0
    setItems(prev => [...prev, {
      ingredient_id: ing.id,
      name: ing.name,
      unit: ing.unit || 'u',
      quantity: 1,
      cost_per_unit: Number(ing.cost_per_unit) || 0,
      supplier: ing.supplier || '',
      total: Number(ing.cost_per_unit) || 0,
    }])
    setSearch('')
  }

  const updateQty = (id: string, qty: number) => {
    setItems(prev => prev.map(i => i.ingredient_id === id
      ? { ...i, quantity: qty, total: qty * i.cost_per_unit }
      : i
    ))
  }

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.ingredient_id !== id))

  const totalCost = items.reduce((s, i) => s + i.total, 0)
  const bySupplier = new Map<string, OCItem[]>()
  for (const item of items) {
    const sup = item.supplier || 'Sin proveedor'
    if (!bySupplier.has(sup)) bySupplier.set(sup, [])
    bySupplier.get(sup)!.push(item)
  }

  // Auto-suggest: items below reorder point
  const suggestItems = () => {
    const newItems: OCItem[] = []
    for (const [ingId, stock] of inventory) {
      const ing = ingredients.find(i => i.id === ingId)
      if (!ing) continue
      if (stock < 2 && !items.some(i => i.ingredient_id === ingId)) { // stock < 2 = low
        newItems.push({
          ingredient_id: ing.id, name: ing.name, unit: ing.unit || 'u',
          quantity: 5, cost_per_unit: Number(ing.cost_per_unit) || 0,
          supplier: ing.supplier || '', total: 5 * (Number(ing.cost_per_unit) || 0),
        })
      }
    }
    if (newItems.length > 0) setItems(prev => [...prev, ...newItems.slice(0, 20)])
  }

  const handleSave = async () => {
    if (items.length === 0) return
    setSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_orders`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: getActiveClientSlug(),
          fecha: today,
          status: 'borrador',
          items: JSON.stringify(items),
          total: totalCost,
          suppliers: [...bySupplier.keys()].join(', '),
          notes: `OC generada ${today} — ${items.length} productos`,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving OC:', err)
    } finally {
      setSaving(false)
    }
  }

  const exportCSV = () => {
    const header = 'Proveedor,Producto,Unidad,Cantidad,Costo Unitario,Total\n'
    const rows = items.map(i => `${i.supplier},${i.name},${i.unit},${i.quantity},${i.cost_per_unit},${i.total}`).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `OC_${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-1)]">Orden de Compra</h2>
            <p className="text-sm text-[var(--text-3)]">Genera OC para proveedores</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={suggestItems} className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium">
            Auto-sugerir
          </button>
          {items.length > 0 && (
            <button onClick={exportCSV} className="px-3 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text-2)] text-xs font-medium flex items-center gap-1">
              <Download size={12} /> CSV
            </button>
          )}
        </div>
      </div>

      {/* Add item */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <select value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}
            className="px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-xs text-[var(--text-1)]">
            <option value="">Todos los proveedores</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ingrediente..."
              className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-teal-500" />
            {filtered.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                {filtered.map(ing => (
                  <button key={ing.id} onClick={() => addItem(ing)}
                    className="w-full text-left px-4 py-2 hover:bg-[var(--surface-2)] text-sm text-[var(--text-1)]">
                    {ing.name} <span className="text-[var(--text-3)]">({ing.unit}) — {ing.supplier || 'Sin prov.'} — Stock: {(inventory.get(ing.id) || 0).toFixed(1)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items by supplier */}
      {Array.from(bySupplier.entries()).map(([supplier, supItems]) => (
        <div key={supplier} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)] flex justify-between">
            <h3 className="text-sm font-bold text-[var(--text-1)]">{supplier}</h3>
            <span className="text-xs text-[var(--text-3)]">{supItems.length} items · {formatCurrency(supItems.reduce((s, i) => s + i.total, 0))}</span>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {supItems.map(item => (
              <div key={item.ingredient_id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm text-[var(--text-1)]">{item.name}</p>
                  <p className="text-[11px] text-[var(--text-3)]">{formatCurrency(item.cost_per_unit)}/{item.unit}</p>
                </div>
                <input type="number" inputMode="decimal" value={item.quantity}
                  onChange={e => updateQty(item.ingredient_id, Number(e.target.value) || 0)}
                  className="w-20 text-center px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm" />
                <span className="text-xs text-[var(--text-3)] w-8">{item.unit}</span>
                <span className="text-sm font-bold text-[var(--text-1)] w-20 text-right">{formatCurrency(item.total)}</span>
                <button onClick={() => removeItem(item.ingredient_id)} className="p-1 text-[var(--text-3)] hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Total + Save */}
      {items.length > 0 && (
        <>
          <div className="flex justify-between items-center px-4 py-3 bg-[var(--surface)] rounded-xl border border-[var(--line)] mb-4">
            <span className="text-sm font-bold text-[var(--text-1)]">Total OC ({items.length} productos)</span>
            <span className="text-xl font-bold text-teal-400">{formatCurrency(totalCost)}</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2">
            {saving ? 'Guardando...' : 'Guardar Orden de Compra'}
          </button>
        </>
      )}

      {items.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-8 text-center">
          <p className="text-sm text-[var(--text-3)]">Busca ingredientes o usa "Auto-sugerir" para agregar items con stock bajo</p>
        </div>
      )}

      {saved && (
        <div className="mt-4 flex items-center gap-2 justify-center text-emerald-400 text-sm">
          <Check size={16} /> Orden de compra guardada
        </div>
      )}
    </div>
  )
}
