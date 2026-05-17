'use client'

import { useState, use } from 'react'
import { MENU_CATEGORIES, formatMXN } from '@/lib/pos-data'

interface CartItem {
  id: string
  name: string
  price: number
  qty: number
}

export default function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = use(params)
  const mesaNum = parseInt(mesa) || 1
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCat, setSelectedCat] = useState(MENU_CATEGORIES[0].id)
  const [sent, setSent] = useState(false)
  const [nombre, setNombre] = useState('')

  const activeCat = MENU_CATEGORIES.find(c => c.id === selectedCat) || MENU_CATEGORIES[0]

  const addItem = (id: string, name: string, price: number) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === id)
      if (existing) return prev.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { id, name, price, qty: 1 }]
    })
  }

  const removeItem = (id: string) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: i.qty - 1 } : i).filter(i => i.qty > 0))
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)

  const handleSend = async () => {
    if (cart.length === 0) return
    // Save to Supabase as a new order
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const items = cart.map(i => ({ nombre: i.name, cantidad: i.qty, precio: i.price, subtotal: i.price * i.qty, modificadores: [], notas: '', precioExtra: 0, menuItemId: i.id, id: i.id }))
    const iva = total * 0.16
    await fetch(`${SUPABASE_URL}/rest/v1/pos_orders`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: 'amalay', mesa: mesaNum, mesero: `QR: ${nombre || 'Cliente'}`, personas: 1,
        status: 'enviada', subtotal: total, iva, total: total + iva, descuento: 0,
        items: JSON.stringify(items),
      }),
    })
    setSent(true)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Pedido enviado</h2>
          <p className="text-slate-500">Tu orden fue enviada a la cocina. Mesa {mesaNum}</p>
          <button onClick={() => { setSent(false); setCart([]) }} className="mt-6 px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold">
            Pedir mas
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <span className="font-black text-lg tracking-tight">
            fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <span className="text-slate-400 text-sm ml-2">Mesa {mesaNum}</span>
        </div>
        {cart.length > 0 && (
          <span className="bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {cart.reduce((s, i) => s + i.qty, 0)}
          </span>
        )}
      </header>

      {/* Name input */}
      <div className="px-4 py-3 border-b border-slate-100">
        <input
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          placeholder="Tu nombre (opcional)"
          className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-slate-100 bg-slate-50 sticky top-[52px] z-10">
        {MENU_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCat(cat.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              selectedCat === cat.id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          {activeCat.items.map(item => {
            const inCart = cart.find(c => c.id === item.id)
            return (
              <button
                key={item.id}
                onClick={() => addItem(item.id, item.name, item.price)}
                className={`border rounded-xl p-3 text-left transition-all ${
                  inCart ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-medium text-slate-900 text-sm">{item.name}</p>
                <p className="text-emerald-600 font-semibold mt-1">{formatMXN(item.price)}</p>
                {inCart && (
                  <div className="flex items-center justify-between mt-2">
                    <button onClick={e => { e.stopPropagation(); removeItem(item.id) }} className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-sm font-bold">-</button>
                    <span className="font-bold text-emerald-600">{inCart.qty}</span>
                    <button onClick={e => { e.stopPropagation(); addItem(item.id, item.name, item.price) }} className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold">+</button>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cart footer */}
      {cart.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
          <button
            onClick={handleSend}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-3"
          >
            Enviar pedido · {formatMXN(total)}
          </button>
        </div>
      )}
    </div>
  )
}
