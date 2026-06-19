'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  MENU_CATEGORIES,
  MESEROS,
  verifyManagerPin,
  RECIPE_ALIASES,
  formatMXN,
  generateId,
  saveOrder,
  logAudit,
  deductIngredientsForOrder,
  reverseIngredientDeduction,
  deductMarketStockForOrder,
  getRecipes,
  getIngredients,
  getModifiersForCategory,
  getModifierTypeFromCategoryName,
  getMenuCategoriesFromDB,
  getModifiersForCategoryFromDB,
  getModifierGroupsForItem,
  getPaymentMethodsFromDB,
  getActiveTurno,
  getClientId,
  type RecipeRow,
  type Ingredient,
  type ModificadorAgregar,
  type ModifierGroupDef,
  type PaymentMethodDB,
  type PagoForma,
} from '@/lib/pos-data'
import { IVA_RATE, TIEMPO_ITEM_ID, isTiempoItem, getStationForItem, setCategoryNameCache, _categoryNameCache } from '@/lib/pos-constants'
import { calcSplitParejo, calcSplitItems } from '@/lib/pos-calculations'
import { publishEvent, getDeviceId } from '@/lib/events'
import { apiUrl } from '@/lib/api-base'
import type { OrderItem, MenuItem, Order } from '@/lib/pos-data'
import {
  printByStation,
  comandasMuted,
  setComandasMuted,
  printPreTicket,
  printTicket,
  printTicketCSS,
  openCashDrawer,
  isBluetoothAvailable,
  isBluetoothConnected,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  isUsbAvailable,
  connectUsbPrinter,
} from '@/lib/printer'
import {
  type AppliedPromo,
  getActivePromos,
  evaluatePromos,
  buildCategoryMap,
} from '@/lib/pos-promos'
import { getActiveCombos, applyCombo, type Combo } from '@/lib/pos-combos'
import { syncAll, getPendingQueue } from '@/lib/pos-offline-db'
import { getPermissions } from '@/lib/pos-permissions'
import {
  ChefHat,
  Grid3X3,
  Minus,
  Plus,
  X,
  CreditCard,
  Banknote,
  Send,
  Clock,
  Users,
  Percent,
  StickyNote,
  Pencil,
  ShieldAlert,
  Ban,
  FileText,
  BookOpen,
  Package,
  ShoppingCart,
  Wine,
  Bike,
  Receipt,
  QrCode,
  Menu,
  Printer,
  Bluetooth,
  Usb,
  ScanBarcode,
  Stamp,
  Monitor,
  Settings,
  Loader2,
  Smartphone,
  Lock,
  Flame,
  Armchair,
  Tag,
  ArrowRightLeft,
  DollarSign,
  ArrowDownUp,
  Layers,
} from 'lucide-react'
import {
  getMPConfig,
  saveMPConfig,
  clearMPConfig,
  fetchMPDevices,
  sendPaymentToPoint,
  pollPaymentStatus,
  cancelPaymentIntent,
  type PaymentStatus,
  type MPConfig,
  type MPDevice,
} from '@/lib/mercadopago'
import dynamic from 'next/dynamic'

const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })
const POSCopilot = dynamic(() => import('@/components/POSCopilot'), { ssr: false })
const OfflineIndicator = dynamic(() => import('@/components/pos/OfflineIndicator'), { ssr: false })
const InventoryAlerts = dynamic(() => import('@/components/pos/InventoryAlerts'), { ssr: false })
const MeseroLeaderboard = dynamic(() => import('@/components/pos/MeseroLeaderboard'), { ssr: false })
const SmartCashCalculator = dynamic(() => import('@/components/pos/SmartCashCalculator'), { ssr: false })
const CustomerMemory = dynamic(() => import('@/components/pos/CustomerMemory'), { ssr: false })
const KitchenTimer = dynamic(() => import('@/components/pos/KitchenTimer'), { ssr: false })

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

export default function POSPage() {
  return (
    <Suspense fallback={
      <div className="h-dvh flex items-center justify-center text-white" style={{background:'#0a0a0f',color:'#fff'}}>
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <POSContent />
    </Suspense>
  )
}

// ─── Modifier Modal ─────────────────────────────────────────────────────────

interface ModifierModalProps {
  item: MenuItem
  existingOrder?: OrderItem | null
  recipeIngredients: string[]
  categoryId: string
  onConfirm: (orderItem: OrderItem) => void
  onCancel: () => void
}

function ModifierModal({ item, existingOrder, recipeIngredients, categoryId, onConfirm, onCancel }: ModifierModalProps) {
  const { quitarOptions: defaultQuitar, agregarOptions: legacyAgregar } = getModifiersForCategory(categoryId)

  // ── Grupos multinivel (Wansoft: "NIVEL 1: PROTEINA, opcional, máx 2") ──
  const [modGroups, setModGroups] = useState<ModifierGroupDef[]>([])
  const [groupChecked, setGroupChecked] = useState<Map<string, Set<string>>>(() => {
    // Restore selections when editing: match existing modifier strings to options later
    return new Map()
  })
  useEffect(() => {
    let alive = true
    getModifierGroupsForItem(item.id, categoryId).then(groups => {
      if (!alive || groups.length === 0) return
      setModGroups(groups)
      if (existingOrder) {
        // Re-marcar opciones ya elegidas (strings "Nombre +$50" → nombre)
        const existing = new Set(existingOrder.modificadores.map(m => m.replace(/ \+\$[\d.]+$/, '')))
        const restored = new Map<string, Set<string>>()
        for (const g of groups) {
          const sel = new Set(g.options.filter(o => existing.has(o.name)).map(o => o.name))
          if (sel.size > 0) restored.set(g.id, sel)
        }
        setGroupChecked(restored)
      }
    })
    return () => { alive = false }
  }, [item.id, categoryId, existingOrder])

  const hasGroups = modGroups.length > 0
  // Con grupos configurados, el legacy "Agregar" se oculta (los grupos lo reemplazan)
  const agregarOptions = hasGroups ? [] : legacyAgregar

  const toggleGroupOption = (group: ModifierGroupDef, optName: string) => {
    setGroupChecked(prev => {
      const next = new Map(prev)
      const sel = new Set(next.get(group.id) || [])
      if (sel.has(optName)) {
        sel.delete(optName)
      } else {
        if (group.maxSelections === 1 && sel.size === 1) sel.clear() // radio behavior
        else if (group.maxSelections !== null && sel.size >= group.maxSelections) return prev // max reached
        sel.add(optName)
      }
      next.set(group.id, sel)
      return next
    })
  }

  const groupsPrecioExtra = modGroups.reduce((sum, g) => {
    const sel = groupChecked.get(g.id)
    if (!sel) return sum
    return sum + g.options.filter(o => sel.has(o.name)).reduce((s, o) => s + o.price, 0)
  }, 0)

  // Grupos con mínimo no cumplido (bloquean confirmar)
  const unmetGroups = modGroups.filter(g => {
    const count = groupChecked.get(g.id)?.size || 0
    const min = g.required ? Math.max(1, g.minSelections) : g.minSelections
    return count < min
  })

  // Dynamic "quitar" options from recipe ingredients (food only — not for drinks/bakery/market)
  const catName = _categoryNameCache[categoryId] || ''
  const catType = catName ? getModifierTypeFromCategoryName(catName) : (defaultQuitar.length > 0 ? 'food' : 'none')
  const isFood = catType === 'food'
  const quitarOptions = isFood
    ? (recipeIngredients.length > 0 ? recipeIngredients.map(name => `Sin ${name}`) : defaultQuitar)
    : []

  const [quitarChecked, setQuitarChecked] = useState<Set<string>>(
    () => new Set(existingOrder?.modificadores.filter(m => m.startsWith('Sin ')) ?? [])
  )
  const [agregarChecked, setAgregarChecked] = useState<Set<string>>(
    () => new Set(
      existingOrder?.modificadores
        .filter(m => !m.startsWith('Sin '))
        .map(m => m.replace(/ \+\$\d+$/, '')) ?? []
    )
  )
  const [notas, setNotas] = useState(existingOrder?.notas ?? '')
  const [cantidad, setCantidad] = useState(existingOrder?.cantidad ?? 1)

  const toggleQuitar = (mod: string) => {
    setQuitarChecked(prev => {
      const next = new Set(prev)
      if (next.has(mod)) next.delete(mod)
      else next.add(mod)
      return next
    })
  }

  const toggleAgregar = (name: string) => {
    setAgregarChecked(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const precioExtra = agregarOptions
    .filter(m => agregarChecked.has(m.name))
    .reduce((sum, m) => sum + m.price, 0) + groupsPrecioExtra

  const subtotal = (item.price + precioExtra) * cantidad

  const buildModificadores = (): string[] => {
    const mods: string[] = []
    quitarChecked.forEach(m => mods.push(m))
    // Grupos multinivel — en orden de nivel
    for (const g of modGroups) {
      const sel = groupChecked.get(g.id)
      if (!sel) continue
      for (const o of g.options) {
        if (sel.has(o.name)) mods.push(o.price > 0 ? `${o.name} +$${o.price}` : o.name)
      }
    }
    agregarChecked.forEach(name => {
      const mod = agregarOptions.find(m => m.name === name)
      if (mod) {
        mods.push(mod.price > 0 ? `${mod.name} +$${mod.price}` : mod.name)
      }
    })
    return mods
  }

  const handleConfirm = () => {
    onConfirm({
      id: existingOrder?.id ?? generateId(),
      menuItemId: item.id,
      nombre: item.name,
      precio: item.price,
      cantidad,
      modificadores: buildModificadores(),
      notas,
      precioExtra,
      subtotal,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl mx-4 [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--line)] px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-white">{item.name}</h3>
            <p className="text-emerald-400 font-semibold">{formatMXN(item.price)}</p>
          </div>
          <button
            onClick={onCancel}
            className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Quitar section — dynamic from recipe ingredients */}
          {quitarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">
              Quitar {recipeIngredients.length > 0 && <span className="text-[var(--text-2)] normal-case font-normal">({recipeIngredients.length} ingredientes)</span>}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {quitarOptions.map(mod => (
                <label
                  key={mod}
                  className={`flex items-center gap-3 px-4 py-4 rounded-xl cursor-pointer transition-colors min-h-[52px] ${
                    quitarChecked.has(mod)
                      ? 'bg-red-900/40 border border-red-700/60'
                      : 'bg-[var(--line)]/50 border border-slate-600/50 hover:bg-[var(--line)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={quitarChecked.has(mod)}
                    onChange={() => toggleQuitar(mod)}
                    className="sr-only"
                  />
                  <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    quitarChecked.has(mod)
                      ? 'bg-red-500 border-red-500'
                      : 'border-[var(--line-soft)]0'
                  }`}>
                    {quitarChecked.has(mod) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-white">{mod}</span>
                </label>
              ))}
            </div>
          </div>}

          {/* Grupos multinivel (Wansoft) */}
          {modGroups.map(group => {
            const sel = groupChecked.get(group.id) || new Set<string>()
            const min = group.required ? Math.max(1, group.minSelections) : group.minSelections
            const maxReached = group.maxSelections !== null && group.maxSelections > 1 && sel.size >= group.maxSelections
            const unmet = sel.size < min
            return (
              <div key={group.id}>
                <h4 className="text-sm font-semibold uppercase tracking-wide mb-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--text-3)]">Nivel {group.level}: {group.name}</span>
                  {min > 0 ? (
                    <span className={`text-[11px] normal-case font-bold px-2 py-0.5 rounded-full ${unmet ? 'bg-red-900/50 text-red-300 border border-red-700/60' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'}`}>
                      Obligatorio{min > 1 ? ` (mín ${min})` : ''}
                    </span>
                  ) : (
                    <span className="text-[11px] normal-case font-medium px-2 py-0.5 rounded-full bg-[var(--line)]/60 text-[var(--text-3)]">Opcional</span>
                  )}
                  {group.maxSelections !== null && (
                    <span className={`text-[11px] normal-case font-medium px-2 py-0.5 rounded-full ${maxReached ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50' : 'bg-[var(--line)]/60 text-[var(--text-3)]'}`}>
                      Máx {group.maxSelections}{group.maxSelections > 1 ? ` (${sel.size}/${group.maxSelections})` : ''}
                    </span>
                  )}
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {group.options.map(opt => {
                    const checked = sel.has(opt.name)
                    const blocked = !checked && group.maxSelections !== null && group.maxSelections > 1 && sel.size >= group.maxSelections
                    return (
                      <label
                        key={opt.name}
                        className={`flex items-center gap-3 px-4 py-4 rounded-xl transition-colors min-h-[52px] ${
                          checked
                            ? 'bg-emerald-900/40 border border-emerald-700/60 cursor-pointer'
                            : blocked
                            ? 'bg-[var(--line)]/30 border border-slate-700/40 opacity-40 cursor-not-allowed'
                            : 'bg-[var(--line)]/50 border border-slate-600/50 hover:bg-[var(--line)] cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          onChange={() => toggleGroupOption(group, opt.name)}
                          className="sr-only"
                        />
                        <div className={`w-6 h-6 ${group.maxSelections === 1 ? 'rounded-full' : 'rounded'} border-2 flex items-center justify-center flex-shrink-0 ${
                          checked ? 'bg-emerald-500 border-emerald-500' : 'border-[var(--line-soft)]0'
                        }`}>
                          {checked && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-sm text-white">{opt.name}</span>
                          <span className={`text-xs font-medium ${opt.price > 0 ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>
                            {opt.price > 0 ? `+${formatMXN(opt.price)}` : 'Gratis'}
                          </span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Agregar section */}
          {agregarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Agregar</h4>
            <div className="grid grid-cols-2 gap-2">
              {agregarOptions.map(mod => (
                <label
                  key={mod.name}
                  className={`flex items-center gap-3 px-4 py-4 rounded-xl cursor-pointer transition-colors min-h-[52px] ${
                    agregarChecked.has(mod.name)
                      ? 'bg-emerald-900/40 border border-emerald-700/60'
                      : 'bg-[var(--line)]/50 border border-slate-600/50 hover:bg-[var(--line)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={agregarChecked.has(mod.name)}
                    onChange={() => toggleAgregar(mod.name)}
                    className="sr-only"
                  />
                  <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    agregarChecked.has(mod.name)
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'border-[var(--line-soft)]0'
                  }`}>
                    {agregarChecked.has(mod.name) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-white">{mod.name}</span>
                    <span className={`text-xs font-medium ${mod.price > 0 ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>
                      {mod.price > 0 ? `+${formatMXN(mod.price)}` : 'Gratis'}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>}

          {/* Notas por item */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Notas del platillo</h4>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['Termino medio', 'Bien cocido', 'Tres cuartos', 'Sin picante', 'Extra caliente', 'Para llevar', 'Urgente', 'Alergia'].map(tag => {
                const isActive = notas.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        setNotas(notas.replace(tag, '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim())
                      } else {
                        setNotas(prev => prev ? `${prev}, ${tag}` : tag)
                      }
                    }}
                    className={`px-4 min-h-[48px] rounded-lg text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-amber-600/40 border border-amber-500/60 text-amber-200'
                        : 'bg-[var(--line)]/50 border border-slate-600/50 text-slate-300 hover:bg-[var(--line)]'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Instrucciones especiales: sin cebolla, termino medio..."
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500 min-h-[44px]"
            />
          </div>

          {/* Cantidad */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Cantidad</h4>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                className="w-12 h-12 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-white transition-colors"
              >
                <Minus size={20} />
              </button>
              <span className="text-2xl font-bold text-white w-12 text-center">{cantidad}</span>
              <button
                onClick={() => setCantidad(cantidad + 1)}
                className="w-12 h-12 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-white transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="sticky bottom-0 bg-[var(--surface-2)] border-t border-[var(--line)] px-5 py-4 flex gap-3 rounded-b-2xl">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={unmetGroups.length > 0}
            className="flex-[2] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold transition-colors min-h-[48px]"
          >
            {unmetGroups.length > 0
              ? `Elige ${unmetGroups[0].name}`
              : <>{existingOrder ? 'Actualizar' : 'Agregar'} {formatMXN(subtotal)}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Discount Modal ─────────────────────────────────────────────────────────

interface DiscountModalProps {
  subtotal: number
  personas: number
  items: OrderItem[]
  onApply: (discount: number, reason: string | undefined, approvedBy: string) => void
  onCancel: () => void
}

const CORTESIA_POR_PERSONA = 480

function DiscountModal({ subtotal, personas, items, onApply, onCancel }: DiscountModalProps) {
  const [mode, setMode] = useState<'percent' | 'fixed' | 'cortesia' | '2x1'>('percent')
  const [value, setValue] = useState('')
  const [cortesiaPersonas, setCortesiaPersonas] = useState(1)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [reason, setReason] = useState('')

  // ── 2x1 (estilo Wansoft: aplicar sobre partidas seleccionadas) ──
  const promoItems = items.filter(i => !isTiempoItem(i))
  const [promoSelected, setPromoSelected] = useState<Set<string>>(new Set())
  const togglePromoItem = (id: string) => {
    setPromoSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // Expandir unidades seleccionadas, ordenar desc, cada 2ª unidad (la más barata del par) gratis
  const promoUnits: number[] = []
  for (const it of promoItems) {
    if (!promoSelected.has(it.id)) continue
    const unitPrice = it.precio + it.precioExtra
    for (let u = 0; u < it.cantidad; u++) promoUnits.push(unitPrice)
  }
  promoUnits.sort((a, b) => b - a)
  const promoPairs = Math.floor(promoUnits.length / 2)
  const promoDiscount = promoUnits.filter((_, idx) => idx % 2 === 1).reduce((s, p) => s + p, 0)

  const maxCortesia = CORTESIA_POR_PERSONA * cortesiaPersonas
  const discountAmount = mode === 'percent'
    ? subtotal * (Math.min(100, Math.max(0, Number(value) || 0)) / 100)
    : mode === 'fixed'
    ? Math.min(subtotal, Math.max(0, Number(value) || 0))
    : mode === '2x1'
    ? Math.min(subtotal, promoDiscount)
    : Math.min(subtotal, maxCortesia)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Aplicar descuento</h3>
          <button onClick={onCancel} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]">
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('percent')}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors min-h-[48px] ${
              mode === 'percent' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            <Percent size={14} className="inline mr-1 -mt-0.5" /> %
          </button>
          <button
            onClick={() => setMode('fixed')}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors min-h-[48px] ${
              mode === 'fixed' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            $ Fijo
          </button>
          <button
            onClick={() => setMode('cortesia')}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors min-h-[48px] ${
              mode === 'cortesia' ? 'bg-violet-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            Cortesía
          </button>
          <button
            onClick={() => setMode('2x1')}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors min-h-[48px] ${
              mode === '2x1' ? 'bg-amber-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            2 x 1
          </button>
        </div>

        {mode === '2x1' ? (
          <div className="mb-3">
            <p className="text-center text-sm text-[var(--text-3)] mb-2">
              Selecciona los platillos que aplican — el más barato de cada par va gratis
            </p>
            <div className="max-h-56 overflow-y-auto space-y-1.5 mb-2">
              {promoItems.map(it => {
                const checked = promoSelected.has(it.id)
                return (
                  <label
                    key={it.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors min-h-[44px] ${
                      checked ? 'bg-amber-900/40 border border-amber-700/60' : 'bg-[var(--line)]/50 border border-slate-600/50 hover:bg-[var(--line)]'
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePromoItem(it.id)} className="sr-only" />
                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      checked ? 'bg-amber-500 border-amber-500' : 'border-[var(--line-soft)]0'
                    }`}>
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="flex-1 text-sm text-white">{it.cantidad}x {it.nombre}</span>
                    <span className="text-xs text-[var(--text-3)]">{formatMXN((it.precio + it.precioExtra) * it.cantidad)}</span>
                  </label>
                )
              })}
            </div>
            {promoUnits.length > 0 && (
              <p className="text-center text-sm">
                <span className="text-[var(--text-3)]">{promoPairs} {promoPairs === 1 ? 'par' : 'pares'}</span>
                {promoUnits.length % 2 === 1 && <span className="text-amber-400"> · 1 unidad sin par</span>}
                {promoDiscount > 0 && <span className="text-amber-400 font-semibold"> · Gratis: -{formatMXN(promoDiscount)}</span>}
              </p>
            )}
          </div>
        ) : mode !== 'cortesia' ? (
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'percent' ? 'Ej. 10' : 'Ej. 50'}
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-lg text-center focus:outline-none focus:border-emerald-500 min-h-[48px] mb-3"
            autoFocus
          />
        ) : (
          <div className="mb-3">
            <p className="text-center text-sm text-[var(--text-3)] mb-3">
              ${CORTESIA_POR_PERSONA} por persona
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setCortesiaPersonas(Math.max(1, cortesiaPersonas - 1))}
                className="w-12 h-12 rounded-xl bg-[var(--line)] flex items-center justify-center text-white text-lg font-bold"
              >
                −
              </button>
              <div className="text-center">
                <span className="text-3xl font-bold text-white">{cortesiaPersonas}</span>
                <p className="text-xs text-[var(--text-3)]">{cortesiaPersonas === 1 ? 'persona' : 'personas'}</p>
              </div>
              <button
                onClick={() => setCortesiaPersonas(Math.min(personas || 10, cortesiaPersonas + 1))}
                className="w-12 h-12 rounded-xl bg-[var(--line)] flex items-center justify-center text-white text-lg font-bold"
              >
                +
              </button>
            </div>
            <p className="text-center text-violet-400 font-semibold text-lg mt-3">
              Cortesía: {formatMXN(maxCortesia)}
            </p>
          </div>
        )}

        {discountAmount > 0 && mode !== 'cortesia' && mode !== '2x1' && (
          <p className="text-center text-[var(--text-3)] text-sm mb-3">
            Descuento: <span className="text-red-400 font-semibold">-{formatMXN(discountAmount)}</span>
          </p>
        )}

        {/* Reason for discount/cortesia */}
        {discountAmount > 0 && (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === 'cortesia' ? 'Motivo de cortesía (ej. cliente frecuente)' : 'Motivo del descuento (opcional)'}
            className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 mb-3"
          />
        )}

        {/* Manager PIN required */}
        {discountAmount > 0 && (
          <div className="mb-3">
            <p className="text-xs text-[var(--text-3)] text-center mb-2">PIN de gerente para autorizar</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(false) }}
              placeholder="••••"
              className={`w-full bg-[var(--line)] border ${pinError ? 'border-red-500' : 'border-slate-600'} rounded-lg px-4 py-3 text-white text-lg text-center tracking-[0.3em] focus:outline-none focus:border-emerald-500 min-h-[48px]`}
            />
            {pinError && <p className="text-red-400 text-xs text-center mt-1">PIN incorrecto</p>}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]">
            Cancelar
          </button>
          <button
            onClick={async () => {
              if (discountAmount <= 0) return
              const manager = await verifyManagerPin(pin)
              if (!manager) { setPinError(true); return }
              onApply(discountAmount, reason || (
                mode === 'cortesia' ? `Cortesía ${cortesiaPersonas}p`
                : mode === '2x1' ? `Promo 2x1 (${promoPairs} ${promoPairs === 1 ? 'par' : 'pares'})`
                : `Descuento ${mode === 'percent' ? value + '%' : '$' + value}`
              ), manager)
            }}
            disabled={discountAmount <= 0 || pin.length < 4}
            className={`flex-[2] py-3 rounded-xl ${mode === 'cortesia' ? 'bg-violet-600 hover:bg-violet-500' : mode === '2x1' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold transition-colors min-h-[48px]`}
          >
            {mode === 'cortesia' ? `Cortesía -${formatMXN(discountAmount)}` : mode === '2x1' ? `2x1 -${formatMXN(discountAmount)}` : `Aplicar -${formatMXN(discountAmount)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Cancel Item Modal (requires reason + manager PIN) ─────────────────────

interface CancelModalProps {
  itemName: string
  onConfirm: (reason: string, managerName: string, options: { prepared: boolean; voided: boolean }) => void
  onCancel: () => void
}

function CancelModal({ itemName, onConfirm, onCancel }: CancelModalProps) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [step, setStep] = useState<'reason' | 'prepared'>('reason')
  const [managerName, setManagerName] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricChecking, setBiometricChecking] = useState(false)

  useEffect(() => {
    // Check if there are manager/admin biometric credentials stored
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const hasManagerCreds = Object.values(stored).some((m: unknown) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (hasManagerCreds && window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(ok => setBiometricAvailable(ok))
          .catch(() => {})
      }
    } catch {}
  }, [])

  const handleBiometricAuth = async () => {
    if (!reason) { setError('Selecciona un motivo'); return }
    setBiometricChecking(true)
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      // Only allow manager/admin credentials
      const managerCreds = Object.entries(stored).filter(([, m]) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (managerCreds.length === 0) { setError('No hay huellas de gerente registradas'); setBiometricChecking(false); return }

      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: managerCreds.map(([id]) => ({
            id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
            type: 'public-key' as const,
          })),
          userVerification: 'required',
          timeout: 30000,
        },
      })
      if (assertion) {
        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
        const member = stored[credId] as { name?: string }
        if (member?.name) {
          setManagerName(member.name)
          setStep('prepared')
        }
      }
    } catch {
      setError('Huella no reconocida')
    }
    setBiometricChecking(false)
  }

  const CANCEL_REASONS = [
    'Cliente cambio de opinion',
    'Platillo agotado',
    'Error del mesero',
    'Preparacion incorrecta',
    'Tiempo de espera excesivo',
    'Otro',
  ]

  const handlePinConfirm = async () => {
    if (!reason) { setError('Selecciona un motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = await verifyManagerPin(pin)
    if (!manager) { setError('PIN invalido'); return }
    setManagerName(manager)
    setStep('prepared')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-900/60 flex items-center justify-center">
            <ShieldAlert size={20} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">{step === 'reason' ? 'Cancelar item' : 'Se preparo este articulo?'}</h3>
            <p className="text-red-400 text-sm">{itemName}</p>
          </div>
        </div>

        {step === 'reason' && (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo de cancelacion</label>
                <div className="grid grid-cols-2 gap-2">
                  {CANCEL_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => { setReason(r); setError('') }}
                      className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors min-h-[44px] ${
                        reason === r
                          ? 'bg-red-900/40 border border-red-600 text-white'
                          : 'bg-[var(--line)]/50 border border-slate-600/50 text-[var(--text-4)] hover:bg-[var(--line)]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">
                  {biometricAvailable ? 'Huella digital o PIN de gerente' : 'PIN de gerente'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
                    placeholder="****"
                    className="flex-1 bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
                  />
                  {biometricAvailable && (
                    <button
                      onClick={handleBiometricAuth}
                      disabled={biometricChecking}
                      className="w-14 min-h-[48px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white flex items-center justify-center transition-colors"
                      title="Autorizar con huella digital"
                    >
                      {biometricChecking
                        ? <Loader2 size={22} className="animate-spin" />
                        : <Lock size={22} />
                      }
                    </button>
                  )}
                </div>
              </div>

              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]">
                Volver
              </button>
              <button
                onClick={handlePinConfirm}
                className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
              >
                <Ban size={18} />
                Siguiente
              </button>
            </div>
          </>
        )}

        {step === 'prepared' && (
          <>
            <p className="text-[var(--text-4)] text-sm mb-4">Si se preparo, queda registrado como merma. Si fue un error operativo, puedes anular (no afecta metricas).</p>
            <div className="space-y-2 mb-5">
              <button
                onClick={() => onConfirm(reason, managerName, { prepared: false, voided: false })}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
              >
                <Ban size={18} />
                Cancelar — No se preparo
              </button>
              <button
                onClick={() => onConfirm(reason, managerName, { prepared: true, voided: false })}
                className="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
              >
                <ShieldAlert size={18} />
                Cancelar — Si, se preparo (merma)
              </button>
              <button
                onClick={() => onConfirm(reason, managerName, { prepared: false, voided: true })}
                className="w-full py-3 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
              >
                <X size={18} />
                Anular — Error operativo
              </button>
            </div>
            <button onClick={() => setStep('reason')} className="w-full py-2.5 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[44px]">
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Void Order Modal (requires reason + manager PIN) ──────────────────────

interface VoidOrderModalProps {
  mesa: number
  total: number
  onConfirm: (reason: string, managerName: string) => void
  onCancel: () => void
}

function VoidOrderModal({ mesa, total, onConfirm, onCancel }: VoidOrderModalProps) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (!reason.trim()) { setError('Escribe el motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = await verifyManagerPin(pin)
    if (!manager) { setError('PIN invalido'); return }
    onConfirm(reason, manager)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-900/60 flex items-center justify-center">
            <ShieldAlert size={20} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Anular orden completa</h3>
            <p className="text-red-400 text-sm">Mesa {mesa} · {formatMXN(total)}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo de anulacion</label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError('') }}
              placeholder="Describe el motivo..."
              rows={3}
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">PIN de gerente</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="****"
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]">
            Volver
          </button>
          <button
            onClick={handleConfirm}
            className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
          >
            <Ban size={18} />
            Anular orden
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Cash Movement Modal (Retiros / Depósitos) ─────────────────────────────

interface CashMovementModalProps {
  turnoId: string | null
  actor: string
  onConfirm: (type: 'retiro' | 'deposito', amount: number, reason: string, managerName: string) => void
  onCancel: () => void
}

function CashMovementModal({ turnoId, actor, onConfirm, onCancel }: CashMovementModalProps) {
  const [type, setType] = useState<'retiro' | 'deposito'>('retiro')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    const num = parseFloat(amount)
    if (!num || num <= 0) { setError('Ingresa un monto valido'); return }
    if (!reason.trim()) { setError('Ingresa un motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = await verifyManagerPin(pin)
    if (!manager) { setError('PIN invalido'); return }
    setSaving(true)
    try {
      // Save to Supabase
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${sbUrl}/rest/v1/pos_cash_movements`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: _cid(),
          turno_id: turnoId,
          type,
          amount: num,
          reason: reason.trim(),
          actor,
          approved_by: manager,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onConfirm(type, num, reason.trim(), manager)
    } catch {
      setError('Error al guardar — intenta de nuevo')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-slate-600/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-900/60 flex items-center justify-center">
            <ArrowDownUp size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Movimiento de caja</h3>
            <p className="text-[var(--text-3)] text-sm">Retiro o deposito de efectivo</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Toggle Retiro / Deposito */}
          <div className="flex gap-2">
            <button
              onClick={() => setType('retiro')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors min-h-[44px] ${
                type === 'retiro' ? 'bg-red-600 text-white' : 'bg-[var(--line)]/50 border border-slate-600/50 text-[var(--text-4)]'
              }`}
            >
              Retiro
            </button>
            <button
              onClick={() => setType('deposito')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors min-h-[44px] ${
                type === 'deposito' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)]/50 border border-slate-600/50 text-[var(--text-4)]'
              }`}
            >
              Deposito
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Monto</label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError('') }}
              placeholder="$0.00"
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl focus:outline-none focus:border-emerald-500 min-h-[48px]"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError('') }}
              placeholder="Ej: Cambio, pago proveedor, fondo inicial..."
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 min-h-[48px]"
            />
          </div>

          {/* Manager PIN */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">PIN de gerente</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="****"
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-emerald-500 min-h-[48px]"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className={`flex-[2] py-3 rounded-xl ${type === 'retiro' ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2 disabled:opacity-50`}
          >
            <DollarSign size={18} />
            {saving ? 'Guardando...' : `Confirmar ${type}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main POS Content ───────────────────────────────────────────────────────

function POSContent() {
  const searchParams = useSearchParams()
  const initialCuenta = searchParams.get('cuenta') || ''
  // Cuenta por nombre (estilo Wansoft): sin mesa → mesa 0
  const initialMesa = initialCuenta ? 0 : (Number(searchParams.get('mesa')) || 1)

  const [menuCategories, setMenuCategories] = useState(MENU_CATEGORIES)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mesa, setMesa] = useState<number>(initialMesa)

  // When URL mesa param changes (e.g. from plano), reset order for new mesa
  // Use window.location directly because Next.js searchParams may be stale
  useEffect(() => {
    const checkUrlMesa = () => {
      const params = new URLSearchParams(window.location.search)
      const urlMesa = Number(params.get('mesa')) || 0
      if (urlMesa > 0 && urlMesa !== mesa) {
        setMesa(urlMesa)
        setOrderItems([])
        setOrderId(generateId())
        setLoadedOrderId(null)
        setLoadedUpdatedAt(null)
        setCancelledItems(new Set())
        setVoidedItems(new Set())
        setDiscount(0)
      }
    }
    // Check on popstate (browser back/forward) and on focus (returning from plano)
    window.addEventListener('popstate', checkUrlMesa)
    window.addEventListener('focus', checkUrlMesa)
    // Also check periodically for router.push changes
    const interval = setInterval(checkUrlMesa, 500)
    return () => {
      window.removeEventListener('popstate', checkUrlMesa)
      window.removeEventListener('focus', checkUrlMesa)
      clearInterval(interval)
    }
  }, [mesa])
  const [clienteNombre, setClienteNombre] = useState<string>(initialCuenta)
  const [mesero, setMesero] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        // First check localStorage (dropdown selection persists across reloads)
        const fromDropdown = localStorage.getItem('pos_mesero')
        if (fromDropdown && MESEROS.includes(fromDropdown)) return fromDropdown
        // Fallback: match from staff session
        const saved = sessionStorage.getItem('pos_staff')
        if (saved) {
          const s = JSON.parse(saved)
          const match = MESEROS.find(m => m.toLowerCase().includes(s.name?.toLowerCase()?.split(' ')[0] || ''))
          if (match) return match
        }
      } catch { /* */ }
    }
    return MESEROS[0]
  })
  const [personas, setPersonas] = useState<number>(2)
  const [clock, setClock] = useState<string>('')
  const [showPayment, setShowPayment] = useState(false)
  const [showMixto, setShowMixto] = useState(false)
  // Pago mixto multi-forma (estilo Wansoft): lista de {metodo, monto}
  const [mixtoPagos, setMixtoPagos] = useState<PagoForma[]>([])
  const [mixtoForma, setMixtoForma] = useState('Efectivo')
  const [mixtoMonto, setMixtoMonto] = useState('')
  // Formas de pago custom desde pos_payment_methods (Rappi, Ubereats, Cortesía...)
  const [paymentMethodsDB, setPaymentMethodsDB] = useState<PaymentMethodDB[]>([])
  // Turno activo — se adjunta turno_id a cada orden cerrada
  const [turnoId, setTurnoId] = useState<string | null>(null)
  // Sillas: silla activa para nuevos items (spinner SILLA estilo Wansoft)
  const [sillaActual, setSillaActual] = useState(1)
  // Tiempos: firebutton "Impresión por tiempos"
  const [showFirebutton, setShowFirebutton] = useState(false)
  const [tiempoFired, setTiempoFired] = useState(0)
  const [showCashCalc, setShowCashCalc] = useState(false)
  const [showCashFlow, setShowCashFlow] = useState(false)
  // Getnet standalone (spec 14.1): el cajero teclea el monto a mano en la terminal roja
  // → mostrar el monto GIGANTE + confirmación para evitar descuadres
  const [showCardConfirm, setShowCardConfirm] = useState(false)
  const [cashAmount, setCashAmount] = useState('')
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [sentToKitchen, setSentToKitchen] = useState(false)

  // Modifier modal state
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null)
  const [modifierCategoryId, setModifierCategoryId] = useState<string>('')
  const [editingOrderItem, setEditingOrderItem] = useState<OrderItem | null>(null)

  // Recipe data for dynamic modifiers
  const [allRecipes, setAllRecipes] = useState<RecipeRow[]>([])
  const [allIngredients, setAllIngredients] = useState<Ingredient[]>([])

  // Out-of-stock tracking
  const [outOfStockItems, setOutOfStockItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    (async () => {
      const [r, i, dbMenu, pm, turno] = await Promise.all([
        getRecipes(), getIngredients(), getMenuCategoriesFromDB(), getPaymentMethodsFromDB(), getActiveTurno(),
      ])
      setAllRecipes(r)
      setAllIngredients(i)
      if (dbMenu.length > 0) {
        setMenuCategories(dbMenu)
        // Build category name cache for station routing (UUID ids → display names)
        const nameMap: Record<string, string> = {}
        for (const cat of dbMenu) nameMap[cat.id] = cat.name
        setCategoryNameCache(nameMap)
      }
      setPaymentMethodsDB(pm)
      if (turno) setTurnoId(turno.id)
      // Promos: build category map + load
      const cats = dbMenu.length > 0 ? dbMenu : menuCategories
      categoryMapRef.current = buildCategoryMap(cats)
      getActivePromos(_cid()).then(setAllPromos).catch(() => {})
      getActiveCombos(_cid()).then(setAllCombos).catch(() => {})

      // Check which menu items are out of stock
      try {
        const invRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_inventory?select=ingredient_id,stock&client_id=eq.${_cid()}&stock=lte.0`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
        })
        if (invRes.ok) {
          const zeroStock = await invRes.json()
          const zeroIds = new Set(zeroStock.map((z: { ingredient_id: string }) => z.ingredient_id))
          // Find menu items whose ALL key ingredients are at zero
          const oos = new Set<string>()
          const recipesGrouped = new Map<string, { ingredient_id: string }[]>()
          for (const recipe of r) {
            const list = recipesGrouped.get(recipe.menu_item_id) || []
            list.push(recipe)
            recipesGrouped.set(recipe.menu_item_id, list)
          }
          for (const [menuItemId, ingredients] of recipesGrouped) {
            const hasZero = ingredients.some(ing => zeroIds.has(ing.ingredient_id))
            if (hasZero) oos.add(menuItemId)
          }
          setOutOfStockItems(oos)
        }
      } catch { /* */ }
    })()
  }, [])

  // Get ingredient names for a specific menu item
  const getRecipeIngredients = useCallback((itemName: string): string[] => {
    const name = itemName.toLowerCase()
    const ingMap = new Map(allIngredients.map(i => [i.id, i]))

    // Use alias map first
    const aliases = RECIPE_ALIASES[name]
    let rows: RecipeRow[] = []

    if (aliases) {
      for (const alias of aliases) {
        const matched = allRecipes.filter(r => r.menu_item_name.toLowerCase() === alias.toLowerCase())
        if (matched.length > 0) { rows = matched; break }
      }
    }

    // Fallback: partial match
    if (rows.length === 0) {
      rows = allRecipes.filter(r => {
        const rName = r.menu_item_name.toLowerCase()
        return rName === name || rName.includes(name) || name.includes(rName)
      })
    }

    // Get unique ingredient names, capitalize first letter
    const names = new Set<string>()
    for (const row of rows) {
      const ing = ingMap.get(row.ingredient_id)
      const ingName = ing?.name || row.ingredient_id
      // Skip very generic ingredients (water, oil, salt, pepper)
      if (['agua de filtro', 'aceite vegetal', 'sal', 'pimienta', 'aceite de oliva'].includes(ingName.toLowerCase())) continue
      names.add(ingName.charAt(0).toUpperCase() + ingName.slice(1))
    }
    return Array.from(names).slice(0, 12) // max 12 options
  }, [allRecipes, allIngredients])

  // Online/offline + sync (IndexedDB-backed)
  const [online, setOnline] = useState(true)
  const [pendingSync, setPendingSync] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const syncRef = useRef(false)
  useEffect(() => {
    let mounted = true
    // syncAll, getPendingQueue imported at top level
    setOnline(navigator.onLine)

    const updateCount = async () => {
      try { const q = await getPendingQueue(); if (mounted) setPendingSync(q.length) } catch {}
    }

    const doSync = async () => {
      if (syncRef.current) return
      syncRef.current = true
      if (mounted) setIsSyncing(true)
      try {
        const result = await syncAll()
        if (mounted && result.synced > 0) setLastSyncTime(new Date().toISOString())
      } catch {}
      if (mounted) setIsSyncing(false)
      syncRef.current = false
      updateCount()
    }

    const goOnline = () => { if (mounted) setOnline(true); doSync() }
    const goOffline = () => { if (mounted) setOnline(false) }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    updateCount()
    // Periodic sync every 30s
    const interval = setInterval(() => { if (navigator.onLine) updateCount() }, 30000)
    return () => { mounted = false; window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(interval) }
  }, [])

  // Multi-device presence counter
  const [connectedDevices, setConnectedDevices] = useState(0)

  // Nav hamburger
  const [showNav, setShowNav] = useState(false)

  // Bluetooth printer
  const [btPrinter, setBtPrinter] = useState<string | null>(null)
  const [btConnecting, setBtConnecting] = useState(false)
  const hasBluetooth = typeof window !== 'undefined' && isBluetoothAvailable()
  const hasUsb = typeof window !== 'undefined' && isUsbAvailable()

  const handleConnectPrinter = async () => {
    // isBluetoothConnected() checks the 'default' slot — works for BT and USB
    if (isBluetoothConnected()) {
      await disconnectBluetoothPrinter()
      setBtPrinter(null)
      showToast('Impresora desconectada')
      return
    }
    setBtConnecting(true)
    try {
      const name = await connectBluetoothPrinter()
      setBtPrinter(name)
      showToast(`Impresora ${name} conectada`)
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : 'No se pudo conectar'}`)
    }
    setBtConnecting(false)
  }

  // Modo piloto: mute de comandas físicas (solo Wansoft imprime ese día).
  // Toggle protegido con PIN de gerente + evento de auditoría.
  const [comandasOff, setComandasOff] = useState(false)
  useEffect(() => { setComandasOff(comandasMuted()) }, [])

  // Pin prompt state (replaces window.prompt for kiosk/PWA compatibility)
  const [pinPrompt, setPinPrompt] = useState<{ title: string; onSubmit: (pin: string) => void } | null>(null)
  const [pinInput, setPinInput] = useState('')

  const handleToggleComandas = async () => {
    const next = !comandasOff
    setPinInput('')
    setPinPrompt({
      title: next ? 'PIN de gerente para APAGAR comandas (modo piloto):' : 'PIN de gerente para ENCENDER comandas:',
      onSubmit: async (pin: string) => {
        const manager = await verifyManagerPin(pin)
        if (!manager) { showToast('PIN inválido'); return }
        setComandasMuted(next)
        setComandasOff(next)
        logAudit({
          action: next ? 'comandas_print_off' : 'comandas_print_on',
          actor: manager || 'manager',
          details: { motivo: 'modo piloto', terminal: getDeviceId() },
        })
        showToast(next ? 'Comandas APAGADAS — solo KDS (modo piloto)' : 'Comandas encendidas')
        setPinPrompt(null)
      },
    })
  }

  const handleConnectUsbPrinter = async () => {
    if (isBluetoothConnected()) {
      await disconnectBluetoothPrinter()
      setBtPrinter(null)
      showToast('Impresora desconectada')
      return
    }
    setBtConnecting(true)
    try {
      const name = await connectUsbPrinter()
      setBtPrinter(name)
      showToast(`Impresora ${name} conectada (USB)`)
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : 'No se pudo conectar'}`)
    }
    setBtConnecting(false)
  }

  const handlePrintTicket = async (order: Order) => {
    // Bridge → Bluetooth → CSS (same priority as kitchen tickets)
    await printTicket(order)
  }

  // Person count verification before payment
  const [showPersonVerify, setShowPersonVerify] = useState(false)
  const [verifiedPersonas, setVerifiedPersonas] = useState(0)
  const [customPersonas, setCustomPersonas] = useState('')

  const handlePersonVerified = (count: number) => {
    setPersonas(count)
    setShowPersonVerify(false)
    setShowMixto(false)
    setMixtoPagos([])
    setMixtoMonto('')
    setShowCardConfirm(false)
    setShowPayment(true)
  }

  // Mercado Pago Point
  const [mpConfig, setMpConfig] = useState<MPConfig | null>(null)
  const [showMPConfig, setShowMPConfig] = useState(false)
  const [mpAccessToken, setMpAccessToken] = useState('')
  const [mpDeviceId, setMpDeviceId] = useState('')
  const [mpDevices, setMpDevices] = useState<MPDevice[]>([])
  const [mpLoadingDevices, setMpLoadingDevices] = useState(false)
  const [mpSending, setMpSending] = useState(false)
  const [mpStatus, setMpStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [mpError, setMpError] = useState('')

  useEffect(() => {
    setMpConfig(getMPConfig())
  }, [])

  // Menu search
  const [menuSearch, setMenuSearch] = useState('')
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)

  // Discount state
  const [showDiscount, setShowDiscount] = useState(false)
  const [discount, setDiscount] = useState(0)

  // Promos
  const [availablePromos, setAvailablePromos] = useState<AppliedPromo[]>([])
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null)
  const [allPromos, setAllPromos] = useState<Awaited<ReturnType<typeof getActivePromos>>>([])
  const categoryMapRef = useRef(new Map<string, string>())
  const [allCombos, setAllCombos] = useState<Combo[]>([])
  const [showComboModal, setShowComboModal] = useState(false)

  // Split de cuenta
  const [showSplit, setShowSplit] = useState(false)
  const [splitAssignments, setSplitAssignments] = useState<Record<string, number>>({}) // itemId → cuenta (1-6)
  const [splitPayingCuenta, setSplitPayingCuenta] = useState(0) // 0 = no split, 1-6 = which cuenta paying now
  const [splitCount, setSplitCount] = useState(0) // 0 = no split, 2-6 = number of cuentas
  const [splitMode, setSplitMode] = useState<'items' | 'parejo' | null>(null) // null = choosing, 'items' = assign items, 'parejo' = equal split
  const [splitParejoN, setSplitParejoN] = useState(0) // number of people for parejo split

  const CUENTA_COLORS = [
    '', // index 0 unused
    'bg-blue-600', // C1
    'bg-purple-600', // C2
    'bg-amber-600', // C3
    'bg-rose-600', // C4
    'bg-cyan-600', // C5
    'bg-lime-600', // C6
  ]
  const CUENTA_BG = [
    '',
    'bg-blue-900/30 border-blue-700',
    'bg-purple-900/30 border-purple-700',
    'bg-amber-900/30 border-amber-700',
    'bg-rose-900/30 border-rose-700',
    'bg-cyan-900/30 border-cyan-700',
    'bg-lime-900/30 border-lime-700',
  ]
  const CUENTA_TEXT = ['', 'text-blue-400', 'text-purple-400', 'text-amber-400', 'text-rose-400', 'text-cyan-400', 'text-lime-400']

  // Propina
  const [propina, setPropina] = useState(0)

  // Load active order for selected mesa
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null)
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const loadMesaOrder = async () => {
      try {
        // Cuenta por nombre: busca por customer_name; mesa: busca por número
        const filter = clienteNombre
          ? `customer_name=eq.${encodeURIComponent(clienteNombre)}`
          : `mesa=eq.${mesa}`
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&${filter}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (cancelled) return // mesa changed while fetching
        if (res.ok) {
          const rows = await res.json()
          if (rows.length > 0 && rows[0].id !== loadedOrderId) {
            const order = rows[0]
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
            setOrderItems(items.filter((i: OrderItem & { cancelled?: boolean }) => !i.cancelled))
            setOrderId(order.id)
            setMesero(order.mesero || MESEROS[0])
            setPersonas(order.personas || 2)
            setDiscount(order.descuento || 0)
            setLoadedOrderId(order.id)
            setLoadedUpdatedAt(order.updated_at || order.created_at || null)
          }
        }
      } catch { /* */ }
    }
    if (orderItems.length === 0) {
      setOrderId(generateId())
      setLoadedOrderId(null)
      setLoadedUpdatedAt(null)
      loadMesaOrder()
    }
    return () => { cancelled = true }
  }, [mesa, clienteNombre])

  // Order-level notes
  const [orderNotes, setOrderNotes] = useState('')

  // Cancel modal state
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null)

  // Void order modal state
  const [showVoidOrder, setShowVoidOrder] = useState(false)
  // Cash movement modal state (retiros / depositos)
  const [showCashMovement, setShowCashMovement] = useState(false)

  // Cancelled items (kept for audit — shown with strikethrough)
  const [cancelledItems, setCancelledItems] = useState<Set<string>>(new Set())
  // Voided items (error operativo — strikethrough + gray + ANULADO badge, no metrics)
  const [voidedItems, setVoidedItems] = useState<Set<string>>(new Set())

  // Order ID for audit trail (generated once per order)
  const [orderId, setOrderId] = useState(() => generateId())

  // Flash animation state
  const [flashItemId, setFlashItemId] = useState<string | null>(null)

  // Staff role from session
  const [staffRole, setStaffRole] = useState('cajero')
  const [staffName, setStaffName] = useState('')
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) {
        const s = JSON.parse(saved)
        setStaffRole(s.role || 'admin')
        setStaffName(s.name || '')
      }
    } catch { /* */ }
  }, [])

  // Mobile device detection — meseros en celular solo pueden tomar orden + enviar a cocina
  const isMobileDevice = typeof window !== 'undefined' && (window.innerWidth < 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))
  const isMobileRestricted = isMobileDevice && (staffRole === 'mesero' || staffRole === 'barra')
  // Mobile-restricted users cannot: cobrar, cancelar, descontar, corte, abrir cajón

  // Role permissions — granular system (50+ permissions per Wansoft parity)
  const _perms = (() => {
    try {
      // getPermissions imported at top level
      return getPermissions(staffRole)
    } catch { return null }
  })()
  const can = (perm: string) => _perms ? (_perms as unknown as Record<string, boolean>)[perm] ?? true : true

  // Section visibility (maps nav sections to granular permissions)
  const canSee = (section: string) => {
    const sectionMap: Record<string, string> = {
      mesas: 'abrir_cuentas_restaurante',
      cocina: 'registro_comanda',
      kds: 'registro_comanda',
      barra: 'registro_comanda',
      recetas: 'control_existencias_pos',
      compras: 'control_existencias_pos',
      inventario: 'control_existencias_pos',
      'auditoría': 'reportes',
      corte: 'corte_turno',
      qr: 'abrir_cuentas_restaurante',
      turno: 'corte_turno',
      historial: 'reportes',
      facturacion: 'cancelar_facturas',
      delivery: 'registro_comanda',
    }
    const perm = sectionMap[section]
    if (!perm) return staffRole === 'admin' || staffRole === 'gerente'
    return can(perm)
  }

  // Mobile view toggle
  const [mobileView, setMobileView] = useState<'menu' | 'order'>('menu')

  // Ready orders notification
  const [readyOrders, setReadyOrders] = useState(0)
  useEffect(() => {
    const checkReady = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&status=eq.lista&select=id&limit=50`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (res.ok) {
          const rows = await res.json()
          const count = rows.length
          if (count > readyOrders && readyOrders > 0) {
            // Play notification sound
            try {
              const ctx = new AudioContext()
              const osc = ctx.createOscillator()
              const gain = ctx.createGain()
              osc.connect(gain); gain.connect(ctx.destination)
              osc.frequency.value = 523; osc.type = 'sine'; gain.gain.value = 0.2
              osc.start(); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
              osc.stop(ctx.currentTime + 0.3)
              setTimeout(() => {
                const o2 = ctx.createOscillator(); const g2 = ctx.createGain()
                o2.connect(g2); g2.connect(ctx.destination)
                o2.frequency.value = 659; o2.type = 'sine'; g2.gain.value = 0.2
                o2.start(); g2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
                o2.stop(ctx.currentTime + 0.3)
              }, 150)
            } catch { /* */ }
          }
          setReadyOrders(count)
        }
      } catch { /* */ }
    }
    checkReady()
    const interval = setInterval(checkReady, 5000)
    return () => clearInterval(interval)
  }, [readyOrders])

  // Toast state
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    const update = () => {
      setClock(
        new Date().toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
        })
      )
    }
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  const activeCategory =
    menuCategories.find((c) => c.id === selectedCategory) || menuCategories[0] || { id: '', name: '', items: [] }

  // Open modifier modal for a new item
  const handleMenuItemTap = useCallback((item: MenuItem, catId?: string) => {
    setEditingOrderItem(null)
    setModifierItem(item)
    // Find category for this item
    if (catId) {
      setModifierCategoryId(catId)
    } else {
      const cat = menuCategories.find(c => c.items.some(i => i.id === item.id))
      setModifierCategoryId(cat?.id ?? '')
    }
  }, [])

  // Open modifier modal to edit an existing order item
  const handleEditOrderItem = useCallback((orderItem: OrderItem) => {
    // Find the menu item to get the base info
    let menuItem: MenuItem | null = null
    for (const cat of menuCategories) {
      const found = cat.items.find(i => i.id === orderItem.menuItemId)
      if (found) { menuItem = found; setModifierCategoryId(cat.id); break }
    }
    if (menuItem) {
      setEditingOrderItem(orderItem)
      setModifierItem(menuItem)
    }
  }, [])

  // Handle barcode scan — look up product by barcode in menu
  const handleBarcodeScan = useCallback((code: string) => {
    setShowBarcodeScanner(false)
    let found = false
    for (const cat of menuCategories) {
      const item = cat.items.find(i =>
        (i as MenuItem & { barcode?: string }).barcode === code
      )
      if (item && item.price > 0) {
        handleMenuItemTap(item, cat.id)
        found = true
        break
      }
    }
    if (!found) {
      setMenuSearch(code)
      showToast(`Código: ${code} — busca el producto`)
    }
  }, [handleMenuItemTap])

  // Confirm from modifier modal (add or update)
  const handleModifierConfirm = useCallback((orderItem: OrderItem) => {
    setOrderItems(prev => {
      const existingIndex = prev.findIndex(oi => oi.id === orderItem.id)
      // Estación de ruteo: se fija al agregar (categoría real de BD); al editar se preserva
      const station = existingIndex >= 0
        ? prev[existingIndex].station ?? getStationForItem(modifierCategoryId, orderItem.nombre)
        : getStationForItem(modifierCategoryId, orderItem.nombre)
      if (existingIndex >= 0) {
        const old = prev[existingIndex]
        logAudit({
          order_id: orderId, action: 'item_modified', actor: mesero, mesa,
          details: {
            item: orderItem.nombre,
            from: { cantidad: old.cantidad, modificadores: old.modificadores, notas: old.notas },
            to: { cantidad: orderItem.cantidad, modificadores: orderItem.modificadores, notas: orderItem.notas },
          },
        })
        const next = [...prev]
        next[existingIndex] = { ...orderItem, station }
        return next
      }
      logAudit({
        order_id: orderId, action: 'item_added', actor: mesero, mesa,
        details: { item: orderItem.nombre, cantidad: orderItem.cantidad, precio: orderItem.precio, modificadores: orderItem.modificadores, silla: orderItem.silla ?? sillaActual },
      })
      // Shadow mode (Fullsite OS): evento append-only en paralelo, fire-and-forget
      publishEvent('orders.item.added.v1', 1, { userId: mesero, deviceId: getDeviceId() }, {
        ticketId: orderId, itemId: orderItem.id, productId: orderItem.nombre,
        qty: orderItem.cantidad, precio: orderItem.precio, mesa, clientId: getClientId(),
      })
      // Silla activa (estilo Wansoft CANT/SILLA): nuevos items se asignan a la silla seleccionada
      // courseId: items go into the current (last) course group
      const currentCourse = prev.filter(isTiempoItem).length + 1
      return [...prev, { ...orderItem, silla: orderItem.silla ?? (sillaActual || 1), station, courseId: currentCourse, courseStatus: 'pending' as const }]
    })
    setFlashItemId(orderItem.id)
    setTimeout(() => setFlashItemId(null), 500)
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [orderId, mesero, mesa, sillaActual, modifierCategoryId])

  const handleModifierCancel = useCallback(() => {
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [])

  // Cancel item (requires reason + manager PIN — NEVER delete)
  const handleCancelItem = useCallback((reason: string, managerName: string, options: { prepared: boolean; voided: boolean }) => {
    if (!cancellingItem) return
    const { prepared, voided } = options
    const action = voided ? 'item_voided' as const : 'item_cancelled' as const
    logAudit({
      order_id: orderId, action, actor: mesero, mesa,
      details: { item: cancellingItem.nombre, cantidad: cancellingItem.cantidad, precio: cancellingItem.subtotal, prepared, voided },
      reason,
      approved_by: managerName,
    })
    // Shadow mode: evento SENSIBLE — la BD lo rechaza sin audit.approvedBy
    publishEvent(voided ? 'orders.item.voided.v1' : 'orders.item.cancelled.v1', 1, { userId: mesero, deviceId: getDeviceId() }, {
      ticketId: orderId, itemId: cancellingItem.id, productId: cancellingItem.nombre,
      qty: cancellingItem.cantidad, inventoryImpact: !voided, mesa, clientId: getClientId(),
    }, {
      requestedBy: mesero, approvedBy: managerName, reason,
      before: { qty: cancellingItem.cantidad, subtotal: cancellingItem.subtotal, prepared, voided },
      after: { qty: 0, cancelled: !voided, voided },
    })
    // Reverse inventory deduction for cancelled items (not voided — voided means never made)
    if (!voided && prepared) {
      reverseIngredientDeduction(cancellingItem, orderId, managerName, reason)
        .catch(() => { /* inventory reversal failed but cancellation proceeds */ })
    }
    if (voided) {
      // Voided = never made, but ingredients were deducted at send-to-kitchen — reverse them
      reverseIngredientDeduction(cancellingItem, orderId, managerName, reason)
        .catch(() => { /* inventory reversal failed but void proceeds */ })
      setVoidedItems(prev => new Set(prev).add(cancellingItem.id))
    } else {
      setCancelledItems(prev => new Set(prev).add(cancellingItem.id))
    }
    setCancellingItem(null)
    if (voided) {
      showToast(`${cancellingItem.nombre} ANULADO — aprobado por ${managerName}`)
    } else if (prepared) {
      showToast(`${cancellingItem.nombre} cancelado — registrado como merma`)
    } else {
      showToast(`${cancellingItem.nombre} cancelado — aprobado por ${managerName}`)
    }
  }, [cancellingItem, orderId, mesero, mesa])

  // Void entire order
  const handleVoidOrder = useCallback(async (reason: string, managerName: string) => {
    const voidTotal = orderItems.reduce((sum, i) => sum + i.subtotal, 0)
    logAudit({
      order_id: orderId, action: 'order_cancelled', actor: mesero, mesa,
      details: { items: orderItems.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, subtotal: i.subtotal })), total: voidTotal },
      reason,
      approved_by: managerName,
    })
    // Shadow mode: anulación = un evento sensible por cada línea de la orden
    for (const i of orderItems) {
      publishEvent('orders.item.cancelled.v1', 1, { userId: mesero, deviceId: getDeviceId() }, {
        ticketId: orderId, itemId: i.id, productId: i.nombre,
        qty: i.cantidad, inventoryImpact: true, mesa, clientId: getClientId(), voidOrder: true,
      }, {
        requestedBy: mesero, approvedBy: managerName, reason: `ANULACIÓN ORDEN: ${reason}`,
        before: { qty: i.cantidad, subtotal: i.subtotal },
        after: { qty: 0, cancelled: true },
      })
    }
    // Mark order as cancelled in database (if it was already saved)
    if (loadedOrderId) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}`, {
          method: 'PATCH',
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'cancelada', notas: `ANULADA: ${reason} (por ${managerName})` }),
        })
      } catch { /* offline - will be caught by sync */ }
    }
    setOrderItems([])
    setCancelledItems(new Set())
    setVoidedItems(new Set())
    setDiscount(0)
    setOrderNotes('')
    setShowVoidOrder(false)
    showToast(`Orden anulada — aprobado por ${managerName}`)
  }, [orderId, mesero, mesa, orderItems, loadedOrderId])

  // Cash movement confirmed (already saved to Supabase in modal)
  const handleCashMovement = useCallback((type: 'retiro' | 'deposito', amount: number, reason: string, managerName: string) => {
    const action = type === 'retiro' ? 'cash_retiro' as const : 'cash_deposito' as const
    logAudit({
      order_id: undefined, action, actor: mesero, mesa,
      details: { type, amount, reason, turno_id: turnoId },
      reason,
      approved_by: managerName,
    })
    setShowCashMovement(false)
    showToast(`${type === 'retiro' ? 'Retiro' : 'Deposito'} de ${formatMXN(amount)} registrado`)
  }, [mesero, mesa, turnoId])

  const updateQuantity = useCallback((id: string, delta: number) => {
    setOrderItems((prev) => {
      const item = prev.find(oi => oi.id === id)
      if (item) {
        const newQty = Math.max(1, item.cantidad + delta)
        logAudit({
          order_id: orderId, action: 'quantity_changed', actor: mesero, mesa,
          details: { item: item.nombre, from: item.cantidad, to: newQty },
        })
      }
      return prev.map((oi) =>
        oi.id === id
          ? {
              ...oi,
              cantidad: Math.max(1, oi.cantidad + delta),
              subtotal: (oi.precio + oi.precioExtra) * Math.max(1, oi.cantidad + delta),
            }
          : oi
      )
    })
  }, [orderId, mesero, mesa])

  // Cambiar silla de un item (tap en el badge — cicla 1..personas, estilo Wansoft "Cambiar # de silla")
  const cycleSilla = useCallback((id: string) => {
    setOrderItems(prev => prev.map(oi => {
      if (oi.id !== id || isTiempoItem(oi)) return oi
      const next = ((oi.silla || 1) % Math.max(personas, 1)) + 1
      logAudit({ order_id: orderId, action: 'item_modified', actor: mesero, mesa, details: { item: oi.nombre, silla_from: oi.silla || 1, silla_to: next } })
      return { ...oi, silla: next }
    }))
  }, [personas, orderId, mesero, mesa])

  // Derive courseId for all items based on tiempo separator positions
  const assignCourseIds = useCallback((items: OrderItem[]): OrderItem[] => {
    let course = 1
    return items.map(it => {
      if (isTiempoItem(it)) { course++; return it }
      return { ...it, courseId: course, courseStatus: it.courseStatus || 'pending' }
    })
  }, [])

  // Insertar separador de tiempo (estilo Wansoft "XX TIEMPO: N XX" — partida especial $0.00, silla 0)
  const addTiempoSeparator = useCallback(() => {
    setOrderItems(prev => {
      const n = prev.filter(isTiempoItem).length + 1
      const sep: OrderItem = {
        id: generateId(), menuItemId: TIEMPO_ITEM_ID, nombre: `XX TIEMPO: ${n} XX`,
        precio: 0, cantidad: 1, modificadores: [], notas: '', precioExtra: 0, subtotal: 0, silla: 0,
      }
      logAudit({ order_id: orderId, action: 'item_added', actor: mesero, mesa, details: { item: sep.nombre, tiempo: n } })
      return assignCourseIds([...prev, sep])
    })
  }, [orderId, mesero, mesa, assignCourseIds])

  const removeTiempoSeparator = useCallback((id: string) => {
    setOrderItems(prev => {
      // Re-numera los separadores restantes
      const rest = prev.filter(i => i.id !== id)
      let n = 0
      return rest.map(i => isTiempoItem(i) ? { ...i, nombre: `XX TIEMPO: ${++n} XX` } : i)
    })
  }, [])

  const activeItems = (orderItems || []).filter(i => !cancelledItems.has(i.id) && !voidedItems.has(i.id))
  const subtotal = activeItems.reduce((sum, item) => sum + (item.subtotal || 0), 0)

  // Re-evaluate promos when items/subtotal change
  useEffect(() => {
    if (!allPromos || allPromos.length === 0 || activeItems.length === 0) {
      setAvailablePromos([])
      return
    }
    const results = evaluatePromos(allPromos, activeItems, subtotal, categoryMapRef.current)
    setAvailablePromos(results)
    // Auto-apply the best auto_apply promo if no manual discount
    if (discount === 0 && !appliedPromo) {
      const auto = results.find(r => r.promo.auto_apply)
      if (auto) {
        setAppliedPromo(auto)
        setDiscount(auto.discount)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItems.length, subtotal, allPromos.length])

  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const iva = subtotalAfterDiscount * IVA_RATE
  const total = subtotalAfterDiscount + iva

  const handleSendToKitchen = async () => {
    if (activeItems.length === 0 || saving) return
    setSaving(true)

    // Multi-user conflict check: if we loaded an existing order, verify it hasn't been modified since
    if (loadedOrderId && loadedUpdatedAt) {
      try {
        const checkRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}&select=updated_at,created_at&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (checkRes.ok) {
          const rows = await checkRes.json()
          if (rows.length > 0) {
            const currentUpdatedAt = rows[0].updated_at || rows[0].created_at
            if (currentUpdatedAt && currentUpdatedAt !== loadedUpdatedAt) {
              showToast('Esta orden fue modificada por otro usuario')
            }
          }
        }
      } catch { /* proceed anyway */ }
    }

    const order: Order = {
      id: orderId,
      mesa,
      clienteNombre: clienteNombre || undefined,
      mesero,
      personas,
      status: 'enviada',
      items: activeItems,
      subtotal,
      iva,
      total,
      descuento: discount,
      turnoId: turnoId || undefined,
      notas: orderNotes || undefined,
      createdAt: new Date(),
    }
    const ok = await saveOrder(order)
    if (ok) {
      logAudit({
        order_id: orderId, action: 'order_sent_kitchen', actor: mesero, mesa,
        details: { items_count: activeItems.length, total },
      })

      showToast('Orden enviada a cocina')

      // Auto-deduct ingredients from inventory (fire-and-forget, don't block UI)
      deductIngredientsForOrder(activeItems, orderId, mesero).then(result => {
        if (result.alerts.length > 0) {
          showToast(`${result.alerts.length} alertas de inventario`)
        }
      }).catch(() => {})
      // Print per-station tickets (splits order by cocina/barra/caja)
      printByStation(order)

      setLoadedOrderId(orderId)
      setLoadedUpdatedAt(new Date().toISOString())
      setSentToKitchen(true)
      setTimeout(() => setSentToKitchen(false), 2000)
    } else {
      showToast('Error al guardar orden')
    }
    setSaving(false)
  }

  // Pre-ticket (precuenta — antes de cobrar)
  const handlePreTicket = async () => {
    if (activeItems.length === 0) return
    const order: Order = {
      id: orderId,
      mesa,
      clienteNombre: clienteNombre || undefined,
      mesero,
      personas,
      status: 'enviada',
      items: activeItems,
      subtotal,
      iva,
      total,
      descuento: discount,
      notas: orderNotes || undefined,
      createdAt: new Date(),
    }
    await printPreTicket(order)
    logAudit({ order_id: orderId, action: 'preticket_printed', actor: mesero, mesa, details: { total, personas, items: activeItems.length } })
    showToast('Pre-cuenta impresa')
  }

  const handleCloseOrder = () => {
    if (orderItems.length === 0) return
    setVerifiedPersonas(personas)
    setCustomPersonas('')
    setShowPersonVerify(true)
  }

  const handlePayment = async (method: string) => {
    setSaving(true)

    // Determine which items to pay based on split state
    let payingItems = activeItems
    let paySubtotal: number
    let payDiscount: number
    let payTotal: number

    if (splitMode === 'parejo' && splitPayingCuenta > 0) {
      // Parejo: equal split — each person pays total / N.
      // Centavos: cuentas 1..N-1 pagan round(total/N); la última paga el remanente exacto.
      const r = calcSplitParejo(activeItems, discount, splitParejoN, splitPayingCuenta)
      paySubtotal = r.subtotal
      payDiscount = r.discount
      payTotal = r.total
    } else if (splitPayingCuenta > 0) {
      // Split por items: el descuento global se prorratea según la parte del subtotal
      const r = calcSplitItems(activeItems, splitAssignments, splitPayingCuenta, discount)
      payingItems = r.payingItems as typeof activeItems
      paySubtotal = r.subtotal
      payDiscount = r.discount
      payTotal = r.total
    } else {
      paySubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
      payDiscount = discount
      const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
      payTotal = paySubtotalAfterDiscount + paySubtotalAfterDiscount * IVA_RATE
    }
    const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
    const payIva = paySubtotalAfterDiscount * IVA_RATE
    const payId = splitPayingCuenta > 0 ? `${orderId}-C${splitPayingCuenta}` : orderId

    // Desglose de pagos (multi-forma estilo Wansoft). Pago simple → 1 elemento.
    const pagos: PagoForma[] = method === 'Mixto' && mixtoPagos.length > 0
      ? mixtoPagos
      : [{ metodo: method, monto: payTotal + propina }]
    const metodoLabel = method === 'Mixto'
      ? mixtoPagos.map(p => `${p.metodo} ${formatMXN(p.monto)}`).join(' + ')
      : method

    const order: Order = {
      id: payId,
      mesa,
      clienteNombre: clienteNombre || undefined,
      mesero,
      personas: splitPayingCuenta > 0 ? Math.ceil(personas / (splitMode === 'parejo' ? splitParejoN : splitCount)) : personas,
      status: 'cerrada',
      items: payingItems,
      subtotal: paySubtotal,
      iva: payIva,
      total: payTotal,
      descuento: payDiscount,
      // Cada cuenta del split es su propia orden en BD — registra la propina capturada en ESTA cuenta
      propina: propina > 0 ? propina : undefined,
      metodoPago: metodoLabel,
      pagos,
      turnoId: turnoId || undefined,
      notas: splitPayingCuenta > 0
        ? `Cuenta ${splitPayingCuenta} de ${splitMode === 'parejo' ? splitParejoN : splitCount} (${splitMode === 'parejo' ? 'parejo' : 'split'})`
        : (orderNotes || undefined),
      createdAt: new Date(),
      closedAt: new Date(),
    }
    const ok = await saveOrder(order)
    if (ok) {
      // Open cash drawer for cash payments (incluye mixto con componente efectivo)
      if (pagos.some(p => p.metodo.toLowerCase().includes('efectivo'))) {
        openCashDrawer()
      }

      logAudit({
        order_id: payId, action: 'payment_processed', actor: mesero, mesa,
        details: { method: metodoLabel, pagos, total: payTotal, cuenta: splitPayingCuenta || 'full', propina, cashReceived: method === 'Efectivo' ? cashAmount : undefined },
      })
      // Market: descuenta stock al COBRAR (retail 1:1, items mkt-*).
      // Split parejo: todas las cuentas repiten los mismos items → solo cuenta 1 descuenta.
      // Split por items: cada cuenta descuenta lo suyo (sin dobles).
      const shouldDeductMarket = splitPayingCuenta === 0 || splitMode !== 'parejo' || splitPayingCuenta === 1
      if (shouldDeductMarket) {
        const mkt = await deductMarketStockForOrder(payingItems, payId, mesero)
        if (mkt.deductions.length > 0) {
          logAudit({
            order_id: payId, action: 'payment_processed', actor: 'Sistema',
            details: { market_deductions: mkt.deductions, market_alerts: mkt.alerts },
          })
        }
        if (mkt.alerts.length > 0) {
          showToast(`Stock Market bajo: ${mkt.alerts[0]}${mkt.alerts.length > 1 ? ` (+${mkt.alerts.length - 1})` : ''}`)
        }
      }

      // Shadow mode (Fullsite OS): pago capturado, fire-and-forget
      publishEvent('payments.payment.captured.v1', 1, { userId: mesero, deviceId: getDeviceId() }, {
        ticketId: payId, total: payTotal, subtotal: paySubtotal, iva: payIva,
        descuento: payDiscount, propina, metodo: metodoLabel, pagos,
        cuenta: splitPayingCuenta || 'full', mesa, clientId: getClientId(),
        turnoId: turnoId || null,
      })

      // Print ticket for THIS cuenta
      handlePrintTicket(order)

      // If split and more cuentas remaining, advance to next
      const totalCuentas = splitMode === 'parejo' ? splitParejoN : splitCount
      if (splitPayingCuenta > 0 && splitPayingCuenta < totalCuentas) {
        showToast(`Cuenta ${splitPayingCuenta} de ${totalCuentas} cobrada (${method}) — ahora cobra Cuenta ${splitPayingCuenta + 1}`)
        setSplitPayingCuenta(splitPayingCuenta + 1)
        setPropina(0)
        setShowCashFlow(false)
        setCashAmount('')
        setSaving(false)
        return // Don't reset order yet
      }

      // Fully done (no split, or last cuenta paid)
      showToast(`Todas las cuentas cobradas — ${method}${propina > 0 ? ` + propina ${formatMXN(propina)}` : ''}`)
    } else {
      showToast('Error al cerrar cuenta')
    }
    setSaving(false)
    setOrderItems([])
    setCancelledItems(new Set())
    setDiscount(0)
    setPropina(0)
    setOrderNotes('')
    setShowPayment(false)
    setShowCashFlow(false)
    setCashAmount('')
    setShowMixto(false)
    setMixtoPagos([])
    setMixtoMonto('')
    setSillaActual(1)
    setTiempoFired(0)
    setSplitPayingCuenta(0)
    setSplitAssignments({})
    setSplitCount(0)
    setSplitMode(null)
    setSplitParejoN(0)
  }

  const handleApplyDiscount = (amount: number, reason: string | undefined, approvedBy: string) => {
    logAudit({
      order_id: orderId, action: 'discount_applied', actor: mesero, mesa,
      details: { amount, subtotal, reason: reason || 'Sin motivo' },
      approved_by: approvedBy,
    })
    // Shadow mode: evento SENSIBLE — el modal ya exige PIN de gerente,
    // approvedBy es el gerente que lo autorizó.
    publishEvent('orders.discount.applied.v1', 1, { userId: mesero, deviceId: getDeviceId() }, {
      ticketId: orderId, amount, mesa, clientId: getClientId(),
    }, {
      requestedBy: mesero, approvedBy, reason: reason || 'Sin motivo',
      before: { subtotal, descuento: 0 },
      after: { subtotal: subtotal - amount, descuento: amount },
    })
    setDiscount(amount)
    setShowDiscount(false)
  }

  return (
    <div className="pos-kiosk h-dvh flex flex-col text-white overflow-hidden select-none" style={{'--bg':'#000000','--surface':'#0a0a0c','--surface-2':'#0f1014','--panel':'#0b0b0e','--line':'#1c1d22','--line-soft':'#141519','--text-1':'#f5f5f7','--text-2':'#c4c4cc','--text-3':'#87878f','--text-4':'#555560','--accent':'#10b981','--accent-bright':'#34d399','--accent-deep':'#059669','--accent-soft':'rgba(16,185,129,0.12)','--accent-line':'rgba(16,185,129,0.28)',background:'#0a0a0f',color:'#fff',colorScheme:'dark'} as React.CSSProperties}>
      {/* Top Bar */}
      <header className="pos-safe-top flex flex-col bg-[var(--surface-2)] border-b border-[var(--line)] flex-shrink-0">
        {/* Row 1: Logo + Hamburger + Ready badge + Staff + Clock */}
        <div className="flex items-center justify-between px-3 py-0.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNav(!showNav)} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] active:bg-[var(--surface-2)]0 flex items-center justify-center transition-colors">
              {showNav ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="text-white font-black text-base tracking-tight">
              fullsite
              <span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
            </span>
          </div>
          <div className="flex items-center gap-3 text-[var(--text-3)] flex-shrink-0 ml-2">
            <OfflineIndicator
              isOnline={online}
              pendingCount={pendingSync}
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
              connectedDevices={connectedDevices}
              onSync={async () => {
                const { syncAll } = await import('@/lib/pos-offline-db')
                setIsSyncing(true)
                try { await syncAll(); setLastSyncTime(new Date().toISOString()) } catch {}
                setIsSyncing(false)
              }}
            />
            {readyOrders > 0 && (
              <Link href="/pos/cocina" className="flex items-center gap-1 bg-emerald-600 text-white px-2 py-1 rounded-full text-xs font-bold animate-pulse">
                {readyOrders} listas
              </Link>
            )}
            <button
              onClick={handleToggleComandas}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold min-h-[44px] ${
                comandasOff ? 'bg-amber-600 text-white animate-pulse' : 'bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]'
              }`}
              title={comandasOff ? 'Comandas APAGADAS (modo piloto) — toca para encender' : 'Comandas encendidas — toca para apagar (modo piloto)'}
            >
              <ChefHat size={16} />
              {comandasOff ? 'Comandas OFF' : 'Comandas'}
            </button>
            {/* BT/USB buttons only on mobile (tablets/phones) — terminal uses bridge */}
            {hasBluetooth && isMobileDevice && (
              <button
                onClick={handleConnectPrinter}
                disabled={btConnecting}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold min-h-[44px] ${
                  btPrinter ? 'bg-blue-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]'
                }`}
              >
                <Bluetooth size={16} />
                {btConnecting ? '...' : btPrinter ? btPrinter.slice(0, 8) : 'Printer'}
              </button>
            )}
            {hasUsb && !btPrinter && isMobileDevice && (
              <button
                onClick={handleConnectUsbPrinter}
                disabled={btConnecting}
                className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold min-h-[44px] bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]"
                title="Impresora térmica USB"
              >
                <Usb size={16} />
                {btConnecting ? '...' : 'USB'}
              </button>
            )}
            <button
              onClick={() => {
                const cfg = getMPConfig()
                if (cfg) { setMpAccessToken(cfg.accessToken); setMpDeviceId(cfg.deviceId) }
                setShowMPConfig(true)
              }}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold min-h-[44px] ${
                mpConfig ? 'bg-cyan-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]'
              }`}
              title="Mercado Pago Point"
            >
              <Smartphone size={16} />
              {mpConfig ? 'Point' : 'MP'}
            </button>
            {staffName && <span className="text-xs text-emerald-400">{staffName}</span>}
            {isMobileRestricted && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Solo ordenes</span>}
            <div className="flex items-center gap-1">
              <Clock size={14} />
              <span className="text-xs font-mono">{clock}</span>
            </div>
            <button
              onClick={() => {
                // Bloquear: regresa a la pantalla de PIN sin perder la orden en BD
                try {
                  sessionStorage.removeItem('pos_staff')
                  sessionStorage.removeItem('pos_last_activity')
                } catch { /* */ }
                window.location.reload()
              }}
              title="Bloquear pantalla"
              className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-red-900/40 flex items-center justify-center transition-colors"
            >
              <Lock size={18} />
            </button>
          </div>
        </div>
        {/* Row 2: Selectors (compact for tablet) */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-[var(--line)]/50 overflow-x-auto">
          <div className="flex items-center gap-1 bg-[var(--line)] rounded-lg px-3 py-0.5 border border-slate-600 min-h-[40px]">
            <span className="text-white text-sm font-medium">Mesa</span>
            <input
              type="number"
              disabled={!!clienteNombre}
              value={mesa}
              onChange={(e) => {
                const newMesa = Number(e.target.value) || 1
                if (orderItems.length > 0 && newMesa !== mesa) {
                  logAudit({ order_id: orderId, action: 'status_changed', actor: mesero, mesa, details: { type: 'mesa_moved', from: mesa, to: newMesa } })
                  showToast(`Mesa ${mesa} → Mesa ${newMesa}`)
                }
                setMesa(newMesa)
              }}
              min={1} max={999}
              className="w-14 bg-transparent text-white text-base font-bold text-center border-none outline-none"
            />
          </div>
          <div className="flex items-center gap-1 bg-[var(--line)] rounded-lg px-3 py-1 border border-slate-600 min-h-[48px]">
            <span className="text-teal-400 text-sm font-medium">#</span>
            <input
              type="text"
              value={clienteNombre}
              onChange={(e) => {
                const name = e.target.value.toUpperCase()
                setClienteNombre(name)
                if (name && mesa !== 0) setMesa(0)
                if (!name && mesa === 0) setMesa(1)
              }}
              placeholder="Cliente"
              maxLength={30}
              className="w-28 bg-transparent text-teal-300 text-base font-bold border-none outline-none placeholder:text-[var(--text-4)] placeholder:font-normal"
            />
          </div>
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-[var(--line)] text-white rounded-lg px-3 py-2 text-base font-medium border border-slate-600 min-h-[48px]">
            {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}p</option>))}
          </select>
          <select value={mesero} onChange={(e) => { setMesero(e.target.value); try { localStorage.setItem('pos_mesero', e.target.value) } catch {} }} className="bg-[var(--line)] text-white rounded-lg px-3 py-2 text-base font-medium border border-slate-600 min-h-[48px] flex-1 min-w-0">
            {MESEROS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>
        {/* Row 3: Mobile tab toggle (only visible on mobile) */}
        <div className="flex md:hidden border-t border-[var(--line)]/50">
          <button
            onClick={() => setMobileView('menu')}
            className={`flex-1 py-3 min-h-[52px] text-base font-semibold text-center transition-colors ${mobileView === 'menu' ? 'bg-emerald-600 text-white' : 'text-[var(--text-3)]'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setMobileView('order')}
            className={`flex-1 py-3 min-h-[52px] text-base font-semibold text-center transition-colors relative ${mobileView === 'order' ? 'bg-blue-600 text-white' : 'text-[var(--text-3)]'}`}
          >
            Orden {activeItems.length > 0 && <span className="ml-1 bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeItems.length}</span>}
          </button>
        </div>
      </header>

      {/* Main Content */}
      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-64 bg-[var(--surface-2)] border-r border-[var(--line)] p-4 shadow-2xl overflow-y-auto max-h-[100dvh]" onClick={e => e.stopPropagation()}>
            <p className="text-[var(--text-2)] text-xs font-semibold uppercase mb-2">Navegacion</p>
            <div className="space-y-1">
              {[
                { href: '/pos/mesas', icon: Grid3X3, label: 'Mesas', section: 'mesas' },
                { href: '/pos/cocina', icon: ChefHat, label: 'Cocina', section: 'cocina' },
                { href: '/pos/kds', icon: Monitor, label: 'KDS Tablet', section: 'kds' },
                { href: '/pos/barra', icon: Wine, label: 'Barra', section: 'barra' },
                { href: '/pos/delivery', icon: Bike, label: 'Domicilio', section: 'delivery' },
                { href: '/pos/recetas', icon: BookOpen, label: 'Recetas', section: 'recetas' },
                { href: '/pos/food-cost', icon: DollarSign, label: 'Food Cost', section: 'recetas' },
                { href: '/pos/compras', icon: ShoppingCart, label: 'Compras', section: 'compras' },
                { href: '/pos/inventario', icon: Package, label: 'Inventario', section: 'inventario' },
                { href: '/pos/inventario-market', icon: Package, label: 'Inventario Market', section: 'inventario' },
                { href: '/pos/auditoría', icon: FileText, label: 'Auditoria', section: 'auditoría' },
                { href: '/pos/corte', icon: Receipt, label: 'Corte de caja', section: 'corte' },
                { href: '/pos/qr', icon: QrCode, label: 'QR Mesas', section: 'qr' },
                { href: '/pos/turno', icon: Clock, label: 'Turno', section: 'turno' },
                { href: '/pos/facturacion', icon: Stamp, label: 'Facturacion', section: 'facturacion' },
                { href: '/pos/recepcion-factura', icon: FileText, label: 'Recepcion XML', section: 'facturacion' },
                { href: '/pos/facturas-proveedor', icon: FileText, label: 'Facturas Proveedor', section: 'facturacion' },
                { href: '/pos/asistencia', icon: Clock, label: 'Checador', section: 'configuracion' },
                { href: '/pos/staff-analytics', icon: Users, label: 'Rutina Meseros', section: 'configuracion' },
                { href: '/pos/monitor', icon: Monitor, label: 'Monitor', section: 'configuracion' },
                { href: '/pos/historial', icon: FileText, label: 'Historial', section: 'historial' },
                { href: '/pos/huella', icon: Lock, label: 'Huellas', section: 'configuracion' },
                { href: '/pos/configuracion', icon: Settings, label: 'Configuracion', section: 'configuracion' },
              ].filter(item => canSee(item.section)).map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowNav(false)}
                  className="flex items-center gap-3 px-4 py-1.5 rounded-xl text-[var(--text-4)] hover:bg-[var(--line)] hover:text-white active:bg-emerald-500/10 transition-colors min-h-[40px]"
                >
                  <item.icon size={18} />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              ))}
            </div>

            {/* Leaderboard + Kitchen Timer in nav */}
            <div className="mt-4 pt-4 border-t border-[var(--line)] space-y-3">
              <MeseroLeaderboard currentMesero={mesero} compact />
              <KitchenTimer />
            </div>
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel -- Current Order (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[45%] md:flex flex-col border-r border-[var(--line)] bg-[var(--surface)] ${mobileView === 'order' ? 'flex w-full' : 'hidden'}`}>
          {/* Order header — compact */}
          <div className="px-3 py-1 border-b border-[var(--line)] bg-[var(--surface-2)]/50 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-1">
                Mesa
                <input
                  type="number"
                  value={mesa}
                  onChange={e => setMesa(Number(e.target.value) || 1)}
                  min={1}
                  max={999}
                  className="w-14 text-center bg-transparent border border-[var(--line)] rounded-lg text-white font-bold text-base mx-1 py-0.5 focus:border-emerald-500 focus:outline-none"
                />
                <span className="text-[var(--text-3)] font-normal text-xs">{personas}p · {mesero.split(' ')[0]}</span>
              </h2>
              <span className="text-emerald-400 font-bold text-lg">{formatMXN(total)}</span>
            </div>
          </div>

          {/* Order items list — MAIN AREA, takes all available space */}
          <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            {orderItems.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-[var(--text-2)]">
                <p className="text-sm">Toca un producto para agregar</p>
              </div>
            ) : (
              <div className="space-y-px">
                {/* Group items by seat when personas > 1 */}
                {(() => {
                  // Build seat groups
                  const seatGroups: Map<number, typeof orderItems> = new Map()
                  const tiempoItems: typeof orderItems = []
                  for (const item of orderItems) {
                    if (isTiempoItem(item)) {
                      tiempoItems.push(item)
                      continue
                    }
                    const seat = item.silla || 1
                    if (!seatGroups.has(seat)) seatGroups.set(seat, [])
                    seatGroups.get(seat)!.push(item)
                  }
                  const seats = Array.from(seatGroups.keys()).sort((a, b) => a - b)
                  const showSeatHeaders = personas > 1

                  // Render tiempo separators first
                  const tiempoElements = tiempoItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 py-1 px-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <Flame size={13} className="text-amber-400 flex-shrink-0" />
                      <p className="flex-1 text-amber-400 font-bold text-xs tracking-widest text-center">{item.nombre}</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTiempoSeparator(item.id) }}
                        className="w-11 h-11 rounded-md bg-amber-500/10 hover:bg-amber-500/25 text-amber-400 flex items-center justify-center transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))

                  return (
                    <>
                      {tiempoElements}
                      {seats.map(seat => {
                        const seatItems = seatGroups.get(seat)!
                        const seatActive = seatItems.filter(i => !cancelledItems.has(i.id) && !voidedItems.has(i.id))
                        const seatTotal = seatActive.reduce((s, i) => s + i.subtotal, 0)
                        return (
                          <div key={`seat-${seat}`}>
                            {showSeatHeaders && (
                              <button
                                onClick={() => setSillaActual(seat)}
                                className={`w-full flex items-center gap-2 px-2 py-1 mt-1 rounded-lg transition-colors ${
                                  sillaActual === seat ? 'bg-sky-500/15 border border-sky-500/30' : 'bg-[var(--surface-2)]/40'
                                }`}
                              >
                                <Armchair size={14} className="text-sky-400" />
                                <span className="text-sky-400 text-xs font-bold">Asiento {seat}</span>
                                <span className="text-[var(--text-3)] text-xs ml-auto">{formatMXN(seatTotal)}</span>
                              </button>
                            )}
                            {seatItems.map(item => {
                  const isCancelled = cancelledItems.has(item.id)
                  const isVoided = voidedItems.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 py-1 px-2 rounded-lg transition-all ${
                        isVoided
                          ? 'bg-slate-500/10 border border-slate-500/20 opacity-40'
                          : isCancelled
                          ? 'bg-red-500/10 border border-red-500/20 opacity-60'
                          : flashItemId === item.id
                          ? 'ring-2 ring-emerald-500 bg-emerald-500/10'
                          : 'bg-[var(--surface-2)]/60 hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      {/* Quantity controls */}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1) }}
                          disabled={isCancelled || isVoided}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Minus size={18} />
                        </button>
                        <span className="w-7 text-center font-bold text-lg">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                          disabled={isCancelled || isVoided}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Plus size={18} />
                        </button>
                      </div>

                      {/* Item name + modifiers */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm leading-tight ${isVoided ? 'line-through text-slate-500' : isCancelled ? 'line-through text-red-400' : ''}`}>
                          {item.nombre}
                        </p>
                        {isVoided && (
                          <span className="inline-block bg-slate-600/60 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded">ANULADO</span>
                        )}
                        {isCancelled && !isVoided && (
                          <p className="text-red-500 text-[10px] font-semibold">CANCELADO</p>
                        )}
                        {item.modificadores.length > 0 && (
                          <p className="text-[var(--text-3)] text-[11px] truncate">
                            {item.modificadores.join(' · ')}
                          </p>
                        )}
                        {item.notas && (
                          <p className="text-[var(--text-2)] text-[11px] italic truncate">
                            {item.notas}
                          </p>
                        )}
                      </div>

                      {/* Silla badge (tap para ciclar 1..personas) */}
                      {!isCancelled && !isVoided && (
                        <button
                          onClick={(e) => { e.stopPropagation(); cycleSilla(item.id) }}
                          className="flex-shrink-0 min-w-[44px] h-11 px-2 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 text-sm font-bold flex items-center justify-center transition-colors hover:bg-sky-500/30"
                          title="Silla — toca para cambiar"
                        >
                          S{item.silla || 1}
                        </button>
                      )}

                      {/* Line total */}
                      <span className={`font-semibold text-sm w-20 text-right flex-shrink-0 ${isVoided ? 'line-through text-slate-500/60' : isCancelled ? 'line-through text-red-400/60' : ''}`}>
                        {formatMXN(item.subtotal)}
                      </span>

                      {!isCancelled && !isVoided && (
                        <>
                          {/* Edit */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditOrderItem(item) }}
                            className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
                          >
                            <Pencil size={18} />
                          </button>

                          {/* Cancel (NOT delete — requires reason + manager PIN) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
                            title="Cancelar item (requiere gerente)"
                          >
                            <Ban size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
                          </div>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            )}

            {/* AI Copilot + Customer Memory — only on mobile (terminal has limited space) */}
            {orderItems.length > 0 && isMobileDevice && (
              <div className="mt-2 space-y-1">
                <POSCopilot
                  orderItems={orderItems.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, subtotal: i.subtotal }))}
                  mesa={mesa}
                  personas={personas}
                  mesero={mesero}
                />
                <CustomerMemory mesa={mesa} mesero={mesero} />
              </div>
            )}
          </div>

          {/* Discount + Order notes + Totals — fixed at bottom, compact */}
          <div className="border-t border-[var(--line)] px-3 py-1 bg-[var(--surface-2)]/50 flex-shrink-0">
            {/* Tiempos row */}
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={addTiempoSeparator}
                disabled={activeItems.filter(i => !isTiempoItem(i)).length === 0}
                className="flex items-center gap-1.5 px-4 min-h-[48px] rounded-lg bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-amber-400 text-sm font-semibold transition-colors"
                title="Insertar separador de tiempo"
              >
                <Clock size={18} />
                Tiempo
              </button>
              {orderItems.some(isTiempoItem) && (
                <button
                  onClick={() => setShowFirebutton(true)}
                  className="flex items-center gap-1.5 px-4 min-h-[48px] rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold transition-colors"
                  title="Impresión por tiempos — disparar siguiente tiempo a cocina"
                >
                  <Flame size={18} />
                  Disparar
                </button>
              )}
              <div className="flex-1" />
            </div>
            {/* Inline tools row: discount, notes, void */}
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => setShowDiscount(true)}
                disabled={orderItems.length === 0 || isMobileRestricted}
                className="flex items-center gap-1.5 px-4 min-h-[48px] rounded-lg bg-[var(--line)] hover:bg-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-4)] text-sm font-semibold transition-colors"
                title={isMobileRestricted ? 'Solo disponible en terminal de caja' : 'Aplicar descuento'}
              >
                <Percent size={16} />
                {discount > 0 ? `-${formatMXN(discount)}` : 'Desc'}
              </button>
              {discount > 0 && (
                <button
                  onClick={() => {
                    logAudit({ order_id: orderId, action: 'discount_removed', actor: mesero, mesa, details: { amount: discount } })
                    setDiscount(0)
                    setAppliedPromo(null)
                  }}
                  className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 transition-colors"
                >
                  <X size={18} />
                </button>
              )}
              {/* Order notes — inline input */}
              <div className="flex-1 flex items-center gap-1 min-w-0">
                <StickyNote size={12} className="text-[var(--text-3)] flex-shrink-0" />
                <input
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Nota..."
                  className="flex-1 min-w-0 bg-[var(--line)]/60 border border-slate-600/50 rounded-lg px-3 min-h-[48px] text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <button
                onClick={() => { if (!isMobileRestricted) { openCashDrawer(); showToast('Cajón abierto') } }}
                disabled={isMobileRestricted}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-slate-700/50 hover:bg-slate-700 disabled:opacity-30 text-[var(--text-3)] transition-colors"
                title={isMobileRestricted ? 'Solo disponible en terminal de caja' : 'Abrir cajón'}
              >
                <Banknote size={18} />
              </button>
              <button
                onClick={() => { if (!isMobileRestricted) setShowCashMovement(true) }}
                disabled={isMobileRestricted}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-slate-700/50 hover:bg-slate-700 disabled:opacity-30 text-[var(--text-3)] transition-colors"
                title={isMobileRestricted ? 'Solo disponible en terminal de caja' : 'Retiro / Deposito'}
              >
                <DollarSign size={18} />
              </button>
              <button
                onClick={() => {
                  const reprintOrder: Order = {
                    id: generateId(), items: activeItems, mesa: Number(mesa) || 0, mesero,
                    subtotal: Number(subtotal), descuento: Number(discount), iva: Number(iva), total: Number(total), propina: 0,
                    metodoPago: 'efectivo', status: 'cerrada',
                    personas: Number(personas) || 2,
                    createdAt: new Date(),
                  }
                  handlePrintTicket(reprintOrder)
                }}
                disabled={orderItems.length === 0}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-slate-700/50 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-3)] transition-colors"
                title="Reimprimir ticket"
              >
                <Printer size={18} />
              </button>
              <button
                onClick={() => {
                  if (orderItems.length === 0) return
                  setPinInput('')
                  setPinPrompt({
                    title: 'Transferir a mesa #:',
                    onSubmit: (input: string) => {
                      const newMesa = parseInt(input, 10)
                      if (isNaN(newMesa) || newMesa <= 0) { showToast('Numero de mesa invalido'); return }
                      const oldMesa = mesa
                      setMesa(newMesa)
                      logAudit({ order_id: orderId, action: 'mesa_transferred', actor: mesero, mesa: newMesa, details: { from: oldMesa, to: newMesa } })
                      showToast(`Mesa transferida: ${oldMesa} → ${newMesa}`)
                      setPinPrompt(null)
                    },
                  })
                }}
                disabled={orderItems.length === 0}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-sky-900/30 hover:bg-sky-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-sky-400 transition-colors"
                title="Transferir mesa"
              >
                <ArrowRightLeft size={18} />
              </button>
              <button
                onClick={() => setShowVoidOrder(true)}
                disabled={orderItems.length === 0}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 transition-colors"
                title="Anular orden"
              >
                <ShieldAlert size={18} />
              </button>
            </div>

            {/* Promos available */}
            {availablePromos.length > 0 && discount === 0 && (
              <div className="flex items-center gap-1.5 mb-1.5 overflow-x-auto">
                {availablePromos.slice(0, 3).map((ap, i) => (
                  <button
                    key={ap.promo.id || i}
                    onClick={() => {
                      setAppliedPromo(ap)
                      setDiscount(ap.discount)
                      logAudit({
                        order_id: orderId, action: 'discount_applied', actor: mesero, mesa,
                        details: { amount: ap.discount, promo: ap.promo.name, type: ap.promo.type, auto: false },
                      })
                      showToast(`${ap.label} aplicado: -${formatMXN(ap.discount)}`)
                    }}
                    className="flex items-center gap-1 px-3 min-h-[36px] rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold whitespace-nowrap hover:bg-emerald-600/30 animate-pulse"
                  >
                    <Tag size={12} />
                    {ap.label} (-{formatMXN(ap.discount)})
                  </button>
                ))}
              </div>
            )}
            {appliedPromo && discount > 0 && (
              <div className="flex items-center gap-1.5 mb-1 text-xs text-emerald-400">
                <Tag size={12} />
                <span className="font-semibold">{appliedPromo.label}</span>
              </div>
            )}

            {/* Totals — compact */}
            <div className="flex items-center justify-between text-xs text-[var(--text-3)] mb-0.5">
              <span>Sub {formatMXN(subtotal)}</span>
              {discount > 0 && <span className="text-red-400">-{formatMXN(discount)}</span>}
              <span>IVA {formatMXN(iva)}</span>
              <span className="text-white text-base font-bold">{formatMXN(total)}</span>
            </div>
          </div>

          {/* Action buttons — compact for tablets */}
          <div className="px-3 py-1 border-t border-[var(--line)] flex gap-2 flex-shrink-0">
            <button
              onClick={handleSendToKitchen}
              disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
            >
              <Send size={18} />
              {saving ? '...' : sentToKitchen ? 'Enviado' : 'Cocina'}
            </button>
            <button
              onClick={handlePreTicket}
              disabled={activeItems.length === 0 || saving}
              className="flex-[0.6] flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
            >
              <Receipt size={16} />
              Cuenta
            </button>
            <button
              onClick={() => { if (activeItems.length >= 2) { setSplitMode(null); setSplitCount(0); setSplitParejoN(0); setSplitAssignments({}); setShowSplit(true) } else handleCloseOrder() }}
              disabled={activeItems.length === 0 || saving || isMobileRestricted}
              className="flex-[0.4] flex items-center justify-center bg-purple-600 hover:bg-purple-500 active:bg-purple-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
              title={isMobileRestricted ? 'Solo disponible en terminal de caja' : ''}
            >
              Split
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={activeItems.length === 0 || saving || isMobileRestricted}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
              title={isMobileRestricted ? 'Solo disponible en terminal de caja' : ''}
            >
              <CreditCard size={18} />
              {isMobileRestricted ? 'Solo caja' : 'Cobrar'}
            </button>
          </div>
        </div>

        {/* Right Panel -- Menu (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`} style={{background:'#0d0d12'}}>
          {/* Search bar — touch target + barcode scanner */}
          <div className="px-3 pt-1.5 pb-1 flex-shrink-0 flex gap-2">
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="flex-1 bg-[var(--line)] border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500 min-h-[44px]"
            />
            <button
              onClick={() => setShowBarcodeScanner(true)}
              className="w-[44px] h-[44px] bg-amber-600 hover:bg-amber-500 active:bg-amber-700 rounded-xl flex items-center justify-center text-white flex-shrink-0 transition-colors"
              title="Escanear código de barras"
            >
              <ScanBarcode size={20} />
            </button>
          </div>

          {/* Seat tabs — PoloTab style */}
          {personas > 1 && (
            <div className="px-3 pb-1 flex-shrink-0 flex items-center gap-1.5 overflow-x-auto">
              <button
                onClick={() => setSillaActual(0)}
                className={`px-4 min-h-[40px] rounded-xl text-sm font-bold transition-all flex-shrink-0 ${
                  sillaActual === 0
                    ? 'bg-white text-black'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] hover:bg-[var(--line)]'
                }`}
              >
                Todos
              </button>
              {Array.from({ length: personas }, (_, i) => i + 1).map(s => {
                const seatItems = orderItems.filter(oi => !cancelledItems.has(oi.id) && !voidedItems.has(oi.id) && !isTiempoItem(oi) && (oi.silla || 1) === s)
                const seatTotal = seatItems.reduce((sum, oi) => sum + oi.subtotal, 0)
                return (
                  <button
                    key={s}
                    onClick={() => setSillaActual(s)}
                    className={`px-4 min-h-[40px] rounded-xl text-sm font-bold transition-all flex-shrink-0 flex items-center gap-2 ${
                      sillaActual === s
                        ? 'bg-sky-600 text-white ring-2 ring-sky-400/40'
                        : 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] hover:bg-[var(--line)]'
                    }`}
                  >
                    <Armchair size={16} />
                    <span>{s}</span>
                    {seatTotal > 0 && <span className="text-xs opacity-70">{formatMXN(seatTotal)}</span>}
                  </button>
                )
              })}
              <button
                onClick={() => setPersonas(p => p + 1)}
                className="w-10 min-h-[40px] rounded-xl bg-[var(--surface-2)] border border-dashed border-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)] flex items-center justify-center flex-shrink-0 transition-colors"
                title="Agregar comensal"
              >
                <Plus size={16} />
              </button>
            </div>
          )}

          {menuSearch.trim() ? (
            /* Search results across all categories */
            <div className="flex-1 overflow-y-auto p-3 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              {(() => {
                const term = menuSearch.toLowerCase()
                const results: { item: MenuItem; category: string; catId: string }[] = []
                for (const cat of menuCategories) {
                  for (const item of cat.items) {
                    if (item.price > 0 && item.name.toLowerCase().includes(term)) {
                      results.push({ item, category: cat.name, catId: cat.id })
                    }
                  }
                }
                if (results.length === 0) {
                  return <p className="text-[var(--text-2)] text-center py-8">Sin resultados para &ldquo;{menuSearch}&rdquo;</p>
                }
                return (
                  <div className="space-y-2">
                    {results.map(({ item, category, catId }) => {
                      const catColor = menuCategories.find(c => c.id === catId)?.color || 'bg-emerald-600'
                      return (
                        <button
                          key={item.id}
                          onClick={() => { handleMenuItemTap(item, catId); setMobileView('order') }}
                          className="w-full bg-[var(--surface-2)] hover:bg-[var(--line)] active:bg-emerald-500/10 border border-[var(--line)] rounded-xl text-left transition-colors flex items-center min-h-[64px] overflow-hidden"
                        >
                          <div className={`w-1.5 self-stretch flex-shrink-0 rounded-l-lg ${catColor}`} />
                          <div className="flex items-center justify-between flex-1 px-3 py-3">
                            <div>
                              <span className="font-semibold text-base text-white">{item.name}</span>
                              <span className="text-[var(--text-2)] text-xs ml-2">{category}</span>
                            </div>
                            <span className="text-emerald-400 font-bold text-lg">{formatMXN(item.price)}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          ) : (
            <>
              {/* Category grid — full area, alphabetical left→right, large touch targets */}
              <div className="flex-1 overflow-y-auto bg-[var(--surface-2)]/50 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6 gap-1.5 p-2 auto-rows-fr pb-4">
                  {allCombos.length > 0 && (
                    <button
                      onClick={() => setShowComboModal(true)}
                      className="px-2 py-2 rounded-xl text-xs font-bold text-center transition-all min-h-[58px] leading-tight flex flex-col items-center justify-center gap-0.5 bg-gradient-to-br from-amber-600 to-orange-600 text-white hover:opacity-100 active:scale-95 ring-2 ring-amber-400/30"
                    >
                      <Layers size={18} />
                      <span>Combos</span>
                      <span className="text-[10px] font-normal opacity-70">{allCombos.length}</span>
                    </button>
                  )}
                  {menuCategories.filter(cat => cat.items.some(i => i.price > 0))
                    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                    .map((cat) => {
                      const catColor = (cat as { color?: string }).color || 'bg-slate-600'
                      const itemCount = cat.items.filter(i => i.price > 0).length
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-2 py-2 rounded-xl text-xs font-bold text-center transition-all min-h-[58px] leading-tight flex flex-col items-center justify-center gap-0.5 ${catColor} opacity-85 text-white hover:opacity-100 active:scale-95`}
                        >
                          <span>{cat.name}</span>
                          <span className="text-[10px] font-normal opacity-70">{itemCount}</span>
                        </button>
                      )
                    })}
                </div>
              </div>

              {/* Menu items — centered modal overlay on category tap */}
              {selectedCategory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedCategory('')}>
                  <div className="bg-[#111118] rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl w-[90vw] max-w-[700px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className={`flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.08)] ${(activeCategory as { color?: string }).color || 'bg-emerald-600'}`}>
                      <h3 className="text-white font-bold text-lg">{activeCategory.name} <span className="text-white/60 text-sm font-normal ml-2">{activeCategory.items.filter(i => i.price > 0).length} platillos</span></h3>
                      <button onClick={() => setSelectedCategory('')} className="w-11 h-11 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30 active:scale-95">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-4 max-h-[65vh] overscroll-contain [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pb-4">
                {activeCategory.items.filter(item => item.price > 0).map((item) => {
                    const isOOS = outOfStockItems.has(item.id)
                    return (
                    <button
                      key={item.id}
                      onClick={() => { if (isOOS) { showToast(`${item.name} — AGOTADO`); return } handleMenuItemTap(item, activeCategory.id); setSelectedCategory(''); setMobileView('order') }}
                      className={`bg-[#1a1a24] hover:bg-[#222230] active:scale-[0.97] border rounded-2xl text-left transition-all flex min-h-[110px] overflow-hidden relative shadow-sm ${
                        isOOS
                          ? 'border-red-500/30 opacity-50 cursor-not-allowed'
                          : (item as MenuItem & { promo?: boolean }).promo
                          ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                          : 'border-[rgba(255,255,255,0.08)] hover:border-emerald-500/30'
                      }`}
                    >
                      <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-red-500' : (activeCategory as { color?: string }).color || 'bg-emerald-600'}`} />
                      {isOOS && <span className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase">Agotado</span>}
                      <div className="flex flex-col justify-between px-4 py-5 flex-1">
                        <span className={`font-bold text-lg leading-snug ${isOOS ? 'text-gray-500 line-through' : 'text-white'}`}>{item.name}</span>
                        <span className={`font-bold text-xl mt-2 ${isOOS ? 'text-red-400' : 'text-emerald-400'}`}>${Math.round(item.price)}</span>
                      </div>
                    </button>
                    )
                  })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* Combo selection modal */}
              {showComboModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowComboModal(false)}>
                  <div className="bg-[#111118] rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl w-[90vw] max-w-[600px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.08)] bg-gradient-to-r from-amber-600 to-orange-600">
                      <h3 className="text-white font-bold text-lg">Combos <span className="text-white/60 text-sm font-normal ml-2">{allCombos.length} disponibles</span></h3>
                      <button onClick={() => setShowComboModal(false)} className="w-11 h-11 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30 active:scale-95">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-4 max-h-[65vh] overscroll-contain [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <div className="space-y-3">
                        {allCombos.map(combo => {
                          const menuPrices = new Map<string, number>()
                          for (const cat of menuCategories) {
                            for (const item of cat.items) {
                              menuPrices.set(item.id, item.price)
                            }
                          }
                          const originalTotal = combo.items.reduce((s, ci) => s + (menuPrices.get(ci.menu_item_id) ?? 0), 0)
                          const savings = originalTotal - combo.price
                          return (
                            <button
                              key={combo.id}
                              onClick={() => {
                                const menuPrices = new Map<string, number>()
                                for (const cat of menuCategories) {
                                  for (const item of cat.items) menuPrices.set(item.id, item.price)
                                }
                                const comboItems = applyCombo(combo, menuPrices)
                                setOrderItems(prev => {
                                  const currentCourse = prev.filter(isTiempoItem).length + 1
                                  return [...prev, ...comboItems.map(ci => ({
                                    ...ci,
                                    silla: sillaActual,
                                    courseId: currentCourse,
                                    courseStatus: 'pending' as const,
                                  }))]
                                })
                                logAudit({
                                  order_id: orderId, action: 'combo_added', actor: mesero, mesa,
                                  details: { combo: combo.name, price: combo.price, items: combo.items.map(i => i.name) },
                                })
                                showToast(`${combo.name} agregado`)
                                setShowComboModal(false)
                                setMobileView('order')
                              }}
                              className="w-full bg-[#1a1a24] hover:bg-[#222230] active:scale-[0.97] border border-[rgba(255,255,255,0.08)] hover:border-amber-500/30 rounded-2xl text-left transition-all p-4 shadow-sm"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-white text-lg">{combo.name}</span>
                                <span className="text-amber-400 font-bold text-xl">${Math.round(combo.price)}</span>
                              </div>
                              <div className="text-[var(--text-3)] text-sm space-y-0.5">
                                {combo.items.map((ci, i) => (
                                  <div key={i}>• {ci.name}</div>
                                ))}
                              </div>
                              {savings > 0 && (
                                <div className="mt-2 text-emerald-400 text-xs font-semibold">
                                  Ahorras ${Math.round(savings)} (era ${Math.round(originalTotal)})
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* Legacy grid removed — items shown only in category modal */}
            </>
          )}
        </div>
      </div>

      {/* Barcode Scanner */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowBarcodeScanner(false)}
        />
      )}

      {/* Modifier Modal */}
      {modifierItem && (
        <ModifierModal
          item={modifierItem}
          existingOrder={editingOrderItem}
          recipeIngredients={getRecipeIngredients(modifierItem.name)}
          categoryId={modifierCategoryId}
          onConfirm={handleModifierConfirm}
          onCancel={handleModifierCancel}
        />
      )}

      {/* Discount Modal */}
      {showDiscount && (
        <DiscountModal
          subtotal={subtotal}
          personas={personas}
          items={activeItems}
          onApply={handleApplyDiscount}
          onCancel={() => setShowDiscount(false)}
        />
      )}

      {/* Cancel Item Modal (blindaje) */}
      {cancellingItem && (
        <CancelModal
          itemName={`${cancellingItem.cantidad}x ${cancellingItem.nombre}`}
          onConfirm={handleCancelItem}
          onCancel={() => setCancellingItem(null)}
        />
      )}

      {/* Void Order Modal (blindaje) */}
      {showVoidOrder && (
        <VoidOrderModal
          mesa={mesa}
          total={total}
          onConfirm={handleVoidOrder}
          onCancel={() => setShowVoidOrder(false)}
        />
      )}

      {/* Cash Movement Modal (retiros / depositos) */}
      {showCashMovement && (
        <CashMovementModal
          turnoId={turnoId}
          actor={mesero}
          onConfirm={handleCashMovement}
          onCancel={() => setShowCashMovement(false)}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium animate-fade-in">
          {toast}
        </div>
      )}

      {/* Split de Cuenta Modal */}
      {showSplit && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-lg border border-[var(--line)] max-h-[85vh] overflow-y-auto mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Dividir cuenta — Mesa {mesa}</h3>
              <button onClick={() => { setShowSplit(false); setSplitMode(null); setSplitCount(0); setSplitParejoN(0) }} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center">
                <X size={20} />
              </button>
            </div>

            {/* Step 1: Choose split mode */}
            {splitMode === null && (
              <>
                <p className="text-[var(--text-3)] text-sm mb-4">¿En cuántas cuentas dividir?</p>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => { setSplitCount(n); setSplitMode('items'); setSplitAssignments({}) }}
                      className="py-4 rounded-xl bg-[var(--line)] hover:bg-blue-600/30 border border-transparent hover:border-blue-600 text-white font-bold text-xl transition-all"
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    onClick={() => { setSplitMode('parejo'); setSplitParejoN(0) }}
                    className="py-4 rounded-xl bg-emerald-900/30 hover:bg-emerald-600/30 border border-emerald-700/50 hover:border-emerald-500 text-emerald-400 font-bold text-sm transition-all"
                  >
                    Parejo
                  </button>
                </div>
              </>
            )}

            {/* Parejo mode: choose number of people */}
            {splitMode === 'parejo' && splitParejoN === 0 && (
              <>
                <p className="text-[var(--text-3)] text-sm mb-4">¿Entre cuántas personas dividir parejo?</p>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => setSplitParejoN(n)}
                      className="py-4 rounded-xl bg-[var(--line)] hover:bg-emerald-600/30 border border-transparent hover:border-emerald-600 text-white font-bold text-xl transition-all"
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSplitMode(null)}
                  className="w-full py-3 rounded-xl bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]"
                >
                  Atrás
                </button>
              </>
            )}

            {/* Parejo mode: show result */}
            {splitMode === 'parejo' && splitParejoN > 0 && (
              <>
                {(() => {
                  const fullSubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
                  const fullAfterDisc = Math.max(0, fullSubtotal - discount)
                  const fullTotal = fullAfterDisc + fullAfterDisc * IVA_RATE
                  const perPerson = fullTotal / splitParejoN
                  return (
                    <div className="text-center mb-6">
                      <p className="text-[var(--text-3)] text-sm mb-2">Total dividido entre {splitParejoN} personas</p>
                      <p className="text-3xl font-bold text-emerald-400">{formatMXN(perPerson)}</p>
                      <p className="text-[var(--text-3)] text-xs mt-1">cada persona</p>
                      <p className="text-[var(--text-2)] text-xs mt-2">Total: {formatMXN(fullTotal)}</p>
                    </div>
                  )
                })()}
                <div className="flex gap-3">
                  <button onClick={() => { setSplitParejoN(0) }} className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]">
                    Atrás
                  </button>
                  <button
                    onClick={() => {
                      logAudit({
                        order_id: orderId, action: 'status_changed', actor: mesero, mesa,
                        details: { type: 'split_parejo', personas: splitParejoN },
                      })
                      setShowSplit(false)
                      setSplitPayingCuenta(1)
                      setShowPayment(true)
                      showToast(`Cobra Cuenta 1 de ${splitParejoN}`)
                    }}
                    className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold min-h-[48px]"
                  >
                    Dividir y cobrar
                  </button>
                </div>
              </>
            )}

            {/* Items mode: assign items to cuentas */}
            {splitMode === 'items' && splitCount > 0 && (
              <>
                <p className="text-[var(--text-3)] text-sm mb-4">Toca cada item para cambiar de cuenta ({splitCount} cuentas)</p>

                <div className="space-y-2 mb-6">
                  {activeItems.map(item => {
                    const cuenta = splitAssignments[item.id] || 1
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSplitAssignments(prev => ({ ...prev, [item.id]: cuenta >= splitCount ? 1 : cuenta + 1 }))}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${CUENTA_BG[cuenta]} border`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${CUENTA_COLORS[cuenta]} text-white`}>C{cuenta}</span>
                          <span className="text-white text-sm">{item.cantidad}x {item.nombre}</span>
                        </div>
                        <span className="text-white font-semibold">{formatMXN(item.subtotal)}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Totals per cuenta */}
                <div className={`grid gap-3 mb-6 ${splitCount === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {Array.from({ length: splitCount }, (_, idx) => {
                    const cNum = idx + 1
                    const cItems = activeItems.filter(i => (splitAssignments[i.id] || 1) === cNum)
                    const cTotal = cItems.reduce((s, i) => s + i.subtotal, 0)
                    const cWithIva = cTotal + cTotal * IVA_RATE
                    return (
                      <div key={cNum} className={`${CUENTA_BG[cNum]} border rounded-xl p-3 text-center`}>
                        <p className={`${CUENTA_TEXT[cNum]} text-xs font-bold mb-1`}>CUENTA {cNum}</p>
                        <p className="text-white text-lg font-bold">{formatMXN(cWithIva)}</p>
                        <p className={`${CUENTA_TEXT[cNum]} opacity-60 text-xs`}>{cItems.length} items</p>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => { setSplitMode(null); setSplitCount(0) }} className="flex-1 py-3 rounded-xl bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]">
                    Atrás
                  </button>
                  <button
                    onClick={() => {
                      // Check at least 2 cuentas have items
                      const usedCuentas = new Set(activeItems.map(i => splitAssignments[i.id] || 1))
                      if (usedCuentas.size < 2) {
                        setShowSplit(false)
                        setSplitPayingCuenta(0)
                        setSplitMode(null)
                        setSplitCount(0)
                        setShowPayment(true)
                        return
                      }
                      logAudit({
                        order_id: orderId, action: 'status_changed', actor: mesero, mesa,
                        details: {
                          type: 'split_cuenta',
                          cuentas: splitCount,
                          distribution: Array.from({ length: splitCount }, (_, idx) =>
                            activeItems.filter(i => (splitAssignments[i.id] || 1) === idx + 1).length
                          ),
                        },
                      })
                      setShowSplit(false)
                      setSplitPayingCuenta(1)
                      setShowPayment(true)
                      showToast(`Cobra Cuenta 1 de ${splitCount}`)
                    }}
                    className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold min-h-[48px]"
                  >
                    Dividir y cobrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Person Count Verification Modal */}
      {showPersonVerify && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-sm border border-[var(--line)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Confirmar personas</h3>
              <button
                onClick={() => setShowPersonVerify(false)}
                className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-[var(--text-3)] text-sm mb-4">
              Mesa {mesa} &middot; {mesero}
            </p>
            <p className="text-[var(--text-4)] text-sm mb-3 font-medium">Cuantas personas?</p>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => { setVerifiedPersonas(n); setCustomPersonas('') }}
                  className={`py-3 rounded-xl text-lg font-bold transition-colors ${
                    verifiedPersonas === n && !customPersonas
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                      : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-[var(--line)]'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => {
                  setCustomPersonas(String(verifiedPersonas > 5 ? verifiedPersonas : 6))
                  setVerifiedPersonas(0)
                }}
                className={`py-3 rounded-xl text-lg font-bold transition-colors ${
                  customPersonas
                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                    : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-[var(--line)]'
                }`}
              >
                6+
              </button>
            </div>
            {customPersonas && (
              <div className="mb-4">
                <input
                  type="number"
                  inputMode="numeric"
                  value={customPersonas}
                  onChange={e => setCustomPersonas(e.target.value)}
                  min={1}
                  max={99}
                  autoFocus
                  className="w-full bg-[var(--bg)] border border-slate-600 rounded-xl px-4 py-3 text-white text-2xl text-center font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}
            <button
              onClick={() => {
                const count = customPersonas ? parseInt(customPersonas) || personas : verifiedPersonas || personas
                handlePersonVerified(Math.max(1, count))
              }}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
            >
              <CreditCard size={20} />
              Confirmar y cobrar
            </button>
          </div>
        </div>
      )}

      {/* Mercado Pago Point Config Modal */}
      {showMPConfig && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-md border border-slate-700" style={{background:'#1a1a2e'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Smartphone size={20} />
                Mercado Pago Point
              </h3>
              <button
                onClick={() => setShowMPConfig(false)}
                className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[var(--text-3)] text-xs mb-1 block">Access Token</label>
                <input
                  type="password"
                  value={mpAccessToken}
                  onChange={e => setMpAccessToken(e.target.value)}
                  placeholder="APP_USR-..."
                  className="w-full border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500" style={{background:'#0f0f1a'}}
                />
              </div>

              <div>
                <label className="text-[var(--text-3)] text-xs mb-1 block">Device ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mpDeviceId}
                    onChange={e => setMpDeviceId(e.target.value)}
                    placeholder="GERTEC_MP35P__..."
                    className="flex-1 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500" style={{background:'#0f0f1a'}}
                  />
                  <button
                    onClick={async () => {
                      if (!mpAccessToken) { showToast('Ingresa el Access Token primero'); return }
                      setMpLoadingDevices(true)
                      const result = await fetchMPDevices(mpAccessToken)
                      if (result.success && result.devices) {
                        setMpDevices(result.devices)
                        if (result.devices.length === 0) showToast('No se encontraron dispositivos')
                      } else {
                        showToast(result.error || 'Error al obtener dispositivos')
                      }
                      setMpLoadingDevices(false)
                    }}
                    disabled={mpLoadingDevices || !mpAccessToken}
                    className="px-3 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-[var(--line)] text-white text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    {mpLoadingDevices ? <Loader2 size={16} className="animate-spin" /> : 'Buscar'}
                  </button>
                </div>
              </div>

              {mpDevices.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[var(--text-3)] text-xs">Dispositivos encontrados:</p>
                  {mpDevices.map(d => (
                    <button
                      key={d.id}
                      onClick={() => { setMpDeviceId(d.id); setMpDevices([]) }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        mpDeviceId === d.id
                          ? 'bg-cyan-600 text-white'
                          : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-[var(--line)]'
                      }`}
                    >
                      <span className="font-medium">{d.id}</span>
                      <span className="text-xs opacity-60 ml-2">{d.operating_mode}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                {mpConfig && (
                  <button
                    onClick={() => {
                      clearMPConfig()
                      setMpConfig(null)
                      setMpAccessToken('')
                      setMpDeviceId('')
                      setShowMPConfig(false)
                      showToast('Point desconfigurado')
                    }}
                    className="flex-1 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold text-sm transition-colors"
                  >
                    Desconectar
                  </button>
                )}
                <button
                  onClick={() => {
                    if (!mpAccessToken || !mpDeviceId) { showToast('Completa ambos campos'); return }
                    const cfg: MPConfig = { accessToken: mpAccessToken, deviceId: mpDeviceId, deviceModel: 'MINI' }
                    saveMPConfig(cfg)
                    setMpConfig(cfg)
                    setShowMPConfig(false)
                    showToast('Point configurado')
                  }}
                  disabled={!mpAccessToken || !mpDeviceId}
                  className="flex-[2] py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-[var(--line)] disabled:text-[var(--text-3)] text-white font-semibold text-sm transition-colors"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Impresión por tiempos (firebutton estilo Wansoft) */}
      {showFirebutton && (() => {
        // Tiempo 1 sale con la comanda inicial; el firebutton dispara los siguientes
        const numTiempos = activeItems.filter(isTiempoItem).length + 1
        const nextTiempo = tiempoFired + 2
        const done = nextTiempo > numTiempos
        // Items del tiempo N: entre el separador N-1 y el N (tiempo 1 = antes del primer separador)
        const itemsOfTiempo = (n: number) => {
          let t = 1
          const out: OrderItem[] = []
          for (const it of activeItems) {
            if (isTiempoItem(it)) { t++; continue }
            if (t === n) out.push(it)
          }
          return out
        }
        const nextItems = done ? [] : itemsOfTiempo(nextTiempo)
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-sm border border-amber-500/30">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2"><Flame size={18} className="text-amber-400" />Impresión por tiempos</h3>
                <button onClick={() => setShowFirebutton(false)} className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center"><X size={18} /></button>
              </div>
              {done ? (
                <p className="text-emerald-400 text-sm text-center py-4">Todos los tiempos fueron disparados ({numTiempos} de {numTiempos})</p>
              ) : (
                <>
                  <p className="text-[var(--text-3)] text-sm mb-1">Tiempo siguiente: <span className="text-amber-400 font-bold text-lg">{nextTiempo}</span> de {numTiempos}</p>
                  <div className="bg-[var(--line)]/50 rounded-lg p-3 mb-4 max-h-36 overflow-y-auto">
                    {nextItems.length === 0
                      ? <p className="text-[var(--text-2)] text-xs">Sin platillos en este tiempo</p>
                      : nextItems.map(i => <p key={i.id} className="text-white text-xs py-0.5">{i.cantidad}x {i.nombre}</p>)}
                  </div>
                  <button
                    onClick={async () => {
                      const fireOrder: Order = {
                        id: orderId, mesa, mesero, personas, status: 'enviada',
                        items: nextItems, subtotal: 0, iva: 0, total: 0, descuento: 0,
                        notas: `*** PREPARAR Y SACAR TIEMPO ${nextTiempo} ***`,
                        createdAt: new Date(),
                      }
                      try { await printByStation(fireOrder) } catch { /* sin impresora */ }
                      logAudit({ order_id: orderId, action: 'tiempo_fired', actor: mesero, mesa, details: { tiempo: nextTiempo, items: nextItems.map(i => i.nombre) } })
                      // Update courseStatus to 'fired' for items in this course
                      const firedIds = new Set(nextItems.map(i => i.id))
                      setOrderItems(prev => prev.map(it => firedIds.has(it.id) ? { ...it, courseStatus: 'fired' as const } : it))
                      setTiempoFired(t => t + 1)
                      setShowFirebutton(false)
                      showToast(`Tiempo ${nextTiempo} disparado a cocina`)
                    }}
                    className="w-full py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold flex items-center justify-center gap-2"
                  >
                    <Printer size={18} />Imprimir
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-md border border-[var(--line)] max-h-[92vh] overflow-y-auto">
            {(() => {
              // Calculate total for current split cuenta or full order
              const totalCuentas = splitMode === 'parejo' ? splitParejoN : splitCount
              let payingItems = activeItems
              let paySubtotal: number
              let payDiscountLocal: number
              let payTotal: number

              if (splitMode === 'parejo' && splitPayingCuenta > 0) {
                const r = calcSplitParejo(activeItems, discount, splitParejoN, splitPayingCuenta)
                paySubtotal = r.subtotal
                payDiscountLocal = r.discount
                payTotal = r.total
              } else if (splitPayingCuenta > 0) {
                const r = calcSplitItems(activeItems, splitAssignments, splitPayingCuenta, discount)
                payingItems = r.payingItems as typeof activeItems
                paySubtotal = r.subtotal
                payDiscountLocal = r.discount
                payTotal = r.total
              } else {
                paySubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
                payDiscountLocal = discount
                const sub = Math.max(0, paySubtotal - payDiscountLocal)
                payTotal = sub + sub * IVA_RATE
              }
              const paySubAfterDisc = Math.max(0, paySubtotal - payDiscountLocal)
              const payIva = paySubAfterDisc * IVA_RATE
              const cuentaLabel = splitPayingCuenta > 0 ? ` — Cuenta ${splitPayingCuenta} de ${totalCuentas}` : ''

              return (<>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Cerrar cuenta{cuentaLabel}</h3>
              <button
                onClick={() => { setShowPayment(false); setShowCardConfirm(false); setSplitPayingCuenta(0); setSplitCount(0); setSplitMode(null); setSplitParejoN(0) }}
                className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            {splitPayingCuenta > 0 && (
              <div className={`text-center py-2 px-4 rounded-lg mb-3 ${CUENTA_BG[splitPayingCuenta] || CUENTA_BG[1]} border`}>
                <p className={`text-sm font-bold ${CUENTA_TEXT[splitPayingCuenta] || CUENTA_TEXT[1]}`}>
                  Cuenta {splitPayingCuenta} de {totalCuentas}{splitMode === 'parejo' ? ' (parejo)' : ` · ${payingItems.length} items`}
                </p>
              </div>
            )}

            <div className="text-center mb-4">
              <p className="text-[var(--text-3)] text-sm mb-1">
                Mesa {mesa} · {mesero}
              </p>
              <p className="text-4xl font-bold text-white">{formatMXN(payTotal)}</p>
              {discount > 0 && splitPayingCuenta === 0 && (
                <p className="text-red-400 text-sm mt-1">Descuento: -{formatMXN(discount)}</p>
              )}
            </div>

            {/* Propina */}
            <div className="mb-4">
              <p className="text-[var(--text-3)] text-sm mb-2">Propina</p>
              <div className="flex gap-2">
                {[0, 10, 15, 20].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setPropina(pct === 0 ? 0 : Math.round(total * pct / 100))}
                    className={`flex-1 min-h-[52px] rounded-lg text-base font-bold transition-colors ${
                      (pct === 0 && propina === 0) || (pct > 0 && propina === Math.round(total * pct / 100))
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-[var(--line)]'
                    }`}
                  >
                    {pct === 0 ? 'Sin' : `${pct}%`}
                  </button>
                ))}
                <input
                  type="number"
                  inputMode="numeric"
                  value={propina || ''}
                  onChange={e => setPropina(Number(e.target.value) || 0)}
                  placeholder="$"
                  className="w-24 min-h-[52px] bg-[var(--line)] border border-slate-600 rounded-lg px-2 text-white text-base text-center focus:outline-none focus:border-emerald-500"
                />
              </div>
              {propina > 0 && (
                <p className="text-emerald-400 text-sm mt-2 text-center">
                  Total + propina: {formatMXN(total + propina)}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setShowCashFlow(!showCashFlow)}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <Banknote size={24} />
                Efectivo
              </button>
              {showCashFlow && (() => {
                const totalConPropina = payTotal + propina
                const cashReceived = parseFloat(cashAmount) || 0
                const cambio = cashReceived - totalConPropina
                return (
                  <div className="bg-[var(--surface-2)] border border-emerald-700/40 rounded-xl p-4 space-y-3">
                    <p className="text-emerald-400 text-sm font-bold text-center">Total a cobrar: {formatMXN(totalConPropina)}</p>
                    <div>
                      <label className="text-[var(--text-3)] text-xs mb-1 block">Cliente paga con:</label>
                      <div className="flex gap-2 mb-2">
                        {[100, 200, 500, 1000].map(bill => (
                          <button key={bill} onClick={() => setCashAmount(String(bill))}
                            className={`flex-1 min-h-[52px] rounded-lg text-base font-bold transition-colors ${cashAmount === String(bill) ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}
                          >${bill}</button>
                        ))}
                      </div>
                      <input
                        type="number" inputMode="decimal" value={cashAmount}
                        onChange={e => setCashAmount(e.target.value)}
                        placeholder="Monto recibido" autoFocus
                        className="w-full bg-[var(--bg)] border border-slate-600 rounded-lg px-4 py-3 text-white text-2xl text-center font-bold focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    {cashReceived > 0 && (
                      <div className={`text-center py-3 rounded-xl ${cambio >= 0 ? 'bg-emerald-900/40 border border-emerald-700/40' : 'bg-red-900/40 border border-red-700/40'}`}>
                        {cambio >= 0 ? (
                          <>
                            <p className="text-[var(--text-3)] text-xs">Cambio</p>
                            <p className="text-3xl font-black text-emerald-400">{formatMXN(cambio)}</p>
                          </>
                        ) : (
                          <p className="text-red-400 font-bold">Falta {formatMXN(Math.abs(cambio))}</p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => { if (cashReceived >= totalConPropina) handlePayment('Efectivo') }}
                      disabled={cashReceived < totalConPropina}
                      className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-3)] text-white font-black text-lg transition-colors"
                    >
                      {cashReceived >= totalConPropina ? `Cobrar — Cambio ${formatMXN(cambio)}` : 'Ingresa el monto recibido'}
                    </button>
                  </div>
                )
              })()}
              <button
                onClick={async () => {
                  // Try MP Point Smart first
                  const mpToken = localStorage.getItem('mp_access_token')
                  const mpDevice = localStorage.getItem('mp_device_id')
                  if (mpToken && mpDevice) {
                    showToast('Enviando cobro a terminal...')
                    setSaving(true)
                    try {
                      const res = await fetch(apiUrl('/api/mp-point'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'payment',
                          accessToken: mpToken,
                          deviceId: mpDevice,
                          amount: payTotal + propina,
                          orderId: orderId,
                        }),
                      })
                      const result = await res.json()
                      if (result.success && result.data?.id) {
                        // Poll for payment completion
                        const intentId = result.data.id
                        let attempts = 0
                        const poll = setInterval(async () => {
                          attempts++
                          try {
                            const statusRes = await fetch(apiUrl('/api/mp-point'), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'status', accessToken: mpToken, paymentIntentId: intentId }),
                            })
                            const statusData = await statusRes.json()
                            if (statusData.state === 'FINISHED') {
                              clearInterval(poll)
                              handlePayment('Tarjeta de credito')
                            } else if (statusData.state === 'CANCELED' || statusData.state === 'ERROR' || attempts > 60) {
                              clearInterval(poll)
                              setSaving(false)
                              showToast(statusData.state === 'CANCELED' ? 'Pago cancelado' : 'Error en terminal')
                            }
                          } catch { /* keep polling */ }
                        }, 3000)
                      } else {
                        // MP failed, fall back to manual
                        setSaving(false)
                        handlePayment('Tarjeta de credito')
                      }
                    } catch {
                      setSaving(false)
                      handlePayment('Tarjeta de credito')
                    }
                  } else {
                    // Sin MP configurado — terminal bancaria standalone (Getnet):
                    // mostrar monto gigante para que el cajero lo teclee sin error
                    setShowCardConfirm(true)
                  }
                }}
                disabled={saving}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <CreditCard size={24} />
                {saving ? 'Esperando terminal...' : 'Tarjeta'}
              </button>
              {showCardConfirm && (
                <div className="bg-[var(--surface-2)] border border-blue-600/50 rounded-xl p-4 space-y-3">
                  <p className="text-blue-300 text-sm font-bold text-center uppercase tracking-wide">Teclea en la terminal bancaria</p>
                  <p className="text-5xl font-black text-white text-center tabular-nums">{formatMXN(payTotal + propina)}</p>
                  <p className="text-[var(--text-3)] text-xs text-center">Verifica que el monto en la Getnet coincida ANTES de cobrar</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCardConfirm(false)}
                      className="flex-1 py-4 rounded-xl bg-[var(--line)] hover:bg-[var(--line-soft)] text-[var(--text-2)] font-bold min-h-[56px] transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => { setShowCardConfirm(false); handlePayment('Tarjeta de credito') }}
                      className="flex-[2] py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-lg min-h-[56px] transition-colors"
                    >
                      Pago aprobado
                    </button>
                  </div>
                </div>
              )}
              {/* Formas de pago custom desde catálogo (estilo Wansoft: Rappi, Ubereats, Cortesía...) */}
              {(() => {
                const customMethods = paymentMethodsDB.filter(m => m.type !== 'cash' && m.type !== 'card')
                if (customMethods.length === 0) {
                  return (
                    <button
                      onClick={() => handlePayment('Transferencia electronica')}
                      className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
                    >
                      <Send size={22} />
                      Transferencia
                    </button>
                  )
                }
                return (
                  <div className="grid grid-cols-2 gap-2">
                    {customMethods.map(m => (
                      <button
                        key={m.id}
                        onClick={() => handlePayment(m.name)}
                        className="flex items-center justify-center gap-2 bg-purple-600/80 hover:bg-purple-500 text-white font-bold py-4 rounded-xl text-base transition-colors min-h-[60px]"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )
              })()}
              <button
                onClick={() => { setShowMixto(!showMixto); setMixtoPagos([]); setMixtoMonto(''); setMixtoForma('Efectivo') }}
                className={`w-full flex items-center justify-center gap-3 ${showMixto ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-[var(--line)] hover:bg-[var(--line-soft)] text-[var(--text-2)]'} font-bold py-4 rounded-xl text-base transition-colors min-h-[60px]`}
              >
                Pago mixto (varias formas)
              </button>
              {showMixto && (() => {
                const totalConPropina = payTotal + propina
                const pagado = mixtoPagos.reduce((s, p) => s + p.monto, 0)
                const restante = Math.max(0, totalConPropina - pagado)
                const formaNames = ['Efectivo', 'Tarjeta de credito', ...paymentMethodsDB.filter(m => m.type !== 'cash' && m.type !== 'card').map(m => m.name)]
                const montoNum = parseFloat(mixtoMonto) || 0
                return (
                  <div className="bg-[var(--line)] rounded-xl p-4 space-y-3">
                    {/* Pagos agregados */}
                    {mixtoPagos.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-[var(--bg)]/60 rounded-lg px-3 py-2">
                        <span className="text-sm text-white">{p.metodo}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{formatMXN(p.monto)}</span>
                          <button
                            onClick={() => setMixtoPagos(prev => prev.filter((_, i) => i !== idx))}
                            className="w-11 h-11 rounded-lg bg-red-500/15 text-red-400 flex items-center justify-center"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {/* Selector de forma */}
                    {restante > 0.009 && (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {formaNames.map(name => (
                            <button
                              key={name}
                              onClick={() => setMixtoForma(name)}
                              className={`px-4 min-h-[48px] rounded-lg text-sm font-semibold transition-colors ${mixtoForma === name ? 'bg-amber-600 text-white' : 'bg-[var(--bg)]/60 text-[var(--text-3)]'}`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={mixtoMonto}
                            onChange={(e) => setMixtoMonto(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 min-h-[52px] bg-[var(--bg)] border border-slate-600 rounded-lg px-3 text-white text-lg text-right focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => setMixtoMonto(restante.toFixed(2))}
                            className="px-4 min-h-[52px] rounded-lg bg-[var(--bg)]/60 text-amber-400 text-sm font-semibold"
                          >
                            Restante
                          </button>
                          <button
                            onClick={() => {
                              if (montoNum <= 0 || montoNum > restante + 0.009) return
                              setMixtoPagos(prev => [...prev, { metodo: mixtoForma, monto: montoNum }])
                              setMixtoMonto('')
                            }}
                            disabled={montoNum <= 0 || montoNum > restante + 0.009}
                            className="px-5 min-h-[52px] rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-base font-bold"
                          >
                            Agregar
                          </button>
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-2)]">Restante:</span>
                      <span className={`font-bold ${restante <= 0.009 ? 'text-emerald-400' : 'text-amber-400'}`}>{formatMXN(restante)}</span>
                    </div>
                    <button
                      onClick={() => handlePayment('Mixto')}
                      disabled={mixtoPagos.length === 0 || restante > 0.009}
                      className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[60px]"
                    >
                      {restante > 0.009 ? `Faltan ${formatMXN(restante)}` : 'Confirmar pago mixto'}
                    </button>
                  </div>
                )
              })()}
            </div>
              </>)
            })()}
          </div>
        </div>
      )}

      {/* Smart Alerts (replaces chat) */}
      <POSAlerts role={staffRole} />

      {/* Pin/Input Prompt Modal (replaces window.prompt for kiosk/PWA) */}
      {pinPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 w-80 shadow-2xl">
            <p className="text-sm font-medium text-[var(--text-1)] mb-4">{pinPrompt.title}</p>
            <input
              type={pinPrompt.title.toLowerCase().includes('pin') ? 'password' : 'number'}
              autoFocus
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && pinInput) { pinPrompt.onSubmit(pinInput); setPinInput('') }
                if (e.key === 'Escape') { setPinPrompt(null); setPinInput('') }
              }}
              className="w-full px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-center text-lg font-mono text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
              placeholder={pinPrompt.title.toLowerCase().includes('pin') ? '****' : '#'}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setPinPrompt(null); setPinInput('') }}
                className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { if (pinInput) { pinPrompt.onSubmit(pinInput); setPinInput('') } }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AI Copilot Chat (floating) ─────────────────────────────────────────────

function POSAlerts({ role }: { role: string }) {
  const [alerts, setAlerts] = useState<{ id: string; type: 'warning' | 'info' | 'success'; message: string; dismissible: boolean }[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Fetch smart alerts every 60 seconds
  useEffect(() => {
    async function fetchAlerts() {
      const newAlerts: typeof alerts = []
      try {
        const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

        // Stock bajo alerts moved to dashboard only — too distracting in POS during rush
        if (role === 'admin' || role === 'gerente') {

          // Check agent anomalies
          try {
            const agentRes = await fetch(
              `${sbUrl}/rest/v1/agent_results?agent_id=eq.anomaly&order=updated_at.desc&limit=1`,
              { headers }
            )
            if (agentRes.ok) {
              const [anomaly] = await agentRes.json()
              if (anomaly?.priority === 'critical') {
                newAlerts.push({
                  id: 'anomaly-critical',
                  type: 'warning',
                  message: `🚨 ${anomaly.summary}`,
                  dismissible: true,
                })
              }
            }
          } catch { /* ignore */ }
        }

        // Check ready orders (all roles)
        try {
          const readyRes = await fetch(
            `${sbUrl}/rest/v1/pos_orders?status=eq.lista&client_id=eq.${_cid()}&limit=5`,
            { headers }
          )
          if (readyRes.ok) {
            const readyOrders = await readyRes.json()
            if (readyOrders.length > 0) {
              newAlerts.push({
                id: 'ready-orders',
                type: 'success',
                message: `✅ ${readyOrders.length} orden${readyOrders.length > 1 ? 'es' : ''} lista${readyOrders.length > 1 ? 's' : ''} para entregar`,
                dismissible: false,
              })
            }
          }
        } catch { /* ignore */ }

        // Check delivery orders (all roles)
        try {
          const delRes = await fetch(
            `${sbUrl}/rest/v1/delivery_orders?status=eq.nueva&client_id=eq.${_cid()}&limit=3`,
            { headers }
          )
          if (delRes.ok) {
            const deliveryOrders = await delRes.json()
            for (const d of deliveryOrders) {
              // Skip test/invalid data
              if (!d.customer_name || d.customer_name === 'TEST' || d.customer_name.includes('test') || d.customer_name.includes('default') || d.total <= 1) continue
              const platform: Record<string, string> = { ubereats: '🟢 Uber', rappi: '🟠 Rappi' }
              newAlerts.push({
                id: `del-${d.id}`,
                type: 'info',
                message: `${platform[d.platform] || '📦'} Pedido ${d.customer_name} — $${Math.round(d.total)}`,
                dismissible: true,
              })
            }
          }
        } catch { /* ignore */ }

      } catch { /* ignore all errors */ }

      setAlerts(newAlerts)
    }

    fetchAlerts()
    const interval = setInterval(fetchAlerts, 60000)
    return () => clearInterval(interval)
  }, [role])

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id))
  if (visibleAlerts.length === 0) return null

  const colors = {
    warning: 'bg-amber-900/80 border-amber-600/50 text-amber-200',
    info: 'bg-blue-900/80 border-blue-600/50 text-blue-200',
    success: 'bg-emerald-900/80 border-emerald-600/50 text-emerald-200',
  }

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[90%] max-w-lg">
      {visibleAlerts.map(alert => (
        <div key={alert.id} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border backdrop-blur-sm shadow-lg text-sm font-medium ${colors[alert.type]}`}>
          <span>{alert.message}</span>
          {alert.dismissible && (
            <button onClick={() => setDismissed(prev => new Set(prev).add(alert.id))} className="ml-3 min-w-[44px] min-h-[44px] flex items-center justify-center opacity-60 hover:opacity-100">
              <X size={18} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
