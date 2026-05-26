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
  printTicketCSS,
  printTicketBluetooth,
  printKitchenTicketCSS,
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
} from 'lucide-react'
import dynamic from 'next/dynamic'

const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })
const POSCopilot = dynamic(() => import('@/components/POSCopilot'), { ssr: false })
const OfflineIndicator = dynamic(() => import('@/components/pos/OfflineIndicator'), { ssr: false })
const InventoryAlerts = dynamic(() => import('@/components/pos/InventoryAlerts'), { ssr: false })

export default function POSPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center text-white bg-[var(--surface)]">
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
                      ? 'bg-red-500/100 border-red-500'
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
                      ? 'bg-emerald-500/100 border-emerald-500'
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

          {/* Notas */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Notas</h4>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Instrucciones especiales..."
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
            className="flex-[2] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500/100 text-white font-semibold transition-colors min-h-[48px]"
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
  onApply: (discount: number) => void
  onCancel: () => void
}

function DiscountModal({ subtotal, onApply, onCancel }: DiscountModalProps) {
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent')
  const [value, setValue] = useState('')

  const discountAmount = mode === 'percent'
    ? subtotal * (Math.min(100, Math.max(0, Number(value) || 0)) / 100)
    : Math.min(subtotal, Math.max(0, Number(value) || 0))

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
            className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors min-h-[44px] ${
              mode === 'percent' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            <Percent size={16} className="inline mr-1 -mt-0.5" /> Porcentaje
          </button>
          <button
            onClick={() => setMode('fixed')}
            className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors min-h-[44px] ${
              mode === 'fixed' ? 'bg-emerald-600 text-white' : 'bg-[var(--line)] text-[var(--text-4)]'
            }`}
          >
            $ Monto fijo
          </button>
        </div>

        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'percent' ? 'Ej. 10' : 'Ej. 50'}
          className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-lg text-center focus:outline-none focus:border-emerald-500 min-h-[48px] mb-3"
          autoFocus
        />

        {discountAmount > 0 && (
          <p className="text-center text-[var(--text-3)] text-sm mb-4">
            Descuento: <span className="text-red-400 font-semibold">-{formatMXN(discountAmount)}</span>
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold transition-colors min-h-[48px]">
            Cancelar
          </button>
          <button
            onClick={() => onApply(discountAmount)}
            disabled={discountAmount <= 0}
            className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500/100 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-semibold transition-colors min-h-[48px]"
          >
            Aplicar -{formatMXN(discountAmount)}
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
            className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-500/100 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
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
            className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-500/100 text-white font-semibold transition-colors min-h-[48px] flex items-center justify-center gap-2"
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
  const [selectedCategory, setSelectedCategory] = useState<string>(
    MENU_CATEGORIES[0].id
  )
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
        const invRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pos_inventory?select=ingredient_id,stock&client_id=eq.amalay&stock=lte.0`, {
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

  // Menu search
  const [menuSearch, setMenuSearch] = useState('')
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)

  // Discount state
  const [showDiscount, setShowDiscount] = useState(false)
  const [discount, setDiscount] = useState(0)

  // Split de cuenta
  const [showSplit, setShowSplit] = useState(false)
  const [splitAssignments, setSplitAssignments] = useState<Record<string, number>>({}) // itemId → cuenta (1 or 2)
  const [splitPayingCuenta, setSplitPayingCuenta] = useState<0 | 1 | 2>(0) // 0 = no split, 1 = paying cuenta 1, 2 = paying cuenta 2

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

  // Role permissions
  const canSee = (section: string) => {
    const perms: Record<string, string[]> = {
      mesero: ['mesas', 'cocina', 'barra'],
      cajero: ['mesas', 'cocina', 'barra', 'corte'],
      cocina: ['cocina'],
      barra: ['barra'],
      gerente: ['mesas', 'cocina', 'kds', 'barra', 'recetas', 'compras', 'inventario', 'auditoria', 'corte', 'qr', 'turno', 'historial', 'facturacion'],
      admin: ['mesas', 'cocina', 'kds', 'barra', 'recetas', 'compras', 'inventario', 'auditoria', 'corte', 'qr', 'turno', 'historial', 'facturacion'],
    }
    return (perms[staffRole] || perms.admin).includes(section)
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
      // Print kitchen ticket
      printKitchenTicketCSS(order)

      setSentToKitchen(true)
      setTimeout(() => setSentToKitchen(false), 2000)
    } else {
      showToast('Error al guardar orden')
    }
    setSaving(false)
  }

  const handleCloseOrder = () => {
    if (orderItems.length === 0) return
    setShowPayment(true)
  }

  const handlePayment = async (method: string) => {
    setSaving(true)

    // Determine which items to pay based on split state
    const payingItems = splitPayingCuenta === 1
      ? activeItems.filter(i => (splitAssignments[i.id] || 1) === 1)
      : splitPayingCuenta === 2
        ? activeItems.filter(i => splitAssignments[i.id] === 2)
        : activeItems
    const paySubtotal = payingItems.reduce((s, i) => s + i.subtotal, 0)
    const payDiscount = splitPayingCuenta === 0 ? discount : 0
    const paySubtotalAfterDiscount = Math.max(0, paySubtotal - payDiscount)
    const payIva = paySubtotalAfterDiscount * IVA_RATE
    const payTotal = paySubtotalAfterDiscount + payIva
    const payId = splitPayingCuenta > 0 ? `${orderId}-C${splitPayingCuenta}` : orderId

    const order: Order = {
      id: payId,
      mesa,
      mesero,
      personas: splitPayingCuenta > 0 ? Math.ceil(personas / 2) : personas,
      status: 'cerrada',
      items: payingItems,
      subtotal: paySubtotal,
      iva: payIva,
      total: payTotal,
      descuento: payDiscount,
      propina: splitPayingCuenta === 0 || splitPayingCuenta === 2 ? (propina > 0 ? propina : undefined) : undefined,
      metodoPago: method,
      notas: splitPayingCuenta > 0 ? `Cuenta ${splitPayingCuenta} de split` : (orderNotes || undefined),
      createdAt: new Date(),
      closedAt: new Date(),
    }
    const ok = await saveOrder(order)
    if (ok) {
      logAudit({
        order_id: payId, action: 'payment_processed', actor: mesero, mesa,
        details: { method, total: payTotal, cuenta: splitPayingCuenta || 'full', propina },
      })

      // If split and just paid Cuenta 1, move to Cuenta 2
      if (splitPayingCuenta === 1) {
        showToast(`Cuenta 1 cobrada (${method}) — ahora cobra Cuenta 2`)
        setSplitPayingCuenta(2)
        setPropina(0)
        setSaving(false)
        return // Don't reset order yet
      }

      // Fully done (no split, or Cuenta 2 paid)
      showToast(`Cuenta cerrada - ${method}${propina > 0 ? ` + propina ${formatMXN(propina)}` : ''}`)
      // Auto-print ticket
      handlePrintTicket(order)
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
    setSplitPayingCuenta(0)
    setSplitAssignments({})
  }

  const handleApplyDiscount = (amount: number) => {
    logAudit({
      order_id: orderId, action: 'discount_applied', actor: mesero, mesa,
      details: { amount, subtotal },
    })
    setDiscount(amount)
    setShowDiscount(false)
  }

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden">
      {/* Top Bar */}
      <header className="flex flex-col bg-[var(--surface-2)] border-b border-[var(--line)] flex-shrink-0">
        {/* Row 1: Logo + Hamburger + Ready badge + Staff + Clock */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowNav(!showNav)} className="w-12 h-12 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] active:bg-[var(--surface-2)]0 flex items-center justify-center transition-colors">
              {showNav ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span className="text-white font-black text-lg tracking-tight">
              fullsite
              <span className="inline-block w-1.5 h-1.5 bg-emerald-500/100 ml-0.5 mb-0.5" />
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
            {staffName && <span className="text-xs text-emerald-400">{staffName}</span>}
            <div className="flex items-center gap-1">
              <Clock size={14} />
              <span className="text-xs font-mono">{clock}</span>
            </div>
          </div>
        </div>
        {/* Row 2: Selectors (compact on mobile) */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--line)]/50 overflow-x-auto">
          <select value={mesa} onChange={(e) => {
            const newMesa = Number(e.target.value)
            if (orderItems.length > 0 && newMesa !== mesa) {
              logAudit({ order_id: orderId, action: 'status_changed', actor: mesero, mesa, details: { type: 'mesa_moved', from: mesa, to: newMesa } })
              showToast(`Mesa ${mesa} → Mesa ${newMesa}`)
            }
            setMesa(newMesa)
          }} className="bg-[var(--line)] text-white rounded-xl px-4 py-3 text-base font-medium border border-slate-600 min-h-[48px]">
            {Array.from({ length: 16 }, (_, i) => (<option key={i + 1} value={i + 1}>Mesa {i + 1}</option>))}
          </select>
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-[var(--line)] text-white rounded-xl px-4 py-3 text-base font-medium border border-slate-600 min-h-[48px]">
            {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1} pers</option>))}
          </select>
          <select value={mesero} onChange={(e) => setMesero(e.target.value)} className="bg-[var(--line)] text-white rounded-xl px-4 py-3 text-base font-medium border border-slate-600 min-h-[48px] flex-1 min-w-0">
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
            Orden {activeItems.length > 0 && <span className="ml-1 bg-emerald-500/100 text-white text-xs rounded-full px-1.5 py-0.5">{activeItems.length}</span>}
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
                { href: '/pos/auditoria', icon: FileText, label: 'Auditoria', section: 'auditoria' },
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
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel -- Current Order (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[45%] md:flex flex-col border-r border-[var(--line)] bg-[var(--surface)] ${mobileView === 'order' ? 'flex w-full' : 'hidden'}`}>
          {/* Order header */}
          {/* Order header — Wansoft style */}
          <div className="px-3 py-2 border-b border-[var(--line)] bg-[var(--surface-2)]/50">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold">
                Mesa {mesa}
                <span className="text-[var(--text-3)] font-normal text-sm ml-2">{personas} pers · {mesero}</span>
              </h2>
              <span className="text-emerald-400 font-bold text-xl">{formatMXN(total)}</span>
            </div>
            {/* Silla selector removed — not functional yet */}
          </div>

          {/* Order items list */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {/* AI Copilot */}
            <POSCopilot
              orderItems={orderItems.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, subtotal: i.subtotal }))}
              mesa={mesa}
              personas={personas}
              mesero={mesero}
            />
            {orderItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--text-2)]">
                <p className="text-lg">Toca un producto para agregar</p>
              </div>
            ) : (
              <div className="space-y-1">
                {orderItems.map((item) => {
                  const isCancelled = cancelledItems.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 py-3 px-3 rounded-lg transition-all ${
                        isCancelled
                          ? 'bg-red-500/10 border border-red-500/20 opacity-60'
                          : flashItemId === item.id
                          ? 'ring-2 ring-emerald-500 bg-emerald-500/10'
                          : 'bg-[var(--surface-2)]/60 hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      {/* Quantity controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1) }}
                          disabled={isCancelled}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center font-semibold text-lg">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                          disabled={isCancelled}
                          className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Item name + modifiers */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-[15px] ${isCancelled ? 'line-through text-red-400' : ''}`}>
                          {item.nombre}
                        </p>
                        {isCancelled && (
                          <p className="text-red-500 text-xs font-semibold">CANCELADO</p>
                        )}
                        {item.modificadores.length > 0 && (
                          <p className="text-[var(--text-3)] text-xs mt-0.5 truncate">
                            {item.modificadores.join(' · ')}
                          </p>
                        )}
                        {item.notas && (
                          <p className="text-[var(--text-2)] text-xs italic mt-0.5 truncate">
                            {item.notas}
                          </p>
                        )}
                        <p className="text-[var(--text-3)] text-sm">
                          {formatMXN(item.precio + item.precioExtra)} c/u
                        </p>
                      </div>

                      {/* Line total */}
                      <span className={`font-semibold text-lg w-24 text-right flex-shrink-0 ${isCancelled ? 'line-through text-red-400/60' : ''}`}>
                        {formatMXN(item.subtotal)}
                      </span>

                      {!isCancelled && (
                        <>
                          {/* Edit */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditOrderItem(item) }}
                            className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
                          >
                            <Pencil size={14} />
                          </button>

                          {/* Cancel (NOT delete — requires reason + manager PIN) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
                            title="Cancelar item (requiere gerente)"
                          >
                            <Ban size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Discount + Order notes + Totals */}
          <div className="border-t border-[var(--line)] px-4 py-3 bg-[var(--surface-2)]/50">
            {/* Discount button */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setShowDiscount(true)}
                disabled={orderItems.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-4)] text-sm transition-colors min-h-[40px]"
              >
                <Percent size={14} />
                {discount > 0 ? `Descuento: -${formatMXN(discount)}` : 'Aplicar descuento'}
              </button>
              {discount > 0 && (
                <button
                  onClick={() => {
                    logAudit({ order_id: orderId, action: 'discount_removed', actor: mesero, mesa, details: { amount: discount } })
                    setDiscount(0)
                  }}
                  className="px-2 py-2 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 text-sm transition-colors min-h-[40px]"
                >
                  <X size={14} />
                </button>
              )}
              <button
                onClick={() => setShowVoidOrder(true)}
                disabled={orderItems.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 text-sm transition-colors min-h-[40px] ml-auto"
              >
                <ShieldAlert size={14} />
                Anular orden
              </button>
            </div>

            {/* Order notes */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <StickyNote size={14} className="text-[var(--text-3)]" />
                <span className="text-xs text-[var(--text-3)] font-medium">Nota de la orden</span>
              </div>
              <input
                type="text"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Nota de la orden..."
                className="w-full bg-[var(--line)]/60 border border-slate-600/50 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex justify-between text-[var(--text-3)] text-sm mb-1">
              <span>Subtotal</span>
              <span>{formatMXN(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-red-400 text-sm mb-1">
                <span>Descuento</span>
                <span>-{formatMXN(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[var(--text-3)] text-sm mb-2">
              <span>IVA (16%)</span>
              <span>{formatMXN(iva)}</span>
            </div>
            <div className="flex justify-between text-white text-2xl font-bold">
              <span>Total</span>
              <span>{formatMXN(total)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 border-t border-[var(--line)] flex gap-3">
            <button
              onClick={handleSendToKitchen}
              disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500/100 active:bg-emerald-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-black py-6 rounded-2xl text-xl transition-all min-h-[72px]"
            >
              <Send size={22} />
              {saving ? 'Guardando...' : sentToKitchen ? 'Enviado!' : 'Cocina'}
            </button>
            <button
              onClick={() => { if (activeItems.length >= 2) setShowSplit(true); else handleCloseOrder() }}
              disabled={activeItems.length === 0 || saving}
              className="flex-[0.4] flex items-center justify-center bg-purple-600 hover:bg-purple-500/100 active:bg-purple-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-6 rounded-2xl text-base transition-all min-h-[72px]"
            >
              Split
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500/100 active:bg-blue-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-black py-6 rounded-2xl text-xl transition-all min-h-[72px]"
            >
              <CreditCard size={22} />
              Cobrar
            </button>
          </div>
        </div>

        {/* Right Panel -- Menu (50% on tablet, full on mobile when active) */}
        <div className={`md:w-[50%] lg:w-[55%] md:flex flex-col bg-slate-850 ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`}>
          {/* Search bar — big touch target + barcode scanner */}
          <div className="px-3 pt-3 pb-2 flex-shrink-0 flex gap-2">
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="flex-1 bg-[var(--line)] border border-slate-600 rounded-xl px-5 py-3.5 text-white placeholder-slate-400 text-base focus:outline-none focus:border-emerald-500 min-h-[50px]"
            />
            <button
              onClick={() => setShowBarcodeScanner(true)}
              className="w-[50px] h-[50px] bg-amber-600 hover:bg-amber-500/100 active:bg-amber-700 rounded-xl flex items-center justify-center text-white flex-shrink-0 transition-colors"
              title="Escanear código de barras"
            >
              <ScanBarcode size={22} />
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
                          className="w-full bg-[var(--surface-2)] hover:bg-[var(--line)] active:bg-emerald-500/10 border border-[var(--line)] rounded-lg text-left transition-colors flex items-center min-h-[48px] overflow-hidden"
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
              {/* Category tabs — big touch targets */}
              <div className="flex gap-2 px-3 py-2.5 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface-2)]/50 flex-shrink-0">
                {menuCategories.filter(cat => cat.items.some(i => i.price > 0)).map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all min-h-[44px] ${
                      selectedCategory === cat.id
                        ? `${(cat as { color?: string }).color || 'bg-emerald-600'} text-white shadow-lg`
                        : 'bg-[var(--line)] text-[var(--text-4)] hover:bg-[var(--line)] active:bg-[var(--surface-2)]0'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Menu items grid — BIG touch cards for tablet */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {activeCategory.items.filter(item => item.price > 0).map((item) => {
                    const isOOS = outOfStockItems.has(item.id)
                    return (
                    <button
                      key={item.id}
                      onClick={() => { if (isOOS) { showToast(`${item.name} — AGOTADO`); return } handleMenuItemTap(item, activeCategory.id); setMobileView('order') }}
                      className={`bg-[var(--surface)] hover:bg-[var(--surface-2)] active:scale-[0.97] border rounded-2xl text-left transition-all flex min-h-[90px] overflow-hidden relative shadow-sm ${
                        isOOS
                          ? 'border-red-500/30 opacity-50 cursor-not-allowed'
                          : (item as MenuItem & { promo?: boolean }).promo
                          ? 'border-[var(--accent)]/40 ring-1 ring-[var(--accent)]/20'
                          : 'border-[var(--line)] hover:border-[var(--accent)]/30'
                      }`}
                    >
                      <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-red-500' : activeCategory.color || 'bg-emerald-600'}`} />
                      {isOOS && (
                        <span className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                          Agotado
                        </span>
                      )}
                      {!isOOS && (item as MenuItem & { promo?: boolean }).promo && (
                        <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                          Promo
                        </span>
                      )}
                      <div className="flex flex-col justify-between px-4 py-5 flex-1">
                        <span className={`font-bold text-base leading-snug ${isOOS ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-1)]'}`}>
                          {item.name}
                        </span>
                        <span className={`font-bold text-lg mt-2 ${isOOS ? 'text-red-400' : 'text-[var(--accent)]'}`}>
                          ${Math.round(item.price)}
                        </span>
                      </div>
                    </button>
                    )
                  })}
                </div>
              </div>
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
              <h3 className="text-xl font-bold">Split de cuenta — Mesa {mesa}</h3>
              <button onClick={() => setShowSplit(false)} className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center">
                <X size={20} />
              </button>
            </div>
            <p className="text-[var(--text-3)] text-sm mb-4">Toca cada item para asignarlo a Cuenta 1 o Cuenta 2</p>

            <div className="space-y-2 mb-6">
              {activeItems.map(item => {
                const cuenta = splitAssignments[item.id] || 1
                return (
                  <button
                    key={item.id}
                    onClick={() => setSplitAssignments(prev => ({ ...prev, [item.id]: cuenta === 1 ? 2 : 1 }))}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${
                      cuenta === 1 ? 'bg-blue-900/30 border border-blue-700/50' : 'bg-purple-900/30 border border-purple-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                        cuenta === 1 ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                      }`}>C{cuenta}</span>
                      <span className="text-white text-sm">{item.cantidad}x {item.nombre}</span>
                    </div>
                    <span className="text-white font-semibold">{formatMXN(item.subtotal)}</span>
                  </button>
                )
              })}
            </div>

            {/* Totals per cuenta */}
            {(() => {
              const cuenta1Items = activeItems.filter(i => (splitAssignments[i.id] || 1) === 1)
              const cuenta2Items = activeItems.filter(i => splitAssignments[i.id] === 2)
              const total1 = cuenta1Items.reduce((s, i) => s + i.subtotal, 0)
              const total2 = cuenta2Items.reduce((s, i) => s + i.subtotal, 0)
              const iva1 = total1 * IVA_RATE
              const iva2 = total2 * IVA_RATE
              return (
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-4 text-center">
                    <p className="text-blue-400 text-xs font-bold mb-1">CUENTA 1</p>
                    <p className="text-white text-xl font-bold">{formatMXN(total1 + iva1)}</p>
                    <p className="text-blue-400/60 text-xs">{cuenta1Items.length} items</p>
                  </div>
                  <div className="bg-purple-900/20 border border-purple-700/30 rounded-xl p-4 text-center">
                    <p className="text-purple-400 text-xs font-bold mb-1">CUENTA 2</p>
                    <p className="text-white text-xl font-bold">{formatMXN(total2 + iva2)}</p>
                    <p className="text-purple-400/60 text-xs">{cuenta2Items.length} items</p>
                  </div>
                </div>
              )
            })()}

            <div className="flex gap-3">
              <button onClick={() => setShowSplit(false)} className="flex-1 py-3 rounded-xl bg-[var(--line)] hover:bg-[var(--line)] text-[var(--text-4)] font-semibold min-h-[48px]">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const cuenta2Items = activeItems.filter(i => splitAssignments[i.id] === 2)
                  if (cuenta2Items.length === 0) {
                    setShowSplit(false)
                    setSplitPayingCuenta(0)
                    setShowPayment(true)
                    return
                  }
                  logAudit({
                    order_id: orderId, action: 'status_changed', actor: mesero, mesa,
                    details: {
                      type: 'split_cuenta',
                      cuenta1_items: activeItems.filter(i => (splitAssignments[i.id] || 1) === 1).length,
                      cuenta2_items: cuenta2Items.length,
                    },
                  })
                  setShowSplit(false)
                  setSplitPayingCuenta(1) // Start with cuenta 1
                  setShowPayment(true)
                  showToast('Cobra Cuenta 1 primero')
                }}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500/100 text-white font-semibold min-h-[48px]"
              >
                Dividir y cobrar
              </button>
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
              const payingItems = splitPayingCuenta === 1
                ? activeItems.filter(i => (splitAssignments[i.id] || 1) === 1)
                : splitPayingCuenta === 2
                  ? activeItems.filter(i => splitAssignments[i.id] === 2)
                  : activeItems
              const paySubtotal = payingItems.reduce((s, i) => s + i.subtotal, 0)
              const payDiscount = splitPayingCuenta === 0 ? discount : 0
              const paySubAfterDisc = Math.max(0, paySubtotal - payDiscount)
              const payIva = paySubAfterDisc * IVA_RATE
              const payTotal = paySubAfterDisc + payIva
              const cuentaLabel = splitPayingCuenta > 0 ? ` — Cuenta ${splitPayingCuenta}` : ''

              return (<>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Cerrar cuenta{cuentaLabel}</h3>
              <button
                onClick={() => { setShowPayment(false); setSplitPayingCuenta(0) }}
                className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-[var(--line)] flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            {splitPayingCuenta > 0 && (
              <div className={`text-center py-2 px-4 rounded-lg mb-3 ${splitPayingCuenta === 1 ? 'bg-blue-900/30 border border-blue-700/40' : 'bg-purple-900/30 border border-purple-700/40'}`}>
                <p className={`text-sm font-bold ${splitPayingCuenta === 1 ? 'text-blue-400' : 'text-purple-400'}`}>
                  Cuenta {splitPayingCuenta} · {payingItems.length} items
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
                onClick={() => handlePayment('Efectivo')}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500/100 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <Banknote size={24} />
                Efectivo
              </button>
              <button
                onClick={() => handlePayment('Tarjeta de credito')}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500/100 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <CreditCard size={24} />
                Tarjeta
              </button>
              <button
                onClick={() => handlePayment('Transferencia electronica')}
                className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500/100 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <Send size={22} />
                Transferencia
              </button>
              <button
                onClick={() => handlePayment('Mixto')}
                className="w-full flex items-center justify-center gap-3 bg-[var(--line)] hover:bg-[var(--line-soft)] text-[var(--text-2)] font-semibold py-3 rounded-xl text-base transition-colors min-h-[48px]"
              >
                Mixto (efectivo + tarjeta)
              </button>
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
              `${sbUrl}/rest/v1/pos_inventory?stock=lt.5&stock=gt.0&client_id=eq.amalay&limit=5`,
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
            `${sbUrl}/rest/v1/pos_orders?status=eq.lista&client_id=eq.amalay&limit=5`,
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
            `${sbUrl}/rest/v1/delivery_orders?status=eq.nueva&client_id=eq.amalay&limit=3`,
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
