'use client'

import { useState, useRef } from 'react'
import { ArrowRight, ArrowLeft, Check, Store, Users, UtensilsCrossed, CreditCard, Rocket, Upload } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface RestaurantInfo {
  name: string
  city: string
  phone: string
  email: string
  tables: number
  timezone: string
}

interface StaffMember {
  name: string
  pin: string
  role: string
}

interface MenuItemInput {
  name: string
  price: string
  category: string
}

interface PaymentMethod {
  name: string
  type: string
  commission: string
}

const STEPS = [
  { id: 'info', label: 'Restaurante', icon: Store },
  { id: 'staff', label: 'Equipo', icon: Users },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { id: 'payments', label: 'Pagos', icon: CreditCard },
  { id: 'done', label: 'Listo', icon: Rocket },
]

const DEFAULT_CATEGORIES = [
  'Desayunos', 'Comida', 'Cena', 'Bebidas Calientes', 'Bebidas Frias',
  'Postres', 'Entradas', 'Ensaladas', 'Sopas', 'Extras',
]

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { name: 'Efectivo', type: 'cash', commission: '0' },
  { name: 'Tarjeta de credito', type: 'card', commission: '2.5' },
  { name: 'Tarjeta de debito', type: 'card', commission: '1.5' },
  { name: 'Transferencia', type: 'transfer', commission: '0' },
]

async function api(path: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1: Restaurant info
  const [info, setInfo] = useState<RestaurantInfo>({
    name: '', city: 'Monterrey', phone: '', email: '', tables: 10, timezone: 'America/Monterrey',
  })

  // Step 2: Staff
  const [staff, setStaff] = useState<StaffMember[]>([
    { name: '', pin: '', role: 'mesero' },
  ])

  // Step 3: Menu
  const [categories, setCategories] = useState<string[]>(['Desayunos', 'Bebidas'])
  const [newCat, setNewCat] = useState('')
  const [menuItems, setMenuItems] = useState<MenuItemInput[]>([
    { name: '', price: '', category: 'Desayunos' },
  ])

  // Step 4: Payments
  const [payments, setPayments] = useState<PaymentMethod[]>([...DEFAULT_PAYMENT_METHODS])

  // CSV upload
  const csvRef = useRef<HTMLInputElement>(null)
  const [csvCount, setCsvCount] = useState(0)

  const clientId = info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'nuevo'

  const canNext = () => {
    if (step === 0) return info.name.length > 0
    if (step === 1) return staff.some(s => s.name && s.pin)
    if (step === 2) return menuItems.some(i => i.name && i.price)
    if (step === 3) return payments.length > 0
    return true
  }

  const handleFinish = async () => {
    setSaving(true)
    setError('')
    try {
      // 1. Create client
      await api('clients', {
        id: clientId,
        display_name: info.name,
        city: info.city,
        phone: info.phone,
        email: info.email,
        timezone: info.timezone,
        tables_count: info.tables,
      })

      // 2. Create staff
      for (const s of staff.filter(s => s.name && s.pin)) {
        await api('pos_staff', {
          client_id: clientId,
          name: s.name,
          pin: s.pin,
          role: s.role,
          active: true,
        })
      }

      // 3. Create categories + items
      for (const cat of categories) {
        const catId = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        await api('pos_menu_categories', {
          id: `${clientId}-${catId}`,
          client_id: clientId,
          name: cat,
          color: 'bg-emerald-600',
          sort_order: categories.indexOf(cat),
          active: true,
        })
      }

      for (const item of menuItems.filter(i => i.name && i.price)) {
        const catId = item.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const itemId = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' + Date.now().toString(36)
        await api('pos_menu_items', {
          id: itemId,
          client_id: clientId,
          category_id: `${clientId}-${catId}`,
          name: item.name,
          price: Number(item.price),
          active: true,
        })
      }

      // 4. Create payment methods
      for (const pm of payments) {
        await api('pos_payment_methods', {
          client_id: clientId,
          name: pm.name,
          type: pm.type,
          commission_pct: Number(pm.commission),
          active: true,
        })
      }

      // 5. Create default location
      const locationId = `${clientId}-main`
      await api('client_locations', {
        id: locationId,
        client_id: clientId,
        name: info.name,
        address: info.city,
        active: true,
      }).catch(() => {}) // OK if table doesn't exist yet

      // 6. Create MESAS config based on table count
      // (MESAS_CONFIG in pos-data.ts is static, but the table count is saved in clients)

      // 7. Save clientId to localStorage for data.ts auto-resolution
      try {
        localStorage.setItem('fullsite_client_id', clientId)
      } catch {}

      setStep(4) // Done!
    } catch (err) {
      setError('Error guardando. Intenta de nuevo.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--surface-2)] flex flex-col">
      {/* Header */}
      <header className="bg-[var(--surface)] border-b border-[var(--line)] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <span className="font-black text-xl tracking-tight text-[var(--text-1)]">
            fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <span className="text-sm text-[var(--text-3)]">Configuración inicial</span>
        </div>
      </header>

      {/* Progress */}
      <div className="bg-[var(--surface)] border-b border-[var(--line-soft)] px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={s.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                i < step ? 'text-emerald-600' : i === step ? 'bg-emerald-500/10 text-emerald-700' : 'text-[var(--text-3)]'
              }`}>
                {i < step ? <Check size={14} /> : <Icon size={14} />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-8">
        <div className="max-w-xl mx-auto">

          {/* Step 0: Restaurant Info */}
          {step === 0 && (
            <div>
              <h2 className="text-2xl font-bold text-[var(--text-1)] mb-2">Tu restaurante</h2>
              <p className="text-[var(--text-2)] mb-6">Información basica para configurar tu cuenta.</p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Nombre del restaurante *</label>
                  <input value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })}
                    placeholder="Ej: Mi Cafe" autoFocus
                    className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Ciudad</label>
                    <input value={info.city} onChange={e => setInfo({ ...info, city: e.target.value })}
                      className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Mesas</label>
                    <input type="number" value={info.tables} onChange={e => setInfo({ ...info, tables: Number(e.target.value) })}
                      className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Teléfono</label>
                    <input value={info.phone} onChange={e => setInfo({ ...info, phone: e.target.value })}
                      placeholder="81 1234 5678"
                      className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Email</label>
                    <input value={info.email} onChange={e => setInfo({ ...info, email: e.target.value })}
                      className="w-full border border-[var(--line)] rounded-xl px-4 py-3 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Staff */}
          {step === 1 && (
            <div>
              <h2 className="text-2xl font-bold text-[var(--text-1)] mb-2">Tu equipo</h2>
              <p className="text-[var(--text-2)] mb-6">Agrega a tus meseros y cajeros. Cada uno tendra un PIN para entrar al POS.</p>
              <div className="space-y-3">
                {staff.map((s, i) => (
                  <div key={i} className="flex gap-3 items-center">
                    <input value={s.name} onChange={e => { const n = [...staff]; n[i].name = e.target.value; setStaff(n) }}
                      placeholder="Nombre" className="flex-1 border border-[var(--line)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                    <input value={s.pin} onChange={e => { const n = [...staff]; n[i].pin = e.target.value.replace(/\D/g, '').slice(0, 4); setStaff(n) }}
                      placeholder="PIN (4 dig)" maxLength={4}
                      className="w-28 border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-center font-mono focus:outline-none focus:border-emerald-500" />
                    <select value={s.role} onChange={e => { const n = [...staff]; n[i].role = e.target.value; setStaff(n) }}
                      className="w-32 border border-[var(--line)] rounded-xl px-3 py-3 text-sm">
                      <option value="mesero">Mesero</option>
                      <option value="cajero">Cajero</option>
                      <option value="cocina">Cocina</option>
                      <option value="barra">Barra</option>
                      <option value="gerente">Gerente</option>
                    </select>
                  </div>
                ))}
              </div>
              <button onClick={() => setStaff([...staff, { name: '', pin: '', role: 'mesero' }])}
                className="mt-4 text-sm text-emerald-600 font-semibold hover:text-emerald-700">
                + Agregar persona
              </button>
            </div>
          )}

          {/* Step 2: Menu */}
          {step === 2 && (
            <div>
              <h2 className="text-2xl font-bold text-[var(--text-1)] mb-2">Tu menu</h2>
              <p className="text-[var(--text-2)] mb-6">Agrega categorias y platillos. Puedes editar todo despues en /admin/menu.</p>

              {/* Categories */}
              <div className="mb-6">
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase mb-2 block">Categorias</label>
                <div className="flex gap-2 flex-wrap mb-3">
                  {categories.map(c => (
                    <span key={c} className="flex items-center gap-1 bg-emerald-500/10 text-emerald-700 px-3 py-1.5 rounded-lg text-sm font-medium">
                      {c}
                      <button onClick={() => setCategories(categories.filter(x => x !== c))} className="text-emerald-400 hover:text-red-500 ml-1">&times;</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newCat} onChange={e => setNewCat(e.target.value)}
                    placeholder="Nueva categoria" onKeyDown={e => { if (e.key === 'Enter' && newCat) { setCategories([...categories, newCat]); setNewCat('') } }}
                    className="flex-1 border border-[var(--line)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
                  <button onClick={() => { if (newCat) { setCategories([...categories, newCat]); setNewCat('') } }}
                    className="px-4 py-2.5 bg-[var(--surface-2)] text-[var(--text-2)] rounded-xl text-sm font-semibold">Agregar</button>
                </div>
                <div className="flex gap-1 flex-wrap mt-3">
                  {DEFAULT_CATEGORIES.filter(c => !categories.includes(c)).slice(0, 6).map(c => (
                    <button key={c} onClick={() => setCategories([...categories, c])}
                      className="text-xs text-[var(--text-3)] border border-[var(--line)] rounded-lg px-2 py-1 hover:border-emerald-300 hover:text-emerald-600">
                      + {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* CSV Upload */}
              <div className="mb-6 p-4 border-2 border-dashed border-[var(--line)] rounded-xl text-center hover:border-emerald-400 transition-colors">
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      const text = ev.target?.result as string
                      const lines = text.split('\n').filter(l => l.trim())
                      const parsed: MenuItemInput[] = []
                      for (const line of lines) {
                        const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
                        if (parts.length >= 2 && parts[0] && !isNaN(Number(parts[1]))) {
                          const cat = parts[2] || categories[0] || 'General'
                          if (cat && !categories.includes(cat)) setCategories(prev => [...prev, cat])
                          parsed.push({ name: parts[0], price: parts[1], category: cat })
                        }
                      }
                      if (parsed.length > 0) {
                        setMenuItems(prev => [...prev.filter(i => i.name), ...parsed])
                        setCsvCount(parsed.length)
                      }
                    }
                    reader.readAsText(file)
                  }}
                />
                <button onClick={() => csvRef.current?.click()} className="flex items-center gap-2 mx-auto text-sm text-emerald-600 font-semibold">
                  <Upload size={16} />
                  Subir CSV (nombre, precio, categoria)
                </button>
                <p className="text-xs text-[var(--text-3)] mt-2">Formato: nombre,precio,categoria — una fila por platillo</p>
                {csvCount > 0 && <p className="text-xs text-emerald-600 mt-2 font-semibold">{csvCount} platillos importados del CSV</p>}
              </div>

              {/* Items */}
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase mb-2 block">Platillos ({menuItems.filter(i => i.name).length})</label>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {menuItems.map((item, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={item.name} onChange={e => { const n = [...menuItems]; n[i].name = e.target.value; setMenuItems(n) }}
                      placeholder="Nombre del platillo" className="flex-1 border border-[var(--line)] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
                    <input type="number" value={item.price} onChange={e => { const n = [...menuItems]; n[i].price = e.target.value; setMenuItems(n) }}
                      placeholder="Precio" className="w-24 border border-[var(--line)] rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:border-emerald-500" />
                    <select value={item.category} onChange={e => { const n = [...menuItems]; n[i].category = e.target.value; setMenuItems(n) }}
                      className="w-32 border border-[var(--line)] rounded-xl px-2 py-2.5 text-sm">
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button onClick={() => setMenuItems([...menuItems, { name: '', price: '', category: categories[0] || '' }])}
                className="mt-3 text-sm text-emerald-600 font-semibold hover:text-emerald-700">
                + Agregar platillo
              </button>
            </div>
          )}

          {/* Step 3: Payments */}
          {step === 3 && (
            <div>
              <h2 className="text-2xl font-bold text-[var(--text-1)] mb-2">Métodos de pago</h2>
              <p className="text-[var(--text-2)] mb-6">Configura como cobras. Puedes editarlos despues en /admin/formas-pago.</p>
              <div className="space-y-3">
                {payments.map((pm, i) => (
                  <div key={i} className="flex gap-3 items-center bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3">
                    <span className="flex-1 text-sm font-medium text-[var(--text-1)]">{pm.name}</span>
                    <span className="text-xs text-[var(--text-3)] uppercase">{pm.type}</span>
                    <span className="text-sm text-[var(--text-2)]">{pm.commission}%</span>
                    <button onClick={() => setPayments(payments.filter((_, j) => j !== i))}
                      className="text-[var(--text-4)] hover:text-red-500">&times;</button>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-[var(--text-3)]">Estos son los métodos mas comunes. Puedes agregar mas despues.</p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-6">
                <Rocket size={36} className="text-emerald-600" />
              </div>
              <h2 className="text-3xl font-bold text-[var(--text-1)] mb-3">Todo listo</h2>
              <p className="text-[var(--text-2)] text-lg mb-2">{info.name} esta configurado.</p>
              <p className="text-[var(--text-3)] text-sm mb-8">
                {staff.filter(s => s.name).length} personas · {menuItems.filter(i => i.name).length} platillos · {payments.length} formas de pago
              </p>
              <div className="flex gap-4 justify-center">
                <a href="/pos" className="px-8 py-3.5 bg-emerald-600 text-white rounded-2xl font-semibold text-lg shadow-lg shadow-emerald-200">
                  Abrir POS
                </a>
                <a href="/admin/menu" className="px-8 py-3.5 bg-[var(--surface-2)] text-[var(--text-1)] rounded-2xl font-semibold text-lg">
                  Editar menu
                </a>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="mt-4 text-red-500 text-sm text-center">{error}</p>}
        </div>
      </div>

      {/* Footer nav */}
      {step < 4 && (
        <div className="bg-[var(--surface)] border-t border-[var(--line)] px-6 py-4">
          <div className="max-w-xl mx-auto flex justify-between">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
              className="flex items-center gap-2 px-4 py-2.5 text-[var(--text-2)] disabled:opacity-30 text-sm font-medium">
              <ArrowLeft size={16} /> Atras
            </button>
            {step < 3 ? (
              <button onClick={() => setStep(step + 1)} disabled={!canNext()}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 disabled:bg-[var(--line)] text-white disabled:text-[var(--text-3)] rounded-xl text-sm font-semibold">
                Siguiente <ArrowRight size={16} />
              </button>
            ) : (
              <button onClick={handleFinish} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 disabled:bg-emerald-300 text-white rounded-xl text-sm font-semibold">
                {saving ? 'Guardando...' : 'Crear restaurante'} <Rocket size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
