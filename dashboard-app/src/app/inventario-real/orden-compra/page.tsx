'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ShoppingCart, AlertTriangle, Truck, DollarSign, Search,
  Save, Wand2, Send, ChevronDown, ChevronRight, Plus, Trash2, Download,
} from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

// ── Types ──────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  inv_final_qty: number
  costo_promedio: number
}

interface ReorderConfig {
  codigo: string
  producto: string
  almacen: string
  minimo: number
  maximo: number
}

interface Supplier {
  clave: string
  nombre: string
  rfc: string
  telefono: string
  email: string
  giro: string
}

interface OrderLine {
  id: string
  codigo: string
  producto: string
  almacen: string
  stockActual: number
  minimo: number
  maximo: number
  pedir: number
  costoUnitario: number
  proveedor: string
}

// ── Constants ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Category-to-giro mapping for best-guess supplier matching
const GIRO_KEYWORDS: Record<string, string[]> = {
  'carnes': ['carne', 'res', 'pollo', 'cerdo', 'tocino', 'jamon', 'salchicha', 'chorizo', 'arrachera', 'bistec', 'pechuga'],
  'lacteos': ['leche', 'queso', 'crema', 'yogurt', 'mantequilla', 'queso crema'],
  'frutas y verduras': ['fruta', 'verdura', 'tomate', 'cebolla', 'lechuga', 'aguacate', 'limon', 'naranja', 'fresa', 'platano', 'mango', 'papa', 'chile', 'zanahoria', 'pepino', 'espinaca', 'nopal'],
  'panaderia': ['harina', 'pan', 'levadura', 'masa', 'tortilla', 'croissant', 'bagel'],
  'bebidas': ['cafe', 'te', 'jugo', 'refresco', 'agua', 'cerveza', 'vino', 'licor', 'jarabe', 'frappe'],
  'abarrotes': ['aceite', 'sal', 'azucar', 'arroz', 'frijol', 'pasta', 'salsa', 'vinagre', 'mostaza', 'mayonesa', 'ketchup', 'miel'],
  'limpieza': ['jabon', 'detergente', 'cloro', 'limpiador', 'papel', 'servilleta', 'bolsa', 'desechable'],
  'mariscos': ['camaron', 'pescado', 'pulpo', 'atun', 'calamar', 'salmon', 'marisco'],
  'helados': ['helado', 'nieve', 'paleta', 'gelato'],
  'semillas': ['semilla', 'nuez', 'almendra', 'avena', 'granola', 'chia', 'linaza'],
}

// ── Helpers ────────────────────────────────────────────────────────

function deepParse(val: unknown): unknown {
  if (typeof val !== 'string') return val
  try {
    const parsed = JSON.parse(val)
    if (typeof parsed === 'string') return deepParse(parsed)
    return parsed
  } catch {
    return val
  }
}

function matchSupplierByGiro(producto: string, departamento: string, suppliers: Supplier[]): string {
  const text = `${producto} ${departamento}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  for (const supplier of suppliers) {
    const giro = (supplier.giro || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // Direct giro keyword match
    const keywords = GIRO_KEYWORDS[giro] || []
    for (const kw of keywords) {
      if (text.includes(kw)) return supplier.nombre
    }

    // Fallback: check if any word in supplier giro appears in product name
    const giroWords = giro.split(/\s+/).filter(w => w.length > 3)
    for (const word of giroWords) {
      if (text.includes(word)) return supplier.nombre
    }
  }

  return 'Sin proveedor asignado'
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatWhatsAppMessage(supplierName: string, lines: OrderLine[]): string {
  const today = new Date().toISOString().split('T')[0]
  let msg = `*Orden de Compra - AMALAY*\n`
  msg += `Proveedor: ${supplierName}\n`
  msg += `Fecha: ${today}\n\n`
  msg += `*Productos:*\n`
  lines.forEach((l, i) => {
    msg += `${i + 1}. ${l.producto} - Cantidad: ${l.pedir}\n`
  })
  msg += `\n*Total estimado: ${formatCurrency(lines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0))}*`
  return msg
}

// ── Page ───────────────────────────────────────────────────────────

export default function OrdenCompraPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [configs, setConfigs] = useState<ReorderConfig[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orderLines, setOrderLines] = useState<OrderLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedSuppliers, setCollapsedSuppliers] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [addSearch, setAddSearch] = useState('')

  // ── Load data ─────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [invResult, configResult, suppResult] = await Promise.all([
          getWansoftDataLatest('inventory_parsed'),
          getWansoftDataLatest('reorder_config'),
          getWansoftDataLatest('proveedores_catalog'),
        ])

        let invItems: InventoryItem[] = []
        if (invResult?.data) {
          const raw = Array.isArray(invResult.data) ? invResult.data : (invResult.data as any)?.items || []
          invItems = raw.map((r: any) => ({
            almacen: r.almacen || '',
            codigo: r.codigo || '',
            producto: r.producto || '',
            departamento: r.departamento || '',
            inv_final_qty: Number(r.inv_final_qty) || 0,
            costo_promedio: Number(r.costo_promedio) || 0,
          }))
        }
        setInventory(invItems)

        let cfgArr: ReorderConfig[] = []
        if (configResult?.data) {
          const parsed = Array.isArray(configResult.data) ? configResult.data : []
          cfgArr = parsed.map((c: any) => ({
            codigo: c.codigo,
            producto: c.producto,
            almacen: c.almacen,
            minimo: Number(c.minimo) || 0,
            maximo: Number(c.maximo) || 0,
          }))
        }
        setConfigs(cfgArr)

        let suppArr: Supplier[] = []
        if (suppResult?.data) {
          const parsed = deepParse(suppResult.data)
          const arr = Array.isArray(parsed) ? parsed : (parsed as any)?.Result || []
          suppArr = arr.map((s: any) => ({
            clave: s.clave || s.Clave || '',
            nombre: s.nombre || s.Nombre || s.BuyerName || '',
            rfc: s.rfc || s.RFC || '',
            telefono: s.telefono || s.Telefono || '',
            email: s.email || s.Email || '',
            giro: s.giro || s.Giro || '',
          }))
        }
        setSuppliers(suppArr)
      } catch (e) {
        console.error('[orden-compra] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Auto-generate orders ──────────────────────────────────────────

  const autoGenerate = useCallback(() => {
    const configMap = new Map<string, ReorderConfig>()
    configs.forEach(c => configMap.set(c.codigo, c))

    const lines: OrderLine[] = []
    inventory.forEach(item => {
      const cfg = configMap.get(item.codigo)
      if (!cfg) return
      if (item.inv_final_qty >= cfg.minimo) return

      const pedir = Math.max(0, Math.round((cfg.maximo - item.inv_final_qty) * 100) / 100)
      if (pedir <= 0) return

      const proveedor = matchSupplierByGiro(item.producto, item.departamento, suppliers)

      lines.push({
        id: generateId(),
        codigo: item.codigo,
        producto: item.producto,
        almacen: item.almacen,
        stockActual: item.inv_final_qty,
        minimo: cfg.minimo,
        maximo: cfg.maximo,
        pedir,
        costoUnitario: item.costo_promedio,
        proveedor,
      })
    })

    setOrderLines(lines)
    setSaved(false)
  }, [inventory, configs, suppliers])

  // ── Add product manually ──────────────────────────────────────────

  const addProduct = useCallback((item: InventoryItem) => {
    const configMap = new Map<string, ReorderConfig>()
    configs.forEach(c => configMap.set(c.codigo, c))
    const cfg = configMap.get(item.codigo)

    const proveedor = matchSupplierByGiro(item.producto, item.departamento, suppliers)
    const pedir = cfg ? Math.max(0, Math.round((cfg.maximo - item.inv_final_qty) * 100) / 100) : 1

    setOrderLines(prev => {
      if (prev.some(l => l.codigo === item.codigo && l.almacen === item.almacen)) return prev
      return [...prev, {
        id: generateId(),
        codigo: item.codigo,
        producto: item.producto,
        almacen: item.almacen,
        stockActual: item.inv_final_qty,
        minimo: cfg?.minimo ?? 0,
        maximo: cfg?.maximo ?? 0,
        pedir,
        costoUnitario: item.costo_promedio,
        proveedor,
      }]
    })
    setShowAddModal(false)
    setAddSearch('')
    setSaved(false)
  }, [configs, suppliers])

  // ── Remove line ───────────────────────────────────────────────────

  const removeLine = useCallback((id: string) => {
    setOrderLines(prev => prev.filter(l => l.id !== id))
    setSaved(false)
  }, [])

  // ── Update quantity ───────────────────────────────────────────────

  const updatePedir = useCallback((id: string, value: number) => {
    setOrderLines(prev => prev.map(l => l.id === id ? { ...l, pedir: value } : l))
    setSaved(false)
  }, [])

  // ── Toggle supplier collapse ──────────────────────────────────────

  const toggleSupplier = useCallback((supplier: string) => {
    setCollapsedSuppliers(prev => {
      const next = new Set(prev)
      if (next.has(supplier)) next.delete(supplier)
      else next.add(supplier)
      return next
    })
  }, [])

  // ── Save to Supabase ──────────────────────────────────────────────

  const saveOrder = useCallback(async () => {
    setSaving(true)
    try {
      const clientId = getActiveClientSlug()
      const now = new Date()
      const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 16)
      const dataKey = `purchase_order_${ts}`

      const grouped: Record<string, OrderLine[]> = {}
      orderLines.forEach(l => {
        if (!grouped[l.proveedor]) grouped[l.proveedor] = []
        grouped[l.proveedor].push(l)
      })

      const payload = {
        created_at: now.toISOString(),
        total_lines: orderLines.length,
        total_estimado: orderLines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0),
        proveedores: Object.entries(grouped).map(([prov, lines]) => ({
          proveedor: prov,
          productos: lines.map(l => ({
            codigo: l.codigo,
            producto: l.producto,
            cantidad: l.pedir,
            costo_unitario: l.costoUnitario,
            costo_total: l.pedir * l.costoUnitario,
          })),
          subtotal: lines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0),
        })),
      }

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
          data_key: dataKey,
          fecha: now.toISOString().split('T')[0],
          data: payload,
        }),
      })

      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        console.error('[orden-compra] Save failed:', await res.text())
      }
    } catch (e) {
      console.error('[orden-compra] Save error:', e)
    }
    setSaving(false)
  }, [orderLines])

  // ── Grouped data ──────────────────────────────────────────────────

  const grouped = useMemo(() => {
    let lines = orderLines
    if (search) {
      const q = search.toLowerCase()
      lines = lines.filter(l =>
        l.producto.toLowerCase().includes(q) ||
        l.codigo.toLowerCase().includes(q) ||
        l.proveedor.toLowerCase().includes(q)
      )
    }

    const map: Record<string, OrderLine[]> = {}
    lines.forEach(l => {
      if (!map[l.proveedor]) map[l.proveedor] = []
      map[l.proveedor].push(l)
    })

    return Object.entries(map)
      .sort(([a], [b]) => {
        if (a === 'Sin proveedor asignado') return 1
        if (b === 'Sin proveedor asignado') return -1
        return a.localeCompare(b)
      })
  }, [orderLines, search])

  // ── KPIs ──────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const configMap = new Map<string, ReorderConfig>()
    configs.forEach(c => configMap.set(c.codigo, c))

    let bajoMinimo = 0
    inventory.forEach(item => {
      const cfg = configMap.get(item.codigo)
      if (cfg && item.inv_final_qty < cfg.minimo) bajoMinimo++
    })

    const proveedoresSet = new Set(orderLines.map(l => l.proveedor).filter(p => p !== 'Sin proveedor asignado'))
    const costoTotal = orderLines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0)

    return {
      bajoMinimo,
      proveedores: proveedoresSet.size,
      costoTotal,
      lineas: orderLines.length,
    }
  }, [inventory, configs, orderLines])

  // ── Filtered add-modal products ───────────────────────────────────

  const addModalProducts = useMemo(() => {
    if (!addSearch || addSearch.length < 2) return []
    const q = addSearch.toLowerCase()
    return inventory
      .filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [inventory, addSearch])

  // ── Render ────────────────────────────────────────────────────────

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
        title="Ordenes de Compra"
        subtitle="Generar pedidos a proveedores"
        action={
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={autoGenerate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/15 text-purple-400 font-semibold text-sm hover:bg-purple-500/25 active:scale-95 transition-all min-h-[44px]"
            >
              <Wand2 size={16} />
              Auto-generar
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 active:scale-95 transition-all min-h-[44px]"
            >
              <Plus size={16} />
              Agregar
            </button>
            <button
              onClick={saveOrder}
              disabled={saving || orderLines.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500/15 text-blue-400 font-semibold text-sm hover:bg-blue-500/25 active:scale-95 transition-all disabled:opacity-50 min-h-[44px]"
            >
              {saving ? (
                <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
              ) : (
                <Save size={16} />
              )}
              {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar OC'}
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Bajo minimo"
          value={String(kpis.bajoMinimo)}
          icon={AlertTriangle}
          accentClass="kpi-accent-pink"
          index={0}
        />
        <KPICard
          label="Proveedores"
          value={String(kpis.proveedores)}
          icon={Truck}
          accentClass="kpi-accent-blue"
          index={1}
        />
        <KPICard
          label="Costo estimado"
          value={formatCurrency(kpis.costoTotal)}
          icon={DollarSign}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Lineas en OC"
          value={String(kpis.lineas)}
          icon={ShoppingCart}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* Search */}
      {orderLines.length > 0 && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            type="text"
            placeholder="Buscar por producto, codigo o proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
          />
        </div>
      )}

      {/* Empty state */}
      {orderLines.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-12 text-center">
          <ShoppingCart size={48} className="mx-auto mb-4 text-[var(--text-3)] opacity-50" />
          <p className="text-[var(--text-2)] font-medium text-lg mb-2">Sin productos en la orden</p>
          <p className="text-[var(--text-3)] text-sm mb-6 max-w-md mx-auto">
            Usa &quot;Auto-generar&quot; para crear ordenes de compra automaticamente basadas en productos bajo minimo, o agrega productos manualmente.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={autoGenerate}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-purple-500/15 text-purple-400 font-semibold text-sm hover:bg-purple-500/25 active:scale-95 transition-all min-h-[48px]"
            >
              <Wand2 size={18} />
              Auto-generar OCs
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/15 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 active:scale-95 transition-all min-h-[48px]"
            >
              <Plus size={18} />
              Agregar producto
            </button>
          </div>
        </div>
      )}

      {/* Grouped order table */}
      {grouped.map(([supplierName, lines]) => {
        const isCollapsed = collapsedSuppliers.has(supplierName)
        const subtotal = lines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0)
        const supplierData = suppliers.find(s => s.nombre === supplierName)
        const phone = supplierData?.telefono?.replace(/\D/g, '')

        return (
          <div key={supplierName} className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
            {/* Supplier header */}
            <button
              onClick={() => toggleSupplier(supplierName)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 transition-colors min-h-[52px]"
            >
              <div className="flex items-center gap-3">
                {isCollapsed ? <ChevronRight size={18} className="text-[var(--text-3)]" /> : <ChevronDown size={18} className="text-[var(--text-3)]" />}
                <Truck size={18} className="text-blue-400" />
                <div className="text-left">
                  <span className="font-semibold text-[var(--text-1)]">{supplierName}</span>
                  {supplierData?.giro && (
                    <span className="ml-2 text-xs text-[var(--text-3)]">({supplierData.giro})</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--text-3)]">{lines.length} productos</span>
                <span className="font-semibold text-[var(--text-1)] tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
            </button>

            {/* Lines table */}
            {!isCollapsed && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Producto</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Stock</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Min</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Pedir</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider hidden md:table-cell">Costo Unit.</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-3)] text-xs uppercase tracking-wider">Costo Est.</th>
                        <th className="px-2 py-2.5 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(line => (
                        <tr
                          key={line.id}
                          className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="text-[var(--text-1)] font-medium truncate max-w-[200px]">{line.producto}</div>
                            <div className="text-xs text-[var(--text-3)] font-mono">{line.codigo} - {line.almacen}</div>
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums font-semibold ${line.stockActual < line.minimo ? 'text-red-400' : 'text-[var(--text-1)]'}`}>
                            {line.stockActual.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">
                            {line.minimo.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={line.pedir}
                              onChange={e => updatePedir(line.id, parseFloat(e.target.value) || 0)}
                              className="w-20 md:w-24 px-2 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-right text-[var(--text-1)] text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[40px]"
                            />
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)] hidden md:table-cell">
                            {formatCurrency(line.costoUnitario)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-[var(--text-1)]">
                            {formatCurrency(line.pedir * line.costoUnitario)}
                          </td>
                          <td className="px-2 py-3 text-center">
                            <button
                              onClick={() => removeLine(line.id)}
                              className="p-2 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all min-h-[36px] min-w-[36px]"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Supplier footer: subtotal + WhatsApp */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]/50">
                  <div className="flex gap-2">
                    {phone && (
                      <a
                        href={`https://wa.me/${phone}?text=${encodeURIComponent(formatWhatsAppMessage(supplierName, lines))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 font-semibold text-xs hover:bg-emerald-500/25 active:scale-95 transition-all min-h-[36px]"
                      >
                        <Send size={14} />
                        Enviar por WhatsApp
                      </a>
                    )}
                    {supplierData?.email && (
                      <a
                        href={`mailto:${supplierData.email}?subject=${encodeURIComponent(`Orden de Compra - AMALAY ${new Date().toISOString().split('T')[0]}`)}&body=${encodeURIComponent(formatWhatsAppMessage(supplierName, lines).replace(/\*/g, ''))}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/15 text-blue-400 font-semibold text-xs hover:bg-blue-500/25 active:scale-95 transition-all min-h-[36px]"
                      >
                        <Download size={14} />
                        Email
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-[var(--text-3)] mr-2">Subtotal:</span>
                    <span className="font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(subtotal)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Grand total */}
      {orderLines.length > 0 && (
        <div className="flex items-center justify-between px-4 py-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <span className="text-[var(--text-2)] font-medium">Total estimado ({orderLines.length} productos, {grouped.length} proveedores)</span>
          <span className="text-xl font-bold text-blue-400 tabular-nums">
            {formatCurrency(orderLines.reduce((s, l) => s + l.pedir * l.costoUnitario, 0))}
          </span>
        </div>
      )}

      {/* Footer count */}
      {orderLines.length > 0 && (
        <p className="text-xs text-[var(--text-3)] text-right">
          {orderLines.length} lineas de compra en {grouped.length} ordenes
        </p>
      )}

      {/* Add product modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--surface-1)] rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-[var(--border)] shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-lg font-semibold text-[var(--text-1)]">Agregar producto</h3>
              <button
                onClick={() => { setShowAddModal(false); setAddSearch('') }}
                className="p-2 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)] transition-all min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                &times;
              </button>
            </div>

            {/* Modal search */}
            <div className="px-5 py-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                <input
                  type="text"
                  placeholder="Buscar producto por nombre o codigo..."
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-3)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 min-h-[44px]"
                />
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {addModalProducts.length === 0 && addSearch.length >= 2 ? (
                <p className="text-center text-[var(--text-3)] text-sm py-8">Sin resultados</p>
              ) : addSearch.length < 2 ? (
                <p className="text-center text-[var(--text-3)] text-sm py-8">Escribe al menos 2 caracteres</p>
              ) : (
                <div className="space-y-1">
                  {addModalProducts.map(item => {
                    const alreadyAdded = orderLines.some(l => l.codigo === item.codigo && l.almacen === item.almacen)
                    return (
                      <button
                        key={`${item.codigo}-${item.almacen}`}
                        onClick={() => !alreadyAdded && addProduct(item)}
                        disabled={alreadyAdded}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all min-h-[52px] ${
                          alreadyAdded
                            ? 'opacity-40 cursor-not-allowed bg-[var(--surface-2)]'
                            : 'hover:bg-[var(--surface-2)] active:scale-[0.98]'
                        }`}
                      >
                        <div>
                          <div className="text-[var(--text-1)] font-medium text-sm">{item.producto}</div>
                          <div className="text-xs text-[var(--text-3)]">{item.codigo} - {item.almacen}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm tabular-nums text-[var(--text-2)]">{item.inv_final_qty.toFixed(2)}</div>
                          <div className="text-xs text-[var(--text-3)]">en stock</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
