'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Package, TrendingDown, X } from 'lucide-react'
import { formatMXN } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

interface InventoryItem {
  ingredient_id: string
  ingredient_name: string
  stock: number
  unit: string
  reorder_point: number
  recipe_usage: number // quantity per order
  orders_remaining: number
}

interface StockAlert {
  ingredient: string
  stock: number
  unit: string
  ordersLeft: number
  menuItems: string[]
  severity: 'critical' | 'warning' | 'low'
}

interface InventoryAlertsProps {
  onItemOutOfStock?: (menuItemId: string) => void
  compact?: boolean
}

export default function InventoryAlerts({ onItemOutOfStock, compact = false }: InventoryAlertsProps) {
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadInventoryAlerts()
    // Refresh every 2 minutes
    const interval = setInterval(loadInventoryAlerts, 120000)
    return () => clearInterval(interval)
  }, [])

  async function loadInventoryAlerts() {
    try {
      // Fetch inventory with reorder points
      const invRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_inventory?select=ingredient_id,stock,reorder_point&client_id=eq.${_cid()}`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const inventory = invRes.ok ? await invRes.json() : []

      // Fetch ingredients for names
      const ingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_ingredients?select=id,name,unit&client_id=eq.${_cid()}&active=eq.true`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const ingredients = ingRes.ok ? await ingRes.json() : []
      const ingMap = new Map(ingredients.map((i: { id: string; name: string; unit: string }) => [i.id, i]))

      // Fetch recipes to calculate orders remaining
      const recRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_recipes_old?select=menu_item_id,menu_item_name,ingredient_id,quantity&client_id=eq.${_cid()}&limit=5000`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const recipes = recRes.ok ? await recRes.json() : []

      // Build alerts
      const newAlerts: StockAlert[] = []

      for (const inv of inventory) {
        const ing = ingMap.get(inv.ingredient_id) as { name: string; unit: string } | undefined
        if (!ing) continue

        const stock = Number(inv.stock) || 0
        const reorderPoint = Number(inv.reorder_point) || 0

        // Find all recipes using this ingredient
        const usages = recipes.filter((r: { ingredient_id: string }) => r.ingredient_id === inv.ingredient_id)
        if (usages.length === 0) continue

        // Calculate minimum orders remaining (limited by this ingredient)
        const minOrders = Math.min(
          ...usages.map((u: { quantity: number }) => Math.floor(stock / (Number(u.quantity) || 1)))
        )

        const menuItems = usages.map((u: { menu_item_name: string }) => u.menu_item_name)

        let severity: 'critical' | 'warning' | 'low' | null = null
        if (stock <= 0 || minOrders <= 0) {
          severity = 'critical'
          // Notify parent about out-of-stock items
          usages.forEach((u: { menu_item_id: string }) => onItemOutOfStock?.(u.menu_item_id))
        } else if (minOrders <= 3) {
          severity = 'critical'
        } else if (stock <= reorderPoint || minOrders <= 10) {
          severity = 'warning'
        } else if (minOrders <= 20) {
          severity = 'low'
        }

        if (severity) {
          newAlerts.push({
            ingredient: ing.name,
            stock,
            unit: ing.unit,
            ordersLeft: minOrders,
            menuItems: [...new Set(menuItems)] as string[],
            severity,
          })
        }
      }

      // Sort: critical first, then warning, then low
      newAlerts.sort((a, b) => {
        const order = { critical: 0, warning: 1, low: 2 }
        return order[a.severity] - order[b.severity]
      })

      setAlerts(newAlerts)
    } catch {
      // Silent fail
    }
    setLoading(false)
  }

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.ingredient))

  if (loading || visibleAlerts.length === 0) return null

  if (compact) {
    const criticalCount = visibleAlerts.filter(a => a.severity === 'critical').length
    const warningCount = visibleAlerts.filter(a => a.severity === 'warning').length

    return (
      <div className="flex items-center gap-2">
        {criticalCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 animate-pulse">
            <AlertTriangle size={14} />
            {criticalCount} agotado{criticalCount > 1 ? 's' : ''}
          </div>
        )}
        {warningCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-amber-500/10 text-amber-400">
            <Package size={14} />
            {warningCount} bajo{warningCount > 1 ? 's' : ''}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visibleAlerts.map((alert) => (
        <div
          key={alert.ingredient}
          className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
            alert.severity === 'critical'
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : alert.severity === 'warning'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {alert.severity === 'critical' ? (
              <AlertTriangle size={18} />
            ) : (
              <TrendingDown size={18} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold capitalize">{alert.ingredient}</p>
            <p className="text-xs opacity-80">
              {alert.ordersLeft <= 0
                ? 'AGOTADO'
                : `${alert.ordersLeft} orden${alert.ordersLeft > 1 ? 'es' : ''} restante${alert.ordersLeft > 1 ? 's' : ''}`}
              {' · '}{alert.stock} {alert.unit} en stock
            </p>
            <p className="text-xs opacity-60 mt-0.5 truncate">
              Afecta: {alert.menuItems.slice(0, 3).join(', ')}
              {alert.menuItems.length > 3 ? ` +${alert.menuItems.length - 3} mas` : ''}
            </p>
          </div>
          <button
            onClick={() => setDismissed(prev => new Set(prev).add(alert.ingredient))}
            className="flex-shrink-0 p-1 rounded hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// Export hook for use in POS page to mark menu items as out-of-stock
export function useInventoryStatus() {
  const [outOfStock, setOutOfStock] = useState<Set<string>>(new Set())

  const markOutOfStock = (menuItemId: string) => {
    setOutOfStock(prev => new Set(prev).add(menuItemId))
  }

  return { outOfStock, markOutOfStock }
}
