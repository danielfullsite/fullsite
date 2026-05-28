'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Pencil, Save, X, MapPin, Clock, DollarSign } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface DeliveryZone {
  id?: string
  name: string
  postal_codes: string
  delivery_fee: number
  min_order: number
  estimated_minutes: number
  active: boolean
  client_id?: string
}

const empty: DeliveryZone = { name: '', postal_codes: '', delivery_fee: 0, min_order: 0, estimated_minutes: 30, active: true }

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts?.headers },
  })
  return res.ok ? res.json() : []
}

export default function DomicilioPage() {
  const CLIENT_ID = useClientId()
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [modal, setModal] = useState<DeliveryZone | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    const data = await api(`pos_delivery_zones?client_id=eq.${CLIENT_ID}&order=name`)
    setZones(data)
  }
  useEffect(() => { load() }, [CLIENT_ID])

  const handleSave = async () => {
    if (!modal || !modal.name) return
    const body = { ...modal, client_id: CLIENT_ID }
    delete body.id
    if (isNew) {
      await api('pos_delivery_zones', { method: 'POST', body: JSON.stringify(body) })
      showToast(`Zona "${modal.name}" agregada`)
    } else {
      await api(`pos_delivery_zones?id=eq.${modal.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`Zona "${modal.name}" actualizada`)
    }
    setModal(null)
    load()
  }

  const toggleActive = async (zone: DeliveryZone) => {
    await api(`pos_delivery_zones?id=eq.${zone.id}`, { method: 'PATCH', body: JSON.stringify({ active: !zone.active }) })
    showToast(`${zone.name} ${zone.active ? 'desactivada' : 'activada'}`)
    load()
  }

  const cpCount = (codes: string) => codes ? codes.split(',').filter(c => c.trim()).length : 0

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Zonas de Domicilio" subtitle={`${zones.length} zonas configuradas`}
        action={<button onClick={() => { setModal({ ...empty }); setIsNew(true) }}
          className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm">
          <Plus size={16} /> Agregar zona
        </button>} />

      {zones.length === 0 ? (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-10 text-center text-sm text-[var(--text-3)]">
          No hay zonas de delivery configuradas
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {zones.map(zone => (
            <div key={zone.id} className={`bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm p-5 ${!zone.active ? 'opacity-40' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[var(--text-1)]">{zone.name}</h3>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">{cpCount(zone.postal_codes)} codigos postales</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setModal({ ...zone }); setIsNew(false) }}
                    className="w-7 h-7 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] inline-flex items-center justify-center">
                    <Pencil size={13} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign size={14} className="text-emerald-500" />
                  <span className="text-[var(--text-2)]">Envio:</span>
                  <span className="font-semibold text-[var(--text-1)]">${zone.delivery_fee.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-blue-500" />
                  <span className="text-[var(--text-2)]">Minimo:</span>
                  <span className="font-semibold text-[var(--text-1)]">${zone.min_order.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-amber-500" />
                  <span className="text-[var(--text-2)]">Tiempo est.:</span>
                  <span className="font-semibold text-[var(--text-1)]">{zone.estimated_minutes} min</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-[var(--line-soft)] flex items-center justify-between">
                <p className="text-xs text-[var(--text-3)] truncate max-w-[60%]" title={zone.postal_codes}>
                  CP: {zone.postal_codes || '---'}
                </p>
                <button onClick={() => toggleActive(zone)}
                  className={`text-xs font-semibold px-2 py-1 rounded-full ${zone.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                  {zone.active ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-[var(--surface)] rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--text-1)] mb-4">{isNew ? 'Nueva zona' : 'Editar zona'}</h3>
            <div className="space-y-3">
              <input value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })}
                placeholder="Nombre de la zona" className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
              <div>
                <label className="text-xs text-[var(--text-2)] mb-1 block">Codigos postales (separados por coma)</label>
                <input value={modal.postal_codes} onChange={e => setModal({ ...modal, postal_codes: e.target.value })}
                  placeholder="64000, 64010, 64020" className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-2)] mb-1 block">Costo envio</label>
                  <input type="number" value={modal.delivery_fee}
                    onChange={e => setModal({ ...modal, delivery_fee: Number(e.target.value) })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-2)] mb-1 block">Pedido min.</label>
                  <input type="number" value={modal.min_order}
                    onChange={e => setModal({ ...modal, min_order: Number(e.target.value) })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-2)] mb-1 block">Minutos est.</label>
                  <input type="number" value={modal.estimated_minutes}
                    onChange={e => setModal({ ...modal, estimated_minutes: Number(e.target.value) })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm" />
                </div>
              </div>
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
