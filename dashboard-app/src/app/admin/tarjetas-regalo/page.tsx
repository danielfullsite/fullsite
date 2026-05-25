'use client'

import { useState, useEffect } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Trash2, Save, X, Search, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface GiftCard {
  id?: string
  code: string
  initial_balance: number
  current_balance: number
  customer_name: string
  customer_phone: string
  status: string
  expires_at: string
  client_id: string
}

const empty: GiftCard = { code:'', initial_balance:0, current_balance:0, customer_name:'', customer_phone:'', status:'active', expires_at:'', client_id:'amalay' }

const genCode = () => Math.random().toString(36).substring(2,6).toUpperCase() + Math.floor(1000+Math.random()*9000)

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'return=representation', ...opts?.headers },
  })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export default function TarjetasRegaloPage() {
  const CLIENT_ID = useClientId()
  const [cards, setCards] = useState<GiftCard[]>([])
  const [editing, setEditing] = useState<GiftCard | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api(`pos_gift_cards?client_id=eq.${CLIENT_ID}&order=created_at.desc`)
      setCards(data || [])
    } catch { setCards([]) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing?.code) return
    try {
      if (editing.id) {
        const { id, ...body } = editing
        await api(`pos_gift_cards?id=eq.${id}`, { method:'PATCH', body: JSON.stringify(body) })
      } else {
        const body = { ...editing, current_balance: editing.initial_balance }
        await api('pos_gift_cards', { method:'POST', body: JSON.stringify(body) })
      }
      setEditing(null)
      load()
    } catch (e: any) { alert(e.message) }
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminar tarjeta?')) return
    await api(`pos_gift_cards?id=eq.${id}`, { method:'DELETE' })
    load()
  }

  const filtered = cards.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.code.toLowerCase().includes(q) || c.customer_name.toLowerCase().includes(q)
  })

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    used: 'bg-[var(--surface-2)] text-[var(--text-3)]',
    expired: 'bg-red-100 text-red-500',
  }

  const pct = (c: GiftCard) => c.initial_balance > 0 ? (c.current_balance / c.initial_balance) * 100 : 0

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Tarjetas de Regalo" subtitle="Gestionar gift cards" action={
        <button onClick={() => setEditing({...empty, code: genCode()})} className="flex items-center gap-1.5 bg-[var(--surface)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-2)]"><Plus size={16}/>Nueva</button>
      }/>

      {editing && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-5 mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex gap-2">
              <input placeholder="Codigo" value={editing.code} onChange={e=>setEditing({...editing,code:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm flex-1 font-mono tracking-wider"/>
              <button onClick={()=>setEditing({...editing,code:genCode()})} className="p-2 border border-[var(--line)] rounded-lg hover:bg-[var(--surface-2)]" title="Generar codigo"><RefreshCw size={14}/></button>
            </div>
            <select value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm">
              <option value="active">Activa</option>
              <option value="used">Usada</option>
              <option value="expired">Expirada</option>
            </select>
            <input type="number" placeholder="Saldo inicial" value={editing.initial_balance||''} onChange={e=>setEditing({...editing,initial_balance:Number(e.target.value)})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            {editing.id && <input type="number" placeholder="Saldo actual" value={editing.current_balance||''} onChange={e=>setEditing({...editing,current_balance:Number(e.target.value)})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>}
            <input placeholder="Nombre cliente" value={editing.customer_name} onChange={e=>setEditing({...editing,customer_name:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <input placeholder="Telefono" value={editing.customer_phone} onChange={e=>setEditing({...editing,customer_phone:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm"/>
            <input type="date" value={editing.expires_at} onChange={e=>setEditing({...editing,expires_at:e.target.value})} className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm" title="Expira"/>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setEditing(null)} className="flex items-center gap-1 px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded-lg"><X size={14}/>Cancelar</button>
            <button onClick={save} className="flex items-center gap-1 bg-[var(--surface)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--surface-2)]"><Save size={14}/>Guardar</button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]"/>
        <input placeholder="Buscar por codigo o nombre..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full border border-[var(--line)] rounded-lg pl-9 pr-3 py-2 text-sm"/>
      </div>

      {loading ? <p className="text-[var(--text-3)] text-sm">Cargando...</p> : filtered.length === 0 ? <p className="text-[var(--text-3)] text-sm">Sin tarjetas</p> : (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--line-soft)] text-left text-[11px] text-[var(--text-3)] uppercase">
              <th className="px-4 py-3">Codigo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Saldo</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Expira</th>
              <th className="px-4 py-3 w-20"></th>
            </tr></thead>
            <tbody>
              {filtered.map(c=>(
                <tr key={c.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]/50">
                  <td className="px-4 py-3 font-mono tracking-wider font-medium">{c.code}</td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--text-1)]">{c.customer_name || '-'}</div>
                    {c.customer_phone && <div className="text-[11px] text-[var(--text-3)]">{c.customer_phone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--text-1)] font-medium">${c.current_balance.toFixed(2)} <span className="text-[var(--text-4)] font-normal">/ ${c.initial_balance.toFixed(2)}</span></div>
                    <div className="w-24 h-1.5 bg-[var(--surface-2)] rounded-full mt-1 overflow-hidden">
                      <div className={`h-full rounded-full ${pct(c) > 50 ? 'bg-green-500/100' : pct(c) > 20 ? 'bg-yellow-500/100' : 'bg-red-500/100'}`} style={{width:`${pct(c)}%`}}/>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColor[c.status]||'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-[var(--text-3)]">{c.expires_at || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={()=>setEditing({...c})} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] p-1">Editar</button>
                      <button onClick={()=>remove(c.id!)} className="p-1 text-[var(--text-3)] hover:text-red-500"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
