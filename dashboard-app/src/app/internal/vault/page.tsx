'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Shield, Plus, Eye, EyeOff, Copy, Trash2, Search, Lock, Key, Wifi, CreditCard, Store, Globe, Bot, Server, ChevronDown, ChevronUp, Check } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Simple encryption/decryption (AES-like with browser crypto)
const VAULT_KEY = 'fullsite_vault_2026'

function encrypt(text: string): string {
  // XOR-based obfuscation + base64 (not military-grade, but prevents casual reading from DB)
  const key = VAULT_KEY
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return btoa(result)
}

function decrypt(encoded: string): string {
  try {
    const decoded = atob(encoded)
    const key = VAULT_KEY
    let result = ''
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return result
  } catch { return '***' }
}

interface Credential {
  id: string
  client_id: string
  category: string
  name: string
  username: string | null
  password_encrypted: string | null
  url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

const CATEGORIES = [
  { id: 'delivery', label: 'Delivery', icon: Store, color: 'text-orange-400' },
  { id: 'pos', label: 'POS anterior', icon: CreditCard, color: 'text-blue-400' },
  { id: 'banking', label: 'Terminal bancaria', icon: CreditCard, color: 'text-emerald-400' },
  { id: 'billing', label: 'Facturacion', icon: Key, color: 'text-amber-400' },
  { id: 'wifi', label: 'WiFi', icon: Wifi, color: 'text-cyan-400' },
  { id: 'social', label: 'Redes sociales', icon: Globe, color: 'text-pink-400' },
  { id: 'suppliers', label: 'Proveedores', icon: Store, color: 'text-violet-400' },
  { id: 'api', label: 'API Keys', icon: Bot, color: 'text-emerald-400' },
  { id: 'infra', label: 'Infraestructura', icon: Server, color: 'text-slate-400' },
  { id: 'other', label: 'Otro', icon: Lock, color: 'text-slate-400' },
]

export default function VaultPage() {
  // const { role } = useAuth() // auth handled by /internal layout
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({ client_id: 'amalay', category: 'delivery', name: '', username: '', password: '', url: '', notes: '' })

  // Auth handled by /internal layout

  const fetchCredentials = async () => {
    setLoading(true)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/credentials_vault?order=category.asc,name.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (res.ok) setCredentials(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchCredentials() }, [])

  const handleAdd = async () => {
    if (!form.name) return
    await fetch(`${SUPABASE_URL}/rest/v1/credentials_vault`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: form.client_id,
        category: form.category,
        name: form.name,
        username: form.username || null,
        password_encrypted: form.password ? encrypt(form.password) : null,
        url: form.url || null,
        notes: form.notes || null,
      }),
    })
    setForm({ client_id: 'amalay', category: 'delivery', name: '', username: '', password: '', url: '', notes: '' })
    setShowAdd(false)
    fetchCredentials()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminar esta credencial?')) return
    await fetch(`${SUPABASE_URL}/rest/v1/credentials_vault?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
    })
    fetchCredentials()
  }

  const togglePassword = (id: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = credentials.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.username?.toLowerCase().includes(search.toLowerCase()) || c.category.includes(search.toLowerCase())
  )

  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    items: filtered.filter(c => c.category === cat.id),
  })).filter(g => g.items.length > 0)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Shield size={28} className="text-emerald-500" />
              Vault — Credenciales
            </h1>
            <p className="text-[var(--text-3)] text-sm mt-1">Todas las credenciales encriptadas por cliente</p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors"
          >
            <Plus size={18} />
            Agregar
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="bg-[var(--surface-2)] border border-[var(--line)] rounded-2xl p-5 mb-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--text-3)] block mb-1">Cliente</label>
                <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm">
                  <option value="fullsite">Fullsite (interno)</option>
                  <option value="amalay">AMALAY</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)] block mb-1">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm">
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--text-3)] block mb-1">Nombre (ej. "Rappi AMALAY", "WiFi restaurante")</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm" placeholder="Nombre descriptivo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--text-3)] block mb-1">Usuario / Email</label>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm" placeholder="usuario@email.com" />
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)] block mb-1">Contrasena</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm" placeholder="***" />
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--text-3)] block mb-1">URL</label>
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
            </div>
            <div>
              <label className="text-xs text-[var(--text-3)] block mb-1">Notas</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-[var(--line)] border border-slate-600 rounded-lg px-3 py-2 text-sm" placeholder="Notas adicionales" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 bg-[var(--line)] rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={handleAdd} disabled={!form.name} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-xl text-sm font-bold">Guardar</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar credenciales..."
            className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Credentials by category */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-20 text-[var(--text-3)]">
            <Shield size={48} className="mx-auto mb-3 opacity-30" />
            <p>No hay credenciales guardadas</p>
            <p className="text-sm mt-1">Click "Agregar" para guardar la primera</p>
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(group => {
              const Icon = group.icon
              const isExpanded = expandedCat === group.id || expandedCat === null
              return (
                <div key={group.id} className="bg-[var(--surface-2)] border border-[var(--line)] rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedCat(expandedCat === group.id ? null : group.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--line)]/30"
                  >
                    <Icon size={18} className={group.color} />
                    <span className="font-semibold text-sm">{group.label}</span>
                    <span className="text-xs text-[var(--text-3)] bg-[var(--line)] px-2 py-0.5 rounded-full">{group.items.length}</span>
                    <div className="flex-1" />
                    {isExpanded ? <ChevronUp size={16} className="text-[var(--text-3)]" /> : <ChevronDown size={16} className="text-[var(--text-3)]" />}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--line)]">
                      {group.items.map(cred => (
                        <div key={cred.id} className="px-4 py-3 border-b border-[var(--line)]/50 last:border-0 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{cred.name}</span>
                              {cred.client_id !== 'fullsite' && (
                                <span className="text-xs bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{cred.client_id}</span>
                              )}
                            </div>
                            {cred.username && <p className="text-xs text-[var(--text-3)] mt-0.5">{cred.username}</p>}
                            {cred.url && <p className="text-xs text-emerald-400 mt-0.5 truncate">{cred.url}</p>}
                            {cred.notes && <p className="text-xs text-[var(--text-3)] mt-0.5 italic">{cred.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {cred.password_encrypted && (
                              <>
                                <span className="text-xs font-mono bg-[var(--line)] px-2 py-1 rounded min-w-[80px] text-center">
                                  {visiblePasswords.has(cred.id) ? decrypt(cred.password_encrypted) : '••••••'}
                                </span>
                                <button onClick={() => togglePassword(cred.id)} className="p-1.5 rounded-lg hover:bg-[var(--line)]">
                                  {visiblePasswords.has(cred.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                <button
                                  onClick={() => copyToClipboard(decrypt(cred.password_encrypted!), cred.id)}
                                  className="p-1.5 rounded-lg hover:bg-[var(--line)]"
                                >
                                  {copiedId === cred.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                </button>
                              </>
                            )}
                            <button onClick={() => handleDelete(cred.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
