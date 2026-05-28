'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Trash2, Save, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const DAYS = ['Lun','Mar','Mie','Jue','Vie','Sab','Dom']
const TYPES = ['discount','2x1','combo']

interface Promo {
  id?: string
  name: string
  type: string
  discount_pct: number | null
  discount_amount: number | null
  valid_from: string
  valid_until: string
  hours_start: string
  hours_end: string
  days_of_week: number[]
  min_purchase: number
  active: boolean
  client_id: string
}

const empty: Promo = { name:'', type:'discount', discount_pct:null, discount_amount:null, valid_from:'', valid_until:'', hours_start:'', hours_end:'', days_of_week:[], min_purchase:0, active:true, client_id:'amalay' }

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer: opts?.method === 'POST' ? 'return=representation' : 'return=representation', ...opts?.headers },
  })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export default function PromocionesPage() {
  const CLIENT_ID = useClientId()
  const [promos, setPromos] = useState<Promo[]>([])
  const [editing, setEditing] = useState<Promo | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!CLIENT_ID) return; setLoading(true)
    try {
      const data = await api(`pos_promotions?client_id=eq.${CLIENT_ID}&order=active.desc,valid_until.desc`)
      setPromos(data || [])
    } catch { setPromos([]) }
    setLoading(false)
  }

  useEffect(() => { load() }, [CLIENT_ID])

  const save = async () => {
    if (!editing?.name) return
    try {
      if (editing.id) {
        const { id, ...body } = editing
        await api(`pos_promotions?id=eq.${id}`, { method:'PATCH', body: JSON.stringify(body) })
      } else {
        await api('pos_promotions', { method:'POST', body: JSON.stringify(editing) })
      }
      setEditing(null)
      load()
    } catch (e: any) { alert(e.message) }
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminar promocion?')) return
    await api(`pos_promotions?id=eq.${id}`, { method:'DELETE' })
    load()
  }

  const isExpired = (p: Promo) => p.valid_until && new Date(p.valid_until) < new Date()
  const toggleDay = (d: number) => {
    if (!editing) return
    const days = editing.days_of_week.includes(d) ? editing.days_of_week.filter(x=>x!==d) : [...editing.days_of_week, d]
    setEditing({...editing, days_of_week: days})
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Promociones" subtitle="Gestionar descuentos y ofertas" action={
        <button onClick={() => setEditing({...empty})} className="flex items-center gap-1.5 bg-[var(--surface)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-2)]"><Plus size={16}/>Nueva</button>
      }/>

      {editing && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-5 mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Nombre" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <select value={editing.type} onChange={e=>setEditing({...editing,type:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm">
              {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" placeholder="% descuento" value={editing.discount_pct??''} onChange={e=>setEditing({...editing,discount_pct:e.target.value?Number(e.target.value):null})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <input type="number" placeholder="$ descuento" value={editing.discount_amount??''} onChange={e=>setEditing({...editing,discount_amount:e.target.value?Number(e.target.value):null})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <input type="date" value={editing.valid_from} onChange={e=>setEditing({...editing,valid_from:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" title="Desde"/>
            <input type="date" value={editing.valid_until} onChange={e=>setEditing({...editing,valid_until:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" title="Hasta"/>
            <input type="time" value={editing.hours_start} onChange={e=>setEditing({...editing,hours_start:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" title="Hora inicio"/>
            <input type="time" value={editing.hours_end} onChange={e=>setEditing({...editing,hours_end:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" title="Hora fin"/>
            <input type="number" placeholder="Compra minima" value={editing.min_purchase||''} onChange={e=>setEditing({...editing,min_purchase:Number(e.target.value)})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={e=>setEditing({...editing,active:e.target.checked})}/>Activa</label>
          </div>
          <div className="flex gap-2">
            {DAYS.map((d,i)=>(
              <button key={i} onClick={()=>toggleDay(i)} className={`px-3 py-1 rounded-full text-xs font-medium ${editing.days_of_week.includes(i)?'bg-[var(--surface)] text-white':'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>{d}</button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setEditing(null)} className="flex items-center gap-1 px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded-lg"><X size={14}/>Cancelar</button>
            <button onClick={save} className="flex items-center gap-1 bg-[var(--surface)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-2)]"><Save size={14}/>Guardar</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-[var(--text-3)] text-sm">Cargando...</p> : promos.length === 0 ? <p className="text-[var(--text-3)] text-sm">Sin promociones</p> : (
        <div className="grid gap-4">
          {promos.map(p=>(
            <div key={p.id} className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-[var(--text-1)]">{p.name}</span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${p.active && !isExpired(p) ? 'bg-green-500/15 text-green-400' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
                    {p.active && !isExpired(p) ? 'Activa' : 'Inactiva'}
                  </span>
                  <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] px-2 py-0.5 rounded-full uppercase">{p.type}</span>
                </div>
                <div className="text-xs text-[var(--text-3)] space-x-3">
                  {p.discount_pct && <span>{p.discount_pct}% desc</span>}
                  {p.discount_amount && <span>${p.discount_amount} desc</span>}
                  {p.valid_from && <span>Desde {p.valid_from}</span>}
                  {p.valid_until && <span>Hasta {p.valid_until}</span>}
                  {p.hours_start && <span>{p.hours_start}-{p.hours_end}</span>}
                  {p.min_purchase > 0 && <span>Min ${p.min_purchase}</span>}
                  {p.days_of_week?.length > 0 && <span>{p.days_of_week.map(d=>DAYS[d]).join(', ')}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={()=>setEditing({...p})} className="p-2 hover:bg-[var(--surface-2)] rounded-lg text-[var(--text-3)] hover:text-[var(--text-1)] text-xs">Editar</button>
                <button onClick={()=>remove(p.id!)} className="p-2 hover:bg-red-500/10 rounded-lg text-[var(--text-3)] hover:text-red-500"><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
