'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Pencil, Save, Phone, Mail, Calendar, DollarSign, User, X } from 'lucide-react'
import { useClientId } from '@/hooks/useClientId'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Customer {
  id?: string
  name: string
  phone: string
  email: string
  notes: string
  visits: number
  total_spent: number
  last_visit: string | null
  created_at?: string
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...opts?.headers,
    },
  })
  return res.ok ? res.json() : []
}

const emptyCustomer: Customer = { name: '', phone: '', email: '', notes: '', visits: 0, total_spent: 0, last_visit: null }

export default function ClientesPage() {
  const CLIENT_ID = useClientId()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Customer | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const data = await api(`pos_customers?client_id=eq.${CLIENT_ID}&order=last_visit.desc.nullslast,name.asc`)
    setCustomers(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!editing || !editing.name) return
    const body = {
      client_id: CLIENT_ID,
      name: editing.name,
      phone: editing.phone || null,
      email: editing.email || null,
      notes: editing.notes || null,
      visits: editing.visits,
      total_spent: editing.total_spent,
      last_visit: editing.last_visit || null,
    }
    if (isNew) {
      await api('pos_customers', { method: 'POST', body: JSON.stringify(body) })
      showToast(`${editing.name} agregado`)
    } else {
      await api(`pos_customers?id=eq.${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      showToast(`${editing.name} actualizado`)
    }
    setEditing(null)
    load()
  }

  const handleDelete = async (c: Customer) => {
    if (!confirm(`Eliminar a ${c.name}?`)) return
    await api(`pos_customers?id=eq.${c.id}`, { method: 'DELETE' })
    showToast(`${c.name} eliminado`)
    load()
  }

  const filtered = customers.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return c.name.toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.email || '').toLowerCase().includes(s)
  })

  const totalCustomers = customers.length
  const totalSpent = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0)
  const totalVisits = customers.reduce((s, c) => s + (c.visits || 0), 0)
  const avgTicket = totalVisits > 0 ? totalSpent / totalVisits : 0

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-3)]">Cargando clientes...</div>

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)]">Clientes</h2>
          <p className="text-sm text-[var(--text-2)]">{totalCustomers} clientes · {totalVisits} visitas totales</p>
        </div>
        <button
          onClick={() => { setEditing({ ...emptyCustomer }); setIsNew(true) }}
          className="px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm"
        >
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><User size={14} className="text-blue-500" /><span className="text-xs text-[var(--text-2)]">Clientes</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalCustomers}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Calendar size={14} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)]">Visitas totales</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalVisits}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign size={14} className="text-violet-500" /><span className="text-xs text-[var(--text-2)]">Gastado total</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">${Math.round(totalSpent).toLocaleString()}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign size={14} className="text-amber-500" /><span className="text-xs text-[var(--text-2)]">Ticket promedio</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">${Math.round(avgTicket).toLocaleString()}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, telefono o email..."
          className="w-full pl-10 pr-4 py-2.5 border border-[var(--line)] rounded-xl text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Nombre</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Contacto</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Visitas</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Gastado</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Ultima visita</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                <td className="px-5 py-3">
                  <span className="text-sm font-medium text-[var(--text-1)]">{c.name}</span>
                  {c.notes && <p className="text-xs text-[var(--text-3)] mt-0.5 truncate max-w-[200px]">{c.notes}</p>}
                </td>
                <td className="px-5 py-3">
                  {c.phone && <div className="flex items-center gap-1 text-sm text-[var(--text-2)]"><Phone size={12} />{c.phone}</div>}
                  {c.email && <div className="flex items-center gap-1 text-xs text-[var(--text-3)] mt-0.5"><Mail size={10} />{c.email}</div>}
                </td>
                <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--text-1)]">{c.visits}</td>
                <td className="px-5 py-3 text-right text-sm font-semibold text-[var(--text-1)]">${Math.round(Number(c.total_spent || 0)).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-[var(--text-2)]">
                  {c.last_visit ? new Date(c.last_visit).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => { setEditing({ ...c }); setIsNew(false) }}
                      className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center">
                      <Pencil size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-[var(--text-3)] text-sm">{customers.length === 0 ? 'Sin clientes registrados. Agrega el primero.' : 'Sin resultados'}</p>
        )}
      </div>

      {/* Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
          <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-1)]">{isNew ? 'Nuevo cliente' : 'Editar cliente'}</h3>
              <button onClick={() => setEditing(null)} className="text-[var(--text-3)] hover:text-[var(--text-2)]"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Nombre *</label>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Telefono</label>
                  <input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })}
                    placeholder="81 1234 5678"
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Email</label>
                  <input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })}
                    className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Notas</label>
                <textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                  rows={2} placeholder="Alergias, preferencias, mesa favorita..."
                  className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
              {!isNew && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Visitas</label>
                    <input type="number" value={editing.visits} onChange={e => setEditing({ ...editing, visits: Number(e.target.value) })}
                      className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-2)] uppercase">Total gastado</label>
                    <input type="number" value={editing.total_spent} onChange={e => setEditing({ ...editing, total_spent: Number(e.target.value) })}
                      className="w-full border border-[var(--line)] rounded-lg px-3 py-2.5 text-sm mt-1" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSave}
                className="flex-1 px-4 py-2.5 bg-emerald-500/100 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                <Save size={14} /> Guardar
              </button>
              {!isNew && (
                <button onClick={() => { handleDelete(editing); setEditing(null) }}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-100 text-red-600 rounded-xl text-sm font-semibold">
                  Eliminar
                </button>
              )}
              <button onClick={() => setEditing(null)}
                className="px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-xl text-sm">
                Cancelar
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
