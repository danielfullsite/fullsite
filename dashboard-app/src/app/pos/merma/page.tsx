'use client'

import { useState, useEffect } from 'react'
import { Trash2, Search, Plus, Check, ArrowLeft } from 'lucide-react'
import { getIngredients, logAudit } from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const MOTIVOS = [
  'Caducado',
  'Dañado',
  'Preparación incorrecta',
  'Sobrante del día',
  'Derrame',
  'Calidad insuficiente',
  'Otro',
]

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit?: number
}

interface MermaEntry {
  ingredient_id: string
  name: string
  unit: string
  quantity: number
  motivo: string
  cost: number
}

export default function MermaPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<MermaEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  // Adding entry state
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null)
  const [qty, setQty] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS[0])

  useEffect(() => {
    getIngredients().then(data => {
      setIngredients(data as unknown as Ingredient[])
      setLoading(false)
    })
  }, [])

  const filtered = search.length >= 2
    ? ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10)
    : []

  const addEntry = () => {
    if (!selectedIngredient || !qty || Number(qty) <= 0) return
    const cost = (selectedIngredient.cost_per_unit || 0) * Number(qty)
    setEntries(prev => [...prev, {
      ingredient_id: selectedIngredient.id,
      name: selectedIngredient.name,
      unit: selectedIngredient.unit || 'u',
      quantity: Number(qty),
      motivo,
      cost,
    }])
    setSelectedIngredient(null)
    setQty('')
    setSearch('')
    setMotivo(MOTIVOS[0])
  }

  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }

  const totalCost = entries.reduce((s, e) => s + e.cost, 0)

  const handleSave = async () => {
    if (entries.length === 0) return
    setSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]

      // Save each merma as inventory movement
      for (const entry of entries) {
        await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            client_id: 'amalay',
            ingredient_id: entry.ingredient_id,
            type: 'merma',
            quantity: -entry.quantity,
            notes: entry.motivo,
            reference: `merma-${today}`,
          }),
        })

        // Also deduct from pos_inventory
        const invRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.amalay&ingredient_id=eq.${entry.ingredient_id}&select=id,stock`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (invRes.ok) {
          const rows = await invRes.json()
          if (rows.length > 0) {
            const newStock = Math.max(0, Number(rows[0].stock || 0) - entry.quantity)
            await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory?id=eq.${rows[0].id}`, {
              method: 'PATCH',
              headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({ stock: newStock }),
            })
          }
        }
      }

      // Audit log
      logAudit({
        action: 'merma_registered',
        actor: 'almacén',
        details: {
          items: entries.length,
          total_cost: totalCost,
          entries: entries.map(e => ({ name: e.name, qty: e.quantity, unit: e.unit, motivo: e.motivo })),
        },
      })

      setSaved(true)
      setEntries([])
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving merma:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Registro de Merma</h2>
          <p className="text-sm text-[var(--text-3)]">Baja de ingredientes por desperdicio, caducidad o daño</p>
        </div>
      </div>

      {/* Add ingredient */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Agregar merma</h3>

        {/* Search ingredient */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            value={selectedIngredient ? selectedIngredient.name : search}
            onChange={e => { setSearch(e.target.value); setSelectedIngredient(null) }}
            placeholder="Buscar ingrediente..."
            className="w-full pl-9 pr-4 py-3 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500"
          />
          {filtered.length > 0 && !selectedIngredient && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
              {filtered.map(ing => (
                <button
                  key={ing.id}
                  onClick={() => { setSelectedIngredient(ing); setSearch('') }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[var(--surface-2)] text-sm text-[var(--text-1)] transition-colors"
                >
                  {ing.name} <span className="text-[var(--text-3)]">({ing.unit})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedIngredient && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[var(--text-3)] mb-1 block">Cantidad ({selectedIngredient.unit})</label>
              <input
                type="number"
                inputMode="decimal"
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="0.5"
                className="w-full px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-3)] mb-1 block">Motivo</label>
              <select
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
              >
                {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={addEntry}
                disabled={!qty || Number(qty) <= 0}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-medium text-sm flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={14} /> Agregar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entries list */}
      {entries.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-[var(--line-soft)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Merma del día ({entries.length} items)</h3>
            <span className="text-sm font-bold text-red-400">-{formatCurrency(totalCost)}</span>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {entries.map((entry, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--text-1)]">{entry.name}</p>
                  <p className="text-xs text-[var(--text-3)]">{entry.quantity} {entry.unit} — {entry.motivo}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-red-400 font-medium">-{formatCurrency(entry.cost)}</span>
                  <button onClick={() => removeEntry(i)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-3)] hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      {entries.length > 0 && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {saving ? 'Guardando...' : `Registrar merma (${entries.length} items — ${formatCurrency(totalCost)})`}
        </button>
      )}

      {saved && (
        <div className="mt-4 flex items-center gap-2 justify-center text-emerald-400 text-sm">
          <Check size={16} /> Merma registrada — inventario actualizado
        </div>
      )}
    </div>
  )
}
