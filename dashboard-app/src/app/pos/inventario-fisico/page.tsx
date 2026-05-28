'use client'

import { useState, useEffect } from 'react'
import { Search, Check, ArrowLeft, AlertTriangle, Package } from 'lucide-react'
import { getIngredients, getInventory, logAudit } from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface InventoryItem {
  ingredient_id: string
  name: string
  unit: string
  stock: number // system stock
  physical?: number // user input
  cost_per_unit?: number
}

export default function InventarioFisicoPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showDifferences, setShowDifferences] = useState(false)

  useEffect(() => {
    async function load() {
      const [ingredients, inventory] = await Promise.all([getIngredients(), getInventory()])
      const ingMap = new Map((ingredients as any[]).map(i => [i.id, i]))
      const merged: InventoryItem[] = (inventory as any[]).map(inv => {
        const ing = ingMap.get(inv.ingredient_id) || {}
        return {
          ingredient_id: inv.ingredient_id,
          name: (ing as any).name || inv.ingredient_id,
          unit: (ing as any).unit || 'u',
          stock: Number(inv.stock) || 0,
          cost_per_unit: Number((ing as any).cost_per_unit) || 0,
        }
      }).sort((a, b) => a.name.localeCompare(b.name))
      setItems(merged)
      setLoading(false)
    }
    load()
  }, [])

  const updatePhysical = (id: string, value: string) => {
    setItems(prev => prev.map(i => i.ingredient_id === id ? { ...i, physical: value === '' ? undefined : Number(value) } : i))
  }

  const counted = items.filter(i => i.physical !== undefined)
  const differences = counted.filter(i => Math.abs((i.physical || 0) - i.stock) > 0.01)
  const totalDiffCost = differences.reduce((s, i) => {
    const diff = (i.physical || 0) - i.stock
    return s + (diff * (i.cost_per_unit || 0))
  }, 0)

  const filtered = (showDifferences ? differences : items).filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSave = async () => {
    if (counted.length === 0) return
    setSaving(true)
    try {
      for (const item of counted) {
        const diff = (item.physical || 0) - item.stock
        // Update stock to physical count
        await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.amalay&ingredient_id=eq.${item.ingredient_id}`, {
          method: 'PATCH',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ stock: item.physical }),
        })
        // Log movement
        if (Math.abs(diff) > 0.001) {
          await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              client_id: 'amalay',
              ingredient_id: item.ingredient_id,
              type: 'conteo_fisico',
              quantity: diff,
              notes: `Conteo físico: sistema ${item.stock.toFixed(2)} → físico ${(item.physical || 0).toFixed(2)} (diff: ${diff > 0 ? '+' : ''}${diff.toFixed(2)})`,
              reference: `conteo-${new Date().toISOString().split('T')[0]}`,
            }),
          })
        }
      }
      logAudit({
        action: 'merma_registered' as any,
        actor: 'almacén',
        details: { type: 'conteo_fisico', items_counted: counted.length, differences: differences.length, cost_diff: totalDiffCost },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Conteo Físico de Inventario</h2>
          <p className="text-sm text-[var(--text-3)]">Captura el stock real y compara vs sistema</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Productos contados</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{counted.length} <span className="text-sm font-normal text-[var(--text-3)]">/ {items.length}</span></p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Con diferencia</p>
          <p className={`text-2xl font-bold ${differences.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{differences.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Costo diferencia</p>
          <p className={`text-2xl font-bold ${totalDiffCost < 0 ? 'text-red-400' : totalDiffCost > 0 ? 'text-emerald-400' : 'text-[var(--text-1)]'}`}>{formatCurrency(Math.abs(totalDiffCost))}</p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ingrediente..."
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500" />
        </div>
        <button onClick={() => setShowDifferences(!showDifferences)}
          className={`px-4 py-2 rounded-lg text-xs font-medium ${showDifferences ? 'bg-amber-500 text-black' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
          {showDifferences ? `Diferencias (${differences.length})` : 'Solo diferencias'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Ingrediente</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Sistema</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Físico</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {filtered.slice(0, 100).map(item => {
              const diff = item.physical !== undefined ? (item.physical - item.stock) : null
              const hasDiff = diff !== null && Math.abs(diff) > 0.01
              return (
                <tr key={item.ingredient_id} className={hasDiff ? 'bg-amber-500/5' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm text-[var(--text-1)]">{item.name}</p>
                    <p className="text-[11px] text-[var(--text-3)]">{item.unit}</p>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-[var(--text-2)] text-right tabular-nums">{item.stock.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <input type="number" inputMode="decimal" step="0.01"
                      value={item.physical ?? ''}
                      onChange={e => updatePhysical(item.ingredient_id, e.target.value)}
                      placeholder="—"
                      className="w-24 text-center px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500" />
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                    {hasDiff ? (
                      <span className={diff! > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {diff! > 0 ? '+' : ''}{diff!.toFixed(2)}
                      </span>
                    ) : item.physical !== undefined ? (
                      <Check size={14} className="text-emerald-400 inline" />
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Save */}
      {counted.length > 0 && (
        <button onClick={handleSave} disabled={saving}
          className="w-full mt-4 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2">
          {saving ? 'Guardando...' : `Guardar conteo (${counted.length} productos${differences.length > 0 ? `, ${differences.length} con diferencia` : ''})`}
        </button>
      )}

      {saved && (
        <div className="mt-4 flex items-center gap-2 justify-center text-emerald-400 text-sm">
          <Check size={16} /> Conteo guardado — inventario actualizado
        </div>
      )}
    </div>
  )
}
