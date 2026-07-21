'use client'

import { useState, useEffect, useMemo } from 'react'
import { Sparkles, TrendingUp, AlertTriangle, Clock, ChevronRight } from 'lucide-react'
import { getActiveClientSlug as _cid } from '@/lib/data'

// ── Types ────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  nombre: string
  precio: number
  cantidad: number
  subtotal: number
}

interface CopilotSuggestion {
  type: 'upsell' | 'alert' | 'insight' | 'combo'
  priority: number // 1=high, 2=med, 3=low
  title: string
  description: string
  action?: string // item name to add
  actionPrice?: number
}

interface POSCopilotProps {
  orderItems: OrderItem[]
  mesa: number
  personas: number
  mesero: string
  onAddItem?: (itemName: string) => void
}

// ── Upsell rules ─────────────────────────────────────────────────────────

const UPSELL_RULES: Array<{
  trigger: string[] // if order contains any of these
  suggest: string
  reason: string
  price: number
}> = [
  // Coffee upsells
  { trigger: ['americano', 'cafe americano'], suggest: 'Cappuccino', reason: 'Upgrade de cafe +$15', price: 65 },
  { trigger: ['cappuccino', 'latte'], suggest: 'Shot extra', reason: 'Doble shot mas intenso', price: 20 },

  // Breakfast combos
  { trigger: ['chilaquiles', 'enchiladas'], suggest: 'Jugo verde', reason: 'Combo desayuno', price: 55 },
  { trigger: ['pancakes', 'waffles', 'french toast'], suggest: 'Cafe americano', reason: 'Dulce + cafe', price: 45 },
  { trigger: ['huevos', 'omelette', 'benedict'], suggest: 'Jugo de naranja', reason: 'Clasico de desayuno', price: 50 },

  // Bowl combos
  { trigger: ['acai bowl', 'smoothie bowl'], suggest: 'Matcha latte', reason: 'Combo healthy', price: 75 },

  // Postre upsells
  { trigger: ['panini', 'croissant', 'bagel'], suggest: 'Cappuccino', reason: 'Pan + cafe', price: 65 },

  // Dessert push (after mains)
  { trigger: ['chilaquiles', 'enchiladas', 'bowl', 'panini', 'ceviche'], suggest: 'Cheesecake', reason: 'Postre para cerrar', price: 85 },

  // Second drink
  { trigger: ['limonada', 'jugo'], suggest: 'Agua fresca', reason: '2da bebida', price: 35 },
]

const COMBO_RULES: Array<{
  items: string[] // need all of these
  name: string
  discount: number
}> = [
  { items: ['cafe', 'croissant'], name: 'Combo Croissant + Cafe', discount: 15 },
  { items: ['chilaquiles', 'jugo'], name: 'Combo Desayuno AMALAY', discount: 20 },
]

// ── Time-based suggestions ───────────────────────────────────────────────

function getTimeBasedSuggestions(): CopilotSuggestion[] {
  const hour = new Date().getHours()
  const suggestions: CopilotSuggestion[] = []

  if (hour >= 7 && hour < 11) {
    suggestions.push({
      type: 'insight',
      priority: 3,
      title: 'Hora de desayuno',
      description: 'Chilaquiles y cafe son los mas pedidos a esta hora',
    })
  } else if (hour >= 13 && hour < 16) {
    suggestions.push({
      type: 'insight',
      priority: 3,
      title: 'Hora de comida',
      description: 'Bowls y paninis tienen mejor margen a esta hora',
    })
  } else if (hour >= 16) {
    suggestions.push({
      type: 'insight',
      priority: 3,
      title: 'Hora de cafe',
      description: 'Frappes y postres suben 40% despues de las 4pm',
    })
  }

  return suggestions
}


// ── Component ────────────────────────────────────────────────────────────

export default function POSCopilot({ orderItems, mesa, personas, mesero, onAddItem }: POSCopilotProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [lowStock, setLowStock] = useState<string[]>([])

  // Fetch low stock items on mount
  useEffect(() => {
    async function fetchLowStock() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) return

        const res = await fetch(
          `${url}/rest/v1/pos_inventory?select=ingredient_id,stock,reorder_point&client_id=eq.${_cid()}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        )
        if (res.ok) {
          const data = await res.json()
          const low = data
            .filter((i: { stock: number; reorder_point: number }) =>
              i.reorder_point > 0 && i.stock <= i.reorder_point * 0.5
            )
            .map((i: { ingredient_id: string }) => i.ingredient_id)
          setLowStock(low)
        }
      } catch { /* */ }
    }
    fetchLowStock()
  }, [])

  const suggestions = useMemo(() => {
    const all: CopilotSuggestion[] = []
    const orderNames = orderItems.map(i => i.nombre.toLowerCase())
    const orderTotal = orderItems.reduce((s, i) => s + i.subtotal, 0)

    // -- Upsell suggestions --
    for (const rule of UPSELL_RULES) {
      const triggered = rule.trigger.some(t => orderNames.some(n => n.includes(t)))
      const alreadyHas = orderNames.some(n => n.toLowerCase().includes(rule.suggest.toLowerCase()))
      if (triggered && !alreadyHas) {
        all.push({
          type: 'upsell',
          priority: 2,
          title: rule.suggest,
          description: rule.reason,
          action: rule.suggest,
          actionPrice: rule.price,
        })
      }
    }

    // -- Combo detection --
    for (const combo of COMBO_RULES) {
      const hasAll = combo.items.every(item => orderNames.some(n => n.includes(item)))
      if (hasAll) {
        all.push({
          type: 'combo',
          priority: 1,
          title: combo.name,
          description: `Ahorro $${combo.discount} si aplicas combo`,
        })
      }
    }

    // -- Ticket promedio alert --
    if (orderItems.length > 0 && personas > 0) {
      const perPerson = orderTotal / personas
      if (perPerson < 120 && orderItems.length >= 2) {
        all.push({
          type: 'alert',
          priority: 2,
          title: 'Ticket bajo',
          description: `$${Math.round(perPerson)}/persona — promedio es $180. Sugiere postre o 2da bebida.`,
        })
      }
    }

    // -- Low stock warnings --
    if (lowStock.length > 0) {
      const affected = orderItems.filter(i =>
        lowStock.some(ls => i.nombre.toLowerCase().includes(ls.toLowerCase()))
      )
      if (affected.length > 0) {
        all.push({
          type: 'alert',
          priority: 1,
          title: 'Stock bajo',
          description: `${affected.map(a => a.nombre).join(', ')} tiene ingredientes limitados`,
        })
      }
    }

    // -- Empty order --
    if (orderItems.length === 0) {
      all.push(...getTimeBasedSuggestions())
    }

    // -- No drink detection --
    if (orderItems.length >= 1) {
      const drinkKeywords = ['cafe', 'cappuccino', 'latte', 'jugo', 'smoothie', 'frappe', 'limonada', 'agua', 'te ', 'matcha', 'chai', 'soda']
      const hasDrink = orderNames.some(n => drinkKeywords.some(d => n.includes(d)))
      if (!hasDrink) {
        all.push({
          type: 'upsell',
          priority: 1,
          title: 'Sin bebida',
          description: 'Esta mesa no tiene bebida. Sugiere cafe o jugo.',
          action: 'Cafe americano',
          actionPrice: 45,
        })
      }
    }

    // -- Large party suggestion --
    if (personas >= 6 && orderItems.length < personas) {
      all.push({
        type: 'insight',
        priority: 2,
        title: 'Mesa grande',
        description: `${personas} personas, ${orderItems.length} items. Faltan ordenes?`,
      })
    }

    // Filter dismissed and sort by priority
    return all
      .filter(s => !dismissed.has(s.title))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4) // max 4 suggestions
  }, [orderItems, personas, lowStock, dismissed])

  if (suggestions.length === 0) return null

  const iconMap = {
    upsell: TrendingUp,
    alert: AlertTriangle,
    insight: Sparkles,
    combo: Sparkles,
  }

  const colorMap = {
    upsell: { bg: 'bg-blue-900/40', border: 'border-blue-700/40', icon: 'text-blue-400', btn: 'bg-blue-600 hover:bg-blue-500' },
    alert: { bg: 'bg-amber-900/30', border: 'border-amber-700/40', icon: 'text-amber-400', btn: 'bg-amber-600 hover:bg-amber-500' },
    insight: { bg: 'bg-violet-900/30', border: 'border-violet-700/40', icon: 'text-violet-400', btn: 'bg-violet-600 hover:bg-violet-500' },
    combo: { bg: 'bg-emerald-900/30', border: 'border-emerald-700/40', icon: 'text-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-500' },
  }

  return (
    <div className="space-y-2 mb-3">
      <div className="flex items-center gap-1.5 px-1">
        <Sparkles size={12} className="text-violet-400" />
        <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">AI Copilot</span>
      </div>
      {suggestions.map((s) => {
        const Icon = iconMap[s.type]
        const colors = colorMap[s.type]
        return (
          <div
            key={s.title}
            className={`${colors.bg} border ${colors.border} rounded-xl px-3 py-2.5 flex items-center gap-3 group`}
          >
            <Icon size={16} className={`${colors.icon} flex-shrink-0`} />
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold">{s.title}
                {s.actionPrice && <span className="text-[var(--text-3)] font-normal"> · ${s.actionPrice}</span>}
              </p>
              <p className="text-[var(--text-3)] text-[10px] leading-tight">{s.description}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {s.action && onAddItem && (
                <button
                  onClick={() => {
                    onAddItem(s.action!)
                    setDismissed(prev => new Set(prev).add(s.title))
                  }}
                  className={`${colors.btn} text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors`}
                >
                  Agregar
                </button>
              )}
              <button
                onClick={() => setDismissed(prev => new Set(prev).add(s.title))}
                className="text-[var(--text-2)] hover:text-[var(--text-3)] text-xs px-1"
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
