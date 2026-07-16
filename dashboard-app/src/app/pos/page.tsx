'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  MENU_CATEGORIES,
  MESEROS,
  fetchMeseros,
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
  updateOrderStatus,
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
  printUpdateByStation,
  detectItemChanges,
  type ItemChange,
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
import { sendNotification } from '@/lib/service-worker'
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
  ArrowLeft,
  DollarSign,
  ArrowDownUp,
  Layers,
  ClipboardCheck,
  Power,
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
  const [currentLevel, setCurrentLevel] = useState(0)
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
  const [showQuitar, setShowQuitar] = useState(quitarChecked.size > 0)

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

      {/* Modal — full height, wide for POS touch */}
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] w-full max-w-5xl h-[calc(100vh-2rem)] rounded-2xl shadow-2xl flex flex-col mx-auto my-4">
        {/* Header */}
        <div className="bg-[var(--surface-2)] border-b border-[var(--line)] px-5 py-4 flex items-center justify-between rounded-t-2xl flex-shrink-0">
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

        <div className="px-5 py-3 space-y-3 flex-1 overflow-y-auto pos-fat-scroll">
          {/* Step indicator (only for stepped flow) */}
          {hasGroups && modGroups.length > 0 && (
            <div className="flex items-center justify-between pb-1">
              <h4 className="text-sm font-bold text-white">
                {modGroups[currentLevel]?.name ?? 'Confirmar'} ({currentLevel + 1}/{modGroups.length})
              </h4>
              <div className="flex gap-1">
                {modGroups.map((_, i) => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-full ${i === currentLevel ? 'bg-emerald-500' : i < currentLevel ? 'bg-emerald-800' : 'bg-slate-600'}`} />
                ))}
              </div>
            </div>
          )}

          {/* Quitar section — collapsed by default, shows on ALL steps */}
          {quitarOptions.length > 0 && <div>
            <button
              type="button"
              onClick={() => setShowQuitar(prev => !prev)}
              className="w-full flex items-center justify-between py-2 text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide"
            >
              <span>Quitar {quitarChecked.size > 0 && <span className="text-red-400">({quitarChecked.size})</span>}</span>
              <span className="text-xs normal-case text-[var(--text-4)]">{showQuitar ? '▲ Cerrar' : '▼ Abrir'}</span>
            </button>
            {showQuitar && (
            <div className="grid grid-cols-3 gap-1.5">
              {quitarOptions.map(mod => (
                <label
                  key={mod}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl cursor-pointer transition-colors min-h-[48px] ${
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
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    quitarChecked.has(mod)
                      ? 'bg-red-500 border-red-500'
                      : 'border-slate-500'
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
            )}
          </div>}

          {/* Stepped modifier groups (one at a time) */}
          {hasGroups && modGroups.length > 0 && (() => {
            const group = modGroups[currentLevel]
            if (!group) return null
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
                      Obligatorio{min > 1 ? ` (min ${min})` : ''}
                    </span>
                  ) : (
                    <span className="text-[11px] normal-case font-medium px-2 py-0.5 rounded-full bg-[var(--line)]/60 text-[var(--text-3)]">Opcional</span>
                  )}
                  {group.maxSelections !== null && (
                    <span className={`text-[11px] normal-case font-medium px-2 py-0.5 rounded-full ${maxReached ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50' : 'bg-[var(--line)]/60 text-[var(--text-3)]'}`}>
                      Max {group.maxSelections}{group.maxSelections > 1 ? ` (${sel.size}/${group.maxSelections})` : ''}
                    </span>
                  )}
                </h4>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.options.map(opt => {
                    const checked = sel.has(opt.name)
                    const blocked = !checked && group.maxSelections !== null && group.maxSelections > 1 && sel.size >= group.maxSelections
                    return (
                      <label
                        key={opt.name}
                        className={`flex items-center gap-2 px-3 py-3 rounded-xl transition-colors min-h-[48px] ${
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
          })()}

          {/* Legacy Agregar section (only when no groups) */}
          {agregarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Agregar</h4>
            <div className="grid grid-cols-3 gap-1.5">
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

          {/* Notas + Cantidad — always visible on every step */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Notas: sin cebolla, termino medio..."
              className="flex-1 bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                className="w-10 h-10 rounded-lg bg-[var(--line)] flex items-center justify-center text-white"
              >
                <Minus size={18} />
              </button>
              <span className="text-xl font-bold text-white w-8 text-center">{cantidad}</span>
              <button
                onClick={() => setCantidad(cantidad + 1)}
                className="w-10 h-10 rounded-lg bg-[var(--line)] flex items-center justify-center text-white"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        {!hasGroups ? (
          /* Legacy footer — Cancel / Add */
          <div className="bg-[var(--surface-2)] border-t border-[var(--line)] px-5 py-4 flex gap-3 rounded-b-2xl flex-shrink-0">
            <button
              onClick={onCancel}
              className="flex-1 py-4 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-bold text-lg transition-colors min-h-[56px]"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={unmetGroups.length > 0}
              className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-colors min-h-[56px]"
            >
              {unmetGroups.length > 0
                ? `Elige ${unmetGroups[0].name}`
                : <>{existingOrder ? 'Actualizar' : 'Agregar'} {formatMXN(subtotal)}</>}
            </button>
          </div>
        ) : (
          /* Stepped footer — Back / Skip / Next / Add */
          <div className="bg-[var(--surface-2)] border-t border-[var(--line)] px-5 py-4 flex gap-3 rounded-b-2xl flex-shrink-0">
            {/* Back / Cancel */}
            <button
              onClick={currentLevel > 0 ? () => setCurrentLevel(currentLevel - 1) : onCancel}
              className="flex-1 py-4 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-bold text-lg transition-colors min-h-[56px]"
            >
              {currentLevel > 0 ? '\u2190 Atras' : 'Cancelar'}
            </button>

            {currentLevel < modGroups.length - 1 ? (
              /* Not last level: Siguiente + optional Omitir */
              <>
                {/* Omitir — only on optional groups */}
                {(() => {
                  const g = modGroups[currentLevel]
                  const isOptional = !g.required && g.minSelections === 0
                  return isOptional ? (
                    <button
                      onClick={() => setCurrentLevel(currentLevel + 1)}
                      className="flex-1 py-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-[var(--text-3)] font-bold text-lg transition-colors min-h-[56px]"
                    >
                      Omitir &rarr;
                    </button>
                  ) : null
                })()}
                {/* Siguiente — disabled if current required group is unmet */}
                <button
                  onClick={() => setCurrentLevel(currentLevel + 1)}
                  disabled={(() => {
                    const g = modGroups[currentLevel]
                    const count = groupChecked.get(g.id)?.size || 0
                    const min = g.required ? Math.max(1, g.minSelections) : g.minSelections
                    return count < min
                  })()}
                  className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-colors min-h-[56px]"
                >
                  {(() => {
                    const g = modGroups[currentLevel]
                    const count = groupChecked.get(g.id)?.size || 0
                    const min = g.required ? Math.max(1, g.minSelections) : g.minSelections
                    return count < min ? `Elige ${g.name}` : 'Siguiente \u2192'
                  })()}
                </button>
              </>
            ) : (
              /* Last level: Agregar button */
              <>
                {/* Omitir on last level if optional */}
                {(() => {
                  const g = modGroups[currentLevel]
                  const isOptional = !g.required && g.minSelections === 0
                  const count = groupChecked.get(g.id)?.size || 0
                  return isOptional && count === 0 ? (
                    <button
                      onClick={handleConfirm}
                      className="flex-1 py-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-[var(--text-3)] font-bold text-lg transition-colors min-h-[56px]"
                    >
                      Omitir &rarr;
                    </button>
                  ) : null
                })()}
                <button
                  onClick={handleConfirm}
                  disabled={unmetGroups.length > 0}
                  className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-colors min-h-[56px]"
                >
                  {unmetGroups.length > 0
                    ? `Elige ${unmetGroups[0].name}`
                    : <>{existingOrder ? 'Actualizar' : 'Agregar'} &#10003; {formatMXN(subtotal)}</>}
                </button>
              </>
            )}
          </div>
        )}
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
  const [discBioAvail, setDiscBioAvail] = useState(false)
  const [discBioChecking, setDiscBioChecking] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const has = Object.values(stored).some((m: unknown) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (has && window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(ok => setDiscBioAvail(ok)).catch(() => {})
      }
    } catch {}
  }, [])

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

        {/* Manager PIN + Biometric */}
        {discountAmount > 0 && (
          <div className="mb-3">
            <p className="text-xs text-[var(--text-3)] text-center mb-2">
              {discBioAvail ? 'Huella digital o PIN de gerente' : 'PIN de gerente para autorizar'}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(false) }}
                placeholder="••••"
                className={`flex-1 bg-[var(--line)] border ${pinError ? 'border-red-500' : 'border-slate-600'} rounded-lg px-4 py-3 text-white text-lg text-center tracking-[0.3em] focus:outline-none focus:border-emerald-500 min-h-[48px]`}
              />
              {discBioAvail && (
                <button
                  onClick={async () => {
                    if (discountAmount <= 0) return
                    setDiscBioChecking(true)
                    try {
                      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
                      const managerCreds = Object.entries(stored).filter(([, m]) => {
                        const member = m as { role?: string }
                        return member.role === 'admin' || member.role === 'gerente'
                      })
                      if (managerCreds.length === 0) { setPinError(true); setDiscBioChecking(false); return }
                      const challenge = new Uint8Array(32)
                      crypto.getRandomValues(challenge)
                      const assertion = await navigator.credentials.get({
                        publicKey: {
                          challenge, rpId: window.location.hostname,
                          allowCredentials: managerCreds.map(([id]) => ({ id: Uint8Array.from(atob(id), c => c.charCodeAt(0)), type: 'public-key' as const })),
                          userVerification: 'required', timeout: 30000,
                        },
                      })
                      if (assertion) {
                        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
                        const member = stored[credId] as { name?: string }
                        if (member?.name) {
                          onApply(discountAmount, reason || (
                            mode === 'cortesia' ? `Cortesía ${cortesiaPersonas}p`
                            : mode === '2x1' ? `Promo 2x1 (${promoPairs} ${promoPairs === 1 ? 'par' : 'pares'})`
                            : `Descuento ${mode === 'percent' ? value + '%' : '$' + value}`
                          ), member.name)
                        }
                      }
                    } catch { setPinError(true) }
                    setDiscBioChecking(false)
                  }}
                  disabled={discBioChecking}
                  className="w-14 min-h-[48px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white flex items-center justify-center transition-colors"
                  title="Autorizar con huella digital"
                >
                  {discBioChecking ? <Loader2 size={22} className="animate-spin" /> : <Lock size={22} />}
                </button>
              )}
            </div>
            {pinError && <p className="text-red-400 text-xs text-center mt-1">PIN incorrecto o huella no reconocida</p>}
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
            disabled={discountAmount <= 0 || (pin.length < 4 && !discBioAvail)}
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
            <h3 className="text-lg font-bold text-white">{step === 'reason' ? 'Cancelar item' : '¿Se preparó este artículo?'}</h3>
            <p className="text-red-400 text-sm">{itemName}</p>
          </div>
        </div>

        {step === 'reason' && (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo de cancelación</label>
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
  const [biometricAvail, setBiometricAvail] = useState(false)
  const [bioChecking, setBioChecking] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const has = Object.values(stored).some((m: unknown) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (has && window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(ok => setBiometricAvail(ok)).catch(() => {})
      }
    } catch {}
  }, [])

  const handleBio = async () => {
    if (!reason.trim()) { setError('Escribe el motivo'); return }
    setBioChecking(true)
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const managerCreds = Object.entries(stored).filter(([, m]) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (managerCreds.length === 0) { setError('No hay huellas de gerente registradas'); setBioChecking(false); return }
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge, rpId: window.location.hostname,
          allowCredentials: managerCreds.map(([id]) => ({ id: Uint8Array.from(atob(id), c => c.charCodeAt(0)), type: 'public-key' as const })),
          userVerification: 'required', timeout: 30000,
        },
      })
      if (assertion) {
        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
        const member = stored[credId] as { name?: string }
        if (member?.name) onConfirm(reason, member.name)
      }
    } catch { setError('Huella no reconocida') }
    setBioChecking(false)
  }

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
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Motivo de anulación</label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError('') }}
              placeholder="Describe el motivo..."
              rows={3}
              className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">
              {biometricAvail ? 'Huella digital o PIN de gerente' : 'PIN de gerente'}
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
              {biometricAvail && (
                <button
                  onClick={handleBio}
                  disabled={bioChecking}
                  className="w-14 min-h-[48px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white flex items-center justify-center transition-colors"
                  title="Autorizar con huella digital"
                >
                  {bioChecking ? <Loader2 size={22} className="animate-spin" /> : <Lock size={22} />}
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
  const [biometricAvail, setBiometricAvail] = useState(false)
  const [bioChecking, setBioChecking] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const has = Object.values(stored).some((m: unknown) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (has && window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(ok => setBiometricAvail(ok)).catch(() => {})
      }
    } catch {}
  }, [])

  const doCashSave = async (manager: string) => {
    const num = parseFloat(amount)
    setSaving(true)
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${sbUrl}/rest/v1/pos_cash_movements`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ client_id: _cid(), turno_id: turnoId, type, amount: num, reason: reason.trim(), actor, approved_by: manager }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onConfirm(type, num, reason.trim(), manager)
    } catch {
      setError('Error al guardar — intenta de nuevo')
      setSaving(false)
    }
  }

  const handleBio = async () => {
    const num = parseFloat(amount)
    if (!num || num <= 0) { setError('Ingresa un monto válido'); return }
    if (!reason.trim()) { setError('Ingresa un motivo'); return }
    setBioChecking(true)
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const managerCreds = Object.entries(stored).filter(([, m]) => {
        const member = m as { role?: string }
        return member.role === 'admin' || member.role === 'gerente'
      })
      if (managerCreds.length === 0) { setError('No hay huellas de gerente registradas'); setBioChecking(false); return }
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge, rpId: window.location.hostname,
          allowCredentials: managerCreds.map(([id]) => ({ id: Uint8Array.from(atob(id), c => c.charCodeAt(0)), type: 'public-key' as const })),
          userVerification: 'required', timeout: 30000,
        },
      })
      if (assertion) {
        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
        const member = stored[credId] as { name?: string }
        if (member?.name) await doCashSave(member.name)
      }
    } catch { setError('Huella no reconocida') }
    setBioChecking(false)
  }

  const handleConfirm = async () => {
    const num = parseFloat(amount)
    if (!num || num <= 0) { setError('Ingresa un monto válido'); return }
    if (!reason.trim()) { setError('Ingresa un motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = await verifyManagerPin(pin)
    if (!manager) { setError('PIN inválido'); return }
    await doCashSave(manager)
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
            <p className="text-[var(--text-3)] text-sm">Retiro o depósito de efectivo</p>
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

          {/* Manager PIN + Biometric */}
          <div>
            <label className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">
              {biometricAvail ? 'Huella digital o PIN de gerente' : 'PIN de gerente'}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
                placeholder="****"
                className="flex-1 bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-emerald-500 min-h-[48px]"
              />
              {biometricAvail && (
                <button
                  onClick={handleBio}
                  disabled={bioChecking || saving}
                  className="w-14 min-h-[48px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white flex items-center justify-center transition-colors"
                  title="Autorizar con huella digital"
                >
                  {bioChecking ? <Loader2 size={22} className="animate-spin" /> : <Lock size={22} />}
                </button>
              )}
            </div>
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
  const router = useRouter()
  const initialCuenta = searchParams.get('cuenta') || ''
  // Cuenta por nombre (estilo Wansoft): sin mesa → mesa 0
  const initialMesa = initialCuenta ? 0 : (Number(searchParams.get('mesa')) || 1)

  const [menuCategories, setMenuCategories] = useState(MENU_CATEGORIES)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [categorySearch, setCategorySearch] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>(() => {
    // Pre-populate from cache to prevent blank flash on mount
    if (typeof window === 'undefined') return []
    try {
      const m = Number(new URLSearchParams(window.location.search).get('mesa'))
      if (m > 0) {
        const cached = localStorage.getItem(`pos_order_${m}`)
        if (cached) {
          const c = JSON.parse(cached)
          if (c.ts && Date.now() - c.ts < 300000 && c.items?.length > 0) return c.items
        }
      }
    } catch {}
    return []
  })
  const [mesa, setMesa] = useState<number>(initialMesa)

  // Sync mesa state when searchParams change (client-side navigation from mesas/plano)
  const urlMesa = initialCuenta ? 0 : (Number(searchParams.get('mesa')) || 0)
  useEffect(() => {
    if (urlMesa > 0 && urlMesa !== mesa) {
      setMesa(urlMesa)
    }
  }, [urlMesa])

  // Order loading is handled by the useEffect below (mesa + clienteNombre dependency)
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
  // Dynamic meseros list from pos_staff (replaces hardcoded MESEROS for dropdown)
  const [meserosList, setMeserosList] = useState<string[]>(MESEROS)
  useEffect(() => {
    fetchMeseros().then(list => {
      setMeserosList(list)
      // If current mesero is not in the new list, update to first available
      if (list.length > 0 && !list.includes(mesero)) {
        const saved = localStorage.getItem('pos_mesero')
        if (saved && list.includes(saved)) {
          setMesero(saved)
        } else {
          // Try matching by first name from staff session
          try {
            const s = sessionStorage.getItem('pos_staff')
            if (s) {
              const staff = JSON.parse(s)
              const match = list.find(m => m.toLowerCase().includes(staff.name?.toLowerCase()?.split(' ')[0] || ''))
              if (match) { setMesero(match); return }
            }
          } catch { /* */ }
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Print queue needs_attention tracking
  const [printNeedsAttention, setPrintNeedsAttention] = useState(0)
  useEffect(() => {
    const update = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail
      setPrintNeedsAttention(detail?.needsAttention ?? 0)
    }
    // Check on mount
    import('@/lib/print-queue').then(m => setPrintNeedsAttention(m.getNeedsAttentionCount())).catch(() => {})
    window.addEventListener('print-queue-updated', update)
    return () => window.removeEventListener('print-queue-updated', update)
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
  const mpPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [allCombos, setAllCombos] = useState<Combo[]>([])
  const [showComboModal, setShowComboModal] = useState(false)

  // Split de cuenta
  const [showSplit, setShowSplit] = useState(false)
  const [showVerify, setShowVerify] = useState(false)
  const [sentItemIds, setSentItemIds] = useState<Set<string>>(new Set())
  const [sentItemSnapshots, setSentItemSnapshots] = useState<Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }>>({})
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
  const [orderRevision, setOrderRevision] = useState<number>(0)
  const [loadingMesa, setLoadingMesa] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoadingMesa(true)
    const loadMesaOrder = async () => {
      try {
        // Cuenta por nombre: busca por customer_name; mesa: busca por número
        const filter = clienteNombre
          ? `customer_name=eq.${encodeURIComponent(clienteNombre)}`
          : `mesa=eq.${mesa}`
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&${filter}&status=in.(abierta,enviada,preparando,lista,entregada)&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (cancelled) return // mesa changed while fetching
        if (res.ok) {
          const rows = await res.json()
          if (cancelled) return // mesa changed during JSON parse
          if (rows.length > 0) {
            const order = rows[0]
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
            const loadedItems2 = items.filter((i: OrderItem & { cancelled?: boolean }) => !i.cancelled)
            setOrderItems(loadedItems2)
            setOrderId(order.id)
            setMesero(order.mesero || meserosList[0] || MESEROS[0])
            setPersonas(order.personas || 2)
            setDiscount(order.descuento || 0)
            setLoadedOrderId(order.id)
            setLoadedUpdatedAt(order.updated_at || order.created_at || null)
            setOrderRevision(order.order_revision ?? 0)
            setOrderNotes(order.notas || '')
            // Mark loaded items as already sent + snapshot for change detection (H-7)
            if (order.status === 'enviada' || order.status === 'preparando' || order.status === 'lista') {
              setSentItemIds(new Set(loadedItems2.map((i: OrderItem) => i.id)))
              const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
              for (const item of loadedItems2) {
                snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
              }
              setSentItemSnapshots(snaps)
            }
          } else {
            // DB says no open order for this mesa — clear stale cache
            try { localStorage.removeItem(`pos_order_${mesa}`) } catch {}
            // Check for unsaved draft
            try {
              const draft = localStorage.getItem(`pos_draft_${mesa}`)
              if (draft) {
                const d = JSON.parse(draft)
                if (d.items?.length > 0 && d.ts && Date.now() - d.ts < 1800000) { // 30 min TTL
                  setOrderItems(d.items)
                  setOrderId(d.orderId || generateId())
                  if (d.mesero) setMesero(d.mesero)
                  if (d.personas) setPersonas(d.personas)
                  setLoadedOrderId(null)
                  setLoadedUpdatedAt(null)
                  setOrderRevision(0)
                  return // draft restored, don't reset
                }
              }
            } catch {}
            setOrderItems([])
            setOrderId(generateId())
            setLoadedOrderId(null)
            setLoadedUpdatedAt(null)
            setOrderRevision(0)
            setDiscount(0)
            setOrderNotes('')
          }
        }
      } catch { /* */ }
      if (!cancelled) setLoadingMesa(false)
    }
    // Safety: ensure loadingMesa is always cleared after 3 seconds max
    const safetyTimer = setTimeout(() => setLoadingMesa(false), 3000)
    // Don't reset order items — keep showing current state until DB responds
    // Only reset tracking state
    setCancelledItems(new Set())
    setVoidedItems(new Set())
    // DB is the only truth — load from server
    loadMesaOrder()
    return () => { cancelled = true; clearTimeout(safetyTimer) }
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
  const [orderId, setOrderId] = useState(() => {
    if (typeof window === 'undefined') return generateId()
    try {
      const m = Number(new URLSearchParams(window.location.search).get('mesa'))
      if (m > 0) {
        const cached = localStorage.getItem(`pos_order_${m}`)
        if (cached) {
          const c = JSON.parse(cached)
          if (c.ts && Date.now() - c.ts < 300000 && c.id) return c.id
        }
      }
    } catch {}
    return generateId()
  })

  // Auto-save draft items to localStorage on every change (prevents loss on refresh)
  useEffect(() => {
    if (mesa > 0 && orderItems.length > 0) {
      try { localStorage.setItem(`pos_draft_${mesa}`, JSON.stringify({ items: orderItems, orderId, mesero, personas, ts: Date.now() })) } catch {}
    } else if (mesa > 0) {
      try { localStorage.removeItem(`pos_draft_${mesa}`) } catch {}
    }
  }, [orderItems, mesa, orderId, mesero, personas])

  // R2D: Listen for successful offline replay → advance active order revision
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.orderId === orderId && typeof detail?.revision === 'number' && detail.revision > orderRevision) {
        setOrderRevision(detail.revision)
        // Refresh server updated_at to prevent false checkOrderConflict
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${detail.orderId}&select=updated_at`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
        }).then(r => r.json()).then(rows => {
          if (Array.isArray(rows) && rows[0]?.updated_at) setLoadedUpdatedAt(rows[0].updated_at)
        }).catch(() => {})
      }
    }
    window.addEventListener('pos-order-synced', handler)
    return () => window.removeEventListener('pos-order-synced', handler)
  }, [orderId, orderRevision])

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
        setStaffRole(s.role || 'cajero')
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
  const can = (perm: string) => _perms ? (_perms as unknown as Record<string, boolean>)[perm] ?? false : staffRole === 'admin'

  // Section visibility (maps nav sections to granular permissions)
  const canSee = (section: string) => {
    const sectionMap: Record<string, string> = {
      mesas: 'ver_todas_cuentas',  // cajero can see mesas (to charge) but not open new ones
      cocina: 'registro_comanda',
      kds: 'registro_comanda',
      barra: 'registro_comanda',
      panaderia: 'registro_comanda',
      recetas: 'control_existencias_pos',
      compras: 'control_existencias_pos',
      inventario: 'control_existencias_pos',
      'auditoria': 'reportes',
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
            // Play notification sound — reuse single AudioContext
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
                setTimeout(() => ctx.close().catch(() => {}), 500)
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
  const operationLock = useRef(false)
  const genOpId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
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
  }, [menuCategories])

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
    // R0.5 CONTAINMENT — recipe reversal suspended because R0 suspends forward
    // recipe deductions. Reversing never-deducted stock creates phantom inflation.
    // Will be re-enabled via unified R1 reconciler. See R0.5 containment.
    if (!voided && prepared) {
      console.log(`[inventory] R0.5 containment: reversal for ${cancellingItem.nombre} suspended — forward deduction was R0-suspended`)
    }
    if (voided) {
      console.log(`[inventory] R0.5 containment: void reversal for ${cancellingItem.nombre} suspended — forward deduction was R0-suspended`)
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
    if (saving) return
    setSaving(true)
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
    // Mark order as cancelled via revision-aware boundary (reconciliation-relevant status)
    if (loadedOrderId) {
      const voidOpId = genOpId()
      const voidRes = await fetch('/api/pos/save-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: loadedOrderId,
          expected_revision: orderRevision,
          save_operation_id: voidOpId,
          status: 'cancelada',
          notas: `ANULADA: ${reason} (por ${managerName})`,
        }),
      })
      const voidResult = voidRes.ok ? await voidRes.json() : { ok: false }
      if (voidResult.conflict) {
        showToast('Orden modificada por otra terminal — recarga para ver cambios')
        setSaving(false); operationLock.current = false
        return
      }
      if (!voidResult.ok) {
        showToast('Error al anular — la orden NO se anuló. Reintenta.')
        setSaving(false); operationLock.current = false
        return
      }
      if (voidResult.revision != null) setOrderRevision(voidResult.revision)
    }
    // R0.5 CONTAINMENT — recipe reversal suspended because R0 suspends forward
    // recipe deductions. Reversing never-deducted stock creates phantom inflation.
    // Will be re-enabled via unified R1 reconciler. See R0.5 containment.
    const sentCount = orderItems.filter(i => sentItemIds.has(i.id)).length
    if (sentCount > 0) {
      console.log(`[inventory] R0.5 containment: order void reversal for ${sentCount} items suspended — forward deduction was R0-suspended`)
    }
    setOrderItems([])
    setCancelledItems(new Set())
    setVoidedItems(new Set())
    setDiscount(0)
    setOrderNotes('')
    setShowVoidOrder(false)
    showToast(`Orden anulada — aprobado por ${managerName}`)
    setSaving(false); operationLock.current = false
  }, [orderId, mesero, mesa, orderItems, loadedOrderId, saving, sentItemIds])

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
    // Clamp discount if items were removed and discount now exceeds subtotal
    if (discount > subtotal) {
      setDiscount(Math.min(discount, subtotal))
      showToast('Descuento ajustado al nuevo subtotal')
    }
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

  const subtotalAfterDiscount = Math.round(Math.max(0, subtotal - discount) * 100) / 100
  const iva = Math.round(subtotalAfterDiscount * IVA_RATE * 100) / 100
  const total = Math.round((subtotalAfterDiscount + iva) * 100) / 100

  // Concurrency check: verify order hasn't been modified by another terminal
  const checkOrderConflict = async (context: string): Promise<boolean> => {
    if (!loadedOrderId || !loadedUpdatedAt) return false // no conflict possible
    try {
      const checkRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}&select=updated_at,created_at,status&limit=1`,
        { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
      )
      if (checkRes.ok) {
        const rows = await checkRes.json()
        if (rows.length > 0) {
          // Check if already closed (prevents double payment)
          if (rows[0].status === 'cerrada' || rows[0].status === 'cancelada') {
            showToast(`Esta orden ya fue ${rows[0].status} por otro usuario`)
            return true
          }
          const currentUpdatedAt = rows[0].updated_at || rows[0].created_at
          if (currentUpdatedAt && currentUpdatedAt !== loadedUpdatedAt) {
            showToast('Esta orden fue modificada por otro usuario. Recarga la mesa.')
            return true
          }
        }
      }
    } catch {
      // Network error during conflict check — block payment (safe side), allow kitchen send
      if (context === 'payment') {
        showToast('No se pudo verificar el estado de la orden. Reintenta.')
        return true
      }
    }
    return false
  }

  const handleSendToKitchen = async () => {
    if (activeItems.length === 0 || operationLock.current) return
    operationLock.current = true
    setSaving(true)
    const opId = genOpId()
    try {

    if (!turnoId) { showToast('No hay turno activo. Un encargado debe abrir turno.'); return }

    // Multi-user conflict check
    if (await checkOrderConflict('kitchen')) {
      return
    }

    // Phantom order prevention: if this is a NEW order (not loaded from DB),
    // re-check Supabase to see if another terminal already created one for this mesa
    if (!loadedOrderId && mesa) {
      try {
        const filter = clienteNombre
          ? `customer_name=eq.${encodeURIComponent(clienteNombre)}`
          : `mesa=eq.${mesa}`
        const raceRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&${filter}&status=in.(abierta,enviada,preparando)&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (raceRes.ok) {
          const raceRows = await raceRes.json()
          if (raceRows.length > 0) {
            const existing = raceRows[0]
            // Another terminal already created an order — load it instead of creating a duplicate
            const items = typeof existing.items === 'string' ? JSON.parse(existing.items) : (existing.items || [])
            const loadedItems = items.filter((i: OrderItem & { cancelled?: boolean }) => !i.cancelled)
            setOrderItems(loadedItems)
            setOrderId(existing.id)
            setLoadedOrderId(existing.id)
            setLoadedUpdatedAt(existing.updated_at || existing.created_at || null)
            setOrderRevision(existing.order_revision ?? 0)
            if (existing.mesero) setMesero(existing.mesero)
            if (existing.personas) setPersonas(existing.personas)
            if (existing.status === 'enviada' || existing.status === 'preparando') {
              setSentItemIds(new Set(loadedItems.map((i: OrderItem) => i.id)))
              const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
              for (const item of loadedItems) {
                snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
              }
              setSentItemSnapshots(snaps)
            }
            // Silently load existing order — no toast needed
            setSaving(false); operationLock.current = false
            return
          }
        }
      } catch { /* network error — proceed with creation */ }
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
      orderRevision,
    }
    // SAVE FIRST — confirm persistence before printing
    // R2D: opId generated ONCE per logical save action, survives catch → queue → replay
    const saveResult = await saveOrder(order, opId)
    if (!saveResult.ok) {
      if (saveResult.conflict) {
        showToast('Orden modificada por otra terminal — recarga para ver cambios')
      } else if (saveResult.error === 'OFFLINE_QUEUED') {
        showToast('Sin conexión — orden guardada localmente, se enviará al reconectar')
      } else {
        showToast('Error al guardar orden — NO se imprimió')
      }
      setSaving(false); operationLock.current = false
      return
    }
    if (saveResult.revision != null) setOrderRevision(saveResult.revision)
    if (saveResult.inventory_status === 'BLOCKED') {
      showToast('Inventario: algunos ingredientes no se pudieron descontar')
    }
    const ok = true

    // Only print NEW items (not already sent to kitchen)
    const newItems = activeItems.filter(i => !sentItemIds.has(i.id))
    if (newItems.length > 0) {
      const printOrder: Order = { ...order, items: newItems }
      const printResult = await printByStation(printOrder)
      if (printResult.failed.length > 0) {
        showToast(`⚠ Impresora sin conexión: ${printResult.failed.join(', ')}`)
      }
    }

    // Detect CHANGES in already-sent items (H-7: update comanda)
    const changedItems: ItemChange[] = []
    for (const item of activeItems) {
      if (!sentItemIds.has(item.id)) continue // new item, already handled above
      const snapshot = sentItemSnapshots[item.id]
      if (!snapshot) continue
      const changes = detectItemChanges(snapshot, item)
      if (changes.length > 0) {
        const station = item.station ?? 'cocina'
        changedItems.push({ itemId: item.id, nombre: item.nombre, station, changes })
        logAudit({
          order_id: orderId, action: 'kitchen_item_updated', actor: mesero, mesa,
          details: {
            item_id: item.id, item: item.nombre,
            before: snapshot, after: { cantidad: item.cantidad, modificadores: item.modificadores, notas: item.notas, silla: item.silla },
          },
        })
      }
    }
    if (changedItems.length > 0) {
      const updateResult = await printUpdateByStation(order, changedItems)
      if (updateResult.failed.length > 0) {
        showToast(`⚠ Actualización no impresa: ${updateResult.failed.join(', ')}`)
      }
    }

    // Track all items as sent + update snapshots
    setSentItemIds(prev => {
      const next = new Set(prev)
      activeItems.forEach(i => next.add(i.id))
      return next
    })
    setSentItemSnapshots(prev => {
      const next = { ...prev }
      for (const item of activeItems) {
        next[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
      }
      return next
    })

    // UI feedback
    showToast(newItems.length > 0 ? `${newItems.length} items enviados` : 'Orden actualizada')
    setSentToKitchen(true)
    setTimeout(() => setSentToKitchen(false), 2000)

    // Post-save actions
    logAudit({
        order_id: orderId, action: 'order_sent_kitchen', actor: mesero, mesa,
        details: { items_count: activeItems.length, total },
      })

      // Auto-deduct ingredients from inventory — IDEMPOTENT (Principle #12)
      // Only deduct NEW items + quantity DELTAS of already-sent items
      const itemsToDeduct: typeof activeItems = []
      for (const item of activeItems) {
        if (!sentItemIds.has(item.id)) {
          // New item: deduct full quantity
          itemsToDeduct.push(item)
        } else {
          // Already sent: check if quantity increased (deduct only the delta)
          const snapshot = sentItemSnapshots[item.id]
          if (snapshot && item.cantidad > snapshot.cantidad) {
            const delta = item.cantidad - snapshot.cantidad
            itemsToDeduct.push({ ...item, cantidad: delta, subtotal: (item.precio + item.precioExtra) * delta })
          }
          // If quantity decreased or unchanged, don't deduct (reversal is separate)
        }
      }
      // R0 CONTAINMENT — recipe inventory deduction suspended because canonical
      // recipe truth is not established. pos_recipes_old contains duplicate import
      // generations that produce inflated deductions (2-4x per order). Deduction will
      // be re-enabled via reconcile_order_inventory RPC after canonical recipe schema
      // is migrated and validated. See docs/CUTOVER-BLOCKER-PLAN.md P0-2/R0.
      if (itemsToDeduct.length > 0) {
        console.log(`[inventory] R0 containment: ${itemsToDeduct.length} items would deduct — suspended pending canonical recipe truth`)
      }

      setLoadedOrderId(orderId)
      // Read server's actual updated_at (trigger sets it, may differ from client time)
      try {
        const freshRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}&select=updated_at`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
        })
        if (freshRes.ok) {
          const rows = await freshRes.json()
          if (rows[0]?.updated_at) setLoadedUpdatedAt(rows[0].updated_at)
          else setLoadedUpdatedAt(new Date().toISOString())
        } else setLoadedUpdatedAt(new Date().toISOString())
      } catch { setLoadedUpdatedAt(new Date().toISOString()) }
      setSaving(false); operationLock.current = false
      // Cache order locally so it loads instantly when returning to this mesa
      try {
        localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({ id: orderId, items: activeItems, mesero, personas, discount, notas: orderNotes, ts: Date.now() }))
        localStorage.removeItem(`pos_draft_${mesa}`) // clear draft after successful save
      } catch {}
      // Mode-dependent behavior after sending to kitchen:
      // Comandero (mesero): clear session, return to mesas
      // Caja (cajero/gerente/admin): stay on order to charge
      if (staffRole === 'mesero' || staffRole === 'capitan') {
        // Modo Comandero: regresa a mesas para tomar siguiente orden
        if (navigator.onLine) {
          sessionStorage.removeItem('pos_staff')
          sessionStorage.removeItem('pos_last_activity')
          setTimeout(() => { router.push('/pos/mesas') }, 1200)
        } else {
          showToast('Offline — orden guardada localmente')
        }
      }
      // Modo Caja (cajero/gerente/admin): se queda en la orden para cobrar
    } finally {
      operationLock.current = false
      setSaving(false)
    }
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
    if (!turnoId) { showToast('No hay turno activo. Un encargado debe abrir turno.'); return }
    // Block payment if order was never sent to kitchen (no items sent, no loaded order from DB)
    if (sentItemIds.size === 0 && !loadedOrderId) {
      showToast('Primero envía la orden a cocina antes de cobrar')
      return
    }
    setVerifiedPersonas(personas)
    setCustomPersonas('')
    setShowPersonVerify(true)
  }

  const handlePayment = async (method: string) => {
    if (operationLock.current) return
    operationLock.current = true
    setSaving(true)
    const opId = genOpId()
    try {

    // Turno must still be active at payment time
    if (!turnoId) {
      showToast('No hay turno activo. No se puede cobrar.')
      return
    }

    // Concurrency check: prevent double payment or payment on modified order
    if (await checkOrderConflict('payment')) {
      return
    }

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
      orderRevision: splitPayingCuenta > 0 ? 0 : orderRevision,  // Split creates new order → rev 0
    }
    // R2D: opId generated ONCE per logical payment action
    const saveResult = await saveOrder(order, opId)
    if (saveResult.conflict) {
      showToast('Orden modificada por otra terminal — recarga para ver cambios')
      setSaving(false); operationLock.current = false
      return
    }
    if (saveResult.revision != null) setOrderRevision(saveResult.revision)
    if (saveResult.inventory_status === 'BLOCKED') {
      showToast('Inventario: algunos ingredientes no se pudieron descontar')
    }
    const ok = saveResult.ok
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
        setSaving(false); operationLock.current = false
        return // Don't reset order yet
      }

      // Fully done (no split, or last cuenta paid)
      showToast(`Todas las cuentas cobradas — ${method}${propina > 0 ? ` + propina ${formatMXN(propina)}` : ''}`)

      setSaving(false); operationLock.current = false
      setOrderItems([])
      setCancelledItems(new Set())
      setSentItemIds(new Set())
      setSentItemSnapshots({})
      setDiscount(0)
      setPropina(0)
      // Clear localStorage cache for this mesa
      try { localStorage.removeItem(`pos_order_${mesa}`) } catch {}
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
      setOrderId(generateId())
    } else {
      showToast('Error al cerrar cuenta')
      setSaving(false); operationLock.current = false
    }
    } finally {
      operationLock.current = false
      setSaving(false)
    }
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
              onClear={async () => {
                const { clearAllPending } = await import('@/lib/pos-offline-db')
                await clearAllPending()
                setPendingSync(0)
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
              onClick={async () => {
                // Bloquear: regresa a la pantalla de PIN sin perder la orden en BD
                // Clean up server session
                try {
                  const { removeSession: _removeSession } = await import('@/lib/pos-sessions')
                  _removeSession().catch(() => {})
                } catch { /* */ }
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
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-[var(--line)] text-white rounded-lg px-4 py-2 text-lg font-bold border border-slate-600 min-h-[48px]">
            {Array.from({ length: 20 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}p</option>))}
          </select>
          <select value={mesero} onChange={(e) => { const newMesero = e.target.value; setMesero(newMesero); try { localStorage.setItem('pos_mesero', newMesero) } catch {} if (loadedOrderId) { fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}`, { method: 'PATCH', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ mesero: newMesero }) }) } }} className="bg-[var(--line)] text-white rounded-lg px-3 py-2 text-base font-medium border border-slate-600 min-h-[48px] flex-1 min-w-0">
            {meserosList.map((m) => (<option key={m} value={m}>{m}</option>))}
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

      {/* Print queue needs_attention banner — persistent until resolved */}
      {printNeedsAttention > 0 && (
        <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between flex-shrink-0 text-sm font-bold">
          <span>{printNeedsAttention} comanda{printNeedsAttention > 1 ? 's' : ''} sin imprimir</span>
          <button
            onClick={async () => {
              const { retryAllNeedsAttention } = await import('@/lib/print-queue')
              retryAllNeedsAttention()
            }}
            className="bg-white text-red-600 px-3 py-1 rounded font-bold text-xs"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Main Content */}
      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-64 bg-[var(--surface-2)] border-r border-[var(--line)] p-4 shadow-2xl overflow-y-auto max-h-[100dvh] pos-fat-scroll" onClick={e => e.stopPropagation()}>
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
                { href: '/pos/auditoria', icon: FileText, label: 'Auditoria', section: 'auditoria' },
                { href: '/pos/corte', icon: Receipt, label: 'Corte de caja', section: 'corte' },
                { href: '/pos/qr', icon: QrCode, label: 'QR Mesas', section: 'qr' },
                { href: '/pos/turno', icon: Clock, label: 'Turno', section: 'turno' },
                { href: '/pos/facturacion', icon: Stamp, label: 'Facturación', section: 'facturacion' },
                { href: '/pos/recepcion-factura', icon: FileText, label: 'Recepción XML', section: 'facturacion' },
                { href: '/pos/facturas-proveedor', icon: FileText, label: 'Facturas Proveedor', section: 'facturacion' },
                { href: '/pos/asistencia', icon: Clock, label: 'Checador', section: 'configuracion' },
                { href: '/pos/staff-analytics', icon: Users, label: 'Rutina Meseros', section: 'configuracion' },
                { href: '/pos/monitor', icon: Monitor, label: 'Monitor', section: 'configuracion' },
                { href: '/pos/historial', icon: FileText, label: 'Historial', section: 'historial' },
                { href: '/pos/staff', icon: Users, label: 'Empleados', section: 'configuracion' },
                { href: '/pos/huella', icon: Lock, label: 'Huellas', section: 'configuracion' },
                { href: '/pos/configuracion', icon: Settings, label: 'Configuración', section: 'configuracion' },
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

            {/* Cerrar app — admin/gerente only */}
            {(staffRole === 'admin' || staffRole === 'gerente') && (
              <div className="mt-4 pt-4 border-t border-[var(--line)]">
                <button
                  onClick={() => {
                    setShowNav(false)
                    setPinInput('')
                    setPinPrompt({
                      title: 'PIN de gerente para cerrar la app:',
                      onSubmit: async (pin: string) => {
                        const managerName = await verifyManagerPin(pin)
                        if (!managerName) { alert('PIN incorrecto'); return }
                        setPinPrompt(null)
                        logAudit({ action: 'cerrar_app', actor: managerName, mesa: 0, details: {} })
                        if ((window as any).fullsiteApp?.quit) {
                          ;(window as any).fullsiteApp.quit()
                        } else {
                          try { document.exitFullscreen?.() } catch {}
                          window.location.href = 'about:blank'
                        }
                      },
                    })
                  }}
                  className="flex items-center gap-3 px-4 py-2 rounded-xl w-full text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors min-h-[40px]"
                >
                  <Power size={18} />
                  <span className="text-sm font-medium">Cerrar app</span>
                </button>
              </div>
            )}
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

                      {/* Item name + modifiers + KDS status */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm leading-tight ${isVoided ? 'line-through text-slate-500' : isCancelled ? 'line-through text-red-400' : ''}`}>
                          {item.nombre}
                          {!isCancelled && !isVoided && (item as OrderItem & { kds_done?: boolean }).kds_done && (
                            <span className="ml-2 inline-block bg-emerald-500/20 text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">LISTO</span>
                          )}
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
                          {can('cancelar_ordenes') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
                            title="Cancelar item (requiere gerente)"
                          >
                            <Ban size={18} />
                          </button>
                          )}
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
                disabled={orderItems.length === 0 || !can('descuentos_ordenes_pct')}
                className="flex items-center gap-1.5 px-4 min-h-[48px] rounded-lg bg-[var(--line)] hover:bg-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-4)] text-sm font-semibold transition-colors"
                title={!can('descuentos_ordenes_pct') ? 'Sin permiso para descuentos' : 'Aplicar descuento'}
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
                    id: orderId, items: activeItems, mesa: Number(mesa) || 0, mesero,
                    subtotal: Number(subtotal), descuento: Number(discount), iva: Number(iva), total: Number(total), propina: 0,
                    metodoPago: 'efectivo', status: 'cerrada',
                    personas: Number(personas) || 2,
                    createdAt: new Date(),
                    notas: '*** REIMPRESIÓN ***',
                  }
                  handlePrintTicket(reprintOrder)
                  logAudit({ order_id: orderId, action: 'ticket_reprinted', actor: mesero, mesa, details: { total } })
                  showToast('Reimpresión de ticket')
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
                    onSubmit: async (input: string) => {
                      const newMesa = parseInt(input, 10)
                      if (isNaN(newMesa) || newMesa <= 0) { showToast('Numero de mesa invalido'); return }
                      const oldMesa = mesa
                      setMesa(newMesa)
                      // Persist to Supabase — keep current status (or 'enviada' if unknown)
                      if (orderId && loadedOrderId) {
                        await updateOrderStatus(orderId, 'enviada', { mesa: newMesa })
                      } else {
                        // New unsaved order — block transfer, must send to kitchen first
                        setMesa(Number(oldMesa))
                        showToast('Envia la orden a cocina antes de transferir mesa')
                        setPinPrompt(null)
                        return
                      }
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
            {orderItems.length === 0 ? (
              <button
                onClick={() => router.push('/pos/mesas')}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-500 active:bg-slate-700 active:scale-[0.97] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
              >
                <ArrowLeft size={18} />
                Salir
              </button>
            ) : (<>
            <button
              onClick={() => setShowVerify(true)}
              disabled={activeItems.length === 0}
              className="flex-[0.5] flex items-center justify-center gap-1 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-sm transition-all min-h-[52px]"
            >
              <ClipboardCheck size={16} />
              Verificar
            </button>
            <button
              onClick={handleSendToKitchen}
              disabled={activeItems.length === 0 || saving || loadingMesa}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
            >
              {saving ? <div className="w-[18px] h-[18px] border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={18} />}
              {saving ? 'Enviando' : sentToKitchen ? 'Enviado' : 'Enviar'}
            </button>
            <button
              onClick={handlePreTicket}
              disabled={activeItems.length === 0 || saving || loadingMesa}
              className="flex-[0.6] flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
            >
              <Receipt size={16} />
              Cuenta
            </button>
            <button
              onClick={() => { if (activeItems.length >= 2) { setSplitMode(null); setSplitCount(0); setSplitParejoN(0); setSplitAssignments({}); setShowSplit(true) } else handleCloseOrder() }}
              disabled={activeItems.length === 0 || saving || !can('cerrar_cuentas')}
              className="flex-[0.4] flex items-center justify-center bg-purple-600 hover:bg-purple-500 active:bg-purple-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
              title={!can('cerrar_cuentas') ? 'Sin permiso para cobrar' : ''}
            >
              Split
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={activeItems.length === 0 || saving || !can('cerrar_cuentas')}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
              title={!can('cerrar_cuentas') ? 'Sin permiso para cobrar' : ''}
            >
              <CreditCard size={18} />
              {!can('cerrar_cuentas') ? 'Sin permiso' : 'Cobrar'}
            </button>
            </>)}
          </div>
        </div>

        {/* Right Panel -- Menu (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`} style={{background:'#0d0d12'}}>
          {/* Search bar — touch target + barcode scanner */}
          <div className="px-2 pt-1 pb-0.5 flex-shrink-0 flex gap-2">
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="flex-1 bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-1.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500 min-h-[36px]"
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
            <div className="px-2 pb-0.5 flex-shrink-0 flex items-center gap-1 overflow-x-auto">
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
              <div className="flex-1 bg-[var(--surface-2)]/50 p-1 overflow-hidden">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1 h-full" style={{ gridAutoRows: '1fr' }}>
                  {allCombos.length > 0 && (
                    <button
                      onClick={() => setShowComboModal(true)}
                      className="px-3 py-3 rounded-xl text-sm font-bold text-center transition-all min-h-[72px] leading-tight flex flex-col items-center justify-center gap-0.5 bg-gradient-to-br from-amber-600 to-orange-600 text-white hover:opacity-100 active:scale-95 ring-2 ring-amber-400/30"
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
                          className={`px-3 py-3 rounded-xl text-sm font-bold text-center transition-all min-h-[72px] leading-tight flex flex-col items-center justify-center gap-0.5 ${catColor} opacity-85 text-white hover:opacity-100 active:scale-95`}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setSelectedCategory(''); setCategorySearch('') }}>
                  <div className={`bg-[#111118] rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl w-[96vw] max-w-[1200px] overflow-hidden flex flex-col ${activeCategory.items.filter(i => i.price > 0).length > 15 ? 'h-[90vh]' : 'max-h-[90vh]'}`} onClick={e => e.stopPropagation()}>
                    <div className={`flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.08)] ${(activeCategory as { color?: string }).color || 'bg-emerald-600'}`}>
                      <h3 className="text-white font-bold text-lg">{activeCategory.name} <span className="text-white/60 text-sm font-normal ml-2">{activeCategory.items.filter(i => i.price > 0).length} platillos</span></h3>
                      <button onClick={() => { setSelectedCategory(''); setCategorySearch('') }} className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30 active:scale-95">&times;</button>
                    </div>
                    {activeCategory.items.filter(i => i.price > 0).length > 30 && (
                      <div className="px-3 pt-2">
                        <input
                          type="text"
                          value={categorySearch}
                          onChange={e => setCategorySearch(e.target.value)}
                          placeholder="Buscar en esta categoría..."
                          className="w-full bg-[#1a1a24] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/50"
                          autoFocus
                        />
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto p-2 overscroll-contain pos-fat-scroll flex flex-col" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 flex-1" style={{ gridAutoRows: 'minmax(80px, 150px)', minHeight: 0 }}>
                {activeCategory.items.filter(item => item.price > 0 && (!categorySearch || item.name.toLowerCase().includes(categorySearch.toLowerCase()))).map((item) => {
                    const isOOS = outOfStockItems.has(item.id)
                    return (
                    <button
                      key={item.id}
                      onClick={() => { if (isOOS) { showToast(`${item.name} — AGOTADO`); return } handleMenuItemTap(item, activeCategory.id); setSelectedCategory(''); setMobileView('order') }}
                      className={`bg-[#1a1a24] hover:bg-[#222230] active:scale-[0.97] border rounded-xl text-left transition-all flex overflow-hidden relative shadow-sm ${
                        isOOS
                          ? 'border-red-500/30 opacity-50 cursor-not-allowed'
                          : (item as MenuItem & { promo?: boolean }).promo
                          ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                          : 'border-[rgba(255,255,255,0.08)] hover:border-emerald-500/30'
                      }`}
                    >
                      <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-red-500' : (activeCategory as { color?: string }).color || 'bg-emerald-600'}`} />
                      {isOOS && <span className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase">Agotado</span>}
                      <div className="flex flex-col justify-between px-3 py-2.5 flex-1">
                        <span className={`font-semibold text-sm leading-snug ${isOOS ? 'text-gray-500 line-through' : 'text-white'}`}>{item.name}</span>
                        <span className={`font-bold text-base mt-1 ${isOOS ? 'text-red-400' : 'text-emerald-400'}`}>${Math.round(item.price)}</span>
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
                    <div className="overflow-y-auto p-4 max-h-[65vh] overscroll-contain pos-fat-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
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

      {/* Verificar Orden Modal — tabla con columnas de modificadores */}
      {showVerify && (() => {
        // Group items by base product name (without modifiers)
        const byProduct: Record<string, typeof activeItems> = {}
        for (const item of activeItems) {
          const base = item.nombre
          if (!byProduct[base]) byProduct[base] = []
          byProduct[base].push(item)
        }
        const products = Object.entries(byProduct).sort(([a], [b]) => a.localeCompare(b))

        // Collect all unique modifier names across all items for column headers
        const allMods = new Set<string>()
        for (const item of activeItems) {
          const mods = Array.isArray(item.modificadores) ? item.modificadores : (item.modificadores ? [item.modificadores] : [])
          mods.forEach((m: string) => {
            // Split compound modifiers like "VERDES · AGUACATE +$55 · CHICHARRON 50..."
            m.split(/\s*[·]\s*/).forEach(part => {
              const clean = part.replace(/\+?\$[\d,.]+/g, '').trim()
              if (clean) allMods.add(clean)
            })
          })
        }
        const modColumns = Array.from(allMods).sort()

        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowVerify(false)}>
            <div className="bg-[#111118] rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl w-[96vw] max-w-[1000px] max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="bg-cyan-600 px-5 py-3 flex items-center justify-between flex-shrink-0">
                <h3 className="text-white font-bold text-lg">Verificar Orden — Mesa {mesa} <span className="text-white/60 font-normal ml-2">{activeItems.reduce((s, i) => s + i.cantidad, 0)} items</span></h3>
                <button onClick={() => setShowVerify(false)} className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30">&times;</button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {products.map(([productName, items]) => (
                  <div key={productName} className="mb-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-white font-bold text-base">{productName}</span>
                      <span className="text-[var(--text-3)] text-sm">×{items.reduce((s, i) => s + i.cantidad, 0)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[rgba(255,255,255,0.1)]">
                            <th className="py-1.5 text-left text-[var(--text-3)] font-medium w-10">#</th>
                            {modColumns.filter(mc => items.some(item => {
                              const mods = Array.isArray(item.modificadores) ? item.modificadores.join(' · ') : (item.modificadores || '')
                              return mods.toUpperCase().includes(mc.toUpperCase())
                            })).map(mc => (
                              <th key={mc} className="py-1.5 text-center text-[var(--text-3)] font-medium px-2 text-xs">{mc}</th>
                            ))}
                            <th className="py-1.5 text-right text-[var(--text-3)] font-medium">Precio</th>
                            <th className="py-1.5 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => {
                            const itemMods = Array.isArray(item.modificadores) ? item.modificadores.join(' · ') : (item.modificadores || '')
                            const relevantMods = modColumns.filter(mc => items.some(it => {
                              const m = Array.isArray(it.modificadores) ? it.modificadores.join(' · ') : (it.modificadores || '')
                              return m.toUpperCase().includes(mc.toUpperCase())
                            }))
                            return (
                              <tr key={item.id || idx} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.03)]">
                                <td className="py-2 text-white font-bold">{item.cantidad}</td>
                                {relevantMods.map(mc => (
                                  <td key={mc} className="py-2 text-center">
                                    {itemMods.toUpperCase().includes(mc.toUpperCase())
                                      ? <span className="text-emerald-400 text-lg">✓</span>
                                      : <span className="text-[var(--text-4)]">—</span>
                                    }
                                  </td>
                                ))}
                                <td className="py-2 text-right text-white font-semibold">${Math.round(item.precio).toLocaleString()}</td>
                                <td className="py-2 text-center">
                                  <button
                                    onClick={() => { setShowVerify(false); handleEditOrderItem(item) }}
                                    className="w-8 h-8 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center mt-2 pt-3 border-t border-[rgba(255,255,255,0.1)]">
                  <span className="text-[var(--text-3)] text-lg">{activeItems.reduce((s, i) => s + i.cantidad, 0)} items</span>
                  <span className="text-white font-bold text-2xl">${Math.round(activeItems.reduce((s, i) => s + i.precio * i.cantidad, 0)).toLocaleString()}</span>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-[rgba(255,255,255,0.1)] flex gap-3 flex-shrink-0">
                <button
                  onClick={() => setShowVerify(false)}
                  className="flex-1 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-white font-bold text-base hover:bg-[var(--line)] transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => { setShowVerify(false); handleSendToKitchen() }}
                  disabled={saving}
                  className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2 transition-colors"
                >
                  <Send size={18} />
                  Enviar
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2">
          <div className="bg-[var(--surface-2)] rounded-2xl p-5 w-full max-w-3xl border border-[var(--line)] max-h-[96vh] min-h-[420px] overflow-y-auto">
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
                onClick={() => { if (mpPollRef.current) { clearInterval(mpPollRef.current); mpPollRef.current = null } operationLock.current = false; setSaving(false); setShowPayment(false); setShowCardConfirm(false); setSplitPayingCuenta(0); setSplitCount(0); setSplitMode(null); setSplitParejoN(0); setCashAmount('') }}
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

            <div className="text-center mb-3">
              <p className="text-[var(--text-3)] text-sm">Mesa {mesa} · {mesero}</p>
              <p className="text-5xl font-black text-white">{formatMXN(payTotal)}</p>
              {discount > 0 && splitPayingCuenta === 0 && (
                <p className="text-red-400 text-sm mt-1">Descuento: -{formatMXN(discount)}</p>
              )}
              {propina > 0 && (
                <p className="text-emerald-400 text-lg font-bold">+ propina {formatMXN(propina)} = {formatMXN(payTotal + propina)}</p>
              )}
            </div>

            {/* Propina */}
            <div className="mb-3">
              <div className="flex gap-2">
                {[0, 10, 15, 20].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setPropina(pct === 0 ? 0 : Math.round(payTotal * pct / 100))}
                    className={`flex-1 min-h-[56px] rounded-xl text-lg font-bold transition-colors ${
                      (pct === 0 && propina === 0) || (pct > 0 && propina === Math.round(payTotal * pct / 100))
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--line)] text-[var(--text-4)]'
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
                  className="w-28 min-h-[56px] bg-[var(--line)] border border-slate-600 rounded-xl px-3 text-white text-lg text-center focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowCashFlow(!showCashFlow)}
                className="flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-5 rounded-xl text-xl transition-colors min-h-[72px]"
              >
                <Banknote size={20} />
                Efectivo
              </button>
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
                        mpPollRef.current = setInterval(async () => {
                          attempts++
                          try {
                            const statusRes = await fetch(apiUrl('/api/mp-point'), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'status', accessToken: mpToken, paymentIntentId: intentId }),
                            })
                            const statusData = await statusRes.json()
                            if (statusData.state === 'FINISHED') {
                              clearInterval(mpPollRef.current!); mpPollRef.current = null
                              handlePayment('Tarjeta de crédito')
                            } else if (statusData.state === 'CANCELED' || statusData.state === 'ERROR' || attempts > 60) {
                              clearInterval(mpPollRef.current!); mpPollRef.current = null
                              setSaving(false); operationLock.current = false
                              showToast(statusData.state === 'CANCELED' ? 'Pago cancelado' : 'Error en terminal')
                            }
                          } catch { /* keep polling */ }
                        }, 3000)
                      } else {
                        // MP failed, fall back to manual
                        setSaving(false); operationLock.current = false
                        handlePayment('Tarjeta de crédito')
                      }
                    } catch {
                      setSaving(false); operationLock.current = false
                      handlePayment('Tarjeta de crédito')
                    }
                  } else {
                    // Sin MP configurado — terminal bancaria standalone (Getnet):
                    // mostrar monto gigante para que el cajero lo teclee sin error
                    setShowCardConfirm(true)
                  }
                }}
                disabled={saving}
                className="flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold py-5 rounded-xl text-xl transition-colors min-h-[72px]"
              >
                <CreditCard size={24} />
                {saving ? 'Terminal...' : 'Tarjeta'}
              </button>
              </div>
              {showCashFlow && (() => {
                const totalConPropina = payTotal + propina
                const cashReceived = parseFloat(cashAmount) || 0
                const cambio = cashReceived - totalConPropina
                return (
                  <div className="bg-[var(--surface-2)] border border-emerald-700/40 rounded-xl p-4 space-y-3">
                    <p className="text-emerald-400 text-lg font-bold text-center">Total a cobrar: {formatMXN(totalConPropina)}</p>
                    <div className="flex gap-3">
                      {[100, 200, 500, 1000].map(bill => (
                        <button key={bill} onClick={() => setCashAmount(String(bill))}
                          className={`flex-1 min-h-[60px] rounded-xl text-lg font-bold transition-colors ${cashAmount === String(bill) ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}
                        >${bill}</button>
                      ))}
                    </div>
                    <input
                      type="number" inputMode="decimal" value={cashAmount}
                      onChange={e => setCashAmount(e.target.value)}
                      placeholder="Monto recibido" autoFocus
                      className="w-full bg-[var(--bg)] border-2 border-slate-600 rounded-xl px-4 py-4 text-white text-3xl text-center font-black focus:outline-none focus:border-emerald-500"
                    />
                    {cashReceived > 0 && (
                      <div className={`text-center py-3 rounded-xl ${cambio >= 0 ? 'bg-emerald-900/40 border border-emerald-700/40' : 'bg-red-900/40 border border-red-700/40'}`}>
                        {cambio >= 0 ? (
                          <p className="text-3xl font-black text-emerald-400">Cambio: {formatMXN(cambio)}</p>
                        ) : (
                          <p className="text-xl text-red-400 font-bold">Falta {formatMXN(Math.abs(cambio))}</p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => { if (cashReceived >= totalConPropina) handlePayment('Efectivo') }}
                      disabled={saving || cashReceived < totalConPropina}
                      className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--line)] disabled:text-[var(--text-3)] text-white font-black text-xl transition-colors min-h-[60px]"
                    >
                      {cashReceived >= totalConPropina ? `Cobrar — Cambio ${formatMXN(cambio)}` : 'Ingresa el monto recibido'}
                    </button>
                  </div>
                )
              })()}
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
                      onClick={() => { setShowCardConfirm(false); handlePayment('Tarjeta de crédito') }}
                      disabled={saving}
                      className="flex-[2] py-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-black text-lg min-h-[56px] transition-colors"
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
                      disabled={saving}
                      className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
                    >
                      <Send size={18} />
                      Transferencia
                    </button>
                  )
                }
                return (
                  <div className="grid grid-cols-3 gap-2">
                    {customMethods.map(m => (
                      <button
                        key={m.id}
                        onClick={() => handlePayment(m.name)}
                        disabled={saving}
                        className="flex items-center justify-center bg-purple-600/80 hover:bg-purple-500 disabled:bg-purple-900 text-white font-bold py-3 rounded-xl text-base transition-colors min-h-[56px]"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )
              })()}
              <button
                onClick={() => { setShowMixto(!showMixto); setMixtoPagos([]); setMixtoMonto(''); setMixtoForma('Efectivo') }}
                className={`w-full flex items-center justify-center gap-2 ${showMixto ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-[var(--line)] hover:bg-[var(--line-soft)] text-[var(--text-2)]'} font-bold py-3 rounded-xl text-base transition-colors min-h-[52px]`}
              >
                Pago mixto (varias formas)
              </button>
              {showMixto && (() => {
                const totalConPropina = payTotal + propina
                const pagado = mixtoPagos.reduce((s, p) => s + p.monto, 0)
                const restante = Math.max(0, totalConPropina - pagado)
                const formaNames = ['Efectivo', 'Tarjeta de crédito', ...paymentMethodsDB.filter(m => m.type !== 'cash' && m.type !== 'card').map(m => m.name)]
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
                      disabled={saving || mixtoPagos.length === 0 || restante > 0.009}
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
  // Track which alert IDs have already fired a push notification (survives re-renders, resets on unmount)
  const notifiedRef = useRef<Set<string>>(new Set())

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

      // Fire push notifications for alerts that are NEW (not yet notified)
      for (const alert of newAlerts) {
        if (!notifiedRef.current.has(alert.id)) {
          notifiedRef.current.add(alert.id)
          // Map alert to a human-readable push notification
          let title = 'Fullsite POS'
          let body = alert.message.replace(/^[\p{Emoji}\s]+/u, '').trim()
          if (alert.id === 'anomaly-critical') {
            title = 'Anomalía detectada'
          } else if (alert.id === 'ready-orders') {
            title = 'Órdenes listas'
          } else if (alert.id.startsWith('del-')) {
            title = 'Nuevo pedido delivery'
          } else if (alert.id === 'turno-largo') {
            title = 'Turno abierto >12h'
          }
          sendNotification(title, body, '/pos').catch(() => {})
        }
      }
      // Remove IDs that are no longer present so they can re-notify if they reappear
      const currentIds = new Set(newAlerts.map(a => a.id))
      for (const id of notifiedRef.current) {
        if (!currentIds.has(id)) notifiedRef.current.delete(id)
      }

      setAlerts(newAlerts)
    }

    fetchAlerts()
    const interval = setInterval(fetchAlerts, 60000)
    return () => {
      clearInterval(interval)
      // mpPollRef cleanup handled in payment modal close
    }
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
