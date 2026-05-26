'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import {
  ChefHat, Minus, Plus, X, CreditCard, Banknote, Send, Clock, Users,
  Percent, StickyNote, Ban, Menu, ArrowLeft, Trophy, Target, Calculator,
  Heart, AlertTriangle, ShieldAlert, Pencil, Package, Wifi, Monitor,
  TrendingUp, Flame, Star, Coffee, Zap, Grid3X3,
} from 'lucide-react'
import { DEMO_MENU, DEMO_RESTAURANT, DEMO_MESEROS, DEMO_INSIGHTS, formatDemoMXN } from '@/lib/demo-data'

const IVA_RATE = 0.16

interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  subtotal: number
  precioExtra: number
  modificadores: string[]
  notas: string
  cancelled?: boolean
}

// ─── Modifier Modal ─────────────────────────────────────────────────────────
function ModifierModal({ item, onConfirm, onCancel }: {
  item: { id: string; name: string; price: number }
  onConfirm: (oi: OrderItem) => void
  onCancel: () => void
}) {
  const [cantidad, setCantidad] = useState(1)
  const [notas, setNotas] = useState('')
  const [quitar, setQuitar] = useState<Set<string>>(new Set())
  const [agregar, setAgregar] = useState<Set<string>>(new Set())

  const quitarOpts = ['Sin cebolla', 'Sin chile', 'Sin crema', 'Sin queso', 'Sin aguacate', 'Sin salsa']
  const agregarOpts = [
    { name: 'Extra queso', price: 25 },
    { name: 'Extra aguacate', price: 35 },
    { name: 'Extra proteína', price: 45 },
    { name: 'Huevo extra', price: 20 },
  ]

  const precioExtra = agregarOpts.filter(a => agregar.has(a.name)).reduce((s, a) => s + a.price, 0)
  const subtotal = (item.price + precioExtra) * cantidad

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#111114] border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg">{item.name}</h3>
            <p className="text-emerald-400 font-bold">{formatDemoMXN(item.price)}</p>
          </div>
          <button onClick={onCancel} className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Cantidad */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Cantidad</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setCantidad(Math.max(1, cantidad - 1))} className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Minus size={16} /></button>
              <span className="text-xl font-bold w-8 text-center">{cantidad}</span>
              <button onClick={() => setCantidad(cantidad + 1)} className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Plus size={16} /></button>
            </div>
          </div>

          {/* Quitar */}
          <div>
            <p className="text-sm text-zinc-400 mb-2">Quitar</p>
            <div className="flex flex-wrap gap-2">
              {quitarOpts.map(q => (
                <button key={q} onClick={() => setQuitar(prev => { const n = new Set(prev); n.has(q) ? n.delete(q) : n.add(q); return n })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${quitar.has(q) ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-zinc-500 border border-white/5'}`}
                >{q}</button>
              ))}
            </div>
          </div>

          {/* Agregar */}
          <div>
            <p className="text-sm text-zinc-400 mb-2">Agregar</p>
            <div className="flex flex-wrap gap-2">
              {agregarOpts.map(a => (
                <button key={a.name} onClick={() => setAgregar(prev => { const n = new Set(prev); n.has(a.name) ? n.delete(a.name) : n.add(a.name); return n })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${agregar.has(a.name) ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-zinc-500 border border-white/5'}`}
                >{a.name} +${a.price}</button>
              ))}
            </div>
          </div>

          {/* Notas */}
          <div>
            <p className="text-sm text-zinc-400 mb-2">Notas</p>
            <input type="text" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Instrucciones especiales..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex justify-between items-center">
          <span className="text-xl font-bold text-emerald-400">{formatDemoMXN(subtotal)}</span>
          <button onClick={() => {
            const mods = [...Array.from(quitar), ...Array.from(agregar).map(a => { const opt = agregarOpts.find(o => o.name === a); return opt && opt.price > 0 ? `${a} +$${opt.price}` : a })]
            onConfirm({
              id: `${Date.now()}-${item.id}`, menuItemId: item.id, nombre: item.name,
              precio: item.price, cantidad, subtotal, precioExtra,
              modificadores: mods, notas, cancelled: false,
            })
          }} className="px-6 py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600">
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Cancel Item Modal ──────────────────────────────────────────────────────
function CancelModal({ itemName, onConfirm, onCancel }: { itemName: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const reasons = ['Cliente cambió de opinión', 'Error del mesero', 'Platillo agotado', 'Problema en cocina', 'Otro']

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#111114] border border-white/10 rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2"><ShieldAlert size={20} className="text-red-400" /> Cancelar item</h3>
        <p className="text-zinc-500 text-sm mb-4">{itemName}</p>
        <div className="space-y-2 mb-4">
          {reasons.map(r => (
            <button key={r} onClick={() => setReason(r)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${reason === r ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-zinc-400 border border-white/5'}`}
            >{r}</button>
          ))}
        </div>
        <div className="mb-4">
          <p className="text-sm text-zinc-400 mb-1">PIN de gerente</p>
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value)}
            placeholder="••••" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:border-red-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-white/10 text-zinc-500 text-sm">Volver</button>
          <button onClick={() => { if (reason && pin.length === 4) onConfirm(reason) }}
            disabled={!reason || pin.length < 4}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-30">Cancelar item</button>
        </div>
      </div>
    </div>
  )
}

// ─── Discount Modal ─────────────────────────────────────────────────────────
function DiscountModal({ subtotal, onApply, onClose }: { subtotal: number; onApply: (amount: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'pct' | 'fixed'>('pct')
  const [value, setValue] = useState('')
  const amount = mode === 'pct' ? subtotal * (Number(value) / 100) : Number(value) || 0
  const [pin, setPin] = useState('')

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#111114] border border-white/10 rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Percent size={18} className="text-amber-400" /> Aplicar descuento</h3>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('pct')} className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === 'pct' ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-500'}`}>Porcentaje %</button>
          <button onClick={() => setMode('fixed')} className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === 'fixed' ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-500'}`}>Monto fijo $</button>
        </div>
        {mode === 'pct' && (
          <div className="flex gap-2 mb-3">
            {[5, 10, 15, 20, 50].map(p => (
              <button key={p} onClick={() => setValue(String(p))} className={`flex-1 py-2 rounded-lg text-sm font-bold ${value === String(p) ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-zinc-500'}`}>{p}%</button>
            ))}
          </div>
        )}
        <input type="number" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)}
          placeholder={mode === 'pct' ? '% descuento' : '$ monto'}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-center text-xl font-bold mb-2 focus:outline-none focus:border-amber-500" />
        {amount > 0 && <p className="text-center text-amber-400 text-sm mb-3">Descuento: -{formatDemoMXN(Math.min(amount, subtotal))}</p>}
        <div className="mb-4">
          <p className="text-sm text-zinc-400 mb-1">PIN de gerente</p>
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value)}
            placeholder="••••" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:border-amber-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-white/10 text-zinc-500 text-sm">Cancelar</button>
          <button onClick={() => { if (amount > 0 && pin.length === 4) { onApply(Math.min(amount, subtotal)); onClose() } }}
            disabled={amount <= 0 || pin.length < 4}
            className="flex-1 py-2.5 rounded-lg bg-amber-500 text-black text-sm font-bold disabled:opacity-30">Aplicar</button>
        </div>
      </div>
    </div>
  )
}

// ─── AI Copilot ─────────────────────────────────────────────────────────────
function DemoCopilot({ items, personas }: { items: OrderItem[]; personas: number }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const suggestions: { id: string; type: string; title: string; desc: string }[] = []

  // No drink detection
  const hasDrink = items.some(i => ['café', 'latte', 'capuchino', 'jugo', 'smoothie', 'limonada', 'agua', 'mimosa', 'aperol', 'margarita'].some(kw => i.nombre.toLowerCase().includes(kw)))
  if (items.length > 0 && !hasDrink) suggestions.push({ id: 'drink', type: 'upsell', title: 'Sin bebida', desc: 'Sugiere un Café Americano ($55) o Limonada ($70)' })

  // No dessert
  const hasDessert = items.some(i => ['cheesecake', 'brownie', 'tiramisú', 'churros', 'crème'].some(kw => i.nombre.toLowerCase().includes(kw)))
  if (items.length >= 2 && !hasDessert) suggestions.push({ id: 'dessert', type: 'upsell', title: 'Oportunidad de postre', desc: 'Solo 14% de mesas piden postre. Sugiere Cheesecake NY ($145)' })

  // Low ticket
  const orderTotal = items.reduce((s, i) => s + i.subtotal, 0)
  if (items.length > 0 && personas > 0 && (orderTotal / personas) < 200) suggestions.push({ id: 'ticket', type: 'alert', title: 'Ticket bajo', desc: `${formatDemoMXN(Math.round(orderTotal / personas))}/persona — promedio es $520` })

  // Coffee upgrade
  if (items.some(i => i.nombre.toLowerCase().includes('americano'))) suggestions.push({ id: 'upgrade', type: 'upsell', title: 'Upgrade de café', desc: 'Sugiere Capuchino (+$25) o Latte (+$20)' })

  const visible = suggestions.filter(s => !dismissed.has(s.id)).slice(0, 3)
  if (visible.length === 0) return null

  return (
    <div className="space-y-1.5 mb-3">
      {visible.map(s => (
        <div key={s.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${
          s.type === 'upsell' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' :
          s.type === 'alert' ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' :
          'bg-blue-500/5 border-blue-500/20 text-blue-400'
        }`}>
          <Zap size={12} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-bold">{s.title}</p>
            <p className="opacity-80">{s.desc}</p>
          </div>
          <button onClick={() => setDismissed(prev => new Set(prev).add(s.id))} className="p-0.5 hover:opacity-50"><X size={10} /></button>
        </div>
      ))}
    </div>
  )
}

// ─── Main POS ───────────────────────────────────────────────────────────────
export default function DemoPOS() {
  const [selectedCategory, setSelectedCategory] = useState(DEMO_MENU[0].id)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [mesa, setMesa] = useState(3)
  const [mesero, setMesero] = useState(DEMO_RESTAURANT.meseros[0])
  const [personas, setPersonas] = useState(2)
  const [showPayment, setShowPayment] = useState(false)
  const [showCashCalc, setShowCashCalc] = useState(false)
  const [showMixto, setShowMixto] = useState(false)
  const [mixtoEfectivo, setMixtoEfectivo] = useState('')
  const [cashReceived, setCashReceived] = useState('')
  const [propina, setPropina] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [sentToKitchen, setSentToKitchen] = useState(false)
  const [mobileView, setMobileView] = useState<'menu' | 'order'>('menu')
  const [showNav, setShowNav] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)
  const [showVoidOrder, setShowVoidOrder] = useState(false)
  const [cancellingItem, setCancellingItem] = useState<OrderItem | null>(null)
  const [modifierItem, setModifierItem] = useState<{ id: string; name: string; price: number } | null>(null)
  const [orderNotes, setOrderNotes] = useState('')
  const [menuSearch, setMenuSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [clock, setClock] = useState('')
  const [readyOrders, setReadyOrders] = useState(0)
  const [saving, setSaving] = useState(false)

  // Simulated kitchen ready orders
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
      if (Math.random() > 0.8) setReadyOrders(prev => Math.min(prev + 1, 5))
    }, 10000)
    setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
    return () => clearInterval(t)
  }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const activeCategory = DEMO_MENU.find(c => c.id === selectedCategory) || DEMO_MENU[0]
  const activeItems = orderItems.filter(i => !i.cancelled)
  const subtotal = activeItems.reduce((s, i) => s + i.subtotal, 0)
  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const iva = subtotalAfterDiscount * IVA_RATE
  const total = subtotalAfterDiscount + iva

  const handleModifierConfirm = useCallback((oi: OrderItem) => {
    setOrderItems(prev => [...prev, oi])
    setModifierItem(null)
    setMobileView('order')
  }, [])

  const updateQty = (id: string, delta: number) => {
    setOrderItems(prev => prev.map(i =>
      i.id === id ? { ...i, cantidad: Math.max(1, i.cantidad + delta), subtotal: (i.precio + i.precioExtra) * Math.max(1, i.cantidad + delta) } : i
    ))
  }

  const handleSendToKitchen = () => {
    if (activeItems.length === 0 || saving) return
    setSaving(true)
    setTimeout(() => {
      setSentToKitchen(true)
      showToast('Orden enviada a cocina')
      setSaving(false)
      setTimeout(() => setSentToKitchen(false), 2000)
    }, 500)
  }

  const handlePayment = (method: string) => {
    let notes = orderNotes || ''
    if (method === 'Mixto') {
      const ef = parseFloat(mixtoEfectivo) || 0
      const ta = Math.max(0, total - ef)
      notes = `Mixto: Efectivo ${formatDemoMXN(ef)} + Tarjeta ${formatDemoMXN(ta)}${notes ? ' | ' + notes : ''}`
    }
    showToast(`Cuenta cerrada — ${method}${propina > 0 ? ` + propina ${formatDemoMXN(propina)}` : ''}`)
    setOrderItems([])
    setDiscount(0)
    setPropina(0)
    setOrderNotes('')
    setShowPayment(false)
    setShowCashCalc(false)
    setShowMixto(false)
    setMixtoEfectivo('')
    setCashReceived('')
  }

  // Cash calculator
  const cashReceivedNum = Number(cashReceived) || 0
  const cashChange = cashReceivedNum - (total + propina)
  const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5]
  const getChange = (amount: number) => {
    if (amount <= 0) return []
    let rem = Math.round(amount * 100) / 100
    const r: { d: number; c: number }[] = []
    for (const d of DENOMS) { if (rem >= d) { const c = Math.floor(rem / d); r.push({ d, c }); rem = Math.round((rem - d * c) * 100) / 100 } }
    return r
  }

  // Simulated out-of-stock
  const outOfStock = new Set(['ca6', 'ma4']) // Costillas BBQ, Atún Sellado

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden bg-[#0a0a0c]">
      {/* Top Bar */}
      <header className="flex flex-col bg-[#111114] border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowNav(!showNav)} className="w-12 h-12 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center">
              {showNav ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span className="font-black text-lg tracking-tight">fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" /></span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500">
            {/* Online indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400">
              <Wifi size={14} /> Online
            </div>
            {readyOrders > 0 && (
              <div className="flex items-center gap-1 bg-emerald-600 text-white px-2 py-1 rounded-full text-xs font-bold animate-pulse">
                {readyOrders} listas
              </div>
            )}
            <span className="text-sm bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-lg text-xs font-medium">DEMO</span>
            <span className="text-sm">{clock}</span>
          </div>
        </div>

        {/* Mesa / Mesero selector */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5">
          <select value={mesa} onChange={e => setMesa(Number(e.target.value))} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px]">
            {Array.from({ length: DEMO_RESTAURANT.mesas }, (_, i) => <option key={i + 1} value={i + 1}>Mesa {i + 1}</option>)}
          </select>
          <select value={personas} onChange={e => setPersonas(Number(e.target.value))} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px]">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} pers</option>)}
          </select>
          <select value={mesero} onChange={e => setMesero(e.target.value)} className="bg-white/5 rounded-xl px-3 py-2.5 text-sm border border-white/10 min-h-[44px] flex-1">
            {DEMO_RESTAURANT.meseros.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex md:hidden border border-white/10 rounded-xl overflow-hidden">
            <button onClick={() => setMobileView('order')} className={`px-3 py-2 text-xs font-bold ${mobileView === 'order' ? 'bg-emerald-500 text-white' : 'text-zinc-500'}`}>Orden</button>
            <button onClick={() => setMobileView('menu')} className={`px-3 py-2 text-xs font-bold ${mobileView === 'menu' ? 'bg-blue-500 text-white' : 'text-zinc-500'}`}>Menú</button>
          </div>
        </div>
      </header>

      {/* Nav overlay */}
      {showNav && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setShowNav(false)}>
          <div className="w-72 bg-[#111114] border-r border-white/5 p-4 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-zinc-500 text-xs font-semibold uppercase mb-3">Casa Montaña · Demo</p>
            <div className="space-y-1">
              {[
                { icon: Grid3X3, label: 'Mesas' },
                { icon: ChefHat, label: 'Cocina' },
                { icon: Monitor, label: 'KDS Tablet' },
                { icon: Coffee, label: 'Barra' },
                { icon: Package, label: 'Inventario' },
                { icon: Clock, label: 'Turnos' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-500 cursor-default">
                  <item.icon size={18} />
                  <span className="text-sm">{item.label}</span>
                  <span className="ml-auto text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-zinc-600">demo</span>
                </div>
              ))}
              <Link href="/demo/dashboard" onClick={() => setShowNav(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white">
                <ArrowLeft size={18} /> Dashboard
              </Link>
            </div>

            {/* Leaderboard in nav */}
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={14} className="text-amber-400" />
                <span className="text-xs font-bold text-zinc-400">Ranking hoy</span>
              </div>
              {DEMO_MESEROS.slice(0, 5).map((m, i) => (
                <div key={m.nombre} className={`flex items-center justify-between py-1.5 text-xs ${m.nombre === mesero ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`} {m.nombre.split(' ')[0]}</span>
                  <span className="font-bold">{formatDemoMXN(m.total)}</span>
                </div>
              ))}
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target size={12} className="text-emerald-400" />
                  <span className="text-xs text-zinc-500">Meta: $50,000</span>
                  <span className="text-xs font-bold text-emerald-400">77%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full">
                  <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: '77%' }} />
                </div>
              </div>

              {/* Kitchen timer */}
              <div className="mt-4 pt-3 border-t border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <ChefHat size={14} className="text-amber-400" />
                  <span className="text-xs font-bold text-zinc-400">Cocina en vivo</span>
                </div>
                {[
                  { mesa: 7, status: 'PREP', mins: 8 },
                  { mesa: 12, status: 'NUEVA', mins: 2 },
                  { mesa: 5, status: 'PREP', mins: 14 },
                ].map(o => (
                  <div key={o.mesa} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-zinc-400">Mesa {o.mesa} <span className={o.status === 'NUEVA' ? 'text-white' : 'text-amber-400'}>{o.status}</span></span>
                    <span className={`font-mono font-bold ${o.mins > 12 ? 'text-amber-400' : 'text-emerald-400'}`}>{o.mins}m</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left — Order */}
        <div className={`md:w-[45%] md:flex flex-col border-r border-white/5 bg-[#0d0d10] ${mobileView === 'order' ? 'flex w-full' : 'hidden'}`}>
          <div className="px-4 py-2 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-lg font-bold">Mesa {mesa} <span className="text-zinc-500 text-sm font-normal">{personas} pers · {mesero.split(' ')[0]}</span></h2>
            <span className="text-emerald-400 font-bold text-xl">{formatDemoMXN(total)}</span>
          </div>

          {/* Customer memory */}
          <div className="px-4 py-1">
            {mesa === 3 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={12} className="text-red-400" />
                <span className="text-xs font-bold text-red-400">Alergia a nuez — Cliente frecuente</span>
              </div>
            )}
            {mesa === 7 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Star size={12} className="text-amber-400" />
                <span className="text-xs font-bold text-amber-400">VIP — Siempre pide Rib Eye término medio</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2">
            {/* AI Copilot */}
            <DemoCopilot items={activeItems} personas={personas} />

            {activeItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-600">
                <p className="text-lg">Toca un producto para agregar</p>
              </div>
            ) : (
              <div className="space-y-1">
                {orderItems.map(item => (
                  <div key={item.id} className={`flex items-center gap-3 py-3 px-3 rounded-lg transition-all ${
                    item.cancelled ? 'bg-red-500/5 border border-red-500/10 opacity-50' : 'bg-white/[0.02] border border-white/5'
                  }`}>
                    {!item.cancelled && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => updateQty(item.id, -1)} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Minus size={14} /></button>
                        <span className="font-bold text-base w-6 text-center">{item.cantidad}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"><Plus size={14} /></button>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm truncate ${item.cancelled ? 'line-through text-red-400' : ''}`}>{item.nombre}</p>
                      {item.modificadores.length > 0 && <p className="text-zinc-500 text-xs truncate">{item.modificadores.join(' · ')}</p>}
                      {item.notas && <p className="text-zinc-600 text-xs italic">{item.notas}</p>}
                      {item.cancelled && <p className="text-red-500 text-xs font-bold">CANCELADO</p>}
                    </div>
                    <span className={`font-semibold text-lg w-24 text-right ${item.cancelled ? 'line-through text-red-400/50' : ''}`}>{formatDemoMXN(item.subtotal)}</span>
                    {!item.cancelled && (
                      <button onClick={() => setCancellingItem(item)} className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center"><Ban size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-white/5 px-4 py-3 bg-[#111114]/50">
            <div className="flex gap-2 mb-3">
              <button onClick={() => setShowDiscount(true)} disabled={activeItems.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-zinc-400 text-sm min-h-[40px]">
                <Percent size={14} /> {discount > 0 ? `Descuento: -${formatDemoMXN(discount)}` : 'Descuento'}
              </button>
              {discount > 0 && <button onClick={() => setDiscount(0)} className="px-2 py-2 rounded-lg bg-red-500/10 text-red-500"><X size={14} /></button>}
              <button onClick={() => setShowVoidOrder(true)} disabled={activeItems.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/20 hover:bg-red-900/40 disabled:opacity-30 text-red-400 text-sm ml-auto min-h-[40px]">
                <ShieldAlert size={14} /> Anular
              </button>
            </div>

            <div className="mb-2">
              <input type="text" value={orderNotes} onChange={e => setOrderNotes(e.target.value)} placeholder="Nota de la orden..."
                className="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-400 placeholder-zinc-700 focus:outline-none focus:border-emerald-500/50" />
            </div>

            <div className="flex justify-between text-zinc-500 text-sm mb-1"><span>Subtotal</span><span>{formatDemoMXN(subtotal)}</span></div>
            {discount > 0 && <div className="flex justify-between text-red-400 text-sm mb-1"><span>Descuento</span><span>-{formatDemoMXN(discount)}</span></div>}
            <div className="flex justify-between text-zinc-500 text-sm mb-2"><span>IVA (16%)</span><span>{formatDemoMXN(iva)}</span></div>
            <div className="flex justify-between text-2xl font-bold"><span>Total</span><span>{formatDemoMXN(total)}</span></div>
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 border-t border-white/5 flex gap-3">
            <button onClick={handleSendToKitchen} disabled={activeItems.length === 0 || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/5 disabled:text-zinc-600 text-white font-black py-5 rounded-2xl text-xl min-h-[64px]">
              <Send size={22} /> {saving ? 'Enviando...' : sentToKitchen ? 'Enviado!' : 'Cocina'}
            </button>
            <button onClick={() => { setShowPayment(true); setShowCashCalc(false); setShowMixto(false) }} disabled={activeItems.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-zinc-600 text-white font-black py-5 rounded-2xl text-xl min-h-[64px]">
              <CreditCard size={22} /> Cobrar
            </button>
          </div>
        </div>

        {/* Right — Menu */}
        <div className={`md:w-[55%] md:flex flex-col ${mobileView === 'menu' ? 'flex w-full' : 'hidden'}`}>
          {/* Search */}
          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <input type="text" value={menuSearch} onChange={e => setMenuSearch(e.target.value)} placeholder="Buscar platillo..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3.5 text-sm placeholder-zinc-600 focus:outline-none focus:border-emerald-500 min-h-[50px]" />
          </div>

          {menuSearch.trim() ? (
            <div className="flex-1 overflow-y-auto p-3">
              {(() => {
                const term = menuSearch.toLowerCase()
                const results: { item: { id: string; name: string; price: number }; catName: string; catId: string; catColor: string }[] = []
                for (const cat of DEMO_MENU) {
                  for (const item of cat.items) {
                    if (item.name.toLowerCase().includes(term)) results.push({ item, catName: cat.name, catId: cat.id, catColor: cat.color })
                  }
                }
                if (results.length === 0) return <p className="text-zinc-600 text-center py-8">Sin resultados para &ldquo;{menuSearch}&rdquo;</p>
                return (
                  <div className="space-y-2">
                    {results.map(({ item, catName, catColor }) => (
                      <button key={item.id} onClick={() => { setModifierItem(item); setMenuSearch('') }}
                        className="w-full bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-lg text-left flex items-center min-h-[48px] overflow-hidden">
                        <div className={`w-1.5 self-stretch ${catColor}`} />
                        <div className="flex items-center justify-between flex-1 px-3 py-2">
                          <div><span className="font-semibold text-sm">{item.name}</span> <span className="text-zinc-600 text-xs ml-1">{catName}</span></div>
                          <span className="text-emerald-400 font-bold">${item.price}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          ) : (
            <>
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
                  {activeCategory.items.map(item => {
                    const isOOS = outOfStock.has(item.id)
                    return (
                      <button key={item.id} onClick={() => { if (isOOS) { showToast(`${item.name} — AGOTADO`); return } setModifierItem(item) }}
                        className={`bg-white/[0.02] hover:bg-white/[0.05] active:scale-[0.97] border rounded-2xl text-left flex min-h-[90px] overflow-hidden shadow-sm transition-all ${
                          isOOS ? 'border-red-500/30 opacity-50' : 'border-white/5 hover:border-emerald-500/30'
                        }`}>
                        <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${isOOS ? 'bg-red-500' : activeCategory.color}`} />
                        {isOOS && <span className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md">Agotado</span>}
                        <div className="flex flex-col justify-between px-4 py-4 flex-1 relative">
                          <span className={`font-bold text-base leading-snug ${isOOS ? 'text-zinc-600 line-through' : ''}`}>{item.name}</span>
                          <span className={`font-bold text-lg mt-2 ${isOOS ? 'text-red-400' : 'text-emerald-400'}`}>${item.price}</span>
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

      {/* Modals */}
      {modifierItem && <ModifierModal item={modifierItem} onConfirm={handleModifierConfirm} onCancel={() => setModifierItem(null)} />}
      {cancellingItem && <CancelModal itemName={cancellingItem.nombre} onConfirm={(reason) => {
        setOrderItems(prev => prev.map(i => i.id === cancellingItem.id ? { ...i, cancelled: true } : i))
        setCancellingItem(null)
        showToast(`${cancellingItem.nombre} cancelado`)
      }} onCancel={() => setCancellingItem(null)} />}
      {showDiscount && <DiscountModal subtotal={subtotal} onApply={setDiscount} onClose={() => setShowDiscount(false)} />}
      {showVoidOrder && (
        <CancelModal itemName="TODA LA ORDEN" onConfirm={() => {
          setOrderItems([])
          setDiscount(0)
          setOrderNotes('')
          setShowVoidOrder(false)
          showToast('Orden anulada')
        }} onCancel={() => setShowVoidOrder(false)} />
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Cerrar cuenta</h3>
              <button onClick={() => { setShowPayment(false); setShowMixto(false) }} className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center"><X size={20} /></button>
            </div>

            <div className="text-center mb-4">
              <p className="text-zinc-500 text-sm">Mesa {mesa} · {mesero}</p>
              <p className="text-4xl font-bold">{formatDemoMXN(total)}</p>
              {discount > 0 && <p className="text-red-400 text-sm mt-1">Descuento: -{formatDemoMXN(discount)}</p>}
            </div>

            {/* Propina */}
            <div className="mb-4">
              <p className="text-zinc-500 text-sm mb-2">Propina</p>
              <div className="flex gap-2">
                {[0, 10, 15, 20].map(pct => (
                  <button key={pct} onClick={() => setPropina(pct === 0 ? 0 : Math.round(total * pct / 100))}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${(pct === 0 && propina === 0) || (pct > 0 && propina === Math.round(total * pct / 100)) ? 'bg-emerald-600 text-white' : 'bg-white/5 text-zinc-500'}`}
                  >{pct === 0 ? 'Sin' : `${pct}%`}</button>
                ))}
                <input type="number" inputMode="numeric" value={propina || ''} onChange={e => setPropina(Number(e.target.value) || 0)}
                  placeholder="$" className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-2.5 text-sm text-center focus:outline-none focus:border-emerald-500" />
              </div>
              {propina > 0 && <p className="text-emerald-400 text-sm mt-2 text-center">Total + propina: {formatDemoMXN(total + propina)}</p>}
            </div>

            <div className="space-y-3">
              <button onClick={() => handlePayment('Efectivo')} className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]"><Banknote size={24} /> Efectivo</button>

              <button onClick={() => setShowCashCalc(!showCashCalc)} className={`w-full text-center text-xs py-1.5 rounded-lg ${showCashCalc ? 'text-emerald-400' : 'text-zinc-500'}`}>
                <Calculator size={12} className="inline mr-1" />{showCashCalc ? 'Ocultar calculadora' : 'Calcular cambio'}
              </button>
              {showCashCalc && (
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {[Math.ceil((total + propina) / 100) * 100, Math.ceil((total + propina) / 500) * 500, 1000].filter((v, i, a) => a.indexOf(v) === i && v >= total + propina).map(amt => (
                      <button key={amt} onClick={() => setCashReceived(String(amt))} className={`py-2 rounded-lg text-sm font-bold ${cashReceivedNum === amt ? 'bg-emerald-500 text-white' : 'bg-white/5 text-zinc-400'}`}>${amt.toLocaleString()}</button>
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
                          {getChange(cashChange).map(({ d, c }) => <span key={d} className="text-xs bg-white/5 rounded px-2 py-1 font-bold">{c}×${d}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => handlePayment('Tarjeta de crédito')} className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]"><CreditCard size={24} /> Tarjeta</button>
              <button onClick={() => handlePayment('Transferencia')} className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl text-lg min-h-[56px]"><Send size={20} /> Transferencia</button>

              <button onClick={() => { setShowMixto(!showMixto); setMixtoEfectivo('') }}
                className={`w-full flex items-center justify-center gap-3 ${showMixto ? 'bg-amber-600 text-white' : 'bg-white/5 text-zinc-400'} font-semibold py-3 rounded-xl text-base min-h-[48px]`}>
                Mixto (efectivo + tarjeta)
              </button>
              {showMixto && (
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Efectivo:</span>
                    <input type="number" inputMode="decimal" value={mixtoEfectivo} onChange={e => setMixtoEfectivo(e.target.value)} placeholder="$0"
                      className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-amber-500" autoFocus />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Tarjeta:</span>
                    <span className="text-sm font-medium">{formatDemoMXN(Math.max(0, total - (parseFloat(mixtoEfectivo) || 0)))}</span>
                  </div>
                  <button onClick={() => handlePayment('Mixto')} disabled={(parseFloat(mixtoEfectivo) || 0) <= 0}
                    className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white font-semibold py-3 rounded-xl">Confirmar mixto</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[#1a1a1f] border border-white/10 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">{toast}</div>
      )}
    </div>
  )
}
