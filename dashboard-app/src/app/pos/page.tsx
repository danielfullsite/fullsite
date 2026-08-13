'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  MESEROS,
  fetchMeseros,
  verifyManagerPin,
  verifyPinWithMinRole,
  type MenuCategory,
  RECIPE_ALIASES,
  formatMXN,
  generateId,
  saveOrder,
  addOrderItems,
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
  prefetchOfflineData,
  getActiveTurno,
  getClientId,
  type RecipeRow,
  type Ingredient,
  type ModificadorAgregar,
  type ModifierGroupDef,
  type PaymentMethodDB,
  type PagoForma,
  updateOrderStatus,
  getPOSAuthHeaders,
} from '@/lib/pos-data'
import { getIvaRate, TIEMPO_ITEM_ID, isTiempoItem, getStationForItem, setCategoryNameCache, _categoryNameCache, isNoPrintStation, getCancellationReasons, getDiscountCatalog } from '@/lib/pos-constants'
import { calcSplitParejo, calcSplitItems } from '@/lib/pos-calculations'
import { publishEvent, getDeviceId } from '@/lib/events'
import { apiUrl } from '@/lib/api-base'
import { getBridgeUrl } from '@/lib/bridge-url'
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
import { syncAll, getPendingQueue, queueOperation, cacheMenu, getCachedMenu, cacheCashMovement } from '@/lib/pos-offline-db'
import { sendNotification } from '@/lib/service-worker'
import { getPermissions } from '@/lib/pos-permissions'
import {
  type MpPaymentRecovery,
  type MpPaymentState,
  loadMpRecovery,
  persistMpRecovery,
  clearMpRecovery as clearMpRecoveryStore,
  needsOperatorAttention,
} from '@/lib/mp-payment-recovery'
import {
  ChefHat,
  Grid3X3,
  ChevronDown,
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
  Package,
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
  Utensils,
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
import { getActiveClientSlug as _cid } from '@/lib/data'
import { usePOSLock } from './pos-lock-context'

const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })
const POSCopilot = dynamic(() => import('@/components/POSCopilot'), { ssr: false })
const OfflineIndicator = dynamic(() => import('@/components/pos/OfflineIndicator'), { ssr: false })
const InventoryAlerts = dynamic(() => import('@/components/pos/InventoryAlerts'), { ssr: false })
const MeseroLeaderboard = dynamic(() => import('@/components/pos/MeseroLeaderboard'), { ssr: false })
const SmartCashCalculator = dynamic(() => import('@/components/pos/SmartCashCalculator'), { ssr: false })
const CustomerMemory = dynamic(() => import('@/components/pos/CustomerMemory'), { ssr: false })


export default function POSPage() {
  return (
    <Suspense fallback={
      <div className="h-dvh flex items-center justify-center text-[var(--text-1)]" style={{background:'#0a0a0f',color:'#fff'}}>
        <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
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

  // ── Grupos multinivel (el POS legado: "NIVEL 1: PROTEINA, opcional, máx 2") ──
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
            <h3 className="text-lg font-bold text-[var(--text-1)]">{item.name}</h3>
            <p className="text-[var(--accent-ink)] font-semibold">{formatMXN(item.price)}</p>
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
              <h4 className="text-sm font-bold text-[var(--text-1)]">
                {modGroups[currentLevel]?.name ?? 'Confirmar'} ({currentLevel + 1}/{modGroups.length})
              </h4>
              <div className="flex gap-1">
                {modGroups.map((_, i) => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-full ${i === currentLevel ? 'bg-emerald-500' : i < currentLevel ? 'bg-emerald-800' : 'bg-[var(--surface-2)]'}`} />
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
              <span>Quitar {quitarChecked.size > 0 && <span className="text-[var(--crit-ink)]">({quitarChecked.size})</span>}</span>
              <span className="text-xs normal-case text-[var(--text-4)]">{showQuitar ? '▲ Cerrar' : '▼ Abrir'}</span>
            </button>
            {showQuitar && (
            <div className="grid grid-cols-3 gap-1.5">
              {quitarOptions.map(mod => (
                <label
                  key={mod}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl cursor-pointer transition-colors min-h-[48px] ${
                    quitarChecked.has(mod)
                      ? 'bg-[var(--crit-soft)] border border-red-700/60'
                      : 'bg-[var(--line)]/50 border border-[var(--line-soft)] hover:bg-[var(--line)]'
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
                      : 'border-[var(--line)]'
                  }`}>
                    {quitarChecked.has(mod) && (
                      <svg className="w-3 h-3 text-[var(--text-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-[var(--text-1)]">{mod}</span>
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
                    <span className={`text-[11px] normal-case font-bold px-2 py-0.5 rounded-full ${unmet ? 'bg-[var(--crit-soft)] text-[var(--crit-ink)] border border-red-700/60' : 'bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-emerald-700/50'}`}>
                      Obligatorio{min > 1 ? ` (min ${min})` : ''}
                    </span>
                  ) : (
                    <span className="text-[11px] normal-case font-medium px-2 py-0.5 rounded-full bg-[var(--line)]/60 text-[var(--text-3)]">Opcional</span>
                  )}
                  {group.maxSelections !== null && (
                    <span className={`text-[11px] normal-case font-medium px-2 py-0.5 rounded-full ${maxReached ? 'bg-[var(--warn-soft)] text-[var(--warn-ink)] border border-amber-700/50' : 'bg-[var(--line)]/60 text-[var(--text-3)]'}`}>
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
                            ? 'bg-[var(--accent-soft)] border border-emerald-700/60 cursor-pointer'
                            : blocked
                            ? 'bg-[var(--line)]/30 border border-[var(--line-soft)] opacity-40 cursor-not-allowed'
                            : 'bg-[var(--line)]/50 border border-[var(--line-soft)] hover:bg-[var(--line)] cursor-pointer'
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
                            <svg className="w-3 h-3 text-[var(--text-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-sm text-[var(--text-1)]">{opt.name}</span>
                          <span className={`text-xs font-medium ${opt.price > 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--text-3)]'}`}>
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
                      ? 'bg-[var(--accent-soft)] border border-emerald-700/60'
                      : 'bg-[var(--line)]/50 border border-[var(--line-soft)] hover:bg-[var(--line)]'
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
                      <svg className="w-3 h-3 text-[var(--text-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-[var(--text-1)]">{mod.name}</span>
                    <span className={`text-xs font-medium ${mod.price > 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--text-3)]'}`}>
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
              className="flex-1 bg-[var(--line)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                className="w-10 h-10 rounded-lg bg-[var(--line)] flex items-center justify-center text-[var(--text-1)]"
              >
                <Minus size={18} />
              </button>
              <span className="text-xl font-bold text-[var(--text-1)] w-8 text-center">{cantidad}</span>
              <button
                onClick={() => setCantidad(cantidad + 1)}
                className="w-10 h-10 rounded-lg bg-[var(--line)] flex items-center justify-center text-[var(--text-1)]"
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
              className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--raised)] disabled:text-[var(--text-4)] text-white font-bold text-lg transition-colors min-h-[56px]"
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
                      className="flex-1 py-4 rounded-xl bg-[var(--raised)] hover:bg-[var(--surface-2)] text-[var(--text-3)] font-bold text-lg transition-colors min-h-[56px]"
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
                  className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--raised)] disabled:text-[var(--text-4)] text-white font-bold text-lg transition-colors min-h-[56px]"
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
                      className="flex-1 py-4 rounded-xl bg-[var(--raised)] hover:bg-[var(--surface-2)] text-[var(--text-3)] font-bold text-lg transition-colors min-h-[56px]"
                    >
                      Omitir &rarr;
                    </button>
                  ) : null
                })()}
                <button
                  onClick={handleConfirm}
                  disabled={unmetGroups.length > 0}
                  className="flex-[2] py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--raised)] disabled:text-[var(--text-4)] text-white font-bold text-lg transition-colors min-h-[56px]"
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

  // ── 2x1 (estilo POS legado: aplicar sobre partidas seleccionadas) ──
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

  // Catálogo configurable por tenant (setting pos.discount_catalog) — presets de 1 toque
  const catalog = getDiscountCatalog()

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
          <h3 className="text-lg font-bold text-[var(--text-1)]">Aplicar descuento</h3>
          <button onClick={onCancel} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]">
            <X size={20} />
          </button>
        </div>

        {/* Catálogo de descuentos configurable (pos.discount_catalog) — presets de 1 toque */}
        {catalog.length > 0 && (
          <div className="mb-4">
            <label className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2 block">Catálogo</label>
            <div className="grid grid-cols-2 gap-2">
              {catalog.map(d => {
                const active = reason === d.label
                return (
                  <button
                    key={d.id}
                    onClick={() => {
                      if (typeof d.pct === 'number') { setMode('percent'); setValue(String(d.pct)) }
                      else if (typeof d.amount === 'number') { setMode('fixed'); setValue(String(d.amount)) }
                      setReason(d.label)
                    }}
                    className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors min-h-[44px] border ${
                      active ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--text-1)]' : 'bg-[var(--line)]/50 border-[var(--line-soft)] text-[var(--text-2)] hover:bg-[var(--line)]'
                    }`}
                  >
                    <span className="font-semibold">{d.label}</span>
                    <span className="text-[var(--accent-ink)] ml-1 font-mono tabular-nums">
                      {typeof d.pct === 'number' ? `${d.pct}%` : typeof d.amount === 'number' ? formatMXN(d.amount) : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

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
              mode === 'cortesia' ? 'bg-violet-600 text-[var(--text-1)]' : 'bg-[var(--line)] text-[var(--text-4)]'
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
                      checked ? 'bg-[var(--warn-soft)] border border-amber-700/60' : 'bg-[var(--line)]/50 border border-[var(--line-soft)] hover:bg-[var(--line)]'
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePromoItem(it.id)} className="sr-only" />
                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      checked ? 'bg-amber-500 border-amber-500' : 'border-[var(--line-soft)]0'
                    }`}>
                      {checked && (
                        <svg className="w-3 h-3 text-[var(--text-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="flex-1 text-sm text-[var(--text-1)]">{it.cantidad}x {it.nombre}</span>
                    <span className="text-xs text-[var(--text-3)]">{formatMXN((it.precio + it.precioExtra) * it.cantidad)}</span>
                  </label>
                )
              })}
            </div>
            {promoUnits.length > 0 && (
              <p className="text-center text-sm">
                <span className="text-[var(--text-3)]">{promoPairs} {promoPairs === 1 ? 'par' : 'pares'}</span>
                {promoUnits.length % 2 === 1 && <span className="text-[var(--warn-ink)]"> · 1 unidad sin par</span>}
                {promoDiscount > 0 && <span className="text-[var(--warn-ink)] font-semibold"> · Gratis: -{formatMXN(promoDiscount)}</span>}
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
            className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-lg text-center focus:outline-none focus:border-[var(--accent)] min-h-[48px] mb-3"
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
                className="w-12 h-12 rounded-xl bg-[var(--line)] flex items-center justify-center text-[var(--text-1)] text-lg font-bold"
              >
                −
              </button>
              <div className="text-center">
                <span className="text-3xl font-bold text-[var(--text-1)]">{cortesiaPersonas}</span>
                <p className="text-xs text-[var(--text-3)]">{cortesiaPersonas === 1 ? 'persona' : 'personas'}</p>
              </div>
              <button
                onClick={() => setCortesiaPersonas(Math.min(personas || 10, cortesiaPersonas + 1))}
                className="w-12 h-12 rounded-xl bg-[var(--line)] flex items-center justify-center text-[var(--text-1)] text-lg font-bold"
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
            Descuento: <span className="text-[var(--crit-ink)] font-semibold">-{formatMXN(discountAmount)}</span>
          </p>
        )}

        {/* Reason for discount/cortesia */}
        {discountAmount > 0 && (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === 'cortesia' ? 'Motivo de cortesía (ej. cliente frecuente)' : 'Motivo del descuento (opcional)'}
            className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-2.5 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-[var(--accent)] mb-3"
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
                className={`flex-1 bg-[var(--line)] border ${pinError ? 'border-red-500' : 'border-[var(--line)]'} rounded-lg px-4 py-3 text-[var(--text-1)] text-lg text-center tracking-[0.3em] focus:outline-none focus:border-[var(--accent)] min-h-[48px]`}
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
            {pinError && <p className="text-[var(--crit-ink)] text-xs text-center mt-1">PIN incorrecto o huella no reconocida</p>}
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

  // Catálogo configurable por tenant (setting pos.cancellation_reasons)
  const CANCEL_REASONS = getCancellationReasons()

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
          <div className="w-10 h-10 rounded-full bg-[var(--crit-soft)] flex items-center justify-center">
            <ShieldAlert size={20} className="text-[var(--crit-ink)]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--text-1)]">{step === 'reason' ? 'Cancelar item' : '¿Se preparó este artículo?'}</h3>
            <p className="text-[var(--crit-ink)] text-sm">{itemName}</p>
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
                          ? 'bg-[var(--crit-soft)] border border-red-600 text-white'
                          : 'bg-[var(--line)]/50 border border-[var(--line-soft)] text-[var(--text-4)] hover:bg-[var(--line)]'
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
                    className="flex-1 bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
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

              {error && <p className="text-[var(--crit-ink)] text-sm text-center">{error}</p>}
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
                className="w-full py-3 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--text-4)] text-[var(--text-1)] font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
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
          <div className="w-10 h-10 rounded-full bg-[var(--crit-soft)] flex items-center justify-center">
            <ShieldAlert size={20} className="text-[var(--crit-ink)]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--text-1)]">Anular orden completa</h3>
            <p className="text-[var(--crit-ink)] text-sm">Mesa {mesa} · {formatMXN(total)}</p>
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
              className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-red-500 resize-none"
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
                className="flex-1 bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
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

          {error && <p className="text-[var(--crit-ink)] text-sm text-center">{error}</p>}
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
    // Stable id — ensures idempotency whether we save online or queue offline
    const id = crypto.randomUUID()
    const payload = { id, client_id: _cid(), turno_id: turnoId, type, amount: num, reason: reason.trim(), actor, approved_by: manager }
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${sbUrl}/rest/v1/pos_cash_movements`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Write-through cache — mirror to IDB even though Supabase succeeded.
      // Guarantees the wizard sees this movement if connectivity drops before cierre.
      cacheCashMovement({ id, client_id: payload.client_id, turno_id: turnoId ?? '', type, amount: num, reason: reason.trim(), actor, approved_by: manager })
        .catch(() => { /* IDB unavailable — sync_queue is the fallback */ })
      onConfirm(type, num, reason.trim(), manager)
    } catch {
      // Offline or server error — queue for sync and confirm locally.
      // getCachedCashMovsByTurno also reads sync_queue, so the wizard sees it.
      await queueOperation('pos_cash_movements', 'POST', payload as Record<string, unknown>, undefined, undefined, 'SUPABASE_REST')
      onConfirm(type, num, reason.trim(), manager)
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
    // H-1 FIX: doCashSave already POSTs to pos_cash_movements.
    // Previously there was a duplicate POST here causing double-write.
    await doCashSave(manager)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--line-soft)] rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-900/60 flex items-center justify-center">
            <ArrowDownUp size={20} className="text-[var(--accent-ink)]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--text-1)]">Movimiento de caja</h3>
            <p className="text-[var(--text-3)] text-sm">Retiro o depósito de efectivo</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Toggle Retiro / Deposito */}
          <div className="flex gap-2">
            <button
              onClick={() => setType('retiro')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors min-h-[44px] ${
                type === 'retiro' ? 'bg-red-600 text-white' : 'bg-[var(--line)]/50 border border-[var(--line-soft)] text-[var(--text-4)]'
              }`}
            >
              Retiro
            </button>
            <button
              onClick={() => setType('deposito')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors min-h-[44px] ${
                type === 'deposito' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)]/50 border border-[var(--line-soft)] text-[var(--text-4)]'
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
              className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-center text-2xl focus:outline-none focus:border-[var(--accent)] min-h-[48px]"
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
              className="w-full bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-[var(--accent)] min-h-[48px]"
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
                className="flex-1 bg-[var(--line)] border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] placeholder-[var(--text-4)] text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-[var(--accent)] min-h-[48px]"
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

          {error && <p className="text-[var(--crit-ink)] text-sm text-center">{error}</p>}
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
  const { lock } = usePOSLock()
  const initialCuenta = searchParams.get('cuenta') || ''
  // Cuenta por nombre (estilo POS legado): sin mesa → mesa 0
  const initialMesa = initialCuenta ? 0 : (Number(searchParams.get('mesa')) || 1)

  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([])
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
          if (c.ts && Date.now() - c.ts < 28_800_000 && c.items?.length > 0) return c.items
        }
      }
    } catch {}
    return []
  })
  const [mesa, setMesa] = useState<number>(initialMesa)
  // Mesa a la que pertenecen los orderItems actuales. loadMesaOrder lo fija a la mesa
  // que carga. Evita que el persist escriba items de la mesa vieja en la caché de la
  // nueva durante una transición de mesa (fuga cross-mesa).
  const orderItemsMesaRef = useRef<number>(initialMesa)

  // Persist order items to localStorage on every change (8h TTL, survives offline navigation).
  // Merge into any existing cache entry to preserve fields (id, revision, mesero) written
  // by the success path, so the lazy-init still finds the order id on fast remounts.
  useEffect(() => {
    // Solo persistir si los items pertenecen a la mesa actual (no en plena transición).
    if (mesa > 0 && orderItemsMesaRef.current === mesa) {
      try {
        const existing = localStorage.getItem(`pos_order_${mesa}`)
        const prev = existing ? JSON.parse(existing) : {}
        // NUNCA sobrescribir items en caché con [] durante transiciones (cambio de
        // mesa dispara un setOrderItems([]) momentáneo). Un vaciado REAL (pago/cancelación)
        // borra la caché por separado. Esto evita que la orden desaparezca al reabrir.
        const nextItems = orderItems.length > 0 ? orderItems : (prev.items || [])
        localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({ ...prev, ts: Date.now(), items: nextItems }))
      } catch { /* ignore */ }
    }
  }, [orderItems, mesa])

  // Sync mesa state when searchParams change (client-side navigation from mesas/plano)
  const urlMesa = initialCuenta ? 0 : (Number(searchParams.get('mesa')) || 0)
  useEffect(() => {
    if (urlMesa > 0 && urlMesa !== mesa) {
      setOrderItems([])
      setMesa(urlMesa)
    }
  }, [urlMesa])

  // Order loading is handled by the useEffect below (mesa + clienteNombre dependency)
  const [clienteNombre, setClienteNombre] = useState<string>(initialCuenta)
  const [mesero, setMesero] = useState<string>(() => {
    // Anti-fraude: el mesero de una orden NUEVA = la identidad autenticada (quien
    // hizo login con PIN/huella), NO una selección libre. Reasignar requiere gerente.
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('pos_staff')
        if (saved) {
          const s = JSON.parse(saved)
          if (s.name) return s.name
        }
      } catch { /* */ }
    }
    return ''
  })
  // Dynamic meseros list from pos_staff (replaces hardcoded MESEROS for dropdown)
  const [meserosList, setMeserosList] = useState<string[]>(MESEROS)
  useEffect(() => {
    // Solo carga la lista (para reasignación por gerente). NO reasigna el mesero
    // automáticamente desde el dropdown/localStorage — la identidad la fija el login.
    fetchMeseros().then(setMeserosList)
  }, [])

  const [personas, setPersonas] = useState<number>(2)
  const [clock, setClock] = useState<string>('')
  const [showPayment, setShowPayment] = useState(false)
  const [showMixto, setShowMixto] = useState(false)
  // Pago mixto multi-forma (estilo POS legado): lista de {metodo, monto}
  const [mixtoPagos, setMixtoPagos] = useState<PagoForma[]>([])
  const [mixtoForma, setMixtoForma] = useState('Efectivo')
  const [mixtoMonto, setMixtoMonto] = useState('')
  // Formas de pago custom desde pos_payment_methods (Rappi, Ubereats, Cortesía...)
  const [paymentMethodsDB, setPaymentMethodsDB] = useState<PaymentMethodDB[]>([])
  // Turno activo — se adjunta turno_id a cada orden cerrada
  // Seeded from localStorage so it's available synchronously on cold Electron restart
  const [turnoId, setTurnoId] = useState<string | null>(() => {
    try { return localStorage.getItem('pos_turno_id') || null } catch { return null }
  })
  // Sillas: silla activa para nuevos items (spinner SILLA estilo POS legado)
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
      // Stale-while-revalidate: show IDB-cached menu immediately, then refresh from Supabase.
      // This eliminates the blank-menu delay on remount (e.g. after send → mesas → new mesa).
      try {
        const cached = await getCachedMenu() as unknown as Awaited<ReturnType<typeof getMenuCategoriesFromDB>>
        if (cached.length > 0) {
          setMenuCategories(cached)
          const nameMap: Record<string, string> = {}
          for (const cat of cached) nameMap[cat.id] = cat.name
          setCategoryNameCache(nameMap)
          categoryMapRef.current = buildCategoryMap(cached)
        }
      } catch { /* ignore */ }

      // When offline: IDB cache is already shown above — skip all network calls.
      if (!navigator.onLine) return

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
        // Persist for offline cold-start
        cacheMenu(dbMenu as unknown as Record<string, unknown>[]).catch(() => {})
      }
      setPaymentMethodsDB(pm)
      if (turno) {
        setTurnoId(turno.id)
        try { localStorage.setItem('pos_turno_id', turno.id) } catch { /* ignore */ }
      } else if (navigator.onLine) {
        // Only clear the cached turno id when we are actually online and confirmed
        // there is no open turno. Clearing while offline would wipe the localStorage
        // seed that makes turnoId available after a cold offline restart.
        try { localStorage.removeItem('pos_turno_id') } catch { /* ignore */ }
      }
      // Pre-cache all modifier + payment data for offline cold-start (fire-and-forget)
      if (navigator.onLine) prefetchOfflineData().catch(() => {})
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
    // Periodic count refresh every 30s — reads IndexedDB only (no network needed offline)
    const interval = setInterval(updateCount, 30000)
    return () => { mounted = false; window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(interval) }
  }, [])

  // Print queue state — pending/retrying (queue working) vs needs_attention (user action required)
  const [printPending, setPrintPending] = useState(0)
  const [printNeedsAttention, setPrintNeedsAttention] = useState(0)
  useEffect(() => {
    const update = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail
      setPrintPending(detail?.pending ?? 0)
      setPrintNeedsAttention(detail?.needsAttention ?? 0)
    }
    import('@/lib/print-queue').then(m => {
      setPrintPending(m.getPendingCount())
      setPrintNeedsAttention(m.getNeedsAttentionCount())
    }).catch(() => {})
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

  // Modo piloto: mute de comandas físicas (piloto del POS legado terminado — gate removed from printer.ts).
  // Flag cleared on startup so stale pilot-period values don't persist across devices.
  const [comandasOff, setComandasOff] = useState(false)
  useEffect(() => {
    try { localStorage.removeItem('pos_comandas_muted') } catch {}
    setComandasOff(false)
  }, [])

  // Pin prompt state (replaces window.prompt for kiosk/PWA compatibility)
  const [pinPrompt, setPinPrompt] = useState<{ title: string; onSubmit: (pin: string) => void } | null>(null)
  const [pinInput, setPinInput] = useState('')
  // Reasignación de mesero: null = bloqueado. Si tiene el nombre del gerente que
  // autorizó, se habilita el selector una sola vez (anti-fraude: nadie ordena a
  // nombre de otro sin autorización + bitácora).
  const [reassignMgr, setReassignMgr] = useState<string | null>(null)

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
  const CUENTA_TEXT = ['', 'text-[var(--info-ink)]', 'text-[var(--info-ink)]', 'text-[var(--warn-ink)]', 'text-[var(--crit-ink)]', 'text-[var(--info-ink)]', 'text-lime-400']

  // Propina
  const [propina, setPropina] = useState(0)

  // Load active order for selected mesa
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null)
  const [orderNumber, setOrderNumber] = useState<number | null>(null)
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null)
  const [orderRevision, setOrderRevision] = useState<number>(0)
  const [loadingMesa, setLoadingMesa] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoadingMesa(true)
    // Desde aquí los orderItems representan a ESTA mesa (instant-cache la puebla abajo).
    orderItemsMesaRef.current = mesa
    const loadMesaOrder = async () => {
      try {
        // Cuenta por nombre: busca por customer_name; mesa: busca por número
        if (!navigator.onLine) throw new Error('offline')
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
            // Merge: keep any local unsent items that aren't in the DB yet
            setOrderItems(prev => {
              const dbIds = new Set(loadedItems2.map((i: OrderItem) => i.id))
              const localUnsent = prev.filter((i: OrderItem) => !dbIds.has(i.id) && !sentItemIds.has(i.id))
              if (localUnsent.length > 0) {
                // User has new items not yet saved — keep them
                return [...loadedItems2, ...localUnsent]
              }
              return loadedItems2
            })
            setOrderId(order.id)
            setMesero(order.mesero || meserosList[0] || MESEROS[0])
            setPersonas(order.personas || 2)
            setDiscount(order.descuento || 0)
            setLoadedOrderId(order.id)
            setLoadedUpdatedAt(order.updated_at || order.created_at || null)
            setOrderRevision(order.order_revision ?? 0)
            setOrderNotes(order.notas || '')
            // Update cache with DB truth so next entry is instant AND correct
            try { localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({ id: order.id, items: loadedItems2, mesero: order.mesero, personas: order.personas, discount: order.descuento || 0, notas: order.notas || '', revision: order.order_revision ?? 0, updatedAt: order.updated_at || order.created_at, ts: Date.now() })) } catch {}
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
            // DB devolvió 0 filas. PROTECCIÓN CONTRA CARRERA (read-after-write):
            // si hay una orden en caché RECIÉN escrita (<2 min, p.ej. recién enviada
            // a cocina), casi seguro es lag/replicación — NO destruir la orden local.
            // Se conserva lo que mostró el instant-cache y el próximo poll reconcilia.
            // Las órdenes pagadas/canceladas borran su caché (ver handlers de pago),
            // así que esas sí caen a 0 filas y se limpian correctamente.
            try {
              const freshCache = localStorage.getItem(`pos_order_${mesa}`)
              if (freshCache) {
                const fc = JSON.parse(freshCache)
                if (fc.items?.length > 0 && fc.ts && Date.now() - fc.ts < 120000) {
                  // Orden local fresca — no vaciar. Mantener y salir.
                  if (!cancelled) setLoadingMesa(false)
                  return
                }
              }
            } catch {}
            // DB says no open order for this mesa — clear stale cache
            try { localStorage.removeItem(`pos_order_${mesa}`) } catch {}
            // Check for unsaved draft
            try {
              const draft = localStorage.getItem(`pos_draft_${mesa}`)
              if (draft) {
                const d = JSON.parse(draft)
                if (d.items?.length > 0 && d.ts && Date.now() - d.ts < 14400000) { // 4h TTL — mesero puede añadir ítems y esperar sin perder el draft
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
      } catch (err) {
        // Network error — fall back to localStorage cache (stale is better than blank)
        console.warn('[loadMesaOrder] network error, using cached order:', err)
        if (!cancelled) {
          try {
            const cached = localStorage.getItem(`pos_order_${mesa}`)
            if (cached) {
              const c = JSON.parse(cached)
              if (c.items?.length > 0) {
                setOrderItems(c.items)
                setOrderId(c.id || generateId())
                if (c.mesero) setMesero(c.mesero)
                if (c.personas) setPersonas(c.personas)
                if (c.discount != null) setDiscount(c.discount)
                if (c.notas) setOrderNotes(c.notas)
                if (c.revision != null) setOrderRevision(c.revision)
                if (c.updatedAt) setLoadedUpdatedAt(c.updatedAt)
                setLoadedOrderId(c.id || null)
                setSentItemIds(new Set(c.items.map((i: OrderItem) => i.id)))
                const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
                for (const item of c.items) {
                  snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
                }
                setSentItemSnapshots(snaps)
                // MES-002: keep TTL alive during offline — prevents blank pre-fetch flash on next reload
                try { localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({ ...c, ts: Date.now() })) } catch {}
              }
            }
          } catch {}
        }
      }
      if (!cancelled) setLoadingMesa(false)
    }
    // Safety: ensure loadingMesa is always cleared after 3 seconds max
    const safetyTimer = setTimeout(() => setLoadingMesa(false), 3000)
    // Reset tracking state
    setCancelledItems(new Set())
    setVoidedItems(new Set())
    // Show cached order INSTANTLY while DB loads (prevents blank flash)
    try {
      const cached = localStorage.getItem(`pos_order_${mesa}`)
      if (cached) {
        const c = JSON.parse(cached)
        if (c.ts && Date.now() - c.ts < 28_800_000 && c.items?.length > 0) {
          setOrderItems(c.items)
          setOrderId(c.id || generateId())
          if (c.mesero) setMesero(c.mesero)
          if (c.personas) setPersonas(c.personas)
          if (c.discount != null) setDiscount(c.discount)
          if (c.notas) setOrderNotes(c.notas)
          if (c.revision != null) setOrderRevision(c.revision)
          if (c.updatedAt) setLoadedUpdatedAt(c.updatedAt)
          setLoadedOrderId(c.id || null)
          setSentItemIds(new Set(c.items.map((i: OrderItem) => i.id)))
          const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
          for (const item of c.items) {
            snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
          }
          setSentItemSnapshots(snaps)
        }
      }
    } catch {}
    // DB is truth — will overwrite cache if different
    loadMesaOrder()
    return () => { cancelled = true; clearTimeout(safetyTimer) }
  }, [mesa, clienteNombre])

  // Order-level notes
  const [orderNotes, setOrderNotes] = useState('')

  // Cancel modal state
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null)

  // Transfer platillo modal state (Eduardo Jul 21 — Batch 8)
  const [transferringItem, setTransferringItem] = useState<OrderItem | null>(null)

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

  // MES-009: surface STALE_WRITE_CONFLICT to operator the moment syncAll detects it
  useEffect(() => {
    const conflictHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const isCurrentOrder = detail?.orderId === orderId
      showToast(
        isCurrentOrder
          ? `Conflicto de versión en mesa ${mesa} — recarga para ver el estado actual`
          : 'Conflicto de sincronización en una orden — revisa la cola de pendientes'
      )
    }
    window.addEventListener('pos-order-conflict', conflictHandler)
    return () => window.removeEventListener('pos-order-conflict', conflictHandler)
  }, [orderId, mesa])

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

  // Anti-fraude: en una orden NUEVA el mesero = la identidad logueada. En órdenes
  // existentes se respeta order.mesero (reasignable solo por gerente).
  useEffect(() => {
    if (loadedOrderId === null && staffName) setMesero(staffName)
  }, [loadedOrderId, staffName])

  // Mobile device detection — meseros en celular solo pueden tomar orden + enviar a cocina
  const isMobileDevice = typeof window !== 'undefined' && (window.innerWidth < 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))
  const isMobileRestricted = isMobileDevice && (staffRole === 'mesero' || staffRole === 'barra')
  // Mobile-restricted users cannot: cobrar, cancelar, descontar, corte, abrir cajón

  // Role permissions — granular system (50+ permissions per paridad con el POS legado)
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

  // COB-017: MP Point payment recovery — persists the gap between MP_APPROVED and FULLSITE_RECORDED
  const [mpRecovery, setMpRecovery] = useState<MpPaymentRecovery | null>(null)
  useEffect(() => {
    const r = loadMpRecovery(mesa)
    if (r) setMpRecovery(r)
  }, [mesa])
  const updateMpRecovery = (r: MpPaymentRecovery) => { persistMpRecovery(r); setMpRecovery(r) }
  const clearMpRecovery = () => { clearMpRecoveryStore(mesa); setMpRecovery(null) }

  const lastReprintRef = useRef<number>(0)
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
      // Silla activa (estilo POS legado CANT/SILLA): nuevos items se asignan a la silla seleccionada
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
  const handleCancelItem = useCallback(async (reason: string, managerName: string, options: { prepared: boolean; voided: boolean }) => {
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
    // R0.5 RESOLVED: Forward deduction is now active, so reversal is safe.
    // Only reverse if item was prepared (sent to kitchen = stock was deducted).
    // Voided items that were never sent don't need reversal.
    if (!voided && prepared) {
      reverseIngredientDeduction(cancellingItem, loadedOrderId || '', managerName, reason)
        .catch(err => console.error('[inventory] Reversal error (non-blocking):', err))
    }
    if (voided) {
      setVoidedItems(prev => new Set(prev).add(cancellingItem.id))
    } else {
      setCancelledItems(prev => new Set(prev).add(cancellingItem.id))
    }
    // H-4 FIX: persist cancelled flag ON the item in orderItems state
    // so draft auto-save (pos_draft_${mesa}) includes it, and mesa switch preserves it
    setOrderItems(prev => prev.map(i =>
      i.id === cancellingItem.id ? { ...i, cancelled: true } : i
    ))
    setCancellingItem(null)
    if (voided) {
      showToast(`${cancellingItem.nombre} ANULADO — aprobado por ${managerName}`)
    } else if (prepared) {
      showToast(`${cancellingItem.nombre} cancelado — registrado como merma`)
    } else {
      showToast(`${cancellingItem.nombre} cancelado — aprobado por ${managerName}`)
    }
    // Persist to DB via OCC-safe endpoint so KDS reflects cancellation.
    // APP_API transport required — SUPABASE_REST MUST NOT mutate pos_orders.
    const effectiveOrderId = loadedOrderId || orderId
    if (effectiveOrderId) {
      const cancelOpId = genOpId()
      const cancelBody = {
        client_id: _cid(),
        order_id: effectiveOrderId,
        item_id: cancellingItem.id,
        voided,
        operation_id: cancelOpId,
        mesero,
        reason,
        manager: managerName,
      }
      try {
        const res = await fetch('/api/pos/cancel-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
          body: JSON.stringify(cancelBody),
          signal: AbortSignal.timeout(5000),
        })
        const result = res.ok ? await res.json() : { ok: false }
        if (result.conflict) {
          // Local state already updated — the item is cancelled in UI.
          // OCC conflict means DB has a newer revision; the cancel will replay on next send.
          showToast('Conflicto de versión — cancelación local aplicada, se sincronizará al próximo envío')
        } else if (!result.ok && !result.already_applied) {
          throw new Error(`cancel-item API error: ${result.error || res.status}`)
        }
      } catch (err) {
        // Offline or API error: queue for replay with APP_API transport
        console.warn('[cancel] Queuing offline:', err)
        try {
          const { queueOperation } = await import('@/lib/pos-offline-db')
          await queueOperation('pos_orders', 'POST', cancelBody as unknown as Record<string, unknown>, '/api/pos/cancel-item', '0', 'APP_API')
        } catch {
          // IDB unavailable — local state is the truth until next send overwrites DB
          console.error('[cancel] Failed to queue offline — cancellation is local only until next send')
        }
      }
    }
  }, [cancellingItem, orderId, mesero, mesa, loadedOrderId])

  // Void entire order
  // Eduardo Jul 21 (Batch 8): Transfer individual platillo to another mesa
  // Uses server-side OCC API to prevent race conditions and data loss
  const handleTransferItem = useCallback(async (pin: string, targetMesa: number) => {
    if (operationLock.current) return
    if (!transferringItem || !loadedOrderId) return
    // Verify supervisor PIN (capitan+)
    const auth = await verifyPinWithMinRole(pin, 'capitan')
    if (!auth) { showToast('PIN no autorizado — se requiere supervisor'); return }
    operationLock.current = true

    const itemName = transferringItem.nombre
    const itemId = transferringItem.id
    const opId = generateId() // idempotency key

    try {
      const res = await fetch('/api/pos/transfer-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
        body: JSON.stringify({
          client_id: _cid(),
          source_order_id: loadedOrderId,
          item_id: itemId,
          target_mesa: targetMesa,
          source_mesa: mesa,
          mesero,
          approved_by: auth.name,
          approved_role: auth.role,
          operation_id: opId,
        }),
      })
      const result = await res.json()

      if (result.ok) {
        // Success: remove item from local state
        setOrderItems(prev => prev.filter(i => i.id !== itemId))
        setSentItemIds(prev => { const next = new Set(prev); next.delete(itemId); return next })
        showToast(`${itemName} transferido a mesa ${targetMesa} — aprobó ${auth.name}`)
      } else if (result.error === 'SOURCE_CONFLICT' || result.error === 'TARGET_CONFLICT') {
        showToast(result.message || 'Conflicto — recarga y reintenta')
        // Reload order from DB to get fresh state
        // The mesa load effect will handle this on next render
      } else if (result.error === 'ITEM_NOT_IN_SOURCE') {
        showToast(result.message || 'El item ya fue movido por otra terminal')
        setOrderItems(prev => prev.filter(i => i.id !== itemId))
      } else {
        showToast(`Error: ${result.error || 'desconocido'}`)
      }
    } catch (err) {
      console.error('[transfer] Network error:', err)
      showToast('Error de red al transferir — intenta de nuevo')
    }

    operationLock.current = false
    setTransferringItem(null)
  }, [transferringItem, loadedOrderId, mesero, mesa])

  const handleVoidOrder = useCallback(async (reason: string, managerName: string) => {
    if (operationLock.current) return
    operationLock.current = true
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
        headers: { 'Content-Type': 'application/json', ...getPOSAuthHeaders() },
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
    // R0.5 RESOLVED: Reverse deductions for items that were sent to kitchen.
    // Void = entire order cancelled before payment, stock should come back.
    const sentItems = orderItems.filter(i => sentItemIds.has(i.id) && !cancelledItems.has(i.id) && !voidedItems.has(i.id))
    if (sentItems.length > 0) {
      for (const item of sentItems) {
        reverseIngredientDeduction(item, loadedOrderId || '', managerName, reason)
          .catch(err => console.error('[inventory] Order void reversal error (non-blocking):', err))
      }
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

  // Cambiar silla de un item (tap en el badge — cicla 1..personas, estilo POS legado "Cambiar # de silla")
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

  // Insertar separador de tiempo (estilo POS legado "XX TIEMPO: N XX" — partida especial $0.00, silla 0)
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
  const iva = Math.round(subtotalAfterDiscount * getIvaRate() * 100) / 100
  const total = Math.round((subtotalAfterDiscount + iva) * 100) / 100

  // Concurrency check: verify order hasn't been modified by another terminal
  const checkOrderConflict = async (context: string): Promise<boolean> => {
    if (!loadedOrderId || !loadedUpdatedAt) return false // no conflict possible
    try {
      const checkRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}&select=updated_at,created_at,status&limit=1`,
        { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) }
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
      // Network error during conflict check — proceed offline.
      // saveOrder already protects against double payment via expected_revision (OCC)
      // and save_operation_id (idempotency). If two terminals pay the same order offline,
      // the second sync will return STALE_WRITE_CONFLICT and be flagged for operator review.
      return false
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

    // Server-side revision check handles conflicts for kitchen sends.
    // Client-side conflict check removed: caused false positives from stale updatedAt.

    // Phantom order prevention: if this is a NEW order (not loaded from DB),
    // re-check Supabase to see if another terminal already created one for this mesa
    if (!loadedOrderId && mesa) {
      try {
        const filter = clienteNombre
          ? `customer_name=eq.${encodeURIComponent(clienteNombre)}`
          : `mesa=eq.${mesa}`
        const raceRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&${filter}&status=in.(abierta,enviada,preparando)&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) }
        )
        if (raceRes.ok) {
          const raceRows = await raceRes.json()
          if (raceRows.length > 0) {
            const existing = raceRows[0]
            const existingRaw = typeof existing.items === 'string' ? JSON.parse(existing.items) : (existing.items || [])
            const existingActive: OrderItem[] = existingRaw.filter((i: OrderItem & { cancelled?: boolean }) => !i.cancelled)
            const existingIds = new Set(existingActive.map(i => i.id))

            // B's items not yet in A's order — preserve them with a new batch stamp
            const raceBatchId = generateId()
            const raceNewItems: OrderItem[] = activeItems
              .filter(i => !existingIds.has(i.id))
              .map(i => ({ ...i, comanda_batch_id: i.comanda_batch_id || raceBatchId, comanda_batch_seq: 0 }))

            setOrderItems([...existingActive, ...raceNewItems])
            setOrderId(existing.id)
            setLoadedOrderId(existing.id)
            setLoadedUpdatedAt(existing.updated_at || existing.created_at || null)
            setOrderRevision(existing.order_revision ?? 0)
            if (existing.mesero) setMesero(existing.mesero)
            if (existing.personas) setPersonas(existing.personas)

            if (raceNewItems.length > 0) {
              const appendResult = await addOrderItems(existing.id, raceNewItems)
              if (appendResult.ok) {
                setOrderRevision(appendResult.revision!)
                const allSentIds = new Set([...existingActive.map(i => i.id), ...raceNewItems.map(i => i.id)])
                setSentItemIds(allSentIds)
                const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
                for (const item of [...existingActive, ...raceNewItems]) {
                  snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
                }
                setSentItemSnapshots(snaps)
                const racePrintOrder: Order = {
                  id: existing.id, mesa,
                  mesero: existing.mesero || mesero, personas: existing.personas || personas,
                  status: 'enviada', items: raceNewItems,
                  subtotal: raceNewItems.reduce((s, i) => s + i.subtotal, 0), iva: 0,
                  total: raceNewItems.reduce((s, i) => s + i.subtotal, 0),
                  descuento: 0, turnoId: turnoId || undefined, createdAt: new Date(),
                }
                const racePrint = await printByStation(racePrintOrder)
                if (racePrint.failed.length > 0) showToast(`⚠ Impresora sin conexión: ${racePrint.failed.join(', ')}`)
                showToast(`${raceNewItems.length} item${raceNewItems.length !== 1 ? 's' : ''} enviados`)
                sessionStorage.removeItem('pos_staff')
                sessionStorage.removeItem('pos_last_activity')
                router.push('/pos/mesas'); lock()
                return
              } else {
                showToast('Error al agregar items — intenta de nuevo')
              }
            } else {
              setSentItemIds(new Set(existingActive.map(i => i.id)))
              const snaps: Record<string, { cantidad: number; modificadores: string[]; notas: string; silla?: number }> = {}
              for (const item of existingActive) {
                snaps[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
              }
              setSentItemSnapshots(snaps)
              showToast('Orden sincronizada')
            }
            setSaving(false); operationLock.current = false
            return
          }
        }
      } catch { /* network error — proceed with creation */ }
    }

    // Eduardo Jul 21 (Batch 5): stamp comanda_batch_id on new items
    // Each send action creates a new batch. Items keep their batch forever.
    const batchId = generateId()
    const existingBatchIds = new Set(activeItems.map(i => i.comanda_batch_id).filter(Boolean))
    const batchSeq = existingBatchIds.size // 0 for first send, 1+ for subsequent
    const now = new Date()
    const itemsWithBatch = activeItems.map(item => {
      if (item.comanda_batch_id) return item // already stamped from previous send
      return { ...item, comanda_batch_id: batchId, comanda_batch_seq: batchSeq }
    })
    // Build comanda_batches metadata (KDS reads this for per-card status)
    const prevBatches: Record<string, { status: string; created_at: string; seq: number }> = {}
    for (const item of activeItems) {
      if (item.comanda_batch_id && !prevBatches[item.comanda_batch_id]) {
        prevBatches[item.comanda_batch_id] = { status: 'preparando', created_at: now.toISOString(), seq: item.comanda_batch_seq ?? 0 }
      }
    }
    const comandaBatches = {
      ...prevBatches,
      [batchId]: { status: 'enviada', created_at: now.toISOString(), seq: batchSeq },
    }

    const order: Order = {
      id: orderId,
      mesa,
      clienteNombre: clienteNombre || undefined,
      mesero,
      personas,
      status: 'enviada',
      items: itemsWithBatch,
      subtotal,
      iva,
      total,
      descuento: discount,
      turnoId: turnoId || undefined,
      notas: orderNotes || undefined,
      createdAt: now,
      orderRevision,
      comandaBatches,
      orderNumber: orderNumber ?? undefined,
    }
    // SAVE FIRST — confirm persistence before printing
    // R2D: opId generated ONCE per logical save action, survives catch → queue → replay
    const saveResult = await saveOrder(order, opId)
    if (!saveResult.ok) {
      if (saveResult.conflict) {
        // Identify net-new items B is trying to send (not yet in kitchen)
        const conflictNewItems = itemsWithBatch.filter(i => !sentItemIds.has(i.id))
        if (conflictNewItems.length > 0) {
          // Append-only: safe without OCC because item IDs are globally unique UUIDs
          const appendResult = await addOrderItems(order.id, conflictNewItems)
          if (appendResult.ok) {
            setOrderRevision(appendResult.revision!)
            setLoadedOrderId(order.id)
            setSentItemIds(prev => { const n = new Set(prev); conflictNewItems.forEach(i => n.add(i.id)); return n })
            setSentItemSnapshots(prev => {
              const n = { ...prev }
              for (const item of conflictNewItems) {
                n[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
              }
              return n
            })
            const conflictPrint = await printByStation({ ...order, items: conflictNewItems })
            if (conflictPrint.failed.length > 0) showToast(`⚠ Impresora sin conexión: ${conflictPrint.failed.join(', ')}`)
            showToast(`${conflictNewItems.length} item${conflictNewItems.length !== 1 ? 's' : ''} enviados`)
            try {
              const freshRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${order.id}&select=updated_at`, {
                headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
              })
              if (freshRes.ok) { const rows = await freshRes.json(); if (rows[0]?.updated_at) setLoadedUpdatedAt(rows[0].updated_at) }
            } catch {}
            sessionStorage.removeItem('pos_staff')
            sessionStorage.removeItem('pos_last_activity')
            router.push('/pos/mesas'); lock()
            return
          } else {
            if (saveResult.current_revision != null) setOrderRevision(saveResult.current_revision)
            showToast('Error al enviar — intenta de nuevo')
          }
        } else {
          // Only metadata (personas, notas, mesero) conflicted — refresh revision and let user retry
          if (saveResult.current_revision != null) {
            setOrderRevision(saveResult.current_revision)
            try {
              const freshRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${order.id}&select=updated_at`, {
                headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
              })
              if (freshRes.ok) { const rows = await freshRes.json(); if (rows[0]?.updated_at) setLoadedUpdatedAt(rows[0].updated_at) }
            } catch {}
          }
          showToast('Toca Enviar de nuevo')
        }
      } else if (saveResult.error === 'OFFLINE_QUEUED') {
        showToast('Sin conexión — orden guardada localmente, se enviará al reconectar')
        // Bridge is local (127.0.0.1:7717) — print even when internet is down
        const offlineNewItems = activeItems.filter(i => !sentItemIds.has(i.id))
        if (offlineNewItems.length > 0) {
          const offlinePrintOrder: Order = { ...order, items: offlineNewItems }
          printByStation(offlinePrintOrder).then(r => {
            if (r.failed.length > 0) showToast(`⚠ Impresora sin conexión: ${r.failed.join(', ')}`)
          }).catch(() => {})
        }
        // Mark all items as sent so UI reflects "enviado" and prevents duplicate Enviar
        setSentItemIds(prev => { const n = new Set(prev); activeItems.forEach(i => n.add(i.id)); return n })
        setSentItemSnapshots(prev => {
          const n = { ...prev }
          for (const item of activeItems) {
            n[item.id] = { cantidad: item.cantidad, modificadores: [...(item.modificadores || [])], notas: item.notas || '', silla: item.silla }
          }
          return n
        })
        setLoadedOrderId(order.id)
        // Optimistic revision bump: if payment (B-03) also happens offline, its
        // expected_revision must be 1 higher than this send's queued revision.
        // If internet returns before payment, saveResult.revision (line ~3161) overrides this.
        setOrderRevision(prev => prev + 1)
        // Immediate count refresh: interval only fires every 30s, but IDB is local.
        getPendingQueue().then(q => setPendingSync(q.length)).catch(() => {})
        // Broadcast to local server so KDS on other LAN devices receives the order offline
        fetch(`${getBridgeUrl()}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command_id: opId,
            command_type: 'ORDER_SENT',
            order_id: order.id,
            mesa: order.mesa,
            mesero: order.mesero,
            status: 'enviada',
            items: order.items,
            personas: order.personas,
            total: order.total,
            turno_id: order.turnoId || null,
            notas: order.notas || null,
            comanda_batches: order.comandaBatches || null,
            client_id: _cid(),
          }),
        }).catch(() => {})
        // Enviado (offline queue). Al mapa de mesas al instante + bloqueo. Sin espera.
        sessionStorage.removeItem('pos_staff')
        sessionStorage.removeItem('pos_last_activity')
        router.push('/pos/mesas')
        lock()
      } else if (saveResult.error === 'SESSION_EXPIRED') {
        showToast('Sesión expirada — ingresa tu PIN de nuevo')
        setSaving(false); operationLock.current = false
        lock()
        return
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

    // Broadcast to local server so KDS on LAN devices updates immediately (not on 5s Supabase poll)
    fetch(`${getBridgeUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: opId,
        command_type: 'ORDER_SENT',
        order_id: order.id,
        mesa: order.mesa,
        mesero: order.mesero,
        status: 'enviada',
        items: order.items,
        personas: order.personas,
        total: order.total,
        turno_id: order.turnoId || null,
        notas: order.notas || null,
        comanda_batches: order.comandaBatches || null,
        client_id: _cid(),
      }),
    }).catch(() => {})

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

      // Deduct ingredients at kitchen send time (only new items in this batch)
      if (newItems.length > 0) {
        try {
          await deductIngredientsForOrder(newItems, orderId, mesero || 'POS', batchId)
        } catch (err) {
          console.error('[inventory] Deduction error (non-blocking):', err)
        }
      }

      setLoadedOrderId(orderId)
      // Read server's actual updated_at + order_number (triggers set these)
      try {
        const freshRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}&select=updated_at,order_number`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` },
        })
        if (freshRes.ok) {
          const rows = await freshRes.json()
          if (rows[0]?.updated_at) setLoadedUpdatedAt(rows[0].updated_at)
          else setLoadedUpdatedAt(new Date().toISOString())
          if (rows[0]?.order_number) setOrderNumber(rows[0].order_number)
        } else setLoadedUpdatedAt(new Date().toISOString())
      } catch { setLoadedUpdatedAt(new Date().toISOString()) }
      // NO liberar el lock aquí: se mantiene hasta navegar → evita doble-envío/doble-lock
      // si el mesero toca Enviar dos veces.
      // Cache order locally so it loads instantly when returning to this mesa
      try {
        localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({ id: orderId, items: activeItems, mesero, personas, discount, notas: orderNotes, revision: saveResult.revision ?? orderRevision, updatedAt: new Date().toISOString(), ts: Date.now() }))
        localStorage.removeItem(`pos_draft_${mesa}`) // clear draft after successful save
      } catch {}
      // Tras enviar: al mapa de mesas AL INSTANTE + bloqueo (re-identificación por
      // PIN/huella = cada comanda atada a quien la envió). Sin la espera de 15s.
      sessionStorage.removeItem('pos_staff')
      sessionStorage.removeItem('pos_last_activity')
      router.push('/pos/mesas')
      lock()
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
    // COB-017: block opening payment modal when an MP recovery is pending resolution
    if (needsOperatorAttention(mpRecovery)) {
      showToast('Pago MP pendiente de registrar — usa el botón de reintento')
      return
    }
    setVerifiedPersonas(personas)
    setCustomPersonas('')
    setShowPersonVerify(true)
  }

  // _mpOpId: provided by the MP Point recovery flow — same opId reused on retry for idempotent write
  const handlePayment = async (method: string, _mpOpId?: string) => {
    // COB-017: block a new normal payment while an MP recovery requires attention.
    // When _mpOpId is provided, this IS the recovery retry — skip the guard.
    if (!_mpOpId && needsOperatorAttention(mpRecovery)) {
      showToast('Pago MP pendiente de registrar — usa el botón de reintento')
      return
    }
    if (operationLock.current) return
    operationLock.current = true
    setSaving(true)
    const opId = _mpOpId ?? genOpId()
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
      payTotal = paySubtotalAfterDiscount + paySubtotalAfterDiscount * getIvaRate()
    }
    const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
    const payIva = paySubtotalAfterDiscount * getIvaRate()
    const payId = splitPayingCuenta > 0 ? `${orderId}-C${splitPayingCuenta}` : orderId

    // Desglose de pagos (multi-forma estilo POS legado). Pago simple → 1 elemento.
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
      orderNumber: orderNumber ?? undefined,
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
    // Offline: cobro guardado en cola — tratar como éxito, imprimir ticket y limpiar UI
    if (!saveResult.ok && saveResult.error === 'OFFLINE_QUEUED') {
      if (pagos.some(p => p.metodo.toLowerCase().includes('efectivo'))) openCashDrawer()
      handlePrintTicket(order)
      showToast('Sin conexión — cobro guardado localmente, se sincronizará al reconectar')
      setSaving(false); operationLock.current = false
      setOrderItems([]); setCancelledItems(new Set()); setSentItemIds(new Set()); setSentItemSnapshots({})
      setDiscount(0); setPropina(0)
      try { localStorage.removeItem(`pos_order_${mesa}`) } catch {}
      setOrderNotes(''); setShowPayment(false); setShowCashFlow(false); setCashAmount('')
      setShowMixto(false); setMixtoPagos([]); setMixtoMonto(''); setSillaActual(1)
      setTiempoFired(0); setSplitPayingCuenta(0); setSplitAssignments({})
      setSplitCount(0); setSplitMode(null); setSplitParejoN(0); setOrderId(generateId())
      getPendingQueue().then(q => setPendingSync(q.length)).catch(() => {})
      return
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

      // Ingredient deduction happens at kitchen send time (not here).
      // Market stock (retail items) still deducts at payment below.

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
      // Tras cobrar: al mapa de mesas + bloqueo (re-identificación), igual que al
      // enviar. Evita quedar en la mesa (o caer a mesa 1) tras cerrar la cuenta.
      sessionStorage.removeItem('pos_staff')
      sessionStorage.removeItem('pos_last_activity')
      router.push('/pos/mesas')
      lock()
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

  // COB-017: MP recovery retry — reuses the original opId for idempotent DB write.
  // Side effects (ticket, drawer) will only fire if saveOrder confirms ok === true;
  // for card payments there is no cash drawer, so the only duplicate risk is the ticket,
  // which is acceptable during a manual reconciliation scenario.
  const handleMpRecoveryRetry = async () => {
    if (!mpRecovery || operationLock.current) return
    updateMpRecovery({ ...mpRecovery, state: 'FULLSITE_PENDING' as MpPaymentState })
    try {
      await handlePayment('Tarjeta de crédito', mpRecovery.opId)
      clearMpRecovery()
    } catch (err) {
      updateMpRecovery({ ...mpRecovery, state: 'RECONCILIATION_REQUIRED' as MpPaymentState, error: String(err) })
    }
  }

  const handleMpMarkManual = () => {
    if (!mpRecovery) return
    const marked: MpPaymentRecovery = { ...mpRecovery, state: 'FAILED_MANUAL_REVIEW' as MpPaymentState }
    updateMpRecovery(marked)
    void logAudit({
      order_id: mpRecovery.orderId, action: 'mp_payment_marked_manual_review',
      actor: mesero, mesa,
      details: { intentId: mpRecovery.intentId, amount: mpRecovery.amount },
    })
  }

  return (
    <div className="pos-kiosk h-dvh flex flex-col overflow-hidden select-none" style={{ background:'var(--bg)', color:'var(--text-1)' } as React.CSSProperties}>

      {/* COB-017: MP Payment Recovery Banner — shown when MP captured money but Fullsite failed to record */}
      {needsOperatorAttention(mpRecovery) && mpRecovery && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-red-950 border-b-2 border-red-500 px-4 py-3 flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-red-200 font-bold text-sm leading-tight">
                {mpRecovery.state === 'FAILED_MANUAL_REVIEW'
                  ? 'Pago MP marcado para revisión manual'
                  : 'Pago aprobado en terminal — registro pendiente en Fullsite'}
              </p>
              <p className="text-[var(--crit-ink)] text-xs mt-0.5">
                Mesa {mpRecovery.mesa} · {formatMXN(mpRecovery.amount)} · {new Date(mpRecovery.timestamp).toLocaleTimeString('es-MX')} · ID: <span className="font-mono">{mpRecovery.intentId.slice(-8)}</span>
              </p>
            </div>
            {mpRecovery.state !== 'FAILED_MANUAL_REVIEW' && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handleMpRecoveryRetry}
                  disabled={saving}
                  className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg"
                >
                  Reintentar
                </button>
                <button
                  onClick={handleMpMarkManual}
                  className="bg-red-900 hover:bg-red-800 text-[var(--crit-ink)] text-xs font-bold px-3 py-2 rounded-lg border border-red-700"
                >
                  Marcar manual
                </button>
              </div>
            )}
            {mpRecovery.state === 'FAILED_MANUAL_REVIEW' && (
              <button
                onClick={clearMpRecovery}
                className="bg-red-900 hover:bg-red-800 text-[var(--crit-ink)] text-xs font-bold px-3 py-2 rounded-lg border border-red-700 flex-shrink-0"
              >
                Resuelto
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="pos-safe-top flex flex-col bg-[var(--surface-2)] border-b border-[var(--line)] flex-shrink-0">
        {/* Row 1: Logo + Hamburger + Ready badge + Staff + Clock */}
        <div className="flex items-center justify-between px-3 py-0.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNav(!showNav)} className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] active:bg-[var(--surface-2)]0 flex items-center justify-center transition-colors">
              {showNav ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="text-[var(--text-1)] font-black text-base tracking-tight">
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
            {staffName && <span className="text-xs text-[var(--accent-ink)]">{staffName}</span>}
            {isMobileRestricted && <span className="text-[10px] text-[var(--warn-ink)] bg-[var(--warn-soft)] px-2 py-0.5 rounded-full">Solo ordenes</span>}
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
              className="w-11 h-11 rounded-lg bg-[var(--line)] hover:bg-[var(--crit-soft)] flex items-center justify-center transition-colors"
            >
              <Lock size={18} />
            </button>
          </div>
        </div>
        {/* Row 2: Selectors (compact for tablet) */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-[var(--line)]/50 overflow-x-auto">
          {/* Back to mesa map — always visible in kiosk mode (no browser back button) */}
          <Link
            href="/pos/mesas"
            className="flex items-center justify-center w-11 h-11 rounded-lg bg-[var(--line)] border border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)] flex-shrink-0 transition-colors"
            title="Volver al mapa de mesas"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-1 bg-[var(--line)] rounded-lg px-3 py-0.5 border border-[var(--line)] min-h-[40px]">
            <span className="text-[var(--text-1)] text-sm font-medium">Mesa</span>
            <input
              type="number"
              disabled={!!clienteNombre}
              value={mesa}
              onWheel={e => e.currentTarget.blur()}
              onChange={(e) => {
                const newMesa = Number(e.target.value) || 1
                if (orderItems.length > 0 && newMesa !== mesa) {
                  logAudit({ order_id: orderId, action: 'status_changed', actor: mesero, mesa, details: { type: 'mesa_moved', from: mesa, to: newMesa } })
                  showToast(`Mesa ${mesa} → Mesa ${newMesa}`)
                }
                setMesa(newMesa)
                router.replace(`/pos?mesa=${newMesa}`)
              }}
              min={1} max={999}
              className="w-14 bg-transparent text-[var(--text-1)] text-base font-bold text-center border-none outline-none"
            />
          </div>
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-[var(--line)] text-[var(--text-1)] rounded-lg px-4 py-2 text-lg font-bold border border-[var(--line)] min-h-[48px]">
            {Array.from({ length: 20 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}p</option>))}
          </select>
          {/* Mesero — BLOQUEADO a la identidad logueada (anti-fraude). Reasignar
              requiere PIN de gerente y queda en bitácora. */}
          {reassignMgr ? (
            <select
              autoFocus
              value={mesero}
              onChange={(e) => {
                const newMesero = e.target.value
                const prevMesero = mesero
                setMesero(newMesero)
                try { localStorage.setItem('pos_mesero', newMesero) } catch {}
                if (loadedOrderId) {
                  fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?id=eq.${loadedOrderId}`, { method: 'PATCH', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ mesero: newMesero }) }).catch(err => console.error('[mesero-update]', err))
                }
                logAudit({ order_id: orderId, action: 'mesero_reassigned', actor: reassignMgr, mesa, details: { from: prevMesero, to: newMesero, authorized_by: reassignMgr } })
                setReassignMgr(null)
              }}
              className="bg-[var(--line)] text-[var(--text-1)] rounded-lg px-3 py-2 text-base font-medium border border-amber-500 min-h-[48px] flex-1 min-w-0"
            >
              {meserosList.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!(staffRole === 'admin' || staffRole === 'gerente')) {
                  setPinInput('')
                  setPinPrompt({
                    title: 'PIN de gerente para reasignar el mesero:',
                    onSubmit: async (pin: string) => {
                      const mgr = await verifyManagerPin(pin)
                      if (!mgr) { showToast('PIN incorrecto'); return }
                      setPinPrompt(null)
                      setReassignMgr(mgr)
                    },
                  })
                } else {
                  // Admin/gerente ya logueado: puede reasignar directo (queda en bitácora)
                  setReassignMgr(staffName || 'gerente')
                }
              }}
              title="Mesero de la orden — bloqueado. Reasignar requiere gerente."
              className="flex items-center gap-2 bg-[var(--line)] text-[var(--text-1)] rounded-lg px-3 py-2 text-base font-medium border border-[var(--line)] min-h-[48px] flex-1 min-w-0"
            >
              <Lock size={14} className="text-[var(--text-3)] flex-shrink-0" />
              <span className="truncate">{mesero || 'Sin mesero'}</span>
            </button>
          )}
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

      {/* Print queue banner — yellow while queue retries automatically, red when user action needed */}
      {printNeedsAttention > 0 ? (
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
      ) : printPending > 0 ? (
        <div className="bg-yellow-500 text-black px-4 py-2 flex items-center gap-2 flex-shrink-0 text-sm font-semibold">
          <span className="animate-pulse">●</span>
          <span>Reintentando impresión...</span>
        </div>
      ) : null}

      {/* Main Content */}
      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-80 bg-[var(--surface-2)] border-r border-[var(--line)] p-4 shadow-2xl overflow-y-auto max-h-[100dvh] pos-fat-scroll" onClick={e => e.stopPropagation()}>
            <p className="text-[var(--text-2)] text-xs font-semibold uppercase mb-2">Navegacion</p>
            {/* Acordeón: un grupo abierto a la vez (details[name="posnav"]) → sin scroll.
             * Solo lo que un operador toca en servicio. El back-office (recetas, food-cost,
             * compras, inventario, XML/facturas proveedor, analítica) vive en el dashboard. */}
            <div className="space-y-1">
              {[
                { title: 'Operación', icon: Grid3X3, defaultOpen: true, items: [
                  { href: '/pos/mesas', icon: Grid3X3, label: 'Mesas', section: 'mesas' },
                  { href: '/pos/cocina', icon: ChefHat, label: 'Cocina', section: 'cocina' },
                  { href: '/pos/barra', icon: Wine, label: 'Barra', section: 'barra' },
                  { href: '/pos/delivery', icon: Bike, label: 'Domicilio', section: 'delivery' },
                ] },
                { title: 'Caja & Turno', icon: Receipt, defaultOpen: false, items: [
                  { href: '/pos/turno', icon: Clock, label: 'Turno', section: 'turno' },
                  { href: '/pos/corte', icon: Receipt, label: 'Corte de caja', section: 'corte' },
                  { href: '/pos/facturacion', icon: Stamp, label: 'Facturación', section: 'facturacion' },
                ] },
                { title: 'Personal', icon: Users, defaultOpen: false, items: [
                  { href: '/pos/asistencia', icon: Clock, label: 'Checador', section: 'configuracion' },
                  { href: '/pos/staff', icon: Users, label: 'Empleados', section: 'configuracion' },
                  { href: '/pos/huella', icon: Lock, label: 'Huellas', section: 'configuracion' },
                ] },
                { title: 'Terminal', icon: Settings, defaultOpen: false, items: [
                  { href: '/pos/configuracion', icon: Settings, label: 'Configuración', section: 'configuracion' },
                  { href: '/pos/monitor', icon: Monitor, label: 'Monitor', section: 'configuracion' },
                  { href: '/pos/qr', icon: QrCode, label: 'QR Mesas', section: 'qr' },
                  { href: '/pos/historial', icon: FileText, label: 'Historial', section: 'historial' },
                  { href: '/pos/auditoria', icon: FileText, label: 'Auditoria', section: 'auditoria' },
                ] },
              ].map(group => {
                const items = group.items.filter(item => canSee(item.section))
                if (items.length === 0) return null
                return (
                  <details key={group.title} name="posnav" open={group.defaultOpen} className="group/nav">
                    <summary className="flex items-center gap-3 px-4 rounded-xl cursor-pointer select-none text-[var(--text-2)] hover:bg-[var(--line)] hover:text-white transition-colors min-h-[60px]">
                      <group.icon size={24} />
                      <span className="text-lg font-bold flex-1">{group.title}</span>
                      <ChevronDown size={20} className="nav-caret opacity-60" />
                    </summary>
                    <div className="mt-1 mb-2 ml-3 pl-3 border-l border-[var(--line)] space-y-1">
                      {items.map(item => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setShowNav(false)}
                          className="flex items-center gap-3 px-3 rounded-lg text-[var(--text-3)] hover:bg-[var(--line)] hover:text-white active:bg-[var(--accent-soft)] transition-colors min-h-[56px]"
                        >
                          <item.icon size={22} />
                          <span className="text-base font-semibold">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>

            {/* Leaderboard en nav */}
            <div className="mt-4 pt-4 border-t border-[var(--line)] space-y-3">
              <MeseroLeaderboard currentMesero={mesero} compact />
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
                  className="flex items-center gap-3 px-4 py-2 rounded-xl w-full text-[var(--crit-ink)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit-ink)] transition-colors min-h-[40px]"
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
                  onWheel={e => e.currentTarget.blur()}
                  onChange={e => { const v = Number(e.target.value) || 1; setMesa(v); router.replace(`/pos?mesa=${v}`) }}
                  min={1}
                  max={999}
                  className="w-14 text-center bg-transparent border border-[var(--line)] rounded-lg text-[var(--text-1)] font-bold text-base mx-1 py-0.5 focus:border-[var(--accent)] focus:outline-none"
                />
                <span className="text-[var(--text-3)] font-normal text-xs">{personas}p · {(mesero || '').split(' ')[0] || 'Sin mesero'}</span>
              </h2>
              <span className="text-[var(--accent-ink)] font-extrabold text-xl font-mono tabular-nums tracking-tight">{formatMXN(total)}</span>
            </div>
          </div>

          {/* Order items list — MAIN AREA, takes all available space */}
          <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            {orderItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 h-40 text-center border border-dashed border-[var(--line)] rounded-[14px] bg-[var(--surface)] mx-1 my-2">
                <span className="w-10 h-10 rounded-[12px] grid place-items-center bg-[var(--surface-2)] text-[var(--text-3)]">
                  <Utensils size={18} />
                </span>
                <p className="text-sm font-semibold text-[var(--text-2)]">Toca un producto para agregar</p>
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
                    <div key={item.id} className="flex items-center gap-2 py-1 px-2 rounded-lg bg-[var(--warn-soft)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)]">
                      <Flame size={13} className="text-[var(--warn-ink)] flex-shrink-0" />
                      <p className="flex-1 text-[var(--warn-ink)] font-bold text-xs tracking-widest text-center">{item.nombre}</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTiempoSeparator(item.id) }}
                        className="w-11 h-11 rounded-md bg-[var(--warn-soft)] hover:bg-[var(--warn-soft)] text-[var(--warn-ink)] flex items-center justify-center transition-colors"
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
                                  sillaActual === seat ? 'bg-[var(--info-soft)] border border-[color-mix(in_srgb,var(--info)_40%,transparent)]' : 'bg-[var(--surface-2)]/40'
                                }`}
                              >
                                <Armchair size={14} className="text-[var(--info-ink)]" />
                                <span className="text-[var(--info-ink)] text-xs font-bold">Asiento {seat}</span>
                                <span className="text-[var(--text-3)] text-xs ml-auto">{formatMXN(seatTotal)}</span>
                              </button>
                            )}
                            {seatItems.map(item => {
                  const isCancelled = cancelledItems.has(item.id)
                  const isVoided = voidedItems.has(item.id)
                  const isSent = sentItemIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 py-1.5 px-2.5 rounded-[12px] transition-all ${
                        isVoided
                          ? 'bg-[var(--surface-2)] border border-[var(--line)] opacity-40'
                          : isCancelled
                          ? 'bg-[var(--crit-soft)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] opacity-60'
                          : flashItemId === item.id
                          ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)]'
                          : 'bg-[var(--surface-2)] border border-[var(--line)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)]'
                      }`}
                    >
                      {/* Quantity controls */}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1) }}
                          disabled={isCancelled || isVoided || isSent}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Minus size={18} />
                        </button>
                        <span className={`w-7 text-center font-bold text-lg font-mono tabular-nums ${isSent ? 'text-[var(--text-3)]' : ''}`}>
                          {item.cantidad}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                          disabled={isCancelled || isVoided || isSent}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Plus size={18} />
                        </button>
                      </div>

                      {/* Item name + modifiers + KDS status */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm leading-tight ${isVoided ? 'line-through text-[var(--text-4)]' : isCancelled ? 'line-through text-[var(--crit-ink)]' : ''}`}>
                          {item.nombre}
                          {!isCancelled && !isVoided && (item as OrderItem & { kds_done?: boolean }).kds_done && (
                            <span className="ml-2 inline-flex items-center bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-[var(--accent-line)] text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">LISTO</span>
                          )}
                          {!isCancelled && !isVoided && item.station && isNoPrintStation(item.station) && (
                            <span className="ml-2 inline-flex items-center bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--line)] text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none" title="Producto de Market — no genera comanda">SIN COMANDA</span>
                          )}
                        </p>
                        {isVoided && (
                          <span className="inline-flex items-center bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5">ANULADO</span>
                        )}
                        {isCancelled && !isVoided && (
                          <span className="inline-flex items-center bg-[var(--crit-soft)] text-[var(--crit-ink)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5">CANCELADO</span>
                        )}
                        {(item.modificadores || []).length > 0 && (
                          <p className="text-[var(--text-3)] text-[11px] truncate leading-relaxed">
                            {(item.modificadores || []).map((mod, mi, arr) => {
                              const parts = String(mod).split(/(\+\$[\d,.]+)/g)
                              return (
                                <span key={mi}>
                                  {parts.map((p, pi) => /^\+\$/.test(p)
                                    ? <span key={pi} className="text-[var(--accent-ink)] font-semibold font-mono tabular-nums">{p}</span>
                                    : <span key={pi}>{p}</span>)}
                                  {mi < arr.length - 1 ? ' · ' : ''}
                                </span>
                              )
                            })}
                          </p>
                        )}
                        {item.notas && (
                          <p className="text-[var(--text-2)] text-[11px] italic truncate">
                            {item.notas}
                          </p>
                        )}
                      </div>

                      {/* Silla badge (tap para ciclar 1..personas) — locked if sent */}
                      {!isCancelled && !isVoided && (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (!isSent) cycleSilla(item.id) }}
                          disabled={isSent}
                          className={`flex-shrink-0 min-w-[44px] h-11 px-2 rounded-lg text-sm font-bold flex items-center justify-center transition-colors ${isSent ? 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-4)] cursor-not-allowed' : 'bg-[var(--info-soft)] border border-[color-mix(in_srgb,var(--info)_40%,transparent)] text-[var(--info-ink)] hover:bg-[var(--info-soft)]'}`}
                          title={isSent ? 'Enviado — no se puede cambiar silla' : 'Silla — toca para cambiar'}
                        >
                          {isSent && <Lock size={12} className="mr-1" />}
                          S{item.silla || 1}
                        </button>
                      )}

                      {/* Line total */}
                      <span className={`font-semibold text-sm w-20 text-right flex-shrink-0 font-mono tabular-nums ${isVoided ? 'line-through text-[var(--text-4)]' : isCancelled ? 'line-through text-[var(--crit-ink)]' : ''}`}>
                        {formatMXN(item.subtotal)}
                      </span>

                      {!isCancelled && !isVoided && (
                        <>
                          {/* Edit — disabled if sent to kitchen (Eduardo Jul 21) */}
                          {!isSent && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditOrderItem(item) }}
                            className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
                          >
                            <Pencil size={18} />
                          </button>
                          )}

                          {/* Transfer platillo (Eduardo Jul 21 — requires supervisor PIN) */}
                          {isSent && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setTransferringItem(item) }}
                            className="w-11 h-11 rounded-lg bg-[var(--warn-soft)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] hover:bg-[var(--warn-soft)] text-[var(--warn-ink)] flex items-center justify-center transition-colors"
                            title="Transferir platillo a otra mesa (requiere supervisor)"
                          >
                            <ArrowRightLeft size={16} />
                          </button>
                          )}

                          {/* Cancel (NOT delete — requires reason + manager PIN) */}
                          {can('cancelar_ordenes') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-11 h-11 rounded-lg bg-[var(--crit-soft)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] hover:bg-[var(--crit-soft)] text-[var(--crit-ink)] flex items-center justify-center transition-colors"
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
                className="flex items-center gap-1.5 px-4 min-h-[48px] rounded-lg bg-[var(--warn-soft)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] hover:bg-[var(--warn-soft)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--warn-ink)] text-sm font-semibold transition-colors"
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
                  className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--crit-soft)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] hover:bg-[var(--crit-soft)] text-[var(--crit-ink)] transition-colors"
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
                  className="flex-1 min-w-0 bg-[var(--line)]/60 border border-[var(--line-soft)] rounded-lg px-3 min-h-[48px] text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <button
                onClick={() => { if (!isMobileRestricted) { openCashDrawer(); showToast('Cajón abierto') } }}
                disabled={isMobileRestricted}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-[var(--raised)] disabled:opacity-30 text-[var(--text-3)] transition-colors"
                title={isMobileRestricted ? 'Solo disponible en terminal de caja' : 'Abrir cajón'}
              >
                <Banknote size={18} />
              </button>
              <button
                onClick={() => { if (!isMobileRestricted) setShowCashMovement(true) }}
                disabled={isMobileRestricted}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-[var(--raised)] disabled:opacity-30 text-[var(--text-3)] transition-colors"
                title={isMobileRestricted ? 'Solo disponible en terminal de caja' : 'Retiro / Deposito'}
              >
                <DollarSign size={18} />
              </button>
              <button
                onClick={() => {
                  const now = Date.now()
                  if (now - lastReprintRef.current < 3000) return
                  lastReprintRef.current = now
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
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-[var(--raised)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-3)] transition-colors"
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
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--info-soft)] hover:bg-[var(--info-soft)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--info-ink)] transition-colors"
                title="Transferir mesa"
              >
                <ArrowRightLeft size={18} />
              </button>
              <button
                onClick={() => setShowVoidOrder(true)}
                disabled={orderItems.length === 0}
                className="w-12 min-h-[48px] flex items-center justify-center rounded-lg bg-[var(--crit-soft)] hover:bg-[var(--crit-soft)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--crit-ink)] transition-colors"
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
                    className="flex items-center gap-1 px-3 min-h-[36px] rounded-full bg-[var(--accent-soft)] border border-[var(--accent-line)] text-[var(--accent-ink)] text-xs font-bold whitespace-nowrap hover:bg-[var(--accent-soft)] animate-pulse"
                  >
                    <Tag size={12} />
                    {ap.label} (-{formatMXN(ap.discount)})
                  </button>
                ))}
              </div>
            )}
            {appliedPromo && discount > 0 && (
              <div className="flex items-center gap-1.5 mb-1 text-xs text-[var(--accent-ink)]">
                <Tag size={12} />
                <span className="font-semibold">{appliedPromo.label}</span>
              </div>
            )}

            {/* Totals — compact */}
            <div className="flex items-center justify-between text-xs text-[var(--text-3)] mb-0.5">
              <span>Sub <span className="font-mono tabular-nums text-[var(--text-2)]">{formatMXN(subtotal)}</span></span>
              {discount > 0 && <span className="text-[var(--crit-ink)]">-<span className="font-mono tabular-nums">{formatMXN(discount)}</span></span>}
              <span>IVA <span className="font-mono tabular-nums text-[var(--text-2)]">{formatMXN(iva)}</span></span>
              <span className="text-[var(--accent-ink)] text-lg font-extrabold font-mono tabular-nums tracking-tight">{formatMXN(total)}</span>
            </div>
          </div>

          {/* Action buttons — compact for tablets */}
          <div className="px-3 py-1 border-t border-[var(--line)] flex gap-2 flex-shrink-0">
            {orderItems.length === 0 ? (
              <button
                onClick={() => router.push('/pos/mesas')}
                className="flex-1 flex items-center justify-center gap-2 bg-[var(--surface-2)] hover:bg-[var(--text-4)] active:bg-[var(--raised)] active:scale-[0.97] text-[var(--text-1)] font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
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
        <div className={`md:w-[50%] lg:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`} style={{background:'var(--surface)'}}>
          {/* Search bar — touch target + barcode scanner */}
          <div className="px-2 pt-1 pb-0.5 flex-shrink-0 flex gap-2">
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] rounded-[11px] px-3 py-1.5 text-[var(--text-1)] placeholder-[var(--text-4)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] min-h-[36px]"
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
                          className="w-full bg-[var(--surface-2)] hover:bg-[var(--line)] active:bg-[var(--accent-soft)] border border-[var(--line)] rounded-xl text-left transition-colors flex items-center min-h-[64px] overflow-hidden"
                        >
                          <div className={`w-1.5 self-stretch flex-shrink-0 rounded-l-lg ${catColor}`} />
                          <div className="flex items-center justify-between flex-1 px-3 py-3">
                            <div>
                              <span className="font-semibold text-base text-[var(--text-1)]">{item.name}</span>
                              <span className="text-[var(--text-2)] text-xs ml-2">{category}</span>
                            </div>
                            <span className="text-[var(--accent-ink)] font-bold text-lg font-mono tabular-nums">{formatMXN(item.price)}</span>
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
                  {menuCategories.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                      <Package size={48} className="text-[var(--text-3)] mb-4 opacity-40" />
                      <p className="text-lg font-semibold text-[var(--text-1)] mb-2">Sin menú configurado</p>
                      <p className="text-sm text-[var(--text-3)] max-w-md">
                        Importa el menú desde Administración → Carga Masiva o contacta a soporte para configurar tu restaurante.
                      </p>
                    </div>
                  )}
                  {menuCategories.filter(cat => cat.items.some(i => i.price > 0))
                    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                    .map((cat) => {
                      const catColor = (cat as { color?: string }).color || 'bg-[var(--surface-2)]'
                      const itemCount = cat.items.filter(i => i.price > 0).length
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-3 py-3 rounded-xl text-sm font-bold text-center transition-all min-h-[72px] leading-tight flex flex-col items-center justify-center gap-0.5 ${catColor} opacity-85 text-[var(--text-1)] hover:opacity-100 active:scale-95`}
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
                  <div className={`bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-2xl w-[96vw] max-w-[1200px] overflow-hidden flex flex-col ${activeCategory.items.filter(i => i.price > 0).length > 15 ? 'h-[90vh]' : 'max-h-[90vh]'}`} onClick={e => e.stopPropagation()}>
                    <div className={`flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.08)] ${(activeCategory as { color?: string }).color || 'bg-emerald-600'}`}>
                      <h3 className="text-[var(--text-1)] font-bold text-lg">{activeCategory.name} <span className="text-[var(--text-1)]/60 text-sm font-normal ml-2">{activeCategory.items.filter(i => i.price > 0).length} platillos</span></h3>
                      <button onClick={() => { setSelectedCategory(''); setCategorySearch('') }} className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30 active:scale-95">&times;</button>
                    </div>
                    {activeCategory.items.filter(i => i.price > 0).length > 30 && (
                      <div className="px-3 pt-2">
                        <input
                          type="text"
                          value={categorySearch}
                          onChange={e => setCategorySearch(e.target.value)}
                          placeholder="Buscar en esta categoría..."
                          className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2 text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-[var(--accent)]"
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
                      className={`bg-[var(--surface-2)] hover:bg-[var(--raised)] active:scale-[0.97] border rounded-xl text-left transition-all flex overflow-hidden relative shadow-sm ${
                        isOOS
                          ? 'border-[color-mix(in_srgb,var(--crit)_40%,transparent)] opacity-50 cursor-not-allowed'
                          : (item as MenuItem & { promo?: boolean }).promo
                          ? 'border-[var(--accent-line)] ring-1 ring-[var(--accent-soft)]'
                          : 'border-[var(--line-soft)] hover:border-[var(--accent-line)]'
                      }`}
                    >
                      <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-[var(--crit)]' : (activeCategory as { color?: string }).color || 'bg-emerald-600'}`} />
                      {isOOS && <span className="absolute top-2 right-2 bg-[var(--crit)] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide">Agotado</span>}
                      <div className="flex flex-col justify-between px-3 py-2.5 flex-1">
                        <span className={`font-semibold text-sm leading-snug ${isOOS ? 'text-[var(--text-4)] line-through' : 'text-[var(--text-1)]'}`}>{item.name}</span>
                        <span className={`font-bold text-base mt-1 font-mono tabular-nums ${isOOS ? 'text-[var(--crit-ink)]' : 'text-[var(--accent-ink)]'}`}>${Math.round(item.price)}</span>
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
                  <div className="bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-2xl w-[90vw] max-w-[600px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.08)] bg-gradient-to-r from-amber-600 to-orange-600">
                      <h3 className="text-[var(--text-1)] font-bold text-lg">Combos <span className="text-[var(--text-1)]/60 text-sm font-normal ml-2">{allCombos.length} disponibles</span></h3>
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
                              className="w-full bg-[var(--surface-2)] hover:bg-[var(--raised)] active:scale-[0.97] border border-[var(--line-soft)] hover:border-[color-mix(in_srgb,var(--warn)_40%,transparent)] rounded-2xl text-left transition-all p-4 shadow-sm"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-[var(--text-1)] text-lg">{combo.name}</span>
                                <span className="text-[var(--warn-ink)] font-bold text-xl">${Math.round(combo.price)}</span>
                              </div>
                              <div className="text-[var(--text-3)] text-sm space-y-0.5">
                                {combo.items.map((ci, i) => (
                                  <div key={i}>• {ci.name}</div>
                                ))}
                              </div>
                              {savings > 0 && (
                                <div className="mt-2 text-[var(--accent-ink)] text-xs font-semibold">
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

      {/* Transfer Platillo Modal (Eduardo Jul 21 — Batch 8) */}
      {transferringItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-center mb-1">Transferir platillo</h3>
            <p className="text-[var(--text-3)] text-sm text-center mb-4">{transferringItem.cantidad}x {transferringItem.nombre}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1 block">Mesa destino</label>
                <input
                  type="number"
                  id="transfer-mesa-input"
                  placeholder="# mesa"
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] text-center text-lg"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1 block">PIN supervisor</label>
                <input
                  type="password"
                  id="transfer-pin-input"
                  placeholder="PIN"
                  maxLength={8}
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-1)] text-center text-lg tracking-widest"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setTransferringItem(null)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] font-medium transition-colors"
              >Cancelar</button>
              <button
                onClick={() => {
                  const mesaInput = (document.getElementById('transfer-mesa-input') as HTMLInputElement)?.value
                  const pinInput = (document.getElementById('transfer-pin-input') as HTMLInputElement)?.value
                  const targetMesa = parseInt(mesaInput || '', 10)
                  if (isNaN(targetMesa) || targetMesa <= 0) { showToast('Ingresa un numero de mesa valido'); return }
                  if (!pinInput) { showToast('Ingresa PIN de supervisor'); return }
                  handleTransferItem(pinInput, targetMesa)
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition-colors"
              >Transferir</button>
            </div>
          </div>
        </div>
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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--line)] border border-[var(--line)] text-[var(--text-1)] px-6 py-3 rounded-xl shadow-2xl text-sm font-medium animate-fade-in">
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
            <div className="bg-[var(--panel)] rounded-2xl border border-[var(--line)] shadow-2xl w-[96vw] max-w-[1000px] max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="bg-cyan-600 px-5 py-3 flex items-center justify-between flex-shrink-0">
                <h3 className="text-[var(--text-1)] font-bold text-lg">Verificar Orden — Mesa {mesa} <span className="text-[var(--text-1)]/60 font-normal ml-2">{activeItems.reduce((s, i) => s + i.cantidad, 0)} items</span></h3>
                <button onClick={() => setShowVerify(false)} className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-white text-2xl font-bold hover:bg-white/30">&times;</button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {products.map(([productName, items]) => (
                  <div key={productName} className="mb-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[var(--text-1)] font-bold text-base">{productName}</span>
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
                                <td className="py-2 text-[var(--text-1)] font-bold">{item.cantidad}</td>
                                {relevantMods.map(mc => (
                                  <td key={mc} className="py-2 text-center">
                                    {itemMods.toUpperCase().includes(mc.toUpperCase())
                                      ? <span className="text-[var(--accent-ink)] text-lg">✓</span>
                                      : <span className="text-[var(--text-4)]">—</span>
                                    }
                                  </td>
                                ))}
                                <td className="py-2 text-right text-[var(--text-1)] font-semibold">${Math.round(item.precio).toLocaleString()}</td>
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
                  <span className="text-[var(--text-1)] font-bold text-2xl">${Math.round(activeItems.reduce((s, i) => s + i.precio * i.cantidad, 0)).toLocaleString()}</span>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-[rgba(255,255,255,0.1)] flex gap-3 flex-shrink-0">
                <button
                  onClick={() => setShowVerify(false)}
                  className="flex-1 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-[var(--text-1)] font-bold text-base hover:bg-[var(--line)] transition-colors"
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
                    className="py-4 rounded-xl bg-emerald-900/30 hover:bg-[var(--accent-soft)] border border-emerald-700/50 hover:border-emerald-500 text-[var(--accent-ink)] font-bold text-sm transition-all"
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
                      className="py-4 rounded-xl bg-[var(--line)] hover:bg-[var(--accent-soft)] border border-transparent hover:border-emerald-600 text-white font-bold text-xl transition-all"
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
                  const fullTotal = fullAfterDisc + fullAfterDisc * getIvaRate()
                  const perPerson = fullTotal / splitParejoN
                  return (
                    <div className="text-center mb-6">
                      <p className="text-[var(--text-3)] text-sm mb-2">Total dividido entre {splitParejoN} personas</p>
                      <p className="text-3xl font-bold text-[var(--accent-ink)]">{formatMXN(perPerson)}</p>
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
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${CUENTA_COLORS[cuenta]} text-[var(--text-1)]`}>C{cuenta}</span>
                          <span className="text-[var(--text-1)] text-sm">{item.cantidad}x {item.nombre}</span>
                        </div>
                        <span className="text-[var(--text-1)] font-semibold">{formatMXN(item.subtotal)}</span>
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
                    const cWithIva = cTotal + cTotal * getIvaRate()
                    return (
                      <div key={cNum} className={`${CUENTA_BG[cNum]} border rounded-xl p-3 text-center`}>
                        <p className={`${CUENTA_TEXT[cNum]} text-xs font-bold mb-1`}>CUENTA {cNum}</p>
                        <p className="text-[var(--text-1)] text-lg font-bold">{formatMXN(cWithIva)}</p>
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
              <h3 className="text-lg font-bold text-[var(--text-1)]">Confirmar personas</h3>
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
                  className="w-full bg-[var(--bg)] border border-[var(--line)] rounded-xl px-4 py-3 text-[var(--text-1)] text-2xl text-center font-bold focus:outline-none focus:border-[var(--accent)]"
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
          <div className="rounded-2xl p-6 w-full max-w-md border border-[var(--line)]" style={{background:'var(--panel)'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-[var(--text-1)] flex items-center gap-2">
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
                  className="w-full border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] text-sm focus:outline-none focus:border-cyan-500" style={{background:'var(--surface-2)'}}
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
                    className="flex-1 border border-[var(--line)] rounded-lg px-4 py-3 text-[var(--text-1)] text-sm focus:outline-none focus:border-cyan-500" style={{background:'var(--surface-2)'}}
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
                    className="flex-1 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-[var(--crit-ink)] font-semibold text-sm transition-colors"
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

      {/* Impresión por tiempos (firebutton estilo POS legado) */}
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
            <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-sm border border-[color-mix(in_srgb,var(--warn)_40%,transparent)]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2"><Flame size={18} className="text-[var(--warn-ink)]" />Impresión por tiempos</h3>
                <button onClick={() => setShowFirebutton(false)} className="w-11 h-11 rounded-lg bg-[var(--line)] flex items-center justify-center"><X size={18} /></button>
              </div>
              {done ? (
                <p className="text-[var(--accent-ink)] text-sm text-center py-4">Todos los tiempos fueron disparados ({numTiempos} de {numTiempos})</p>
              ) : (
                <>
                  <p className="text-[var(--text-3)] text-sm mb-1">Tiempo siguiente: <span className="text-[var(--warn-ink)] font-bold text-lg">{nextTiempo}</span> de {numTiempos}</p>
                  <div className="bg-[var(--line)]/50 rounded-lg p-3 mb-4 max-h-36 overflow-y-auto">
                    {nextItems.length === 0
                      ? <p className="text-[var(--text-2)] text-xs">Sin platillos en este tiempo</p>
                      : nextItems.map(i => <p key={i.id} className="text-[var(--text-1)] text-xs py-0.5">{i.cantidad}x {i.nombre}</p>)}
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
                payTotal = sub + sub * getIvaRate()
              }
              const paySubAfterDisc = Math.max(0, paySubtotal - payDiscountLocal)
              const payIva = paySubAfterDisc * getIvaRate()
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
              <p className="text-5xl font-black text-[var(--text-1)]">{formatMXN(payTotal)}</p>
              {discount > 0 && splitPayingCuenta === 0 && (
                <p className="text-[var(--crit-ink)] text-sm mt-1">Descuento: -{formatMXN(discount)}</p>
              )}
              {propina > 0 && (
                <p className="text-[var(--accent-ink)] text-lg font-bold">+ propina {formatMXN(propina)} = {formatMXN(payTotal + propina)}</p>
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
                  className="w-28 min-h-[56px] bg-[var(--line)] border border-[var(--line)] rounded-xl px-3 text-[var(--text-1)] text-lg text-center focus:outline-none focus:border-[var(--accent)]"
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
                              // COB-017: persist MP_APPROVED with a stable opId BEFORE calling handlePayment.
                              // If handlePayment throws (JS exception, not network), the recovery record
                              // survives in localStorage so the operator can retry with the same opId
                              // → saveOrder is idempotent (save_operation_id deduplication at DB level).
                              const recoveryOpId = genOpId()
                              const mpRec: MpPaymentRecovery = {
                                state: 'MP_APPROVED',
                                intentId,
                                orderId,
                                opId: recoveryOpId,
                                amount: payTotal + propina,
                                mesa,
                                mesero,
                                timestamp: new Date().toISOString(),
                              }
                              updateMpRecovery(mpRec)
                              try {
                                await handlePayment('Tarjeta de crédito', recoveryOpId)
                                clearMpRecovery()
                              } catch (err) {
                                const failed: MpPaymentRecovery = {
                                  ...mpRec,
                                  state: 'RECONCILIATION_REQUIRED' as MpPaymentState,
                                  error: String(err),
                                }
                                updateMpRecovery(failed)
                                setSaving(false)
                                operationLock.current = false
                                void logAudit({
                                  order_id: orderId, action: 'mp_payment_recovery_required',
                                  actor: mesero, mesa,
                                  details: { intentId, amount: payTotal + propina, error: String(err), opId: recoveryOpId },
                                })
                              }
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
                      if (!navigator.onLine) {
                        showToast('Sin conexión — pago con terminal no disponible offline')
                      } else {
                        handlePayment('Tarjeta de crédito')
                      }
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
                    <p className="text-[var(--accent-ink)] text-lg font-bold text-center">Total a cobrar: {formatMXN(totalConPropina)}</p>
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
                      className="w-full bg-[var(--bg)] border-2 border-[var(--line)] rounded-xl px-4 py-4 text-[var(--text-1)] text-3xl text-center font-black focus:outline-none focus:border-[var(--accent)]"
                    />
                    {cashReceived > 0 && (
                      <div className={`text-center py-3 rounded-xl ${cambio >= 0 ? 'bg-[var(--accent-soft)] border border-emerald-700/40' : 'bg-[var(--crit-soft)] border border-red-700/40'}`}>
                        {cambio >= 0 ? (
                          <p className="text-3xl font-black text-[var(--accent-ink)]">Cambio: {formatMXN(cambio)}</p>
                        ) : (
                          <p className="text-xl text-[var(--crit-ink)] font-bold">Falta {formatMXN(Math.abs(cambio))}</p>
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
                  <p className="text-[var(--info-ink)] text-sm font-bold text-center uppercase tracking-wide">Teclea en la terminal bancaria</p>
                  <p className="text-5xl font-black text-[var(--text-1)] text-center tabular-nums">{formatMXN(payTotal + propina)}</p>
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
              {/* Formas de pago custom desde catálogo (estilo POS legado: Rappi, Ubereats, Cortesía...) */}
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
                        <span className="text-sm text-[var(--text-1)]">{p.metodo}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-1)]">{formatMXN(p.monto)}</span>
                          <button
                            onClick={() => setMixtoPagos(prev => prev.filter((_, i) => i !== idx))}
                            className="w-11 h-11 rounded-lg bg-red-500/15 text-[var(--crit-ink)] flex items-center justify-center"
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
                            className="flex-1 min-h-[52px] bg-[var(--bg)] border border-[var(--line)] rounded-lg px-3 text-[var(--text-1)] text-lg text-right focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => setMixtoMonto(restante.toFixed(2))}
                            className="px-4 min-h-[52px] rounded-lg bg-[var(--bg)]/60 text-[var(--warn-ink)] text-sm font-semibold"
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
                            className="px-5 min-h-[52px] rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-[var(--raised)] disabled:text-[var(--text-4)] text-white text-base font-bold"
                          >
                            Agregar
                          </button>
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-2)]">Restante:</span>
                      <span className={`font-bold ${restante <= 0.009 ? 'text-[var(--accent-ink)]' : 'text-[var(--warn-ink)]'}`}>{formatMXN(restante)}</span>
                    </div>
                    <button
                      onClick={() => handlePayment('Mixto')}
                      disabled={saving || mixtoPagos.length === 0 || restante > 0.009}
                      className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-[var(--raised)] disabled:text-[var(--text-4)] text-white font-bold py-4 rounded-xl text-lg transition-colors min-h-[60px]"
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
              className="w-full px-4 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-center text-lg font-mono text-[var(--text-1)] focus:outline-none focus:border-[var(--accent)]"
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

        // Las alertas de AGENTES IA (anomalías, stock bajo, etc.) NO se muestran en
        // el POS — son para el dashboard. En servicio el operador solo ve alertas
        // OPERATIVAS (órdenes listas, delivery), abajo.

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
