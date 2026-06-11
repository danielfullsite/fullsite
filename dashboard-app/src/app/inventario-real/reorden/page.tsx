'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Package, AlertTriangle, CheckCircle, Settings, Search, Save, Wand2 } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

// ── Types ──────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  critico: boolean
  inv_final_qty: number
  costo_promedio: number
  salidas_qty: number
}

interface ReorderConfig {
  codigo: string
  producto: string
  almacen: string
  minimo: number
  maximo: number
}

type Status = 'bajo_minimo' | 'ok' | 'sobre_maximo' | 'sin_configurar'

// ── Constants ──────────────────────────────────────────────────────

const WAREHOUSE_TABS = [
  { key: 'todos', label: 'Todos' },
  { key: 'cocina', label: 'Cocina' },
  { key: 'barra', label: 'Barra' },
  { key: 'panaderia', label: 'Panaderia' },
  { key: 'market', label: 'Market' },
]

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ────────────────────────────────────────────────────────

function matchWarehouse(almacen: string, tab: string): boolean {
  if (tab === 'todos') return true
  const n = almacen.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (tab === 'cocina') return n.includes('cocina')
  if (tab === 'barra') return n.includes('barra')
  if (tab === 'panaderia') return n.includes('panaderia') || n.includes('panadería')
  if (tab === 'market') return n.includes('market')
  return false
}

function getStatus(stock: number, minimo: number | undefined, maximo: number | undefined): Status {
  if (minimo === undefined && maximo === undefined) return 'sin_configurar'
  if (minimo !== undefined && stock < minimo) return 'bajo_minimo'
  if (maximo !== undefined && stock > maximo) return 'sobre_maximo'
  return 'ok'
}

function statusBadge(status: Status) {
  switch (status) {
    case 'bajo_minimo':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400">Bajo minimo</span>
    case 'ok':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">OK</span>
    case 'sobre_maximo':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400">Sobre maximo</span>
    case 'sin_configurar':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-500/15 text-zinc-400">Sin configurar</span>
  }
}

// ── Page ───────────────────────────────────────────────────────────

export default function ReordenPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [configs, setConfigs] = useState<Map<string, ReorderConfig>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('todos')

  // Load inventory + reorder config
  useEffect(() => {
    async function load() {
      try {
        const [invResult, configResult] = await Promise.all([
          getWansoftDataLatest('inventory_parsed'),
          getWansoftDataLatest('reorder_config'),
        ])

        if (invResult?.data) {
          const raw = Array.isArray(invResult.data) ? invResult.data : (invResult.data as any)?.items || []
          setItems(raw.map((r: any) => ({
            almacen: r.almacen || '',
            codigo: r.codigo || '',
            producto: r.producto || '',
            departamento: r.departamento || '',
            critico: Boolean(r.critico),
            inv_final_qty: Number(r.inv_final_qty) || 0,
            costo_promedio: Number(r.costo_promedio) || 0,
            salidas_qty: Number(r.salidas_qty) || 0,
          })))
        }

        if (configResult?.data) {
          const cfgArr = Array.isArray(configResult.data) ? configResult.data : []
          const map = new Map<string, ReorderConfig>()
          cfgArr.forEach((c: any) => {
            map.set(c.codigo, {
              codigo: c.codigo,
              producto: c.producto,
              almacen: c.almacen,
              minimo: Number(c.minimo) || 0,
              maximo: Number(c.maximo) || 0,
            })
          })
          setConfigs(map)
        }
      } catch (e) {
        console.error('[reorden] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Update a config value
  const updateConfig = useCallback((item: InventoryItem, field: 'minimo' | 'maximo', value: number) => {
    setConfigs(prev => {
      const next = new Map(prev)
      const existing = next.get(item.codigo)
      next.set(item.codigo, {
        codigo: item.codigo,
        producto: item.producto,
        almacen: item.almacen,
        minimo: field === 'minimo' ? value : (existing?.minimo ?? 0),
        maximo: field === 'maximo' ? value : (existing?.maximo ?? 0),
      })
      return next
    })
    setSaved(false)
  }, [])

  // Auto-configure: min = (salidas_qty / 30) * 3, max = min * 3
  const autoConfig = useCallback(() => {
    setConfigs(prev => {
      const next = new Map(prev)
      items.forEach(item => {
        const dailyUsage = item.salidas_qty / 30
        const minimo = Math.round(dailyUsage * 3 * 100) / 100
        const maximo = Math.round(minimo * 3 * 100) / 100
        if (minimo > 0 || maximo > 0) {
          next.set(item.codigo, {
            codigo: item.codigo,
            producto: item.producto,
            almacen: item.almacen,
            minimo,
            maximo,
          })
        }
      })
      return next
    })
    setSaved(false)
  }, [items])

  // Save to Supabase
  const saveConfigs = useCallback(async () => {
    setSaving(true)
    try {
      const clientId = getActiveClientSlug()
      const today = new Date().toISOString().split('T')[0]
      const configArr = Array.from(configs.values()).filter(c => c.minimo > 0 || c.maximo > 0)

      const res = await fetch(`${SUPABASE_URL}/rest/v1/wansoft_data`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          client_id: clientId,
          data_key: 'reorder_config',
          fecha: today,
          data: configArr,
        }),
      })

      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        console.error('[reorden] Save failed:', await res.text())
      }
    } catch (e) {
      console.error('[reorden] Save error:', e)
    }
    setSaving(false)
  }, [configs])

  // Filter + search
  const filtered = useMemo(() => {
    let list = items.filter(i => matchWarehouse(i.almacen, activeTab))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.departamento.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, activeTab, search])

  // KPIs
  const kpis = useMemo(() => {
    let configurados = 0
    let bajoMinimo = 0
    let sobreMaximo = 0
    let sinConfigurar = 0

    items.forEach(item => {
      const cfg = configs.get(item.codigo)
      const status = getStatus(item.inv_final_qty, cfg?.minimo, cfg?.maximo)
      switch (status) {
        case 'bajo_minimo': bajoMinimo++; configurados++; break
        case 'ok': configurados++; break
        case 'sobre_maximo': sobreMaximo++; configurados++; break
        case 'sin_configurar': sinConfigurar++; break
      }
    })

    return { configurados, bajoMinimo, sobreMaximo, sinConfigurar }
  }, [items, configs])

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Punto de Reorden"
        subtitle="Maximos y minimos por producto"
        action={
          <div className="flex gap-2">
            <button
              onClick={autoConfig}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/15 text-purple-400 font-semibold text-sm hover:bg-purple-500/25 active:scale-95 transition-all min-h-[44px]"
            >
              <Wand2 size={16} />
              Auto-configurar
            </button>
            <button
              onClick={saveConfigs}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500/15 text-blue-400 font-semibold text-sm hover:bg-blue-500/25 active:scale-95 transition-all disabled:opacity-50 min-h-[44px]"
            >
              {saving ? (
                <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
              ) : saved ? (
                <CheckCircle size={16} />
              ) : (
                <Save size={16} />
              )}
              {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar'}
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Configurados"
          value={String(kpis.configurados)}
          icon={Settings}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Bajo minimo"
          value={String(kpis.bajoMinimo)}
          icon={AlertTriangle}
          accentClass="kpi-accent-pink"
          index={1}
        />
        <KPICard
          label="Sobre maximo"
          value={String(kpis.sobreMaximo)}
          icon={Package}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Sin configurar"
          value={String(kpis.sinConfigurar)}
          icon={Package}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* Warehouse Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {WAREHOUSE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === tab.key
                ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                : 'text-[var(--text-3)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
        <input
          type="text"
          placeholder="Buscar por codigo, producto o departamento..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-2)]">Codigo</th>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-2)]">Producto</th>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-2)] hidden md:table-cell">Almacen</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-2)]">Stock</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-2)]">Minimo</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-2)]">Maximo</th>
                <th className="text-center px-4 py-3 font-semibold text-[var(--text-2)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[var(--text-3)]">
                    No se encontraron productos
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const cfg = configs.get(item.codigo)
                  const status = getStatus(item.inv_final_qty, cfg?.minimo, cfg?.maximo)
                  const isAlert = status === 'bajo_minimo'

                  return (
                    <tr
                      key={`${item.codigo}-${item.almacen}`}
                      className={`border-b border-[var(--border)] last:border-0 transition-colors ${
                        isAlert
                          ? 'bg-red-500/5 hover:bg-red-500/10'
                          : 'hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-[var(--text-2)]">
                        {item.codigo}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-1)] font-medium max-w-[200px] truncate">
                        {item.producto}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-3)] hidden md:table-cell">
                        {item.almacen}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        isAlert ? 'text-red-400' : 'text-[var(--text-1)]'
                      }`}>
                        {item.inv_final_qty.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={cfg?.minimo ?? ''}
                          placeholder="--"
                          onChange={e => updateConfig(item, 'minimo', parseFloat(e.target.value) || 0)}
                          className="w-20 md:w-24 px-2 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-right text-[var(--text-1)] text-sm tabular-nums placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[40px]"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={cfg?.maximo ?? ''}
                          placeholder="--"
                          onChange={e => updateConfig(item, 'maximo', parseFloat(e.target.value) || 0)}
                          className="w-20 md:w-24 px-2 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-right text-[var(--text-1)] text-sm tabular-nums placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[40px]"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {statusBadge(status)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer count */}
      <p className="text-xs text-[var(--text-3)] text-right">
        {filtered.length} productos mostrados de {items.length} totales
      </p>
    </div>
  )
}
