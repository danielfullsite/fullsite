'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Constructor de mapa de mesas (esqueleton) — cada restaurante arma su propio
// plano SIN nosotros. Lee/escribe pos_mesas (la fuente que /pos/mesas y /pos/plano
// YA leen), así que al guardar, el POS lo refleja solo. Guardado EXPLÍCITO + confirm
// (no toca nada hasta que el usuario guarda). Escribe vía el proxy /api/pos/db.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, Trash2, Save, Circle, Square, RectangleHorizontal, Minus, ArrowLeft, Users } from 'lucide-react'
import { fetchPosMesas, getPOSAuthHeaders, type PosMesa } from '@/lib/pos-data'
import { getActiveClientSlug as _cid } from '@/lib/data'
import { useRouter } from 'next/navigation'

type Shape = 'round' | 'round-lg' | 'square' | 'rect-h'
interface EditorMesa { number: number; capacity: number; zone: string; x_pct: number; y_pct: number; shape: Shape }

const SHAPES: { key: Shape; label: string; icon: React.ReactNode }[] = [
  { key: 'round', label: 'Redonda', icon: <Circle size={18} /> },
  { key: 'square', label: 'Cuadrada', icon: <Square size={18} /> },
  { key: 'rect-h', label: 'Rectangular', icon: <RectangleHorizontal size={18} /> },
  { key: 'round-lg', label: 'Grande', icon: <Circle size={22} /> },
]
const SHAPE_SIZE: Record<Shape, { w: number; h: number }> = {
  round: { w: 46, h: 46 }, 'round-lg': { w: 60, h: 60 }, square: { w: 46, h: 44 }, 'rect-h': { w: 74, h: 42 },
}

export default function PlanoEditor() {
  const router = useRouter()
  const [mesas, setMesas] = useState<EditorMesa[]>([])
  const [originalNumbers, setOriginalNumbers] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ num: number; dx: number; dy: number } | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  useEffect(() => {
    fetchPosMesas(_cid())
      .then((rows: PosMesa[]) => {
        const list: EditorMesa[] = rows.map((r) => ({
          number: r.number,
          capacity: r.capacity || 4,
          zone: r.zone || '',
          x_pct: typeof r.x_pct === 'number' ? r.x_pct : 50,
          y_pct: typeof r.y_pct === 'number' ? r.y_pct : 50,
          shape: (['round', 'round-lg', 'square', 'rect-h'].includes(r.shape) ? r.shape : 'round') as Shape,
        }))
        setMesas(list)
        setOriginalNumbers(list.map((m) => m.number))
      })
      .catch(() => showToast('No se pudo cargar el plano'))
      .finally(() => setLoading(false))
  }, [])

  const addMesa = (shape: Shape) => {
    const nextNum = mesas.length ? Math.max(...mesas.map((m) => m.number)) + 1 : 1
    const nm: EditorMesa = { number: nextNum, capacity: 4, zone: '', x_pct: 50, y_pct: 45, shape }
    setMesas((p) => [...p, nm])
    setSelected(nextNum)
  }
  const removeMesa = (num: number) => { setMesas((p) => p.filter((m) => m.number !== num)); setSelected(null) }
  const patchMesa = (num: number, patch: Partial<EditorMesa>) =>
    setMesas((p) => p.map((m) => (m.number === num ? { ...m, ...patch } : m)))

  // ── Drag ──
  const onPointerDown = (e: React.PointerEvent, num: number) => {
    e.stopPropagation(); setSelected(num)
    const el = canvasRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const m = mesas.find((x) => x.number === num); if (!m) return
    dragRef.current = { num, dx: e.clientX - (rect.left + (m.x_pct / 100) * rect.width), dy: e.clientY - (rect.top + (m.y_pct / 100) * rect.height) }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current; const el = canvasRef.current; if (!d || !el) return
    const rect = el.getBoundingClientRect()
    const x = ((e.clientX - d.dx - rect.left) / rect.width) * 100
    const y = ((e.clientY - d.dy - rect.top) / rect.height) * 100
    patchMesa(d.num, { x_pct: Math.max(2, Math.min(98, x)), y_pct: Math.max(3, Math.min(97, y)) })
  }, [])
  const onPointerUp = () => { dragRef.current = null }

  const save = async () => {
    if (!mesas.length) { showToast('Agrega al menos una mesa'); return }
    const nums = mesas.map((m) => m.number)
    if (new Set(nums).size !== nums.length) { showToast('Hay números de mesa repetidos'); return }
    if (!window.confirm(`Vas a guardar ${mesas.length} mesas. Esto reemplaza el mapa que ven todos los meseros. ¿Continuar?`)) return
    setSaving(true)
    try {
      const cid = _cid()
      const rows = mesas.map((m, i) => ({
        client_id: cid, number: m.number, capacity: m.capacity, zone: m.zone || null,
        x_pct: Math.round(m.x_pct * 100) / 100, y_pct: Math.round(m.y_pct * 100) / 100,
        shape: m.shape, sort_order: i, active: true,
      }))
      // Upsert (merge por client_id,number)
      const res = await fetch('/api/pos/db/rest/v1/pos_mesas?on_conflict=client_id,number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal', ...getPOSAuthHeaders() },
        body: JSON.stringify(rows),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Desactivar las mesas removidas (estaban antes, ya no)
      const removed = originalNumbers.filter((n) => !nums.includes(n))
      if (removed.length) {
        await fetch(`/api/pos/db/rest/v1/pos_mesas?number=in.(${removed.join(',')})`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', ...getPOSAuthHeaders() },
          body: JSON.stringify({ active: false }),
        }).catch(() => {})
      }
      setOriginalNumbers(nums)
      showToast('✅ Mapa guardado — el POS ya lo refleja')
    } catch {
      showToast('Error al guardar — revisa tu conexión')
    } finally {
      setSaving(false)
    }
  }

  const sel = mesas.find((m) => m.number === selected) || null

  return (
    <div className="pos-kiosk h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
        <button onClick={() => router.back()} className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'var(--panel)', color: 'var(--text-2)' }}><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="font-bold text-base">Constructor de mapa</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Arrastra las mesas · edita a la derecha · guarda cuando termines</p>
        </div>
        <button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 font-bold rounded-xl px-5 min-h-[48px] disabled:opacity-40" style={{ background: 'linear-gradient(180deg,var(--accent-bright),var(--accent))', color: '#052018' }}>
          {saving ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save size={18} />}
          Guardar
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Paleta */}
        <aside className="w-[130px] flex-shrink-0 border-r p-3 flex flex-col gap-2" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <p className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: 'var(--text-4)' }}>Agregar</p>
          {SHAPES.map((s) => (
            <button key={s.key} onClick={() => addMesa(s.key)} className="flex items-center gap-2 rounded-xl px-3 min-h-[52px] font-semibold text-sm border transition-transform active:scale-95" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-1)' }}>
              <span style={{ color: 'var(--accent-bright)' }}>{s.icon}</span>{s.label}
            </button>
          ))}
          <div className="mt-auto text-[10px]" style={{ color: 'var(--text-4)' }}>{mesas.length} mesas</div>
        </aside>

        {/* Lienzo */}
        <main className="flex-1 p-4 overflow-hidden">
          <div
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => setSelected(null)}
            className="relative w-full h-full rounded-2xl border"
            style={{ borderColor: 'var(--line)', background: 'var(--bg)', backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          >
            {loading && <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>Cargando plano…</div>}
            {!loading && mesas.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>Agrega mesas desde la izquierda ←</div>}
            {mesas.map((m) => {
              const sz = SHAPE_SIZE[m.shape]
              const isSel = m.number === selected
              return (
                <div
                  key={m.number}
                  onPointerDown={(e) => onPointerDown(e, m.number)}
                  className="absolute flex items-center justify-center font-black cursor-grab active:cursor-grabbing select-none touch-none"
                  style={{
                    left: `${m.x_pct}%`, top: `${m.y_pct}%`, width: sz.w, height: sz.h, transform: 'translate(-50%,-50%)',
                    borderRadius: m.shape.startsWith('round') ? '50%' : 10,
                    background: isSel ? 'var(--accent-soft)' : 'var(--info-soft)',
                    border: `2px solid ${isSel ? 'var(--accent-bright)' : 'rgba(56,189,248,.5)'}`,
                    color: isSel ? 'var(--accent-bright)' : 'var(--info)',
                    boxShadow: isSel ? '0 0 0 3px rgba(16,185,129,.2)' : 'none',
                  }}
                >
                  {m.number}
                </div>
              )
            })}
          </div>
        </main>

        {/* Propiedades */}
        <aside className="w-[190px] flex-shrink-0 border-l p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          {!sel ? (
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>Toca una mesa para editarla</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-bold">Mesa {sel.number}</span>
                <button onClick={() => removeMesa(sel.number)} className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}><Trash2 size={16} /></button>
              </div>
              <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-4)' }}>Número
                <input type="number" value={sel.number} onChange={(e) => patchMesa(sel.number, { number: parseInt(e.target.value) || sel.number })}
                  className="mt-1 w-full rounded-lg px-3 min-h-[44px] text-base font-bold" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }} />
              </label>
              <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-4)' }}>Capacidad
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => patchMesa(sel.number, { capacity: Math.max(1, sel.capacity - 1) })} className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}><Minus size={16} /></button>
                  <span className="flex-1 text-center font-bold tabular-nums flex items-center justify-center gap-1" style={{ color: 'var(--text-1)' }}><Users size={14} />{sel.capacity}</span>
                  <button onClick={() => patchMesa(sel.number, { capacity: sel.capacity + 1 })} className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}><Plus size={16} /></button>
                </div>
              </div>
              <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-4)' }}>Zona
                <input type="text" value={sel.zone} placeholder="Jardín, Barra…" onChange={(e) => patchMesa(sel.number, { zone: e.target.value })}
                  className="mt-1 w-full rounded-lg px-3 min-h-[44px] text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }} />
              </label>
              <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-4)' }}>Forma
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {SHAPES.map((s) => (
                    <button key={s.key} onClick={() => patchMesa(sel.number, { shape: s.key })}
                      className="flex items-center justify-center min-h-[44px] rounded-lg border"
                      style={{ background: sel.shape === s.key ? 'var(--accent-soft)' : 'var(--surface-2)', borderColor: sel.shape === s.key ? 'var(--accent-line)' : 'var(--line)', color: sel.shape === s.key ? 'var(--accent-bright)' : 'var(--text-2)' }}>
                      {s.icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl px-4 py-3 shadow-lg z-50 text-sm font-semibold" style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--text-1)' }}>{toast}</div>
      )}
    </div>
  )
}
