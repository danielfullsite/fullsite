'use client'

import { useState } from 'react'
import { Rocket, Check, Upload, Users, UtensilsCrossed, CreditCard, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [log, setLog] = useState<string[]>([])

  // Step 1: Client info
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientCity, setClientCity] = useState('Monterrey')

  // Step 2: Staff
  const [staffText, setStaffText] = useState('Admin,1234,admin\nGerente,5678,gerente')

  // Step 3: Menu CSV
  const [menuCsv, setMenuCsv] = useState('')
  const [menuFile, setMenuFile] = useState<File | null>(null)

  // Step 4: Payment methods
  const [payments, setPayments] = useState('Efectivo,cash\nTarjeta de credito,card\nTransferencia,other\nRappi,other\nUber Eats,other')

  const addLog = (msg: string) => setLog(prev => [...prev, msg])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setMenuFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setMenuCsv(ev.target?.result as string || '')
    reader.readAsText(file)
  }

  const runOnboarding = async () => {
    if (!clientId || !clientName) return
    setSaving(true)
    setLog([])
    const slug = clientId.toLowerCase().replace(/[^a-z0-9]/g, '-')

    // 1. Create client record
    addLog('Creando cliente...')
    await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: slug, name: clientName, city: clientCity, active: true }),
    }).catch(() => {})
    addLog(`Cliente "${clientName}" (${slug}) creado`)

    // 2. Create staff
    addLog('Creando staff...')
    const staffLines = staffText.split('\n').filter(l => l.trim())
    let staffCount = 0
    for (const line of staffLines) {
      const [name, pin, role] = line.split(',').map(s => s.trim())
      if (!name || !pin) continue
      await fetch(`${SUPABASE_URL}/rest/v1/pos_staff`, {
        method: 'POST', headers,
        body: JSON.stringify({
          id: `${slug}-${pin}`,
          client_id: slug,
          name,
          pin,
          role: role || 'mesero',
          active: true,
        }),
      }).catch(() => {})
      staffCount++
    }
    addLog(`${staffCount} staff creados`)

    // 3. Import menu from CSV
    if (menuCsv) {
      addLog('Importando menu...')
      const lines = menuCsv.split('\n').filter(l => l.trim())
      const headerLine = lines[0]
      const rows = lines.slice(1)

      // Detect columns: category, name, price
      const cols = headerLine.split(',').map(c => c.trim().toLowerCase())
      const catIdx = cols.findIndex(c => c.includes('categ') || c.includes('grupo'))
      const nameIdx = cols.findIndex(c => c.includes('nombre') || c.includes('name') || c.includes('producto'))
      const priceIdx = cols.findIndex(c => c.includes('precio') || c.includes('price'))

      if (nameIdx === -1 || priceIdx === -1) {
        addLog('ERROR: CSV debe tener columnas nombre/name y precio/price')
      } else {
        // Create categories
        const categories = new Set<string>()
        for (const row of rows) {
          const cells = row.split(',').map(c => c.trim())
          const cat = catIdx >= 0 ? cells[catIdx] : 'General'
          if (cat) categories.add(cat)
        }

        const catColors = ['bg-emerald-600', 'bg-blue-600', 'bg-purple-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-orange-600', 'bg-pink-600', 'bg-teal-600', 'bg-indigo-600']
        const catMap: Record<string, string> = {}
        let catIndex = 0
        for (const cat of categories) {
          const catId = `${slug}-${cat.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
          catMap[cat] = catId
          await fetch(`${SUPABASE_URL}/rest/v1/pos_menu_categories`, {
            method: 'POST', headers,
            body: JSON.stringify({
              id: catId,
              client_id: slug,
              name: cat,
              color: catColors[catIndex % catColors.length],
              sort_order: catIndex,
              active: true,
            }),
          }).catch(() => {})
          catIndex++
        }
        addLog(`${categories.size} categorias creadas`)

        // Create items
        let itemCount = 0
        for (const row of rows) {
          const cells = row.split(',').map(c => c.trim())
          const cat = catIdx >= 0 ? cells[catIdx] : 'General'
          const name = cells[nameIdx]
          const price = parseFloat(cells[priceIdx]) || 0
          if (!name) continue

          await fetch(`${SUPABASE_URL}/rest/v1/pos_menu_items`, {
            method: 'POST', headers,
            body: JSON.stringify({
              id: `${slug}-item-${itemCount}`,
              client_id: slug,
              category_id: catMap[cat] || Object.values(catMap)[0],
              name,
              price,
              active: true,
              sort_order: itemCount,
            }),
          }).catch(() => {})
          itemCount++
        }
        addLog(`${itemCount} items importados`)
      }
    } else {
      addLog('Sin menu CSV — se puede importar despues')
    }

    // 4. Payment methods
    addLog('Creando metodos de pago...')
    const payLines = payments.split('\n').filter(l => l.trim())
    let payCount = 0
    for (const line of payLines) {
      const [name, type] = line.split(',').map(s => s.trim())
      if (!name) continue
      await fetch(`${SUPABASE_URL}/rest/v1/pos_payment_methods`, {
        method: 'POST', headers,
        body: JSON.stringify({
          id: `${slug}-pay-${payCount}`,
          client_id: slug,
          name,
          type: type || 'other',
          active: true,
          sort_order: payCount,
        }),
      }).catch(() => {})
      payCount++
    }
    addLog(`${payCount} metodos de pago creados`)

    addLog('Onboarding completado!')
    setSaving(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check size={40} className="text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Onboarding completo!</h1>
          <p className="text-[var(--text-3)] mb-4">"{clientName}" esta listo para usar Fullsite</p>
          <div className="bg-[var(--surface-2)] rounded-xl p-4 text-left text-sm space-y-1 mb-6">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Check size={14} className="text-emerald-400 flex-shrink-0" />
                <span className="text-[var(--text-2)]">{l}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <a href={`/pos?client=${clientId}`} className="block w-full py-3 bg-emerald-600 text-white font-bold rounded-xl text-center">Abrir POS del cliente</a>
            <button onClick={() => { setDone(false); setStep(1); setLog([]) }} className="block w-full py-3 bg-[var(--line)] text-[var(--text-2)] font-medium rounded-xl">Onboardear otro cliente</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Rocket size={28} className="text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold">Onboarding — Nuevo Cliente</h1>
            <p className="text-[var(--text-3)] text-sm">Paso {step} de 4</p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`flex-1 h-2 rounded-full ${s <= step ? 'bg-emerald-500' : 'bg-[var(--line)]'}`} />
          ))}
        </div>

        {/* Step 1: Client */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Rocket size={20} className="text-emerald-400" />
              <h2 className="text-lg font-bold">Datos del cliente</h2>
            </div>
            <div>
              <label className="text-sm text-[var(--text-3)] block mb-1">ID del cliente (slug, sin espacios)</label>
              <input value={clientId} onChange={e => setClientId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="ej: noreste-grill" className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 text-lg" />
            </div>
            <div>
              <label className="text-sm text-[var(--text-3)] block mb-1">Nombre del restaurante</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)}
                placeholder="ej: Noreste Grill" className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 text-lg" />
            </div>
            <div>
              <label className="text-sm text-[var(--text-3)] block mb-1">Ciudad</label>
              <input value={clientCity} onChange={e => setClientCity(e.target.value)}
                placeholder="Monterrey" className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3" />
            </div>
          </div>
        )}

        {/* Step 2: Staff */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users size={20} className="text-blue-400" />
              <h2 className="text-lg font-bold">Staff y PINs</h2>
            </div>
            <p className="text-sm text-[var(--text-3)]">Un empleado por linea: nombre,PIN,rol (admin/gerente/cajero/mesero)</p>
            <textarea value={staffText} onChange={e => setStaffText(e.target.value)}
              rows={8} className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 font-mono text-sm" />
          </div>
        )}

        {/* Step 3: Menu */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <UtensilsCrossed size={20} className="text-amber-400" />
              <h2 className="text-lg font-bold">Menu (CSV)</h2>
            </div>
            <p className="text-sm text-[var(--text-3)]">Sube un CSV con columnas: categoria, nombre, precio. O pegalo directo.</p>
            <div className="border-2 border-dashed border-[var(--line)] rounded-xl p-6 text-center">
              <Upload size={32} className="mx-auto mb-2 text-[var(--text-3)]" />
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" id="csv-upload" />
              <label htmlFor="csv-upload" className="cursor-pointer text-emerald-400 font-medium">Click para subir CSV</label>
              {menuFile && <p className="text-sm text-[var(--text-3)] mt-2">{menuFile.name}</p>}
            </div>
            <p className="text-xs text-[var(--text-3)]">O pega el CSV aqui:</p>
            <textarea value={menuCsv} onChange={e => setMenuCsv(e.target.value)}
              rows={6} placeholder="categoria,nombre,precio&#10;Chilaquiles,Chilaquiles Rojos,195&#10;Coffee,Americano,48" className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 font-mono text-sm" />
            <p className="text-xs text-[var(--text-3)]">{menuCsv ? `${menuCsv.split('\n').filter(l => l.trim()).length - 1} items detectados` : 'Opcional — puedes importar despues'}</p>
          </div>
        )}

        {/* Step 4: Payment methods */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard size={20} className="text-purple-400" />
              <h2 className="text-lg font-bold">Metodos de pago</h2>
            </div>
            <p className="text-sm text-[var(--text-3)]">Un metodo por linea: nombre,tipo (cash/card/other)</p>
            <textarea value={payments} onChange={e => setPayments(e.target.value)}
              rows={6} className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 font-mono text-sm" />
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          <button onClick={() => setStep(s => s - 1)} disabled={step === 1}
            className="flex items-center gap-2 px-6 py-3 bg-[var(--line)] rounded-xl text-[var(--text-3)] disabled:opacity-30">
            <ArrowLeft size={18} /> Anterior
          </button>
          {step < 4 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={step === 1 && (!clientId || !clientName)}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl disabled:opacity-30">
              Siguiente <ArrowRight size={18} />
            </button>
          ) : (
            <button onClick={runOnboarding} disabled={saving}
              className="flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl disabled:opacity-50">
              {saving ? <><Loader2 size={18} className="animate-spin" /> Creando...</> : <><Rocket size={18} /> Crear cliente</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
