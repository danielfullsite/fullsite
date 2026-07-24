// Inventory prediction — estimates ingredient consumption from historical sales patterns
// Cross-references wansoft_daily ventas_por_grupo with pos_recipes ingredientes
// and compares against current stock in pos_inventory_products

import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

interface VentasPorGrupo { nombre: string; total: number }
interface Ingrediente { nombre: string; um: string; porcion: number; costo_um?: number; total?: number }
interface Recipe { nombre: string; precio_venta: number; ingredientes: Ingrediente[] | null; category?: string }
interface InventoryProduct {
  name: string; unit: string; cost_per_unit: number; stock: number;
  reorder_point: number; category: string; active: boolean
}
interface DailyRow { fecha: string; ventas_por_grupo: VentasPorGrupo[] | null }

export async function GET(request: NextRequest) {
  try {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    const opts = { headers, cache: 'no-store' as const }

    // Fetch last 30 days of sales, all recipes, and current inventory in parallel
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const since = thirtyDaysAgo.toISOString().split('T')[0]

    const cid = encodeURIComponent(getClientId(request))
    const [dailyRes, recipesRes, inventoryRes, menuRes] = await Promise.all([
      fetch(`${sbUrl}/rest/v1/wansoft_daily?fecha=gte.${since}&select=fecha,ventas_por_grupo&order=fecha.asc`, opts),
      fetch(`${sbUrl}/rest/v1/pos_recipes?client_id=eq.${cid}&select=nombre,precio_venta,ingredientes,category`, opts),
      fetch(`${sbUrl}/rest/v1/pos_inventory_products?client_id=eq.${cid}&active=eq.true&select=name,unit,cost_per_unit,stock,reorder_point,category`, opts),
      fetch(`${sbUrl}/rest/v1/pos_menu_items?client_id=eq.${cid}&select=name,price,category_id`, opts),
    ])

    const daily: DailyRow[] = dailyRes.ok ? await dailyRes.json() : []
    const recipes: Recipe[] = recipesRes.ok ? await recipesRes.json() : []
    const inventory: InventoryProduct[] = inventoryRes.ok ? await inventoryRes.json() : []
    const menuItems: { name: string; price: number; category_id: string }[] = menuRes.ok ? await menuRes.json() : []

    // ------------------------------------------------------------------
    // Step 1: Calculate average daily sales per category by day-of-week
    // ------------------------------------------------------------------
    // dayOfWeek 0=Sunday ... 6=Saturday
    const categorySalesByDow: Record<number, Record<string, { total: number; count: number }>> = {}
    for (let d = 0; d < 7; d++) categorySalesByDow[d] = {}

    for (const row of daily) {
      if (!row.ventas_por_grupo) continue
      const dow = new Date(row.fecha + 'T12:00:00').getDay()
      for (const g of row.ventas_por_grupo) {
        if (!g.nombre || !g.total) continue
        const key = g.nombre.toUpperCase().trim()
        if (!categorySalesByDow[dow][key]) categorySalesByDow[dow][key] = { total: 0, count: 0 }
        categorySalesByDow[dow][key].total += g.total
        categorySalesByDow[dow][key].count += 1
      }
    }

    // Average sales per category per day-of-week
    const avgCategorySalesByDow: Record<number, Record<string, number>> = {}
    for (let d = 0; d < 7; d++) {
      avgCategorySalesByDow[d] = {}
      for (const [cat, v] of Object.entries(categorySalesByDow[d])) {
        avgCategorySalesByDow[d][cat] = v.count > 0 ? v.total / v.count : 0
      }
    }

    // Also compute overall daily average per category (across all days)
    const categoryTotals: Record<string, { total: number; days: number }> = {}
    for (const row of daily) {
      if (!row.ventas_por_grupo) continue
      for (const g of row.ventas_por_grupo) {
        if (!g.nombre || !g.total) continue
        const key = g.nombre.toUpperCase().trim()
        if (!categoryTotals[key]) categoryTotals[key] = { total: 0, days: 0 }
        categoryTotals[key].total += g.total
      }
    }
    const daysCount = daily.length || 1
    const avgDailyCategorySales: Record<string, number> = {}
    for (const [cat, v] of Object.entries(categoryTotals)) {
      avgDailyCategorySales[cat] = v.total / daysCount
    }

    // ------------------------------------------------------------------
    // Step 2: Estimate items sold per category using avg price from recipes/menu
    // ------------------------------------------------------------------
    // Build a map: category -> average price per item
    // Use recipes with precio_venta > 0, fallback to menu items
    const categoryPrices: Record<string, { sum: number; count: number }> = {}

    for (const r of recipes) {
      if (r.precio_venta > 0 && r.category) {
        const cat = r.category.toUpperCase().trim()
        if (!categoryPrices[cat]) categoryPrices[cat] = { sum: 0, count: 0 }
        categoryPrices[cat].sum += r.precio_venta
        categoryPrices[cat].count += 1
      }
    }

    for (const m of menuItems) {
      if (m.price > 0 && m.category_id) {
        const cat = m.category_id.toUpperCase().trim()
        if (!categoryPrices[cat]) categoryPrices[cat] = { sum: 0, count: 0 }
        categoryPrices[cat].sum += m.price
        categoryPrices[cat].count += 1
      }
    }

    const avgPricePerCategory: Record<string, number> = {}
    for (const [cat, v] of Object.entries(categoryPrices)) {
      avgPricePerCategory[cat] = v.count > 0 ? v.sum / v.count : 150 // default $150 MXN
    }

    // ------------------------------------------------------------------
    // Step 3: Estimate avg daily items sold per category
    // ------------------------------------------------------------------
    const avgDailyItemsPerCategory: Record<string, number> = {}
    for (const [cat, sales] of Object.entries(avgDailyCategorySales)) {
      const avgPrice = avgPricePerCategory[cat] || 150
      avgDailyItemsPerCategory[cat] = sales / avgPrice
    }

    // ------------------------------------------------------------------
    // Step 4: Build ingredient consumption map from recipes
    // ------------------------------------------------------------------
    // For each recipe, map its category to ingredient usage per item sold
    // recipe.ingredientes = [{nombre, um, porcion, ...}]
    // "porcion" = amount of ingredient used per dish

    // Map recipe name -> category (normalized)
    const recipeCategoryMap: Record<string, string> = {}
    for (const r of recipes) {
      if (r.category) {
        recipeCategoryMap[r.nombre.toUpperCase().trim()] = r.category.toUpperCase().trim()
      }
    }

    // Build: ingredient name -> total daily consumption
    const ingredientDailyConsumption: Record<string, { amount: number; unit: string }> = {}

    for (const r of recipes) {
      if (!r.ingredientes || !Array.isArray(r.ingredientes)) continue
      const cat = r.category?.toUpperCase().trim()
      if (!cat) continue

      // How many of this category sold per day, divided by number of recipes in that category
      const recipesInCategory = recipes.filter(
        rr => rr.category?.toUpperCase().trim() === cat && rr.ingredientes && rr.ingredientes.length > 0
      ).length || 1
      const dailyItemsForCategory = avgDailyItemsPerCategory[cat] || 0
      // Assume equal distribution across recipes in category
      const dailyItemsForThisRecipe = dailyItemsForCategory / recipesInCategory

      for (const ing of r.ingredientes) {
        if (!ing.nombre || !ing.porcion) continue
        const ingKey = ing.nombre.toUpperCase().trim()
        if (!ingredientDailyConsumption[ingKey]) {
          ingredientDailyConsumption[ingKey] = { amount: 0, unit: ing.um || '' }
        }
        ingredientDailyConsumption[ingKey].amount += ing.porcion * dailyItemsForThisRecipe
      }
    }

    // ------------------------------------------------------------------
    // Step 5: Match ingredients to inventory products, compute days remaining
    // ------------------------------------------------------------------
    // Fuzzy match: ingredient name contains inventory product name or vice versa
    const inventoryMap = new Map<string, InventoryProduct>()
    for (const p of inventory) {
      inventoryMap.set(p.name.toUpperCase().trim(), p)
    }

    interface PredictionRow {
      product: string
      category: string
      current_stock: number
      unit: string
      avg_daily_consumption: number
      days_remaining: number | null
      status: 'critical' | 'warning' | 'ok'
      cost_per_unit: number
      suggested_purchase: number // amount to buy to reach 14 days
      suggested_purchase_cost: number
    }

    const predictions: PredictionRow[] = []

    // For products that match an ingredient
    const matchedProducts = new Set<string>()

    for (const [ingName, consumption] of Object.entries(ingredientDailyConsumption)) {
      if (consumption.amount <= 0) continue

      // Try exact match first, then partial
      let matched: InventoryProduct | undefined = inventoryMap.get(ingName)
      if (!matched) {
        // Try partial match
        const allKeys = Array.from(inventoryMap.keys())
        for (const pName of allKeys) {
          if (pName.includes(ingName) || ingName.includes(pName)) {
            matched = inventoryMap.get(pName)
            break
          }
        }
      }

      if (matched) {
        const key = matched.name.toUpperCase().trim()
        if (matchedProducts.has(key)) {
          // Already added — accumulate consumption
          const existing = predictions.find(p => p.product.toUpperCase().trim() === key)
          if (existing) {
            existing.avg_daily_consumption += consumption.amount
            existing.days_remaining = existing.avg_daily_consumption > 0
              ? existing.current_stock / existing.avg_daily_consumption
              : null
            existing.status = existing.days_remaining !== null
              ? existing.days_remaining < 3 ? 'critical' : existing.days_remaining < 7 ? 'warning' : 'ok'
              : 'ok'
            const deficit = Math.max(0, (existing.avg_daily_consumption * 14) - existing.current_stock)
            existing.suggested_purchase = Math.ceil(deficit)
            existing.suggested_purchase_cost = deficit * existing.cost_per_unit
          }
          continue
        }
        matchedProducts.add(key)

        const daysRemaining = consumption.amount > 0 ? matched.stock / consumption.amount : null
        const deficit = consumption.amount > 0 ? Math.max(0, (consumption.amount * 14) - matched.stock) : 0

        predictions.push({
          product: matched.name,
          category: matched.category || 'SIN CATEGORIA',
          current_stock: matched.stock,
          unit: matched.unit || '',
          avg_daily_consumption: consumption.amount,
          days_remaining: daysRemaining,
          status: daysRemaining !== null
            ? daysRemaining < 3 ? 'critical' : daysRemaining < 7 ? 'warning' : 'ok'
            : 'ok',
          cost_per_unit: matched.cost_per_unit || 0,
          suggested_purchase: Math.ceil(deficit),
          suggested_purchase_cost: deficit * (matched.cost_per_unit || 0),
        })
      }
    }

    // Add unmatched inventory products (no recipe = no consumption estimate)
    for (const p of inventory) {
      const key = p.name.toUpperCase().trim()
      if (!matchedProducts.has(key)) {
        predictions.push({
          product: p.name,
          category: p.category || 'SIN CATEGORIA',
          current_stock: p.stock,
          unit: p.unit || '',
          avg_daily_consumption: 0,
          days_remaining: null, // unknown — no recipe
          status: p.stock <= 0 ? 'critical' : p.stock <= (p.reorder_point || 0) ? 'warning' : 'ok',
          cost_per_unit: p.cost_per_unit || 0,
          suggested_purchase: 0,
          suggested_purchase_cost: 0,
        })
      }
    }

    // Sort: critical first (lowest days_remaining), then warning, then ok
    predictions.sort((a, b) => {
      const statusOrder = { critical: 0, warning: 1, ok: 2 }
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status]
      // Within same status, sort by days_remaining asc (null = last)
      const da = a.days_remaining ?? 9999
      const db = b.days_remaining ?? 9999
      return da - db
    })

    // ------------------------------------------------------------------
    // Step 6: Summary stats
    // ------------------------------------------------------------------
    const withConsumption = predictions.filter(p => p.avg_daily_consumption > 0)
    const critical = withConsumption.filter(p => p.status === 'critical')
    const warning = withConsumption.filter(p => p.status === 'warning')
    const healthy = withConsumption.filter(p => p.status === 'ok')
    const noRecipe = predictions.filter(p => p.avg_daily_consumption === 0)
    const totalPurchaseCost = predictions.reduce((s, p) => s + p.suggested_purchase_cost, 0)

    // Day-of-week pattern for next 7 days
    const today = new Date()
    const next7DaysPattern: { day: string; categories: Record<string, number> }[] = []
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const dow = d.getDay()
      next7DaysPattern.push({
        day: dayNames[dow],
        categories: avgCategorySalesByDow[dow] || {},
      })
    }

    return Response.json({
      predictions,
      summary: {
        total_products: predictions.length,
        with_consumption_estimate: withConsumption.length,
        critical: critical.length,
        warning: warning.length,
        healthy: healthy.length,
        no_recipe: noRecipe.length,
        total_suggested_purchase_cost: totalPurchaseCost,
        days_analyzed: daysCount,
      },
      next_7_days: next7DaysPattern,
      categories: Array.from(new Set(predictions.map(p => p.category))).sort(),
    })
  } catch (err) {
    console.error('Inventory predict error:', err)
    return Response.json({ predictions: [], summary: {}, next_7_days: [], categories: [] }, { status: 500 })
  }
}
