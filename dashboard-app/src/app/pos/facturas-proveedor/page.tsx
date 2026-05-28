'use client'

import { useState, useEffect } from 'react'
import { FileText, Upload, Check, ArrowLeft, AlertTriangle, DollarSign } from 'lucide-react'
import { getIngredients } from '@/lib/pos-data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface FacturaItem {
  ingredient_id: string
  name: string
  unit: string
  quantity: number
  unit_price: number
  total: number
  baseline_price: number
  variance_pct: number
}

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit?: number
  supplier?: string
}

const VARIANCE_THRESHOLD = 10 // Alert if price varies >10%

export default function FacturasProveedorPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [items, setItems] = useState<FacturaItem[]>([])
  const [proveedor, setProveedor] = useState('')
  const [numFactura, setNumFactura] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getIngredients().then(data => {
      setIngredients((data as any[]).sort((a, b) => a.name.localeCompare(b.name)))
      setLoading(false)
    })
  }, [])

  const suppliers = [...new Set(ingredients.map(i => i.supplier).filter(Boolean))] as string[]
  const filtered = search.length >= 2
    ? ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10)
    : []

  const addItem = (ing: Ingredient) => {
    if (items.some(i => i.ingredient_id === ing.id)) return
    setItems(prev => [...prev, {
      ingredient_id: ing.id,
      name: ing.name,
      unit: ing.unit || 'u',
      quantity: 1,
      unit_price: Number(ing.cost_per_unit) || 0,
      total: Number(ing.cost_per_unit) || 0,
      baseline_price: Number(ing.cost_per_unit) || 0,
      variance_pct: 0,
    }])
    setSearch('')
  }

  const updateItem = (id: string, field: 'quantity' | 'unit_price', value: number) => {
    setItems(prev => prev.map(i => {
      if (i.ingredient_id !== id) return i
      const updated = { ...i, [field]: value }
      updated.total = updated.quantity * updated.unit_price
      updated.variance_pct = updated.baseline_price > 0
        ? ((updated.unit_price - updated.baseline_price) / updated.baseline_price) * 100
        : 0
      return updated
    }))
  }

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.ingredient_id !== id))

  const totalFactura = items.reduce((s, i) => s + i.total, 0)
  const alerts = items.filter(i => Math.abs(i.variance_pct) > VARIANCE_THRESHOLD)

  const handleSave = async () => {
    if (items.length === 0 || !proveedor) return
    setSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      // Save factura
      await fetch(`${SUPABASE_URL}/rest/v1/pos_facturas_proveedor`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: 'amalay',
          fecha: today,
          proveedor,
          num_factura: numFactura,
          items: JSON.stringify(items),
          total: totalFactura,
          status: 'registrada',
          alertas: alerts.length,
        }),
      })

      // Update ingredient costs if price changed
      for (const item of items) {
        if (Math.abs(item.variance_pct) > 0.1) {
          await fetch(`${SUPABASE_URL}/rest/v1/pos_ingredients?id=eq.${item.ingredient_id}&client_id=eq.amalay`, {
            method: 'PATCH',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ cost_per_unit: item.unit_price }),
          })
        }
      }

      // Add inventory (restock)
      for (const item of items) {
        await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            client_id: 'amalay',
            ingredient_id: item.ingredient_id,
            type: 'compra',
            quantity: item.quantity,
            notes: `Factura ${numFactura} — ${proveedor}`,
            reference: numFactura || `factura-${today}`,
          }),
        })

        // Update stock
        const invRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.amalay&ingredient_id=eq.${item.ingredient_id}&select=id,stock`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (invRes.ok) {
          const rows = await invRes.json()
          if (rows.length > 0) {
            const newStock = Number(rows[0].stock || 0) + item.quantity
            await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory?id=eq.${rows[0].id}`, {
              method: 'PATCH',
              headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ stock: newStock }),
            })
          }
        }
      }

      setSaved(true)
      setItems([])
      setNumFactura('')
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Registro de Factura Proveedor</h2>
          <p className="text-sm text-[var(--text-3)]">Captura factura, actualiza costos e inventario automáticamente</p>
        </div>
      </div>

      {/* Header fields */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-3)] mb-1 block">Proveedor *</label>
            <select value={proveedor} onChange={e => setProveedor(e.target.value)}
              className="w-full px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)]">
              <option value="">Seleccionar proveedor</option>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="__otro">Otro...</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--text-3)] mb-1 block">Número de factura</label>
            <input type="text" value={numFactura} onChange={e => setNumFactura(e.target.value)}
              placeholder="Ej. FAC-0042"
              className="w-full px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)]" />
          </div>
        </div>
      </div>

      {/* Search ingredient */}
      <div className="relative mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ingrediente para agregar..."
          className="w-full px-4 py-3 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-violet-500" />
        {filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
            {filtered.map(ing => (
              <button key={ing.id} onClick={() => addItem(ing)}
                className="w-full text-left px-4 py-2 hover:bg-[var(--surface-2)] text-sm text-[var(--text-1)]">
                {ing.name} <span className="text-[var(--text-3)]">({ing.unit}) — Costo base: {formatCurrency(Number(ing.cost_per_unit) || 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Variance alerts */}
      {alerts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">{alerts.length} producto(s) con varianza &gt;{VARIANCE_THRESHOLD}%</p>
            {alerts.map(a => (
              <p key={a.ingredient_id} className="text-xs text-[var(--text-3)]">
                {a.name}: {formatCurrency(a.baseline_price)} → {formatCurrency(a.unit_price)} ({a.variance_pct > 0 ? '+' : ''}{a.variance_pct.toFixed(1)}%)
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Items table */}
      {items.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden mb-4">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Producto</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Cantidad</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Precio/u</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Total</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Var</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {items.map(item => (
                <tr key={item.ingredient_id} className={Math.abs(item.variance_pct) > VARIANCE_THRESHOLD ? 'bg-amber-500/5' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm text-[var(--text-1)]">{item.name}</p>
                    <p className="text-[11px] text-[var(--text-3)]">{item.unit} · Base: {formatCurrency(item.baseline_price)}</p>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input type="number" inputMode="decimal" value={item.quantity}
                      onChange={e => updateItem(item.ingredient_id, 'quantity', Number(e.target.value) || 0)}
                      className="w-20 text-center px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm" />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input type="number" inputMode="decimal" step="0.01" value={item.unit_price}
                      onChange={e => updateItem(item.ingredient_id, 'unit_price', Number(e.target.value) || 0)}
                      className="w-24 text-center px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg text-sm" />
                  </td>
                  <td className="px-4 py-2.5 text-sm font-bold text-[var(--text-1)] text-right tabular-nums">{formatCurrency(item.total)}</td>
                  <td className="px-4 py-2.5 text-xs text-right">
                    {Math.abs(item.variance_pct) > 0.1 ? (
                      <span className={item.variance_pct > 0 ? 'text-red-400' : 'text-emerald-400'}>
                        {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2"><button onClick={() => removeItem(item.ingredient_id)} className="p-1 text-[var(--text-3)] hover:text-red-400"><FileText size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex justify-between items-center px-4 py-3 bg-[var(--surface)] rounded-xl border border-[var(--line)] mb-4">
            <span className="text-sm font-bold text-[var(--text-1)]">Total factura ({items.length} productos)</span>
            <span className="text-xl font-bold text-violet-400">{formatCurrency(totalFactura)}</span>
          </div>
          <button onClick={handleSave} disabled={saving || !proveedor}
            className="w-full py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2">
            {saving ? 'Guardando...' : 'Registrar Factura + Actualizar Inventario'}
          </button>
          <p className="text-xs text-[var(--text-3)] text-center mt-2">Al guardar: se actualiza el stock, se registra el movimiento, y se actualizan los costos si cambiaron.</p>
        </>
      )}

      {saved && (
        <div className="mt-4 flex items-center gap-2 justify-center text-emerald-400 text-sm">
          <Check size={16} /> Factura registrada — inventario y costos actualizados
        </div>
      )}
    </div>
  )
}
