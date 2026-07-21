'use client'

import { useState, useEffect } from 'react'
import { User, AlertTriangle, Heart, Clock, Star } from 'lucide-react'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!


interface CustomerNote {
  id: string
  mesa: number
  note: string
  type: 'allergy' | 'preference' | 'vip' | 'general'
  created_by: string
  created_at: string
}

interface CustomerMemoryProps {
  mesa: number
  mesero: string
  onAddNote?: (note: string, type: string) => void
}

export default function CustomerMemory({ mesa, mesero }: CustomerMemoryProps) {
  const [notes, setNotes] = useState<CustomerNote[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [noteType, setNoteType] = useState<'allergy' | 'preference' | 'vip' | 'general'>('general')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchNotes()
  }, [mesa])

  async function fetchNotes() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_customer_notes?mesa=eq.${mesa}&client_id=eq.${_cid()}&order=created_at.desc&limit=10`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (res.ok) {
        const data = await res.json()
        setNotes(data)
      }
    } catch { /* table might not exist yet */ }
  }

  async function handleSave() {
    if (!newNote.trim()) return
    setSaving(true)
    try {
      const id = `note-${Date.now().toString(36)}`
      await fetch(`${SUPABASE_URL}/rest/v1/pos_customer_notes`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id, client_id: _cid(), mesa, note: newNote.trim(),
          type: noteType, created_by: mesero,
        }),
      })
      setNewNote('')
      setShowAdd(false)
      fetchNotes()
    } catch { /* */ }
    setSaving(false)
  }

  const typeConfig = {
    allergy: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Alergia' },
    preference: { icon: Heart, color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', label: 'Preferencia' },
    vip: { icon: Star, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'VIP' },
    general: { icon: User, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Nota' },
  }

  if (notes.length === 0 && !showAdd) {
    return (
      <button
        onClick={() => setShowAdd(true)}
        className="w-full text-left px-3 py-2 rounded-lg bg-[var(--line)]/30 hover:bg-[var(--line)]/50 text-xs text-[var(--text-3)] transition-colors"
      >
        <User size={12} className="inline mr-1" />
        Agregar nota del cliente (alergias, preferencias...)
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      {/* Existing notes — allergies shown prominently */}
      {notes.filter(n => n.type === 'allergy').map(n => (
        <div key={n.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 animate-pulse-once">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
          <span className="text-xs font-bold text-red-400">{n.note}</span>
        </div>
      ))}

      {/* Other notes */}
      {notes.filter(n => n.type !== 'allergy').map(n => {
        const cfg = typeConfig[n.type]
        return (
          <div key={n.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${cfg.bg}`}>
            <cfg.icon size={12} className={cfg.color} />
            <span className="text-xs text-[var(--text-2)]">{n.note}</span>
          </div>
        )
      })}

      {/* Add note */}
      {showAdd ? (
        <div className="bg-[var(--line)]/50 rounded-lg p-2 space-y-2">
          <div className="flex gap-1">
            {(Object.keys(typeConfig) as Array<keyof typeof typeConfig>).map(t => {
              const cfg = typeConfig[t]
              return (
                <button
                  key={t}
                  onClick={() => setNoteType(t)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    noteType === t ? `${cfg.bg} ${cfg.color} border font-bold` : 'text-[var(--text-3)]'
                  }`}
                >
                  <cfg.icon size={10} />
                  {cfg.label}
                </button>
              )
            })}
          </div>
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder={noteType === 'allergy' ? 'Ej: Alergia a nuez' : 'Nota del cliente...'}
            autoFocus
            className="w-full bg-[var(--surface)] border border-[var(--line)] rounded px-2 py-1.5 text-xs text-[var(--text-1)] focus:outline-none focus:border-emerald-500"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <div className="flex gap-1">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-1 text-xs text-[var(--text-3)]">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !newNote.trim()} className="flex-1 py-1 text-xs bg-emerald-500 text-white rounded disabled:opacity-50 font-bold">Guardar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="text-xs text-[var(--text-3)] hover:text-emerald-400 px-1">
          + Agregar nota
        </button>
      )}
    </div>
  )
}
