'use client'

import { useState, useEffect, use } from 'react'
import { MENU_CATEGORIES, getMenuCategoriesFromDB, formatMXN, type MenuCategory, type MenuItem } from '@/lib/pos-data'
import { ShoppingCart, Plus, Minus, Send, ChevronLeft, X, MessageSquare } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface CartItem {
  id: string
  name: string
  price: number
  qty: number
  notas: string
}

export default function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = use(params)
  const mesaNum = parseInt(mesa) || 1
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCat, setSelectedCat] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [nombre, setNombre] = useState('')
  const [showCart, setShowCart] = useState(false)
  const [notasItem, setNotasItem] = useState<string | null>(null)
  const [notasText, setNotasText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMenuCategoriesFromDB().then(cats => {
      // Filter out market items (price 0) and empty categories
      const filtered = cats
        .map(c => ({ ...c, items: c.items.filter(i => i.price > 0) }))
        .filter(c => c.items.length > 0)
      setMenuCategories(filtered)
      if (filtered.length > 0) setSelectedCat(filtered[0].id)
      setLoading(false)
    })
  }, [])

  const activeCat = menuCategories.find(c => c.id === selectedCat) || menuCategories[0]

  const addItem = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id)
      if (existing) return prev.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1, notas: '' }]
    })
  }

  const removeItem = (id: string) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: i.qty - 1 } : i).filter(i => i.qty > 0))
  }

  const updateNotas = (id: string, notas: string) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, notas } : i))
  }

  const totalItems = cart.reduce((s, i) => s + i.qty, 0)
  const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const iva = totalPrice * 0.16

  const handleSend = async () => {
    if (cart.length === 0 || sending) return
    setSending(true)
    const items = cart.map(i => ({
      id: i.id, menuItemId: i.id, nombre: i.name, cantidad: i.qty,
      precio: i.price, subtotal: i.price * i.qty,
      modificadores: i.notas ? [i.notas] : [], notas: i.notas, precioExtra: 0,
    }))
    await fetch(`${SUPABASE_URL}/rest/v1/pos_orders`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: (typeof window !== 'undefined' && localStorage.getItem('fullsite_client_id')) || 'amalay', mesa: mesaNum, mesero: `QR: ${nombre || 'Cliente'}`, personas: 1,
        status: 'enviada', subtotal: totalPrice, iva, total: totalPrice + iva, descuento: 0,
        items: JSON.stringify(items),
      }),
    })
    setSending(false)
    setSent(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-3)] text-sm">Cargando menu...</p>
        </div>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-[var(--surface)] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-1)] mb-2">Pedido enviado</h2>
          <p className="text-[var(--text-2)] mb-1">Tu orden fue enviada a la cocina</p>
          <p className="text-[var(--text-3)] text-sm">Mesa {mesaNum} · {totalItems} items · {formatMXN(totalPrice + iva)}</p>
          <button onClick={() => { setSent(false); setCart([]) }} className="mt-8 px-8 py-3.5 bg-emerald-600 text-white rounded-2xl font-semibold text-lg shadow-lg shadow-emerald-200">
            Pedir mas
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--surface-2)] flex flex-col">
      {/* Header */}
      <header className="bg-[var(--surface)] text-white px-4 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div>
          <span className="font-black text-lg tracking-tight">
            fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <span className="text-[var(--text-3)] text-sm ml-2">Mesa {mesaNum}</span>
        </div>
        {totalItems > 0 && (
          <button onClick={() => setShowCart(true)} className="relative bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
            <ShoppingCart size={16} />
            {formatMXN(totalPrice)}
            <span className="absolute -top-2 -right-2 bg-[var(--surface)] text-emerald-600 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow">
              {totalItems}
            </span>
          </button>
        )}
      </header>

      {/* Name input */}
      <div className="px-4 py-3 bg-[var(--surface)] border-b border-[var(--line-soft)]">
        <input
          value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="Tu nombre (opcional)"
          className="w-full border border-[var(--line)] rounded-xl px-4 py-2.5 text-[var(--text-1)] placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-[var(--line-soft)] bg-[var(--surface)] sticky top-[56px] z-10">
        {menuCategories.map(cat => (
          <button key={cat.id} onClick={() => setSelectedCat(cat.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              selectedCat === cat.id
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                : 'bg-[var(--surface-2)] text-[var(--text-2)]'
            }`}>
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 px-4 py-4">
        {activeCat && (
          <>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-3">{activeCat.name}</h3>
            <div className="grid grid-cols-2 gap-3">
              {activeCat.items.map(item => {
                const inCart = cart.find(c => c.id === item.id)
                return (
                  <div key={item.id}
                    className={`bg-[var(--surface)] border rounded-2xl p-4 transition-all ${
                      inCart ? 'border-emerald-400 shadow-sm shadow-emerald-100' : 'border-[var(--line)]'
                    }`}>
                    <button onClick={() => addItem(item)} className="w-full text-left">
                      <p className="font-semibold text-[var(--text-1)] text-sm leading-tight">{item.name}</p>
                      <p className="text-emerald-600 font-bold mt-1.5">{formatMXN(item.price)}</p>
                    </button>
                    {inCart && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--line-soft)]">
                        <button onClick={() => removeItem(item.id)}
                          className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
                          <Minus size={14} />
                        </button>
                        <span className="font-bold text-emerald-600 text-lg">{inCart.qty}</span>
                        <button onClick={() => addItem(item)}
                          className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                    {inCart && (
                      <button onClick={() => { setNotasItem(item.id); setNotasText(inCart.notas) }}
                        className="mt-2 w-full text-xs text-[var(--text-3)] flex items-center gap-1 justify-center hover:text-emerald-600">
                        <MessageSquare size={10} />
                        {inCart.notas ? inCart.notas : 'Agregar nota'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Bottom bar */}
      {totalItems > 0 && !showCart && (
        <div className="sticky bottom-0 bg-[var(--surface)] border-t border-[var(--line)] px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] z-10">
          <button onClick={() => setShowCart(true)}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-2xl transition-colors flex items-center justify-center gap-3 shadow-lg shadow-emerald-200">
            <ShoppingCart size={20} />
            Ver pedido ({totalItems}) · {formatMXN(totalPrice)}
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setShowCart(false)}>
          <div className="bg-[var(--surface)] rounded-t-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Cart header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line-soft)]">
              <h3 className="text-lg font-bold text-[var(--text-1)]">Tu pedido</h3>
              <button onClick={() => setShowCart(false)} className="text-[var(--text-3)]"><X size={20} /></button>
            </div>

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {cart.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-3 border-b border-[var(--line-soft)]">
                  <div className="flex-1">
                    <p className="font-medium text-[var(--text-1)] text-sm">{item.name}</p>
                    {item.notas && <p className="text-xs text-[var(--text-3)] mt-0.5">{item.notas}</p>}
                    <p className="text-emerald-600 font-semibold text-sm mt-0.5">{formatMXN(item.price * item.qty)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => removeItem(item.id)} className="w-8 h-8 rounded-full bg-[var(--surface-2)] text-[var(--text-2)] flex items-center justify-center">
                      <Minus size={14} />
                    </button>
                    <span className="font-bold text-[var(--text-1)] w-5 text-center">{item.qty}</span>
                    <button onClick={() => addItem({ id: item.id, name: item.name, price: item.price })} className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Cart totals */}
            <div className="px-5 py-4 border-t border-[var(--line-soft)]">
              <div className="flex justify-between text-sm text-[var(--text-2)] mb-1">
                <span>Subtotal</span><span>{formatMXN(totalPrice)}</span>
              </div>
              <div className="flex justify-between text-sm text-[var(--text-2)] mb-3">
                <span>IVA (16%)</span><span>{formatMXN(iva)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-[var(--text-1)] mb-4">
                <span>Total</span><span>{formatMXN(totalPrice + iva)}</span>
              </div>
              <button onClick={handleSend} disabled={sending}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white font-bold text-lg rounded-2xl transition-colors flex items-center justify-center gap-3">
                <Send size={20} />
                {sending ? 'Enviando...' : 'Enviar a cocina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notas modal */}
      {notasItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setNotasItem(null)}>
          <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--text-1)] mb-3">Nota para el platillo</h3>
            <textarea value={notasText} onChange={e => setNotasText(e.target.value)}
              placeholder="Sin cebolla, extra salsa, etc..."
              rows={3} autoFocus
              className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-emerald-500" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => { updateNotas(notasItem, notasText); setNotasItem(null) }}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold">Guardar</button>
              <button onClick={() => setNotasItem(null)}
                className="py-2.5 px-4 bg-[var(--surface-2)] text-[var(--text-2)] rounded-xl text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
