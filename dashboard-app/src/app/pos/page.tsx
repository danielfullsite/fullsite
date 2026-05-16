'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
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
  type RecipeRow,
  type Ingredient,
  type ModificadorAgregar,
} from '@/lib/pos-data'
import type { OrderItem, MenuItem, Order } from '@/lib/pos-data'
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
  MessageCircle,
  Send as SendIcon,
  Loader2,
} from 'lucide-react'

export default function POSPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center text-white bg-slate-900">
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
      <div className="relative bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-white">{item.name}</h3>
            <p className="text-emerald-400 font-semibold">{formatMXN(item.price)}</p>
          </div>
          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Quitar section — dynamic from recipe ingredients */}
          {quitarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Quitar {recipeIngredients.length > 0 && <span className="text-slate-600 normal-case font-normal">({recipeIngredients.length} ingredientes)</span>}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {quitarOptions.map(mod => (
                <label
                  key={mod}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors min-h-[44px] ${
                    quitarChecked.has(mod)
                      ? 'bg-red-900/40 border border-red-700/60'
                      : 'bg-slate-700/50 border border-slate-600/50 hover:bg-slate-700'
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
          </div>}

          {/* Agregar section */}
          {agregarOptions.length > 0 && <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Agregar</h4>
            <div className="grid grid-cols-2 gap-2">
              {agregarOptions.map(mod => (
                <label
                  key={mod.name}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors min-h-[44px] ${
                    agregarChecked.has(mod.name)
                      ? 'bg-emerald-900/40 border border-emerald-700/60'
                      : 'bg-slate-700/50 border border-slate-600/50 hover:bg-slate-700'
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
                      : 'border-slate-500'
                  }`}>
                    {agregarChecked.has(mod.name) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-white">{mod.name}</span>
                    <span className={`text-xs font-medium ${mod.price > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {mod.price > 0 ? `+${formatMXN(mod.price)}` : 'Gratis'}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>}

          {/* Notas */}
          <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Notas</h4>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Instrucciones especiales..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500 min-h-[44px]"
            />
          </div>

          {/* Cantidad */}
          <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Cantidad</h4>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                className="w-12 h-12 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white transition-colors"
              >
                <Minus size={20} />
              </button>
              <span className="text-2xl font-bold text-white w-12 text-center">{cantidad}</span>
              <button
                onClick={() => setCantidad(cantidad + 1)}
                className="w-12 h-12 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="sticky bottom-0 bg-slate-800 border-t border-slate-700 px-5 py-4 flex gap-3 rounded-b-2xl">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold transition-colors min-h-[48px]"
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
      <div className="relative bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Aplicar descuento</h3>
          <button onClick={onCancel} className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300">
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('percent')}
            className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors min-h-[44px] ${
              mode === 'percent' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            <Percent size={16} className="inline mr-1 -mt-0.5" /> Porcentaje
          </button>
          <button
            onClick={() => setMode('fixed')}
            className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors min-h-[44px] ${
              mode === 'fixed' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
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
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 text-lg text-center focus:outline-none focus:border-emerald-500 min-h-[48px] mb-3"
          autoFocus
        />

        {discountAmount > 0 && (
          <p className="text-center text-slate-400 text-sm mb-4">
            Descuento: <span className="text-red-400 font-semibold">-{formatMXN(discountAmount)}</span>
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold transition-colors min-h-[48px]">
            Cancelar
          </button>
          <button
            onClick={() => onApply(discountAmount)}
            disabled={discountAmount <= 0}
            className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold transition-colors min-h-[48px]"
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
      <div className="relative bg-slate-800 border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
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
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">Motivo de cancelacion</label>
            <div className="grid grid-cols-2 gap-2">
              {CANCEL_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => { setReason(r); setError('') }}
                  className={`px-3 py-2.5 rounded-lg text-sm text-left transition-colors min-h-[44px] ${
                    reason === r
                      ? 'bg-red-900/40 border border-red-600 text-white'
                      : 'bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">PIN de gerente</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="****"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold transition-colors min-h-[48px]">
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
      <div className="relative bg-slate-800 border border-red-700/40 rounded-2xl w-full max-w-md shadow-2xl mx-4 p-5">
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
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">Motivo de anulacion</label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError('') }}
              placeholder="Describe el motivo..."
              rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 block">PIN de gerente</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="****"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 min-h-[48px]"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold transition-colors min-h-[48px]">
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

  const [selectedCategory, setSelectedCategory] = useState<string>(
    MENU_CATEGORIES[0].id
  )
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mesa, setMesa] = useState<number>(initialMesa)
  const [mesero, setMesero] = useState<string>(MESEROS[0])
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

  useEffect(() => {
    (async () => {
      const [r, i] = await Promise.all([getRecipes(), getIngredients()])
      setAllRecipes(r)
      setAllIngredients(i)
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

  // Menu search
  const [menuSearch, setMenuSearch] = useState('')

  // Discount state
  const [showDiscount, setShowDiscount] = useState(false)
  const [discount, setDiscount] = useState(0)

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

  // Mobile view toggle
  const [mobileView, setMobileView] = useState<'menu' | 'order'>('menu')

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
    MENU_CATEGORIES.find((c) => c.id === selectedCategory) || MENU_CATEGORIES[0]

  // Open modifier modal for a new item
  const handleMenuItemTap = useCallback((item: MenuItem, catId?: string) => {
    setEditingOrderItem(null)
    setModifierItem(item)
    // Find category for this item
    if (catId) {
      setModifierCategoryId(catId)
    } else {
      const cat = MENU_CATEGORIES.find(c => c.items.some(i => i.id === item.id))
      setModifierCategoryId(cat?.id ?? '')
    }
  }, [])

  // Open modifier modal to edit an existing order item
  const handleEditOrderItem = useCallback((orderItem: OrderItem) => {
    // Find the menu item to get the base info
    let menuItem: MenuItem | null = null
    for (const cat of MENU_CATEGORIES) {
      const found = cat.items.find(i => i.id === orderItem.menuItemId)
      if (found) { menuItem = found; break }
    }
    if (menuItem) {
      setEditingOrderItem(orderItem)
      setModifierItem(menuItem)
    }
  }, [])

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
  const handleVoidOrder = useCallback((reason: string, managerName: string) => {
    const voidTotal = orderItems.reduce((sum, i) => sum + i.subtotal, 0)
    logAudit({
      order_id: orderId, action: 'order_cancelled', actor: mesero, mesa,
      details: { items: orderItems.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, subtotal: i.subtotal })), total: voidTotal },
      reason,
      approved_by: managerName,
    })
    setOrderItems([])
    setCancelledItems(new Set())
    setDiscount(0)
    setOrderNotes('')
    setShowVoidOrder(false)
    showToast(`Orden anulada — aprobado por ${managerName}`)
  }, [orderId, mesero, mesa, orderItems])

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
    const order: Order = {
      id: orderId,
      mesa,
      mesero,
      personas,
      status: 'cerrada',
      items: activeItems,
      subtotal,
      iva,
      total,
      descuento: discount,
      metodoPago: method,
      notas: orderNotes || undefined,
      createdAt: new Date(),
      closedAt: new Date(),
    }
    const ok = await saveOrder(order)
    if (ok) {
      logAudit({
        order_id: orderId, action: 'payment_processed', actor: mesero, mesa,
        details: { method, total, descuento: discount },
      })
      logAudit({
        order_id: orderId, action: 'order_closed', actor: mesero, mesa,
        details: { method, items_count: activeItems.length, total },
      })
      showToast(`Cuenta cerrada - ${method}`)
    } else {
      showToast('Error al cerrar cuenta')
    }
    setSaving(false)
    setOrderItems([])
    setCancelledItems(new Set())
    setDiscount(0)
    setOrderNotes('')
    setShowPayment(false)
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
      <header className="flex flex-col bg-slate-800 border-b border-slate-700 flex-shrink-0">
        {/* Row 1: Logo + Nav (scrollable on mobile) */}
        <div className="flex items-center justify-between px-3 py-2 overflow-x-auto">
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-white font-black text-lg tracking-tight">
              fullsite
              <span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
            </span>
            <div className="h-5 w-px bg-slate-600" />
            <Link href="/pos/mesas" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><Grid3X3 size={14} />Mesas</Link>
            <Link href="/pos/cocina" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><ChefHat size={14} />Cocina</Link>
            <Link href="/pos/barra" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><Wine size={14} />Barra</Link>
            <Link href="/pos/recetas" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><BookOpen size={14} />Recetas</Link>
            <Link href="/pos/compras" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><ShoppingCart size={14} />Compras</Link>
            <Link href="/pos/inventario" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><Package size={14} />Inv</Link>
            <Link href="/pos/auditoria" className="flex items-center gap-1 text-slate-400 hover:text-white text-xs"><FileText size={14} />Audit</Link>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400 flex-shrink-0 ml-2">
            <Clock size={14} />
            <span className="text-xs font-mono">{clock}</span>
          </div>
        </div>
        {/* Row 2: Selectors (compact on mobile) */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-700/50 overflow-x-auto">
          <select value={mesa} onChange={(e) => setMesa(Number(e.target.value))} className="bg-slate-700 text-white rounded-lg px-2 py-1.5 text-sm border border-slate-600 min-h-[36px]">
            {Array.from({ length: 16 }, (_, i) => (<option key={i + 1} value={i + 1}>Mesa {i + 1}</option>))}
          </select>
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className="bg-slate-700 text-white rounded-lg px-2 py-1.5 text-sm border border-slate-600 min-h-[36px]">
            {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1} pers</option>))}
          </select>
          <select value={mesero} onChange={(e) => setMesero(e.target.value)} className="bg-slate-700 text-white rounded-lg px-2 py-1.5 text-sm border border-slate-600 min-h-[36px] flex-1 min-w-0">
            {MESEROS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>
        {/* Row 3: Mobile tab toggle (only visible on mobile) */}
        <div className="flex md:hidden border-t border-slate-700/50">
          <button
            onClick={() => setMobileView('menu')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${mobileView === 'menu' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setMobileView('order')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors relative ${mobileView === 'order' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >
            Orden {activeItems.length > 0 && <span className="ml-1 bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeItems.length}</span>}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel -- Current Order (60% desktop, full on mobile when active) */}
        <div className={`md:w-[60%] md:flex flex-col border-r border-slate-700 bg-slate-900 ${mobileView === 'order' ? 'flex w-full' : 'hidden'}`}>
          {/* Order header */}
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
            <h2 className="text-lg font-semibold">
              Mesa {mesa}{' '}
              <span className="text-slate-400 font-normal text-sm">
                · {personas} personas · {mesero}
              </span>
            </h2>
          </div>

          {/* Order items list */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {orderItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
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
                          ? 'bg-red-950/30 border border-red-900/30 opacity-60'
                          : flashItemId === item.id
                          ? 'ring-2 ring-emerald-500 bg-emerald-900/20'
                          : 'bg-slate-800/60 hover:bg-slate-800'
                      }`}
                    >
                      {/* Quantity controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1) }}
                          disabled={isCancelled}
                          className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center font-semibold text-lg">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                          disabled={isCancelled}
                          className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
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
                          <p className="text-slate-400 text-xs mt-0.5 truncate">
                            {item.modificadores.join(' · ')}
                          </p>
                        )}
                        {item.notas && (
                          <p className="text-slate-500 text-xs italic mt-0.5 truncate">
                            {item.notas}
                          </p>
                        )}
                        <p className="text-slate-400 text-sm">
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
                            className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 flex items-center justify-center transition-colors"
                          >
                            <Pencil size={14} />
                          </button>

                          {/* Cancel (NOT delete — requires reason + manager PIN) */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancellingItem(item) }}
                            className="w-9 h-9 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 flex items-center justify-center transition-colors"
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
          <div className="border-t border-slate-700 px-4 py-3 bg-slate-800/50">
            {/* Discount button */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setShowDiscount(true)}
                disabled={orderItems.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-sm transition-colors min-h-[40px]"
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
                  className="px-2 py-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 text-sm transition-colors min-h-[40px]"
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
                <StickyNote size={14} className="text-slate-400" />
                <span className="text-xs text-slate-400 font-medium">Nota de la orden</span>
              </div>
              <input
                type="text"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Nota de la orden..."
                className="w-full bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex justify-between text-slate-400 text-sm mb-1">
              <span>Subtotal</span>
              <span>{formatMXN(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-red-400 text-sm mb-1">
                <span>Descuento</span>
                <span>-{formatMXN(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-400 text-sm mb-2">
              <span>IVA (16%)</span>
              <span>{formatMXN(iva)}</span>
            </div>
            <div className="flex justify-between text-white text-2xl font-bold">
              <span>Total</span>
              <span>{formatMXN(total)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 border-t border-slate-700 flex gap-3">
            <button
              onClick={handleSendToKitchen}
              disabled={orderItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
            >
              <Send size={20} />
              {saving ? 'Guardando...' : sentToKitchen ? 'Enviado!' : 'Enviar a cocina'}
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={orderItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
            >
              <CreditCard size={20} />
              Cerrar cuenta
            </button>
          </div>
        </div>

        {/* Right Panel -- Menu (40% desktop, full on mobile when active) */}
        <div className={`md:w-[40%] md:flex flex-col bg-slate-850 ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`}>
          {/* Search bar */}
          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Buscar platillo..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          {menuSearch.trim() ? (
            /* Search results across all categories */
            <div className="flex-1 overflow-y-auto p-3">
              {(() => {
                const term = menuSearch.toLowerCase()
                const results: { item: MenuItem; category: string; catId: string }[] = []
                for (const cat of MENU_CATEGORIES) {
                  for (const item of cat.items) {
                    if (item.name.toLowerCase().includes(term)) {
                      results.push({ item, category: cat.name, catId: cat.id })
                    }
                  }
                }
                if (results.length === 0) {
                  return <p className="text-slate-500 text-center py-8">Sin resultados para &ldquo;{menuSearch}&rdquo;</p>
                }
                return (
                  <div className="space-y-2">
                    {results.map(({ item, category, catId }) => (
                      <button
                        key={item.id}
                        onClick={() => { handleMenuItemTap(item, catId); setMobileView('order') }}
                        className="w-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded-xl p-3 text-left transition-colors flex items-center justify-between"
                      >
                        <div>
                          <span className="font-medium text-[15px] text-white">{item.name}</span>
                          <span className="text-slate-500 text-xs ml-2">{category}</span>
                        </div>
                        <span className="text-emerald-400 font-semibold">{formatMXN(item.price)}</span>
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          ) : (
            <>
              {/* Category tabs */}
              <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
                {MENU_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-[40px] ${
                      selectedCategory === cat.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Menu items grid */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {activeCategory.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { handleMenuItemTap(item, activeCategory.id); setMobileView('order') }}
                      className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded-xl p-3 text-left transition-colors min-h-[80px] md:min-h-[100px] flex flex-col justify-between"
                    >
                      <span className="font-medium text-[14px] leading-tight">
                        {item.name}
                      </span>
                      <span className="text-emerald-400 font-semibold text-base mt-2">
                        {formatMXN(item.price)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-700 border border-slate-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium animate-fade-in">
          {toast}
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Cerrar cuenta</h3>
              <button
                onClick={() => setShowPayment(false)}
                className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            <div className="text-center mb-6">
              <p className="text-slate-400 text-sm mb-1">
                Mesa {mesa} · {mesero}
              </p>
              <p className="text-4xl font-bold text-white">{formatMXN(total)}</p>
              {discount > 0 && (
                <p className="text-red-400 text-sm mt-1">Descuento aplicado: -{formatMXN(discount)}</p>
              )}
              {orderNotes && (
                <p className="text-slate-400 text-sm italic mt-1">{orderNotes}</p>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handlePayment('efectivo')}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <Banknote size={24} />
                Efectivo
              </button>
              <button
                onClick={() => handlePayment('tarjeta')}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                <CreditCard size={24} />
                Tarjeta
              </button>
              <button
                onClick={() => handlePayment('mixto')}
                className="w-full flex items-center justify-center gap-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
              >
                Mixto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Copilot Chat */}
      <POSChat />
    </div>
  )
}

// ─── AI Copilot Chat (floating) ─────────────────────────────────────────────

function POSChat() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: messages.slice(-6) }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || 'Sin respuesta' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error al conectar' }])
    }
    setLoading(false)
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-105"
        >
          <MessageCircle size={24} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-0 right-0 z-50 w-full sm:w-[400px] h-[500px] sm:h-[600px] sm:bottom-6 sm:right-6 bg-slate-800 border border-slate-700 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-700/50 border-b border-slate-600 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
                <MessageCircle size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">fullsite IA</p>
                <p className="text-emerald-400 text-[11px]">Copiloto operativo</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-slate-300">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <MessageCircle size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 text-sm">Pregunta lo que quieras</p>
                <div className="mt-4 space-y-2">
                  {[
                    '¿Quién está vendiendo más hoy?',
                    '¿Cuál es el ticket promedio esta semana?',
                    '¿Qué mesero tiene más cancelaciones?',
                  ].map(q => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className="block w-full text-left px-3 py-2 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-slate-300 text-xs transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-emerald-600 text-white rounded-br-sm'
                    : 'bg-slate-700 text-slate-200 rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-700 text-slate-400 px-3.5 py-2.5 rounded-2xl rounded-bl-sm">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-slate-700 flex-shrink-0">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Pregunta algo..."
                className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center flex-shrink-0"
              >
                <SendIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
