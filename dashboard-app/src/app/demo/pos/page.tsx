'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ChefHat, Minus, Plus, X, CreditCard, Banknote, Send, Clock, Users,
  Percent, StickyNote, Ban, Menu, ArrowLeft, Trophy, Target, Calculator, Heart,
} from 'lucide-react'
import { DEMO_MENU, DEMO_RESTAURANT, formatDemoMXN } from '@/lib/demo-data'

const IVA_RATE = 0.16

interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  subtotal: number
  modificadores: string[]
  notas: string
}

export default function DemoPOS() {
  const [selectedCategory, setSelectedCategory] = useState(DEMO_MENU[0].id)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mesa, setMesa] = useState(3)
  const [mesero, setMesero] = useState(DEMO_RESTAURANT.meseros[0])
  const [personas, setPersonas] = useState(2)
  const [showPayment, setShowPayment] = useState(false)
  const [showCashCalc, setShowCashCalc] = useState(false)
  const [cashReceived, setCashReceived] = useState('')
  const [propina, setPropina] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [sentToKitchen, setSentToKitchen] = useState(false)
  const [mobileView, setMobileView] = useState<'menu' | 'order'>('menu')
  const [showNav, setShowNav] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [clock] = useState(() => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))

  // Demo mesero leaderboard
  const [demoSales] = useState([
    { name: 'Carlos M.', total: 14200 },
    { name: 'Ana R.', total: 12100 },
    { name: 'Luis G.', total: 9800 },
  ])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const activeCategory = DEMO_MENU.find(c => c.id === selectedCategory) || DEMO_MENU[0]
  const subtotal = orderItems.reduce((s, i) => s + i.subtotal, 0)
  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const iva = subtotalAfterDiscount * IVA_RATE
  const total = subtotalAfterDiscount + iva

  const addItem = useCallback((item: { id: string; name: string; price: number }) => {
    setOrderItems(prev => {
      const existing = prev.find(i => i.menuItemId === item.id)
      if (existing) {
        return prev.map(i => i.menuItemId === item.id
          ? { ...i, cantidad: i.cantidad + 1, subtotal: i.precio * (i.cantidad + 1) }
          : i
        )
      }
      return [...prev, {
        id: `${Date.now()}-${item.id}`,
        menuItemId: item.id,
        nombre: item.name,
        precio: item.price,
        cantidad: 1,
        subtotal: item.price,
        modificadores: [],
        notas: '',
      }]
    })
    setMobileView('order')
  }, [])

  const updateQty = (id: string, delta: number) => {
    setOrderItems(prev => prev.map(i =>
      i.id === id ? { ...i, cantidad: Math.max(1, i.cantidad + delta), subtotal: i.precio * Math.max(1, i.cantidad + delta) } : i
    ))
  }

  const removeItem = (id: string) => {
    setOrderItems(prev => prev.filter(i => i.id !== id))
  }

  const handleSendToKitchen = () => {
    if (orderItems.length === 0) return
    setSentToKitchen(true)
    showToast('Orden enviada a cocina')
    setTimeout(() => setSentToKitchen(false), 2000)
  }

  const handlePayment = (method: string) => {
    showToast(`Cuenta cerrada — ${method}${propina > 0 ? ` + propina ${formatDemoMXN(propina)}` : ''}`)
    setOrderItems([])
    setDiscount(0)
    setPropina(0)
    setShowPayment(false)
    setShowCashCalc(false)
    setCashReceived('')
  }

  // Cash calculator
  const cashReceivedNum = Number(cashReceived) || 0
  const cashChange = cashReceivedNum - (total + propina)
  const DENOMS = [1000, 500, 200, 100, 50, 20]
  const getChange = (amount: number) => {
    if (amount <= 0) return []
    let rem = Math.round(amount * 100) / 100
    const r: { d: number; c: number }[] = []
    for (const d of DENOMS) { if (rem >= d) { const c = Math.floor(rem / d); r.push({ d, c }); rem = Math.round((rem - d * c) * 100) / 100 } }
    return r
  }

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden bg-[#0a0a0c]">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-3 py-2 bg-[#111114] border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowNav(!showNav)} className="w-12 h-12 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center">
            {showNav ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="font-black text-lg tracking-tight">
            fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
        </div>
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <span className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-lg text-xs font-medium">
            DEMO
          </span>
          <span>{clock}</span>
        </div>
      </header>

      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-64 bg-[#111114] border-r border-white/5 p-4 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-zinc-500 text-xs font-semibold uppercase mb-3">Demo — {DEMO_RESTAURANT.name}</p>
            <div className="space-y-1">
              <Link href="/demo/dashboard" onClick={() => setShowNav(false)} className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white">
                <ArrowLeft size={18} /> Dashboard
              </Link>
            </div>
            {/* Mini leaderboard */}
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={14} className="text-amber-400" />
                <span className="text-xs font-bold text-zinc-400">Ranking hoy</span>
              </div>
              {demoSales.map((m, i) => (
                <div key={m.name} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-zinc-400">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {m.name}</span>
                  <span className="font-bold text-emerald-400">{formatDemoMXN(m.total)}</span>
                </div>
              ))}
              {/* Meta */}
              <div className="mt-3 flex items-center gap-2">
                <Target size={12} className="text-emerald-400" />
                <span className="text-xs text-zinc-500">Meta: 60% completado</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full mt-1">
                <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: '60%' }} />
              </div>
            </div>
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      {/* Mesa / Mesero selector */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#111114]/50 border-b border-white/5">
        <select value={mesa} onChange={e => setMesa(Number(e.target.value))} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px]">
          {Array.from({ length: 20 }, (_, i) => <option key={i + 1} value={i + 1}>Mesa {i + 1}</option>)}
        </select>
        <select value={personas} onChange={e => setPersonas(Number(e.target.value))} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px]">
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} pers</option>)}
        </select>
        <select value={mesero} onChange={e => setMesero(e.target.value)} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px] flex-1">
          {DEMO_RESTAURANT.meseros.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {/* Mobile tab toggle */}
        <div className="flex md:hidden border border-white/10 rounded-xl overflow-hidden">
          <button onClick={() => setMobileView('order')} className={`px-3 py-2 text-xs font-bold ${mobileView === 'order' ? 'bg-emerald-500 text-white' : 'text-zinc-500'}`}>Orden</button>
          <button onClick={() => setMobileView('menu')} className={`px-3 py-2 text-xs font-bold ${mobileView === 'menu' ? 'bg-blue-500 text-white' : 'text-zinc-500'}`}>Menú</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — Order */}
        <div className={`md:w-[45%] md:flex flex-col border-r border-white/5 bg-[#0d0d10] ${mobileView === 'order' ? 'flex w-full' : 'hidden'}`}>
          <div className="px-4 py-2 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-lg font-bold">Mesa {mesa} <span className="text-zinc-500 text-sm font-normal">{personas} pers · {mesero.split(' ')[0]}</span></h2>
            <span className="text-emerald-400 font-bold text-xl">{formatDemoMXN(total)}</span>
          </div>

          {/* Customer memory demo */}
          <div className="px-4 py-1">
            {mesa === 3 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <Heart size={12} className="text-red-400" />
                <span className="text-xs font-bold text-red-400">Alergia a nuez — Cliente frecuente</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            {orderItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-600">
                <p className="text-lg">Toca un producto para agregar</p>
              </div>
            ) : (
              <div className="space-y-1">
                {orderItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 py-3 px-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updateQty(item.id, -1)} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Minus size={14} /></button>
                      <span className="font-bold text-base w-6 text-center">{item.cantidad}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Plus size={14} /></button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.nombre}</p>
                      <p className="text-zinc-500 text-sm">{formatDemoMXN(item.precio)} c/u</p>
                    </div>
                    <span className="font-semibold text-lg w-24 text-right">{formatDemoMXN(item.subtotal)}</span>
                    <button onClick={() => removeItem(item.id)} className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-white/5 px-4 py-3 bg-[#111114]/50">
            <div className="flex justify-between text-zinc-500 text-sm mb-1"><span>Subtotal</span><span>{formatDemoMXN(subtotal)}</span></div>
            {discount > 0 && <div className="flex justify-between text-red-400 text-sm mb-1"><span>Descuento</span><span>-{formatDemoMXN(discount)}</span></div>}
            <div className="flex justify-between text-zinc-500 text-sm mb-2"><span>IVA (16%)</span><span>{formatDemoMXN(iva)}</span></div>
            <div className="flex justify-between text-2xl font-bold"><span>Total</span><span>{formatDemoMXN(total)}</span></div>
          </div>

          {/* Buttons */}
          <div className="px-4 py-3 border-t border-white/5 flex gap-3">
            <button onClick={handleSendToKitchen} disabled={orderItems.length === 0} className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/5 disabled:text-zinc-600 text-white font-black py-5 rounded-2xl text-xl min-h-[64px]">
              <Send size={22} /> {sentToKitchen ? 'Enviado!' : 'Cocina'}
            </button>
            <button onClick={() => setShowPayment(true)} disabled={orderItems.length === 0} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-zinc-600 text-white font-black py-5 rounded-2xl text-xl min-h-[64px]">
              <CreditCard size={22} /> Cobrar
            </button>
          </div>
        </div>

        {/* Right — Menu */}
        <div className={`md:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`}>
          {/* Categories */}
          <div className="flex gap-2 px-3 py-2 overflow-x-auto flex-shrink-0 border-b border-white/5">
            {DEMO_MENU.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap min-h-[44px] transition-colors ${
                  selectedCategory === cat.id ? `${cat.color} text-white` : 'bg-white/5 text-zinc-500 hover:text-white'
                }`}
              >{cat.name}</button>
            ))}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {activeCategory.items.map(item => (
                <button key={item.id} onClick={() => addItem(item)}
                  className="bg-white/[0.02] hover:bg-white/[0.05] active:scale-[0.97] border border-white/5 hover:border-emerald-500/30 rounded-2xl text-left flex min-h-[90px] overflow-hidden shadow-sm transition-all"
                >
                  <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${activeCategory.color}`} />
                  <div className="flex flex-col justify-between px-4 py-4 flex-1">
                    <span className="font-bold text-base leading-snug">{item.name}</span>
                    <span className="text-emerald-400 font-bold text-lg mt-2">${item.price}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Cerrar cuenta</h3>
              <button onClick={() => { setShowPayment(false); setShowCashCalc(false) }} className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center"><X size={20} /></button>
            </div>

            <div className="text-center mb-4">
              <p className="text-zinc-500 text-sm">Mesa {mesa} · {mesero}</p>
              <p className="text-4xl font-bold">{formatDemoMXN(total)}</p>
            </div>

            {/* Propina */}
            <div className="mb-4">
              <p className="text-zinc-500 text-sm mb-2">Propina</p>
              <div className="flex gap-2">
                {[0, 10, 15, 20].map(pct => (
                  <button key={pct} onClick={() => setPropina(pct === 0 ? 0 : Math.round(total * pct / 100))}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${
                      (pct === 0 && propina === 0) || (pct > 0 && propina === Math.round(total * pct / 100))
                        ? 'bg-emerald-600 text-white' : 'bg-white/5 text-zinc-500'
                    }`}
                  >{pct === 0 ? 'Sin' : `${pct}%`}</button>
                ))}
              </div>
              {propina > 0 && <p className="text-emerald-400 text-sm mt-2 text-center">Total + propina: {formatDemoMXN(total + propina)}</p>}
            </div>

            <div className="space-y-3">
              <button onClick={() => handlePayment('Efectivo')} className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]">
                <Banknote size={24} /> Efectivo
              </button>

              {/* Cash calculator toggle */}
              <button onClick={() => setShowCashCalc(!showCashCalc)} className={`w-full text-center text-xs py-1.5 rounded-lg ${showCashCalc ? 'text-emerald-400' : 'text-zinc-500 hover:text-white'}`}>
                <Calculator size={12} className="inline mr-1" />{showCashCalc ? 'Ocultar calculadora' : 'Calcular cambio'}
              </button>

              {showCashCalc && (
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {[Math.ceil((total + propina) / 100) * 100, Math.ceil((total + propina) / 500) * 500, 1000].filter((v, i, a) => a.indexOf(v) === i).map(amt => (
                      <button key={amt} onClick={() => setCashReceived(String(amt))} className={`py-2 rounded-lg text-sm font-bold ${cashReceivedNum === amt ? 'bg-emerald-500 text-white' : 'bg-white/5 text-zinc-400'}`}>${amt}</button>
                    ))}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-bold">$</span>
                    <input type="number" inputMode="decimal" value={cashReceived} onChange={e => setCashReceived(e.target.value)} placeholder="Recibido" autoFocus
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-xl font-bold text-center focus:outline-none focus:border-emerald-500" />
                  </div>
                  {cashReceivedNum > 0 && cashChange >= 0 && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                      <p className="text-sm text-zinc-400">Cambio</p>
                      <p className="text-3xl font-black text-emerald-400">{formatDemoMXN(cashChange)}</p>
                      {cashChange > 0 && (
                        <div className="flex flex-wrap justify-center gap-2 mt-2">
                          {getChange(cashChange).map(({ d, c }) => (
                            <span key={d} className="text-xs bg-white/5 rounded px-2 py-1 font-bold">{c}×${d}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => handlePayment('Tarjeta de crédito')} className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]">
                <CreditCard size={24} /> Tarjeta
              </button>
              <button onClick={() => handlePayment('Transferencia')} className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]">
                <Send size={20} /> Transferencia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[#1a1a1f] border border-white/10 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
