'use client'

import { useEffect, useState } from 'react'
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Package, Search } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit: number
  yield_factor?: number
  supplier?: string
  category?: string
}

interface CostChange {
  name: string
  prev: number
  current: number
  unit: string
  pct: number
  supplier: string
}

export default function CostosPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [costChanges, setCostChanges] = useState<CostChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

        // Fetch ingredients
        const ingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_cid()}&cost_per_unit=gt.0&order=name.asc&limit=1000&select=id,name,unit,cost_per_unit,yield_factor,supplier,category`,
          { headers }
        )
        const ings: Ingredient[] = ingRes.ok ? await ingRes.json() : []
        setIngredients(ings)

        // Fetch latest agent results for cost changes
        const agentRes = await fetch(
          `${SUPABASE_URL}/rest/v1/agent_results?agent_id=eq.cost-variance&order=fecha.desc&limit=1&select=data`,
          { headers }
        )
        const agentRows = agentRes.ok ? await agentRes.json() : []
        if (agentRows.length > 0 && agentRows[0].data) {
          const data = typeof agentRows[0].data === 'string' ? JSON.parse(agentRows[0].data) : agentRows[0].data
          setCostChanges(data.cost_changes || [])
        }
      } catch (e) {
        console.error('[costos] Error loading:', e)
        setError('No se pudieron cargar los ingredientes. Intenta recargar la pagina.')
      }
      setLoading(false)
    }
    load()
  }, [])

  // KPIs
  const totalIngredients = ingredients.length
  const withCost = ingredients.filter(i => Number(i.cost_per_unit) > 0).length
  const highCost = ingredients.filter(i => Number(i.cost_per_unit) > 500)
  const withYield = ingredients.filter(i => Number(i.yield_factor) > 0 && Number(i.yield_factor) < 1)
  const increases = costChanges.filter(c => c.pct > 0)
  const decreases = costChanges.filter(c => c.pct < 0)

  // Search filter
  const filtered = search
    ? ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || (i.supplier || '').toLowerCase().includes(search.toLowerCase()))
    : ingredients

  // Group by category
  const categories = new Map<string, Ingredient[]>()
  for (const ing of filtered) {
    const cat = ing.category || 'Sin categoría'
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(ing)
  }

  return (
    <>
      <PageHeader
        title="Costos de Ingredientes"
        subtitle={`${totalIngredients} ingredientes con costo configurado`}
      />

      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--text-2)] text-sm font-medium">Cargando costos...</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard
              label="Ingredientes"
              value={`${totalIngredients}`}
              subtitle="Con costo configurado"
              icon={Package}
              accentClass="kpi-accent-blue"
            />
            <KPICard
              label="Con costo"
              value={`${withCost}/${totalIngredients}`}
              subtitle="Ingredientes con precio"
              icon={DollarSign}
              accentClass="kpi-accent-green"
            />
            <KPICard
              label="Subieron"
              value={`${increases.length}`}
              subtitle="vs semana anterior"
              icon={TrendingUp}
              accentClass="kpi-accent-red"
            />
            <KPICard
              label="Bajaron"
              value={`${decreases.length}`}
              subtitle="vs semana anterior"
              icon={TrendingDown}
              accentClass="kpi-accent-amber"
            />
          </div>

          {/* Cost Changes Alert */}
          {costChanges.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6 mb-6">
              <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Variaciones de costo detectadas ({costChanges.length})
              </h3>
              <div className="space-y-3">
                {costChanges.slice(0, 15).map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)] last:border-0">
                    <div>
                      <span className="text-sm font-medium text-[var(--text-1)]">{c.name}</span>
                      <span className="text-xs text-[var(--text-3)] ml-2">{c.supplier}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-3)]">
                        {formatCurrency(c.prev)} → {formatCurrency(c.current)}/{c.unit}
                      </span>
                      <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                        c.pct > 0 ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'
                      }`}>
                        {c.pct > 0 ? '+' : ''}{c.pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              placeholder="Buscar ingrediente o proveedor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* High cost alerts */}
          {highCost.length > 0 && !search && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-amber-500 mb-2">
                {highCost.length} ingredientes con costo alto (&gt;$500/unidad)
              </p>
              <div className="flex flex-wrap gap-2">
                {highCost.slice(0, 8).map(h => (
                  <span key={h.id} className="text-xs bg-amber-500/10 text-amber-400 px-2 py-1 rounded">
                    {h.name}: {formatCurrency(Number(h.cost_per_unit))}/{h.unit}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Ingredients by category */}
          <div className="space-y-4">
            {Array.from(categories.entries())
              .sort((a, b) => a[0].localeCompare(b[0], 'es'))
              .map(([cat, ings]) => (
              <div key={cat} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--line)]">
                  <h4 className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">
                    {cat} <span className="text-[var(--text-3)] font-normal">({ings.length})</span>
                  </h4>
                </div>
                <div className="divide-y divide-[var(--line-soft)]">
                  {ings.sort((a, b) => Number(b.cost_per_unit) - Number(a.cost_per_unit)).slice(0, 20).map(ing => {
                    const yf = Number(ing.yield_factor) || 1
                    const realCost = Number(ing.cost_per_unit) / yf
                    const hasYield = yf > 0 && yf < 1
                    return (
                    <div key={ing.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="text-sm text-[var(--text-1)]">{ing.name}</span>
                        {ing.supplier && <span className="text-xs text-[var(--text-3)] ml-2">{ing.supplier}</span>}
                        {hasYield && <span className="text-[10px] text-amber-400 ml-2">merma {Math.round((1 - yf) * 100)}%</span>}
                      </div>
                      <div className="text-right">
                        {hasYield ? (
                          <>
                            <span className="text-sm font-semibold text-[var(--text-1)] tabular-nums">
                              {formatCurrency(realCost)}<span className="text-xs text-[var(--text-3)] font-normal">/{ing.unit}</span>
                            </span>
                            <span className="text-[10px] text-[var(--text-3)] ml-1 line-through">{formatCurrency(Number(ing.cost_per_unit))}</span>
                          </>
                        ) : (
                          <span className="text-sm font-semibold text-[var(--text-1)] tabular-nums">
                            {formatCurrency(Number(ing.cost_per_unit))}<span className="text-xs text-[var(--text-3)] font-normal">/{ing.unit}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    )
                  })}
                  {ings.length > 20 && (
                    <div className="px-4 py-2 text-xs text-[var(--text-3)]">
                      +{ings.length - 20} más
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
