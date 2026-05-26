'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldOff, ShieldCheck, Package, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { getInventory, getRecipes } from '@/lib/pos-data'
import PageHeader from '@/components/PageHeader'

interface InventoryItem {
  ingredient_id: string
  name: string
  stock: number
  reorder_point: number
  unit: string
}

interface RecipeRow {
  menu_item_id: string
  menu_item_name: string
  ingredient_id: string
  quantity: number
}

interface AffectedItem {
  menuItemId: string
  menuItemName: string
  missingIngredients: { name: string; stock: number; reorderPoint: number; unit: string; needed: number }[]
  severity: 'critical' | 'warning'
}

export default function Auto86Page() {
  const [affected, setAffected] = useState<AffectedItem[]>([])
  const [criticalIngredients, setCriticalIngredients] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [totalMenuItems, setTotalMenuItems] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const [inventory, recipes] = await Promise.all([
        getInventory(),
        getRecipes(),
      ])

      // Build inventory map: ingredient_id → {stock, reorder_point, name, unit}
      const invMap = new Map<string, InventoryItem>()
      for (const item of inventory) {
        invMap.set(item.ingredient_id, {
          ingredient_id: item.ingredient_id,
          name: (item as any).name || item.ingredient_id,
          stock: Number(item.stock) || 0,
          reorder_point: Number(item.reorder_point) || 0,
          unit: (item as any).unit || 'u',
        })
      }

      // Find critical ingredients (stock below reorder point)
      const critical = Array.from(invMap.values())
        .filter(i => i.reorder_point > 0 && i.stock < i.reorder_point)
        .sort((a, b) => (a.stock / a.reorder_point) - (b.stock / b.reorder_point))
      setCriticalIngredients(critical)

      const criticalIds = new Set(critical.map(c => c.ingredient_id))

      // Group recipes by menu item and find affected items
      const menuItemMap = new Map<string, { id: string; name: string; ingredients: { ingredientId: string; quantity: number }[] }>()
      for (const r of recipes) {
        const key = r.menu_item_id
        if (!menuItemMap.has(key)) {
          menuItemMap.set(key, { id: key, name: r.menu_item_name, ingredients: [] })
        }
        menuItemMap.get(key)!.ingredients.push({ ingredientId: r.ingredient_id, quantity: Number(r.quantity) || 0 })
      }
      setTotalMenuItems(menuItemMap.size)

      // Find menu items with critical ingredients
      const affectedItems: AffectedItem[] = []
      for (const [, menuItem] of menuItemMap) {
        const missing = menuItem.ingredients
          .filter(ing => criticalIds.has(ing.ingredientId))
          .map(ing => {
            const inv = invMap.get(ing.ingredientId)!
            return {
              name: inv.name,
              stock: inv.stock,
              reorderPoint: inv.reorder_point,
              unit: inv.unit,
              needed: ing.quantity,
            }
          })

        if (missing.length > 0) {
          const hasZero = missing.some(m => m.stock === 0)
          affectedItems.push({
            menuItemId: menuItem.id,
            menuItemName: menuItem.name,
            missingIngredients: missing,
            severity: hasZero ? 'critical' : 'warning',
          })
        }
      }

      // Sort: critical first, then by number of missing ingredients
      affectedItems.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
        return b.missingIngredients.length - a.missingIngredients.length
      })

      setAffected(affectedItems)
    } catch (err) {
      console.error('Error loading auto-86:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const criticalCount = affected.filter(a => a.severity === 'critical').length
  const warningCount = affected.filter(a => a.severity === 'warning').length
  const safeCount = totalMenuItems - affected.length

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <PageHeader title="Auto-86" subtitle="Detección automática de platillos sin ingredientes" />
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-red-500/20 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldOff size={14} className="text-red-400" />
            <span className="text-xs text-[var(--text-3)] font-medium">86'd (sin stock)</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-amber-500/20 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-xs text-[var(--text-3)] font-medium">Stock bajo</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{warningCount}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-emerald-500/20 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span className="text-xs text-[var(--text-3)] font-medium">Disponibles</span>
          </div>
          <p className="text-2xl font-bold text-emerald-500">{safeCount}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package size={14} className="text-[var(--text-3)]" />
            <span className="text-xs text-[var(--text-3)] font-medium">Ingredientes críticos</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{criticalIngredients.length}</p>
        </div>
      </div>

      {/* Critical ingredients quick view */}
      {criticalIngredients.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Ingredientes en nivel crítico</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {criticalIngredients.slice(0, 12).map(ing => {
              const pct = ing.reorder_point > 0 ? (ing.stock / ing.reorder_point) * 100 : 0
              return (
                <div key={ing.ingredient_id} className="bg-[var(--surface-2)] rounded-lg p-3">
                  <p className="text-xs font-medium text-[var(--text-1)] truncate">{ing.name}</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className={`text-sm font-bold ${ing.stock === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {ing.stock.toFixed(1)}
                    </span>
                    <span className="text-[11px] text-[var(--text-3)]">/ {ing.reorder_point} {ing.unit}</span>
                  </div>
                  <div className="w-full bg-[var(--surface)] rounded-full h-1.5 mt-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${ing.stock === 0 ? 'bg-red-500' : 'bg-amber-500'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Affected menu items */}
      {affected.length > 0 ? (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line-soft)]">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Platillos afectados ({affected.length})</h3>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {affected.map(item => {
              const isExpanded = expanded === item.menuItemId
              return (
                <div key={item.menuItemId}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : item.menuItemId)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--surface-2)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                      <span className="text-sm font-medium text-[var(--text-1)]">{item.menuItemName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {item.severity === 'critical' ? 'SIN STOCK' : 'BAJO'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-3)]">{item.missingIngredients.length} ingrediente{item.missingIngredients.length > 1 ? 's' : ''}</span>
                      {isExpanded ? <ChevronDown size={14} className="text-[var(--text-3)]" /> : <ChevronRight size={14} className="text-[var(--text-3)]" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 pl-9">
                      <div className="space-y-1.5">
                        {item.missingIngredients.map((ing, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--text-2)]">{ing.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[var(--text-3)]">Necesita: {ing.needed.toFixed(2)} {ing.unit}</span>
                              <span className={`font-bold ${ing.stock === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                                Stock: {ing.stock.toFixed(2)} {ing.unit}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-[var(--surface)] rounded-xl border border-emerald-500/20 shadow-sm p-8 text-center">
          <ShieldCheck size={32} className="text-emerald-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-[var(--text-1)] mb-2">Todo disponible</h3>
          <p className="text-sm text-[var(--text-3)]">Los {totalMenuItems} platillos del menú tienen todos sus ingredientes en stock.</p>
        </div>
      )}
    </>
  )
}
