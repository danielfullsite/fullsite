'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  MENU_CATEGORIES,
  MESEROS,
  IVA_RATE,
  MODIFIERS_QUITAR,
  MODIFIERS_AGREGAR,
  formatMXN,
  generateId,
  saveOrder,
} from '@/lib/pos-data'
import type { OrderItem, MenuItem, Order } from '@/lib/pos-data'
import {
  ChefHat,
  Grid3X3,
  Minus,
  Plus,
  Trash2,
  X,
  CreditCard,
  Banknote,
  Send,
  Clock,
  Users,
  Percent,
  StickyNote,
  Pencil,
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
  onConfirm: (orderItem: OrderItem) => void
  onCancel: () => void
}

function ModifierModal({ item, existingOrder, onConfirm, onCancel }: ModifierModalProps) {
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

  const precioExtra = MODIFIERS_AGREGAR
    .filter(m => agregarChecked.has(m.name))
    .reduce((sum, m) => sum + m.price, 0)

  const subtotal = (item.price + precioExtra) * cantidad

  const buildModificadores = (): string[] => {
    const mods: string[] = []
    quitarChecked.forEach(m => mods.push(m))
    agregarChecked.forEach(name => {
      const mod = MODIFIERS_AGREGAR.find(m => m.name === name)
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
          {/* Quitar section */}
          <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Quitar</h4>
            <div className="grid grid-cols-2 gap-2">
              {MODIFIERS_QUITAR.map(mod => (
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
          </div>

          {/* Agregar section */}
          <div>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Agregar</h4>
            <div className="grid grid-cols-2 gap-2">
              {MODIFIERS_AGREGAR.map(mod => (
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
          </div>

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
  const [editingOrderItem, setEditingOrderItem] = useState<OrderItem | null>(null)

  // Discount state
  const [showDiscount, setShowDiscount] = useState(false)
  const [discount, setDiscount] = useState(0)

  // Order-level notes
  const [orderNotes, setOrderNotes] = useState('')

  // Flash animation state
  const [flashItemId, setFlashItemId] = useState<string | null>(null)

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
  const handleMenuItemTap = useCallback((item: MenuItem) => {
    setEditingOrderItem(null)
    setModifierItem(item)
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
        // Update existing
        const next = [...prev]
        next[existingIndex] = orderItem
        return next
      }
      // Add new
      return [...prev, orderItem]
    })
    // Flash animation
    setFlashItemId(orderItem.id)
    setTimeout(() => setFlashItemId(null), 500)
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [])

  const handleModifierCancel = useCallback(() => {
    setModifierItem(null)
    setEditingOrderItem(null)
  }, [])

  const removeItem = useCallback((id: string) => {
    setOrderItems((prev) => prev.filter((oi) => oi.id !== id))
  }, [])

  const updateQuantity = useCallback((id: string, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((oi) =>
          oi.id === id
            ? {
                ...oi,
                cantidad: Math.max(0, oi.cantidad + delta),
                subtotal: (oi.precio + oi.precioExtra) * Math.max(0, oi.cantidad + delta),
              }
            : oi
        )
        .filter((oi) => oi.cantidad > 0)
    )
  }, [])

  const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0)
  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const iva = subtotalAfterDiscount * IVA_RATE
  const total = subtotalAfterDiscount + iva

  const handleSendToKitchen = async () => {
    if (orderItems.length === 0 || saving) return
    setSaving(true)
    const order: Order = {
      id: generateId(),
      mesa,
      mesero,
      personas,
      status: 'enviada',
      items: orderItems,
      subtotal,
      iva,
      total,
      descuento: discount,
      notas: orderNotes || undefined,
      createdAt: new Date(),
    }
    const ok = await saveOrder(order)
    setSaving(false)
    if (ok) {
      setSentToKitchen(true)
      showToast('Orden enviada a cocina')
      setTimeout(() => setSentToKitchen(false), 2000)
    } else {
      showToast('Error al guardar orden')
    }
  }

  const handleCloseOrder = () => {
    if (orderItems.length === 0) return
    setShowPayment(true)
  }

  const handlePayment = async (method: string) => {
    setSaving(true)
    const order: Order = {
      id: generateId(),
      mesa,
      mesero,
      personas,
      status: 'cerrada',
      items: orderItems,
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
    setSaving(false)
    if (ok) {
      showToast(`Cuenta cerrada - ${method}`)
    } else {
      showToast('Error al cerrar cuenta')
    }
    setOrderItems([])
    setDiscount(0)
    setOrderNotes('')
    setShowPayment(false)
  }

  const handleApplyDiscount = (amount: number) => {
    setDiscount(amount)
    setShowDiscount(false)
  }

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-white font-black text-lg tracking-tight">
            fullsite
            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <span className="text-slate-400 text-sm font-medium">POS</span>
          <div className="h-5 w-px bg-slate-600" />
          <Link
            href="/pos/mesas"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <Grid3X3 size={16} />
            Mesas
          </Link>
          <Link
            href="/pos/cocina"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ChefHat size={16} />
            Cocina
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {/* Table selector */}
          <div className="flex items-center gap-2">
            <label className="text-slate-400 text-sm">Mesa</label>
            <select
              value={mesa}
              onChange={(e) => setMesa(Number(e.target.value))}
              className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 min-h-[44px]"
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>

          {/* Personas */}
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <select
              value={personas}
              onChange={(e) => setPersonas(Number(e.target.value))}
              className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 min-h-[44px]"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>

          {/* Mesero selector */}
          <div className="flex items-center gap-2">
            <label className="text-slate-400 text-sm">Mesero</label>
            <select
              value={mesero}
              onChange={(e) => setMesero(e.target.value)}
              className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 min-h-[44px]"
            >
              {MESEROS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Clock */}
          <div className="flex items-center gap-1.5 text-slate-400">
            <Clock size={16} />
            <span className="text-sm font-mono">{clock}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel -- Current Order (60%) */}
        <div className="w-[60%] flex flex-col border-r border-slate-700 bg-slate-900">
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
                {orderItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 py-3 px-3 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition-all ${
                      flashItemId === item.id ? 'ring-2 ring-emerald-500 bg-emerald-900/20' : ''
                    }`}
                  >
                    {/* Quantity controls */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1) }}
                        className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center font-semibold text-lg">
                        {item.cantidad}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1) }}
                        className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Item name + modifiers */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[15px]">{item.nombre}</p>
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
                    <span className="font-semibold text-lg w-24 text-right flex-shrink-0">
                      {formatMXN(item.subtotal)}
                    </span>

                    {/* Edit */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditOrderItem(item) }}
                      className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 flex items-center justify-center transition-colors"
                    >
                      <Pencil size={14} />
                    </button>

                    {/* Remove */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeItem(item.id) }}
                      className="w-9 h-9 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 flex items-center justify-center transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
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
                  onClick={() => setDiscount(0)}
                  className="px-2 py-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 text-sm transition-colors min-h-[40px]"
                >
                  <X size={14} />
                </button>
              )}
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

        {/* Right Panel -- Menu (40%) */}
        <div className="w-[40%] flex flex-col bg-slate-850">
          {/* Category tabs */}
          <div className="flex gap-1 px-3 py-3 overflow-x-auto border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
            {MENU_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
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
            <div className="grid grid-cols-3 gap-2">
              {activeCategory.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleMenuItemTap(item)}
                  className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded-xl p-3 text-left transition-colors min-h-[100px] flex flex-col justify-between"
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
        </div>
      </div>

      {/* Modifier Modal */}
      {modifierItem && (
        <ModifierModal
          item={modifierItem}
          existingOrder={editingOrderItem}
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
    </div>
  )
}
