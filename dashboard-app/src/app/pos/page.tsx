'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  MENU_CATEGORIES,
  MESEROS,
  IVA_RATE,
  MANAGER_PINS,
  RECIPE_ALIASES,
  formatMXN,
  generateId,
  saveOrder,
  logAudit,
  deductIngredientsForOrder,
  getRecipes,
  getIngredients,
  getModifiersForCategory,
  getMenuCategoriesFromDB,
  getModifiersForCategoryFromDB,
  type RecipeRow,
  type Ingredient,
  type ModificadorAgregar,
} from '@/lib/pos-data'
import type { OrderItem, MenuItem, Order } from '@/lib/pos-data'
import {
  printByStation,
  printPreTicket,
  printTicketCSS,
  printTicketBluetooth,
  openCashDrawer,
  isBluetoothAvailable,
  isBluetoothConnected,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
} from '@/lib/printer'
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
  Receipt,
  QrCode,
  Menu,
  Printer,
  Bluetooth,
  ScanBarcode,
  Stamp,
  Monitor,
  Settings,
  Loader2,
  Smartphone,
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
      <div className="h-screen flex items-center justify-center text-white" style={{background:'#0a0a0f',color:'#fff'}}>
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
  const { quitarOptions: defaultQuitar, agregarOptions } = getModifiersForCategory(categoryId)

  // Dynamic "quitar" options from recipe ingredients (food only)
  const quitarOptions = recipeIngredients.length > 0
    ? recipeIngredients.map(name => `Sin ${name}`)
    : defaultQuitar

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
    .reduce((sum, m) => sum + m.price, 0)

  const subtotal = (item.price + precioExtra) * cantidad

  const buildModificadores = (): string[] => {
    const mods: string[] = []
    quitarChecked.forEach(m => mods.push(m))
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
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--line)] px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-white">{item.name}</h3>
            <p className="text-emerald-400 font-semibold">{formatMXN(item.price)}</p>
          </div>
          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]"
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
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors min-h-[44px] ${
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

          {/* Agregar section */}
          {agregarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Agregar</h4>
            <div className="grid grid-cols-2 gap-2">
              {agregarOptions.map(mod => (
                <label
                  key={mod.name}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors min-h-[44px] ${
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
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
            className="flex-[2] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors min-h-[48px]"
          >
            {existingOrder ? 'Actualizar' : 'Agregar'} {formatMXN(subtotal)}
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
  onApply: (discount: number, reason?: string) => void
  onCancel: () => void
}

const CORTESIA_POR_PERSONA = 480

function DiscountModal({ subtotal, personas, onApply, onCancel }: DiscountModalProps) {
  const [mode, setMode] = useState<'percent' | 'fixed' | 'cortesia'>('percent')
  const [value, setValue] = useState('')
  const [cortesiaPersonas, setCortesiaPersonas] = useState(1)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [reason, setReason] = useState('')

  const maxCortesia = CORTESIA_POR_PERSONA * cortesiaPersonas
  const discountAmount = mode === 'percent'
    ? subtotal * (Math.min(100, Math.max(0, Number(value) || 0)) / 100)
    : mode === 'fixed'
    ? Math.min(subtotal, Math.max(0, Number(value) || 0))
    : Math.min(subtotal, maxCortesia)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Aplicar descuento</h3>
          <button onClick={onCancel} className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-4)]">
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('percent')}
            className={`flex-1 py-3 rounded-lg font-medium text-xs transition-colors min-h-[44px] ${
              mode === 'percent' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            <Percent size={14} className="inline mr-1 -mt-0.5" /> %
          </button>
          <button
            onClick={() => setMode('fixed')}
            className={`flex-1 py-3 rounded-lg font-medium text-xs transition-colors min-h-[44px] ${
              mode === 'fixed' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            $ Fijo
          </button>
          <button
            onClick={() => setMode('cortesia')}
            className={`flex-1 py-3 rounded-lg font-medium text-xs transition-colors min-h-[44px] ${
              mode === 'cortesia' ? 'bg-violet-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            Cortesía
          </button>
        </div>

        {mode !== 'cortesia' ? (
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

        {discountAmount > 0 && mode !== 'cortesia' && (
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
            onClick={() => {
              if (discountAmount <= 0) return
              const manager = MANAGER_PINS[pin]
              if (!manager) { setPinError(true); return }
              onApply(discountAmount, reason || (mode === 'cortesia' ? `Cortesía ${cortesiaPersonas}p` : `Descuento ${mode === 'percent' ? value + '%' : '$' + value}`))
            }}
            disabled={discountAmount <= 0 || pin.length < 4}
            className={`flex-[2] py-3 rounded-xl ${mode === 'cortesia' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold transition-colors min-h-[48px]`}
          >
            {mode === 'cortesia' ? `Cortesía -${formatMXN(discountAmount)}` : `Aplicar -${formatMXN(discountAmount)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Cancel Item Modal (requires reason + manager PIN) ─────────────────────

interface CancelModalProps {
  itemName: string
  onConfirm: (reason: string, managerName: string) => void
  onCancel: () => void
}

function CancelModal({ itemName, onConfirm, onCancel }: CancelModalProps) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const CANCEL_REASONS = [
    'Cliente cambio de opinion',
    'Platillo agotado',
    'Error del mesero',
    'Preparacion incorrecta',
    'Tiempo de espera excesivo',
    'Otro',
  ]

  const handleConfirm = () => {
    if (!reason) { setError('Selecciona un motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = MANAGER_PINS[pin]
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
            <h3 className="text-lg font-bold text-white">Cancelar item</h3>
            <p className="text-red-400 text-sm">{itemName}</p>
          </div>
        </div>

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
            Cancelar item
          </button>
        </div>
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

  const handleConfirm = () => {
    if (!reason.trim()) { setError('Escribe el motivo'); return }
    if (!pin) { setError('Ingresa PIN de gerente'); return }
    const manager = MANAGER_PINS[pin]
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

// ─── Main POS Content ───────────────────────────────────────────────────────

function POSContent() {
  const searchParams = useSearchParams()
  const initialMesa = Number(searchParams.get('mesa')) || 1

  const [menuCategories, setMenuCategories] = useState(MENU_CATEGORIES)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mesa, setMesa] = useState<number>(initialMesa)
  const [mesero, setMesero] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('pos_staff')
        if (saved) {
          const s = JSON.parse(saved)
          // Match staff name to MESEROS list
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
  const [mixtoEfectivo, setMixtoEfectivo] = useState('')
  const [showCashCalc, setShowCashCalc] = useState(false)
  const [showCashFlow, setShowCashFlow] = useState(false)
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
      const [r, i, dbMenu] = await Promise.all([getRecipes(), getIngredients(), getMenuCategoriesFromDB()])
      setAllRecipes(r)
      setAllIngredients(i)
      if (dbMenu.length > 0) setMenuCategories(dbMenu)

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
    const { syncAll, getPendingQueue } = require('@/lib/pos-offline-db')
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

  const handleConnectPrinter = async () => {
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

  const handlePrintTicket = async (order: Order) => {
    if (isBluetoothConnected()) {
      try {
        await printTicketBluetooth(order)
        showToast('Ticket impreso')
      } catch {
        // Fallback to CSS print
        printTicketCSS(order)
      }
    } else {
      printTicketCSS(order)
    }
  }

  // Person count verification before payment
  const [showPersonVerify, setShowPersonVerify] = useState(false)
  const [verifiedPersonas, setVerifiedPersonas] = useState(0)
  const [customPersonas, setCustomPersonas] = useState('')

  const handlePersonVerified = (count: number) => {
    setPersonas(count)
    setShowPersonVerify(false)
    setShowMixto(false)
    setMixtoEfectivo('')
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
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?mesa=eq.${mesa}&status=in.(enviada,preparando,lista)&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` }, cache: 'no-store' }
        )
        if (cancelled) return // mesa changed while fetching
        if (res.ok) {
          const rows = await res.json()
          if (rows.length > 0 && rows[0].id !== loadedOrderId) {
            const order = rows[0]
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
            setOrderItems(items.filter((i: OrderItem & { cancelled?: boolean }) => !i.cancelled))
            setMesero(order.mesero || MESEROS[0])
            setPersonas(order.personas || 2)
            setDiscount(order.descuento || 0)
            setLoadedOrderId(order.id)
            setLoadedUpdatedAt(order.updated_at || order.created_at || null)
          }
        }
      } catch { /* */ }
    }
    if (orderItems.length === 0) loadMesaOrder()
    return () => { cancelled = true }
  }, [mesa])

  // Order-level notes
  const [orderNotes, setOrderNotes] = useState('')

  // Cancel modal state
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null)

  // Void order modal state
  const [showVoidOrder, setShowVoidOrder] = useState(false)

  // Cancelled items (kept for audit — shown with strikethrough)
  const [cancelledItems, setCancelledItems] = useState<Set<string>>(new Set())

  // Order ID for audit trail (generated once per order)
  const [orderId] = useState(() => generateId())

  // Flash animation state
  const [flashItemId, setFlashItemId] = useState<string | null>(null)

  // Staff role from session
  const [staffRole, setStaffRole] = useState('admin')
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

  // Role permissions — granular system (50+ permissions per Wansoft parity)
  const _perms = (() => {
    try {
      const { getPermissions } = require('@/lib/pos-permissions')
      return getPermissions(staffRole)
    } catch { return null }
  })()
  const can = (perm: string) => _perms ? (_perms as Record<string, boolean>)[perm] ?? true : true

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
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_orders?status=eq.lista&select=id&limit=50`,
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
    menuCategories.find((c) => c.id === selectedCategory) || menuCategories[0]

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
      if (found) { menuItem = found; break }
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
        next[existingIndex] = orderItem
        return next
      }
      logAudit({
        order_id: orderId, action: 'item_added', actor: mesero, mesa,
        details: { item: orderItem.nombre, cantidad: orderItem.cantidad, precio: orderItem.precio, modificadores: orderItem.modificadores },
      })
      return [...prev, orderItem]
    })
    setFlashItemId(orderItem.id)
    setTimeout(() => setFlashItemId(null), 500)
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [orderId, mesero, mesa])

  const handleModifierCancel = useCallback(() => {
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [])

  // Cancel item (requires reason + manager PIN — NEVER delete)
  const handleCancelItem = useCallback((reason: string, managerName: string) => {
    if (!cancellingItem) return
    logAudit({
      order_id: orderId, action: 'item_cancelled', actor: mesero, mesa,
      details: { item: cancellingItem.nombre, cantidad: cancellingItem.cantidad, precio: cancellingItem.subtotal },
      reason,
      approved_by: managerName,
    })
    setCancelledItems(prev => new Set(prev).add(cancellingItem.id))
    setCancellingItem(null)
    showToast(`${cancellingItem.nombre} cancelado — aprobado por ${managerName}`)
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
    setDiscount(0)
    setOrderNotes('')
    setShowVoidOrder(false)
    showToast(`Orden anulada — aprobado por ${managerName}`)
  }, [orderId, mesero, mesa, orderItems, loadedOrderId])

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

  const activeItems = orderItems.filter(i => !cancelledItems.has(i.id))
  const subtotal = activeItems.reduce((sum, item) => sum + item.subtotal, 0)
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
    const ok = await saveOrder(order)
    if (ok) {
      logAudit({
        order_id: orderId, action: 'order_sent_kitchen', actor: mesero, mesa,
        details: { items_count: activeItems.length, total },
      })

      // Auto-deduct ingredients from inventory
      const result = await deductIngredientsForOrder(activeItems, orderId, mesero)
      if (result.deductions.length > 0) {
        logAudit({
          order_id: orderId, action: 'order_sent_kitchen', actor: 'Sistema',
          details: { inventory_deductions: result.deductions.length, alerts: result.alerts.length },
        })
      }
      if (result.alerts.length > 0) {
        showToast(`Orden enviada — ${result.alerts.length} alertas de inventario`)
      } else {
        showToast('Orden enviada a cocina')
      }
      // Print per-station tickets (splits order by cocina/barra/caja)
      printByStation(order)

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
      // Parejo: equal split — each person pays total / N
      const fullSubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
      const fullDiscount = discount
      const fullAfterDisc = Math.max(0, fullSubtotal - fullDiscount)
      const fullTotal = fullAfterDisc + fullAfterDisc * IVA_RATE
      paySubtotal = fullSubtotal / splitParejoN
      payDiscount = fullDiscount / splitParejoN
      payTotal = fullTotal / splitParejoN
    } else if (splitPayingCuenta > 0) {
      payingItems = activeItems.filter(i => (splitAssignments[i.id] || 1) === splitPayingCuenta)
      paySubtotal = payingItems.reduce((s, i) => s + i.subtotal, 0)
      payDiscount = 0
      const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
      payTotal = paySubtotalAfterDiscount + paySubtotalAfterDiscount * IVA_RATE
    } else {
      paySubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
      payDiscount = discount
      const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
      payTotal = paySubtotalAfterDiscount + paySubtotalAfterDiscount * IVA_RATE
    }
    const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
    const payIva = paySubtotalAfterDiscount * IVA_RATE
    const payId = splitPayingCuenta > 0 ? `${orderId}-C${splitPayingCuenta}` : orderId

    const order: Order = {
      id: payId,
      mesa,
      mesero,
      personas: splitPayingCuenta > 0 ? Math.ceil(personas / (splitMode === 'parejo' ? splitParejoN : splitCount)) : personas,
      status: 'cerrada',
      items: payingItems,
      subtotal: paySubtotal,
      iva: payIva,
      total: payTotal,
      descuento: payDiscount,
      propina: splitPayingCuenta === 0 || splitPayingCuenta === (splitMode === 'parejo' ? splitParejoN : splitCount) ? (propina > 0 ? propina : undefined) : undefined,
      metodoPago: method,
      notas: splitPayingCuenta > 0
        ? `Cuenta ${splitPayingCuenta} de ${splitMode === 'parejo' ? splitParejoN : splitCount} (${splitMode === 'parejo' ? 'parejo' : 'split'})`
        : method === 'Mixto'
          ? `Mixto: Efectivo ${formatMXN(parseFloat(mixtoEfectivo) || 0)} + Tarjeta ${formatMXN(payTotal - (parseFloat(mixtoEfectivo) || 0))}${orderNotes ? ' | ' + orderNotes : ''}`
          : (orderNotes || undefined),
      createdAt: new Date(),
      closedAt: new Date(),
    }
    const ok = await saveOrder(order)
    if (ok) {
      // Open cash drawer for cash payments
      if (method === 'Efectivo' || method === 'Mixto') {
        openCashDrawer()
      }

      logAudit({
        order_id: payId, action: 'payment_processed', actor: mesero, mesa,
        details: { method, total: payTotal, cuenta: splitPayingCuenta || 'full', propina, cashReceived: method === 'Efectivo' ? cashAmount : undefined },
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
    setSplitPayingCuenta(0)
    setSplitAssignments({})
    setSplitCount(0)
    setSplitMode(null)
    setSplitParejoN(0)
  }

  const handleApplyDiscount = (amount: number, reason?: string) => {
    logAudit({
      order_id: orderId, action: 'discount_applied', actor: mesero, mesa,
      details: { amount, subtotal, reason: reason || 'Sin motivo' },
    })
    setDiscount(amount)
    setShowDiscount(false)
  }

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden" style={{'--bg':'#000000','--surface':'#0a0a0c','--surface-2':'#0f1014','--panel':'#0b0b0e','--line':'#1c1d22','--line-soft':'#141519','--text-1':'#f5f5f7','--text-2':'#c4c4cc','--text-3':'#87878f','--text-4':'#555560','--accent':'#10b981','--accent-bright':'#34d399','--accent-deep':'#059669','--accent-soft':'rgba(16,185,129,0.12)','--accent-line':'rgba(16,185,129,0.28)',background:'#0a0a0f',color:'#fff',colorScheme:'dark'} as React.CSSProperties}>
      {/* Top Bar */}
      <header className="flex flex-col bg-[var(--surface-2)] border-b border-[var(--line)] flex-shrink-0">
        {/* Row 1: Logo + Hamburger + Ready badge + Staff + Clock */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNav(!showNav)} className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] active:bg-[var(--surface-2)]0 flex items-center justify-center transition-colors">
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
            {hasBluetooth && (
              <button
                onClick={handleConnectPrinter}
                disabled={btConnecting}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                  btPrinter ? 'bg-blue-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]'
                }`}
              >
                <Bluetooth size={12} />
                {btConnecting ? '...' : btPrinter ? btPrinter.slice(0, 8) : 'Printer'}
              </button>
            )}
            <button
              onClick={() => {
                const cfg = getMPConfig()
                if (cfg) { setMpAccessToken(cfg.accessToken); setMpDeviceId(cfg.deviceId) }
                setShowMPConfig(true)
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                mpConfig ? 'bg-cyan-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)] hover:bg-[var(--line)]'
              }`}
              title="Mercado Pago Point"
            >
              <Smartphone size={12} />
              {mpConfig ? 'Point' : 'MP'}
            </button>
            {staffName && <span className="text-xs text-emerald-400">{staffName}</span>}
            <div className="flex items-center gap-1">
              <Clock size={14} />
              <span className="text-xs font-mono">{clock}</span>
            </div>
          </div>
        </div>
        {/* Row 2: Selectors (compact for tablet) */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--line)]/50 overflow-x-auto">
          <div className="flex items-center gap-1 bg-[var(--line)] rounded-lg px-2 py-1 border border-slate-600 min-h-[40px]">
            <span className="text-white text-sm font-medium">Mesa</span>
            <input
              type="number"
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
              className="w-12 bg-transparent text-white text-sm font-bold text-center border-none outline-none"
            />
          </div>
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-[var(--line)] text-white rounded-lg px-3 py-2 text-sm font-medium border border-slate-600 min-h-[40px]">
            {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}p</option>))}
          </select>
          <select value={mesero} onChange={(e) => { setMesero(e.target.value); try { localStorage.setItem('pos_mesero', e.target.value) } catch {} }} className="bg-[var(--line)] text-white rounded-lg px-3 py-2 text-sm font-medium border border-slate-600 min-h-[40px] flex-1 min-w-0">
            {MESEROS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>
        {/* Row 3: Mobile tab toggle (only visible on mobile) */}
        <div className="flex md:hidden border-t border-[var(--line)]/50">
          <button
            onClick={() => setMobileView('menu')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${mobileView === 'menu' ? 'bg-emerald-600 text-white' : 'text-[var(--text-3)]'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setMobileView('order')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors relative ${mobileView === 'order' ? 'bg-blue-600 text-white' : 'text-[var(--text-3)]'}`}
          >
            Orden {activeItems.length > 0 && <span className="ml-1 bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeItems.length}</span>}
          </button>
        </div>
      </header>

      {/* Main Content */}
      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-64 bg-[var(--surface-2)] border-r border-[var(--line)] p-4 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-[var(--text-2)] text-xs font-semibold uppercase mb-3">Navegacion</p>
            <div className="space-y-1">
              {[
                { href: '/pos/mesas', icon: Grid3X3, label: 'Mesas', section: 'mesas' },
                { href: '/pos/cocina', icon: ChefHat, label: 'Cocina', section: 'cocina' },
                { href: '/pos/kds', icon: Monitor, label: 'KDS Tablet', section: 'kds' },
                { href: '/pos/barra', icon: Wine, label: 'Barra', section: 'barra' },
                { href: '/pos/recetas', icon: BookOpen, label: 'Recetas', section: 'recetas' },
                { href: '/pos/compras', icon: ShoppingCart, label: 'Compras', section: 'compras' },
                { href: '/pos/inventario', icon: Package, label: 'Inventario', section: 'inventario' },
                { href: '/pos/auditoría', icon: FileText, label: 'Auditoria', section: 'auditoría' },
                { href: '/pos/corte', icon: Receipt, label: 'Corte de caja', section: 'corte' },
                { href: '/pos/qr', icon: QrCode, label: 'QR Mesas', section: 'qr' },
                { href: '/pos/turno', icon: Clock, label: 'Turno', section: 'turno' },
                { href: '/pos/facturacion', icon: Stamp, label: 'Facturacion', section: 'facturacion' },
                { href: '/pos/historial', icon: FileText, label: 'Historial', section: 'historial' },
              ].filter(item => canSee(item.section)).map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowNav(false)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-[var(--text-4)] hover:bg-[var(--line)] hover:text-white active:bg-emerald-500/10 transition-colors min-h-[48px]"
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
          <div className="px-3 py-1.5 border-b border-[var(--line)] bg-[var(--surface-2)]/50 flex-shrink-0">
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
          <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
            {orderItems.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-[var(--text-2)]">
                <p className="text-sm">Toca un producto para agregar</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {orderItems.map((item) => {
                  const isCancelled = cancelledItems.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 py-2 px-2 rounded-lg transition-all ${
                        isCancelled
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
                          disabled={isCancelled}
                          className="w-9 h-9 rounded-md bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-6 text-center font-semibold text-base">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                          disabled={isCancelled}
                          className="w-9 h-9 rounded-md bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* Item name + modifiers */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm leading-tight ${isCancelled ? 'line-through text-red-400' : ''}`}>
                          {item.nombre}
                        </p>
                        {isCancelled && (
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

                      {/* Line total */}
                      <span className={`font-semibold text-sm w-20 text-right flex-shrink-0 ${isCancelled ? 'line-through text-red-400/60' : ''}`}>
                        {formatMXN(item.subtotal)}
                      </span>

                      {!isCancelled && (
                        <>
                          {/* Edit */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditOrderItem(item) }}
                            className="w-8 h-8 rounded-md bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
                          >
                            <Pencil size={12} />
                          </button>

                          {/* Cancel (NOT delete — requires reason + manager PIN) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-8 h-8 rounded-md bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
                            title="Cancelar item (requiere gerente)"
                          >
                            <Ban size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* AI Copilot + Customer Memory — below items, scrollable */}
            {orderItems.length > 0 && (
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
          <div className="border-t border-[var(--line)] px-3 py-2 bg-[var(--surface-2)]/50 flex-shrink-0">
            {/* Inline tools row: discount, notes, void */}
            <div className="flex items-center gap-1.5 mb-1.5">
              <button
                onClick={() => setShowDiscount(true)}
                disabled={orderItems.length === 0}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[var(--line)] hover:bg-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-4)] text-xs transition-colors"
                title="Aplicar descuento"
              >
                <Percent size={12} />
                {discount > 0 ? `-${formatMXN(discount)}` : 'Desc'}
              </button>
              {discount > 0 && (
                <button
                  onClick={() => {
                    logAudit({ order_id: orderId, action: 'discount_removed', actor: mesero, mesa, details: { amount: discount } })
                    setDiscount(0)
                  }}
                  className="px-1.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 text-xs transition-colors"
                >
                  <X size={12} />
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
                  className="flex-1 min-w-0 bg-[var(--line)]/60 border border-slate-600/50 rounded-md px-2 py-1 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <button
                onClick={() => { openCashDrawer(); showToast('Cajón abierto') }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-700/50 hover:bg-slate-700 text-[var(--text-3)] text-xs transition-colors"
                title="Abrir cajón"
              >
                <Banknote size={12} />
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
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-700/50 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-3)] text-xs transition-colors"
                title="Reimprimir ticket"
              >
                <Printer size={12} />
              </button>
              <button
                onClick={() => setShowVoidOrder(true)}
                disabled={orderItems.length === 0}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 text-xs transition-colors"
                title="Anular orden"
              >
                <ShieldAlert size={12} />
              </button>
            </div>

            {/* Totals — compact */}
            <div className="flex items-center justify-between text-xs text-[var(--text-3)] mb-0.5">
              <span>Sub {formatMXN(subtotal)}</span>
              {discount > 0 && <span className="text-red-400">-{formatMXN(discount)}</span>}
              <span>IVA {formatMXN(iva)}</span>
              <span className="text-white text-base font-bold">{formatMXN(total)}</span>
            </div>
          </div>

          {/* Action buttons — compact for tablets */}
          <div className="px-3 py-2 border-t border-[var(--line)] flex gap-2 flex-shrink-0">
            <button
              onClick={handleSendToKitchen}
              disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-3 rounded-xl text-sm transition-all min-h-[52px]"
            >
              <Send size={18} />
              {saving ? '...' : sentToKitchen ? 'Enviado' : 'Cocina'}
            </button>
            <button
              onClick={handlePreTicket}
              disabled={activeItems.length === 0 || saving}
              className="flex-[0.6] flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-3 rounded-xl text-sm transition-all min-h-[52px]"
            >
              <Receipt size={16} />
              Cuenta
            </button>
            <button
              onClick={() => { if (activeItems.length >= 2) { setSplitMode(null); setSplitCount(0); setSplitParejoN(0); setSplitAssignments({}); setShowSplit(true) } else handleCloseOrder() }}
              disabled={activeItems.length === 0 || saving}
              className="flex-[0.4] flex items-center justify-center bg-purple-600 hover:bg-purple-500 active:bg-purple-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-3 rounded-xl text-sm transition-all min-h-[52px]"
            >
              Split
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-3 rounded-xl text-sm transition-all min-h-[52px]"
            >
              <CreditCard size={18} />
              Cobrar
            </button>
          </div>
        </div>

        {/* Right Panel -- Menu (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`} style={{background:'#0d0d12'}}>
          {/* Search bar — touch target + barcode scanner */}
          <div className="px-3 pt-2 pb-1.5 flex-shrink-0 flex gap-2">
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

          {menuSearch.trim() ? (
            /* Search results across all categories */
            <div className="flex-1 overflow-y-auto p-3">
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
              <div className="flex-1 overflow-y-auto bg-[var(--surface-2)]/50">
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 p-4">
                  {menuCategories.filter(cat => cat.items.some(i => i.price > 0))
                    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                    .map((cat) => {
                      const catColor = (cat as { color?: string }).color || 'bg-slate-600'
                      const itemCount = cat.items.filter(i => i.price > 0).length
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-4 py-4 rounded-xl text-sm font-bold text-center transition-all min-h-[72px] leading-tight flex flex-col items-center justify-center gap-1 ${catColor} opacity-60 text-white hover:opacity-90 active:scale-95`}
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
                      <button onClick={() => setSelectedCategory('')} className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center text-white text-xl font-bold hover:bg-white/30 active:scale-95">&times;</button>
                    </div>
                    <div className="overflow-y-auto p-4 max-h-[65vh]">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <button onClick={() => { setShowSplit(false); setSplitMode(null); setSplitCount(0); setSplitParejoN(0) }} className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center">
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
                className="w-9 h-9 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
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
                className="w-9 h-9 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
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

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[var(--surface-2)] rounded-2xl p-6 w-full max-w-md border border-[var(--line)]">
            {(() => {
              // Calculate total for current split cuenta or full order
              const totalCuentas = splitMode === 'parejo' ? splitParejoN : splitCount
              let payingItems = activeItems
              let paySubtotal: number
              let payDiscountLocal: number
              let payTotal: number

              if (splitMode === 'parejo' && splitPayingCuenta > 0) {
                const fullSubtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
                const fullAfterDisc = Math.max(0, fullSubtotal - discount)
                const fullTotal = fullAfterDisc + fullAfterDisc * IVA_RATE
                paySubtotal = fullSubtotal / splitParejoN
                payDiscountLocal = discount / splitParejoN
                payTotal = fullTotal / splitParejoN
              } else if (splitPayingCuenta > 0) {
                payingItems = activeItems.filter(i => (splitAssignments[i.id] || 1) === splitPayingCuenta)
                paySubtotal = payingItems.reduce((s, i) => s + i.subtotal, 0)
                payDiscountLocal = 0
                const sub = Math.max(0, paySubtotal - payDiscountLocal)
                payTotal = sub + sub * IVA_RATE
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
                onClick={() => { setShowPayment(false); setSplitPayingCuenta(0); setSplitCount(0); setSplitMode(null); setSplitParejoN(0) }}
                className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
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
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
                  className="w-20 bg-[var(--line)] border border-slate-600 rounded-lg px-2 py-2.5 text-white text-sm text-center focus:outline-none focus:border-emerald-500"
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
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${cashAmount === String(bill) ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-3)]'}`}
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
                      const res = await fetch('/api/mp-point', {
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
                            const statusRes = await fetch('/api/mp-point', {
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
                    // No MP terminal configured — manual
                    handlePayment('Tarjeta de credito')
                  }
                }}
                disabled={saving}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <CreditCard size={24} />
                {saving ? 'Esperando terminal...' : 'Tarjeta'}
              </button>
              <button
                onClick={() => handlePayment('Transferencia electronica')}
                className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <Send size={22} />
                Transferencia
              </button>
              <button
                onClick={() => { setShowMixto(!showMixto); setMixtoEfectivo('') }}
                className={`w-full flex items-center justify-center gap-3 ${showMixto ? 'bg-amber-600 hover:bg-amber-500' : 'bg-[var(--line)] hover:bg-[var(--line-soft)]'} text-${showMixto ? 'white' : '[var(--text-2)]'} font-semibold py-3 rounded-xl text-base transition-colors min-h-[48px]`}
              >
                Mixto (efectivo + tarjeta)
              </button>
              {showMixto && (
                <div className="bg-[var(--line)] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-[var(--text-2)]">Efectivo:</label>
                    <div className="flex items-center gap-2">
                      <span className="text-white">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={mixtoEfectivo}
                        onChange={(e) => setMixtoEfectivo(e.target.value)}
                        placeholder="0.00"
                        className="w-28 bg-[var(--bg)] border border-slate-600 rounded-lg px-3 py-2 text-white text-sm text-right focus:outline-none focus:border-amber-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-[var(--text-2)]">Tarjeta:</label>
                    <span className="text-white text-sm font-medium">
                      {formatMXN(Math.max(0, total - (parseFloat(mixtoEfectivo) || 0)))}
                    </span>
                  </div>
                  {(parseFloat(mixtoEfectivo) || 0) > total && (
                    <p className="text-red-400 text-xs text-center">El efectivo excede el total</p>
                  )}
                  <button
                    onClick={() => handlePayment('Mixto')}
                    disabled={(parseFloat(mixtoEfectivo) || 0) <= 0 || (parseFloat(mixtoEfectivo) || 0) > total}
                    className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl text-base transition-colors"
                  >
                    Confirmar pago mixto
                  </button>
                </div>
              )}
            </div>
              </>)
            })()}
          </div>
        </div>
      )}

      {/* Smart Alerts (replaces chat) */}
      <POSAlerts role={staffRole} />
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

        // Check low inventory (gerente/admin only)
        if (role === 'admin' || role === 'gerente') {
          try {
            const invRes = await fetch(
              `${sbUrl}/rest/v1/pos_inventory?stock=lt.5&stock=gt.0&client_id=eq.${_cid()}&limit=5`,
              { headers }
            )
            if (invRes.ok) {
              const lowStock = await invRes.json()
              for (const item of lowStock) {
                newAlerts.push({
                  id: `inv-${item.ingredient_id}`,
                  type: 'warning',
                  message: `⚠️ ${item.ingredient_id} — quedan ${item.stock} unidades`,
                  dismissible: true,
                })
              }
            }
          } catch { /* ignore */ }

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
              const platform: Record<string, string> = { ubereats: '🟢 Uber', rappi: '🟠 Rappi', didi: '🔶 Didi' }
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
            <button onClick={() => setDismissed(prev => new Set(prev).add(alert.id))} className="ml-3 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
