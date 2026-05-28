'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Save, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface PaymentMethod {
  id?: string
  name: string
  type: 'cash' | 'card' | 'transfer' | 'platform'
  commission_pct: number
  fiscal_code: string
  active: boolean
  client_id?: string
}

const TYPES = ['cash', 'card', 'transfer', 'platform'] as const
const TYPE_LABELS: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', platform: 'Plataforma' }
const empty: PaymentMethod = { name: '', type: 'cash', commission_pct: 0, fiscal_code: '', active: true }

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts?.headers },
  })
  return res.ok ? res.json() : []
}

export default function FormasPagoPage() {
  const CLIENT_ID = useClientId()
  const [items, setItems] = useState<PaymentMethod[]>([])
  const [modal, setModal] = useState<PaymentMethod | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const data = await api(`pos_payment_methods?client_id=eq.${CLIENT_ID}&order=name`)
    setItems(data)
  }
  useEffect(() => { load() }, [CLIENT_ID])

  const handleSave = async () => {
    if (!modal || !modal.name) return
    const body = { ...modal, client_id: CLIENT_ID }
    delete body.id
    if (isNew) {
      await api('pos_payment_methods', { method: 'POST', body: JSON.stringify(body) })
      showToast(`${modal.name} agregado`)
    } else {
      await api(`pos_payment_methods?id=eq.${modal.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`${modal.name} actualizado`)
    }
    setModal(null)
    load()
  }

  const toggleActive = async (item: PaymentMethod) => {
    await api(`pos_payment_methods?id=eq.${item.id}`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) })
    showToast(`${item.name} ${item.active ? 'desactivado' : 'activado'}`)
    load()
  }

  const commColor = (pct: number) => pct < 5 ? 'bg-emerald-500/15 text-emerald-400' : pct <= 20 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Formas de Pago" subtitle={`${items.length} métodos configurados`}
        action={<button onClick={() => { setModal({ ...empty }); setIsNew(true) }}
          className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
          <Plus size={16} /> Agregar
        </button>} />

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Nombre</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Tipo</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Comision</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Codigo Fiscal</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Estado</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${!item.active ? 'opacity-40' : ''}`}>
                <td className="px-5 py-3 text-sm font-medium text-[var(--text-1)]">{item.name}</td>
                <td className="px-5 py-3 text-sm text-[var(--text-2)]">{TYPE_LABELS[item.type] || item.type}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${commColor(item.commission_pct)}`}>
                    {item.commission_pct}%
                  </span>
                </td>
                <td className="px-5 py-3 text-sm text-[var(--text-2)] font-mono">{item.fiscal_code || '---'}</td>
                <td className="px-5 py-3 text-center">
                  <button onClick={() => toggleActive(item)}
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${item.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setModal({ ...item }); setIsNew(false) }}
                    className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] inline-flex items-center justify-center">
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-[var(--text-3)]">No hay formas de pago configuradas</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-[var(--surface)] rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--text-1)] mb-4">{isNew ? 'Nueva forma de pago' : 'Editar forma de pago'}</h3>
            <div className="space-y-3">
              <input value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })}
                placeholder="Nombre" className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
              <select value={modal.type} onChange={e => setModal({ ...modal, type: e.target.value as PaymentMethod['type'] })}
                className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm">
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              <div>
                <label className="text-xs text-[var(--text-2)] mb-1 block">Comision (%)</label>
                <input type="number" step="0.1" value={modal.commission_pct}
                  onChange={e => setModal({ ...modal, commission_pct: Number(e.target.value) })}
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <input value={modal.fiscal_code} onChange={e => setModal({ ...modal, fiscal_code: e.target.value })}
                placeholder="Codigo fiscal (SAT)" className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSave}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1">
                <Save size={14} /> Guardar
              </button>
              <button onClick={() => setModal(null)}
                className="px-4 py-2.5 bg-[var(--line)] hover:bg-slate-300 text-[var(--text-2)] rounded-xl text-sm flex items-center gap-1">
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-2)] text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-medium">
          {toast}
        </div>
      )}
    </div>
  )
}
