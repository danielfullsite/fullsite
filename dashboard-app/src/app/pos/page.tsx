'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  MENU_CATEGORIES,
  MESEROS,
  IVA_RATE,
  formatMXN,
  generateId,
} from '@/lib/pos-data'
import type { OrderItem } from '@/lib/pos-data'
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

  const addItem = useCallback(
    (item: { id: string; name: string; price: number }) => {
      setOrderItems((prev) => {
        const existing = prev.find((oi) => oi.menuItemId === item.id)
        if (existing) {
          return prev.map((oi) =>
            oi.menuItemId === item.id
              ? { ...oi, quantity: oi.quantity + 1 }
              : oi
          )
        }
        return [
          ...prev,
          {
            id: generateId(),
            menuItemId: item.id,
            name: item.name,
            price: item.price,
            quantity: 1,
            status: 'pendiente' as const,
            createdAt: new Date(),
          },
        ]
      })
    },
    []
  )

  const removeItem = useCallback((id: string) => {
    setOrderItems((prev) => prev.filter((oi) => oi.id !== id))
  }, [])

  const updateQuantity = useCallback((id: string, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((oi) =>
          oi.id === id ? { ...oi, quantity: Math.max(0, oi.quantity + delta) } : oi
        )
        .filter((oi) => oi.quantity > 0)
    )
  }, [])

  const subtotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )
  const iva = subtotal * IVA_RATE
  const total = subtotal + iva

  const handleSendToKitchen = () => {
    if (orderItems.length === 0) return
    setSentToKitchen(true)
    setTimeout(() => setSentToKitchen(false), 2000)
  }

  const handleCloseOrder = () => {
    if (orderItems.length === 0) return
    setShowPayment(true)
  }

  const handlePayment = (method: string) => {
    setOrderItems([])
    setShowPayment(false)
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
        {/* Left Panel — Current Order (60%) */}
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
                    className="flex items-center gap-3 py-3 px-3 rounded-lg bg-slate-800/60 hover:bg-slate-800"
                  >
                    {/* Quantity controls */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center font-semibold text-lg">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Item name */}
                    <div className="flex-1">
                      <p className="font-medium text-[15px]">{item.name}</p>
                      <p className="text-slate-400 text-sm">
                        {formatMXN(item.price)} c/u
                      </p>
                    </div>

                    {/* Line total */}
                    <span className="font-semibold text-lg w-24 text-right">
                      {formatMXN(item.price * item.quantity)}
                    </span>

                    {/* Remove */}
                    <button
                      onClick={() => removeItem(item.id)}
                      className="w-9 h-9 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 flex items-center justify-center transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-slate-700 px-4 py-3 bg-slate-800/50">
            <div className="flex justify-between text-slate-400 text-sm mb-1">
              <span>Subtotal</span>
              <span>{formatMXN(subtotal)}</span>
            </div>
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
              disabled={orderItems.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
            >
              <Send size={20} />
              {sentToKitchen ? 'Enviado!' : 'Enviar a cocina'}
            </button>
            <button
              onClick={handleCloseOrder}
              disabled={orderItems.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-xl text-lg transition-colors min-h-[56px]"
            >
              <CreditCard size={20} />
              Cerrar cuenta
            </button>
          </div>
        </div>

        {/* Right Panel — Menu (40%) */}
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
                  onClick={() => addItem(item)}
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
