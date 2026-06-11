'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Search, Plus, Trash2, Pencil, Save, Loader2, ArrowRightLeft, Zap, Package, X, Check } from 'lucide-react'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import PageHeader from '@/components/PageHeader'

// ── Types ───────────────────────────────────────────────────────────

interface UnitConversion {
  id: string
  from_unit: string
  to_unit: string
  factor: number
  product_id?: string
  product_name?: string
}

// ── Constants ───────────────────────────────────────────────────────

const UNITS = [
  'KG', 'G', 'L', 'ML', 'PZ', 'CAJA', 'BOLSA', 'BOTE',
  'MANOJO', 'DOCENA', 'GALON', 'ONZA', 'LIBRA',
] as const

const UNIT_LABELS: Record<string, string> = {
  KG: 'Kilogramo',
  G: 'Gramo',
  L: 'Litro',
  ML: 'Mililitro',
  PZ: 'Pieza',
  CAJA: 'Caja',
  BOLSA: 'Bolsa',
  BOTE: 'Bote',
  MANOJO: 'Manojo',
  DOCENA: 'Docena',
  GALON: 'Galon',
  ONZA: 'Onza',
  LIBRA: 'Libra',
}

const STANDARD_PRESETS: Omit<UnitConversion, 'id'>[] = [
  { from_unit: 'KG', to_unit: 'G', factor: 1000 },
  { from_unit: 'L', to_unit: 'ML', factor: 1000 },
  { from_unit: 'DOCENA', to_unit: 'PZ', factor: 12 },
  { from_unit: 'LIBRA', to_unit: 'G', factor: 453.592 },
  { from_unit: 'GALON', to_unit: 'L', factor: 3.785 },
  { from_unit: 'ONZA', to_unit: 'G', factor: 28.3495 },
  { from_unit: 'ONZA', to_unit: 'ML', factor: 29.5735 },
  { from_unit: 'KG', to_unit: 'LIBRA', factor: 2.20462 },
  { from_unit: 'CAJA', to_unit: 'PZ', factor: 24 },
  { from_unit: 'BOLSA', to_unit: 'KG', factor: 1 },
]

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ── Component ───────────────────────────────────────────────────────

export default function ConversionesPage() {
  const [conversions, setConversions] = useState<UnitConversion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')

  // Form state
  const [formFrom, setFormFrom] = useState('KG')
  const [formTo, setFormTo] = useState('G')
  const [formFactor, setFormFactor] = useState('1000')
  const [formProductName, setFormProductName] = useState('')
  const [showProductField, setShowProductField] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFactor, setEditFactor] = useState('')

  // ── Load ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.${clientId}&data_key=eq.unit_conversions&order=fecha.desc&limit=1&select=data`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (res.ok) {
          const rows = await res.json()
          if (rows.length > 0) {
            const raw = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
            if (Array.isArray(raw)) {
              setConversions(raw.map((c: Omit<UnitConversion, 'id'> & { id?: string }) => ({
                ...c,
                id: c.id || uid(),
              })))
            }
          }
        }
      } catch (e) {
        console.error('[conversiones] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Save ─────────────────────────────────────────────────────────
  const save = useCallback(async (data: UnitConversion[]) => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const clientId = getActiveClientSlug()
      const ok = await sbPost('wansoft_data', clientId, {
        data_key: 'unit_conversions',
        fecha: todayISO(),
        data: data,
      }, { upsert: true })
      if (ok) {
        setSaveMsg({ type: 'success', text: 'Conversiones guardadas' })
      } else {
        setSaveMsg({ type: 'error', text: 'Error al guardar' })
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Error de conexion' })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 3000)
  }, [])

  // ── Actions ──────────────────────────────────────────────────────
  const addConversion = useCallback(() => {
    const factor = parseFloat(formFactor)
    if (isNaN(factor) || factor <= 0) return
    if (formFrom === formTo) return

    const exists = conversions.some(
      c => c.from_unit === formFrom && c.to_unit === formTo && !c.product_id && !showProductField
    )
    if (exists) {
      setSaveMsg({ type: 'error', text: 'Esta conversion ya existe' })
      setTimeout(() => setSaveMsg(null), 3000)
      return
    }

    const newConv: UnitConversion = {
      id: uid(),
      from_unit: formFrom,
      to_unit: formTo,
      factor,
      ...(showProductField && formProductName ? { product_name: formProductName } : {}),
    }
    const updated = [...conversions, newConv]
    setConversions(updated)
    save(updated)
    setFormProductName('')
    setShowProductField(false)
  }, [conversions, formFrom, formTo, formFactor, formProductName, showProductField, save])

  const deleteConversion = useCallback((id: string) => {
    const updated = conversions.filter(c => c.id !== id)
    setConversions(updated)
    save(updated)
  }, [conversions, save])

  const startEdit = useCallback((c: UnitConversion) => {
    setEditingId(c.id)
    setEditFactor(c.factor.toString())
  }, [])

  const confirmEdit = useCallback((id: string) => {
    const factor = parseFloat(editFactor)
    if (isNaN(factor) || factor <= 0) return
    const updated = conversions.map(c => c.id === id ? { ...c, factor } : c)
    setConversions(updated)
    save(updated)
    setEditingId(null)
  }, [conversions, editFactor, save])

  const loadPresets = useCallback(() => {
    const existing = new Set(conversions.map(c => `${c.from_unit}→${c.to_unit}`))
    const newOnes = STANDARD_PRESETS
      .filter(p => !existing.has(`${p.from_unit}→${p.to_unit}`))
      .map(p => ({ ...p, id: uid() }))
    if (newOnes.length === 0) {
      setSaveMsg({ type: 'error', text: 'Todas las conversiones estandar ya existen' })
      setTimeout(() => setSaveMsg(null), 3000)
      return
    }
    const updated = [...conversions, ...newOnes]
    setConversions(updated)
    save(updated)
    setSaveMsg({ type: 'success', text: `${newOnes.length} conversiones estandar agregadas` })
    setTimeout(() => setSaveMsg(null), 3000)
  }, [conversions, save])

  // ── Filtered list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return conversions
    const q = search.toLowerCase()
    return conversions.filter(c =>
      c.from_unit.toLowerCase().includes(q) ||
      c.to_unit.toLowerCase().includes(q) ||
      (UNIT_LABELS[c.from_unit] || '').toLowerCase().includes(q) ||
      (UNIT_LABELS[c.to_unit] || '').toLowerCase().includes(q) ||
      (c.product_name || '').toLowerCase().includes(q)
    )
  }, [conversions, search])

  const genericConversions = filtered.filter(c => !c.product_name)
  const productConversions = filtered.filter(c => !!c.product_name)

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conversiones de Unidades"
        subtitle="Equivalencias entre unidades de medida"
      />

      {/* ── Toast ── */}
      {saveMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${
          saveMsg.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {saveMsg.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {saveMsg.text}
        </div>
      )}

      {/* ── Add form + actions ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
          <Plus size={16} className="text-blue-400" />
          Agregar conversion
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          {/* From unit */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
              Unidad origen
            </label>
            <select
              value={formFrom}
              onChange={e => setFormFrom(e.target.value)}
              className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
            >
              {UNITS.map(u => (
                <option key={u} value={u}>{u} — {UNIT_LABELS[u]}</option>
              ))}
            </select>
          </div>

          {/* Factor */}
          <div className="w-28">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
              Factor
            </label>
            <input
              type="number"
              step="any"
              min="0.001"
              value={formFactor}
              onChange={e => setFormFactor(e.target.value)}
              className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* To unit */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
              Unidad destino
            </label>
            <select
              value={formTo}
              onChange={e => setFormTo(e.target.value)}
              className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
            >
              {UNITS.map(u => (
                <option key={u} value={u}>{u} — {UNIT_LABELS[u]}</option>
              ))}
            </select>
          </div>

          {/* Product-specific toggle + field */}
          {showProductField && (
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Producto (opcional)
              </label>
              <input
                type="text"
                placeholder="Ej. Leche Alpura"
                value={formProductName}
                onChange={e => setFormProductName(e.target.value)}
                className="w-full h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] px-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setShowProductField(!showProductField)}
              className={`h-10 px-3 rounded-lg border text-xs font-medium transition-colors ${
                showProductField
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                  : 'bg-[var(--surface-2)] border-[var(--accent-line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
              title="Conversion por producto"
            >
              <Package size={14} />
            </button>
            <button
              onClick={addConversion}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Plus size={14} />
              Agregar
            </button>
          </div>
        </div>

        {/* Preview */}
        {formFactor && parseFloat(formFactor) > 0 && formFrom !== formTo && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-xs text-[var(--text-3)]">
            1 {formFrom} = {parseFloat(formFactor).toLocaleString('es-MX')} {formTo}
            {showProductField && formProductName && (
              <span className="text-purple-400 ml-2">(solo para {formProductName})</span>
            )}
          </div>
        )}
      </div>

      {/* ── Actions row ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={loadPresets}
          className="h-9 px-4 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/20 text-amber-300 text-xs font-medium transition-colors flex items-center gap-2"
        >
          <Zap size={14} />
          Cargar conversiones estandar
        </button>

        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            placeholder="Buscar unidad o producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-line)] pl-9 pr-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="text-xs text-[var(--text-4)] font-mono">
          {conversions.length} conversion{conversions.length !== 1 ? 'es' : ''}
        </div>
      </div>

      {/* ── Generic conversions table ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
        <div className="px-5 py-4 border-b border-[var(--accent-line)]">
          <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-blue-400" />
            Conversiones generales
          </h3>
        </div>
        {genericConversions.length === 0 ? (
          <div className="p-12 text-center">
            <ArrowRightLeft size={32} className="mx-auto text-[var(--text-4)] mb-3" />
            <p className="text-sm text-[var(--text-3)]">No hay conversiones generales</p>
            <p className="text-xs text-[var(--text-4)] mt-1">Agrega conversiones arriba o carga las estandar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--accent-line)]">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Unidad origen</th>
                  <th className="px-4 py-3 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Factor</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Unidad destino</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Equivalencia</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {genericConversions.map(c => (
                  <tr key={c.id} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-xs font-mono font-semibold">{c.from_unit}</span>
                        <span className="text-[var(--text-4)] text-xs">{UNIT_LABELS[c.from_unit]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {editingId === c.id ? (
                        <input
                          type="number"
                          step="any"
                          value={editFactor}
                          onChange={e => setEditFactor(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && confirmEdit(c.id)}
                          autoFocus
                          className="w-24 h-8 rounded-lg bg-[var(--surface-2)] border border-blue-500 px-2 text-sm text-[var(--text-1)] font-mono text-center focus:outline-none"
                        />
                      ) : (
                        <span className="font-mono text-sm font-semibold text-[var(--text-1)] tnum">
                          {c.factor.toLocaleString('es-MX', { maximumFractionDigits: 6 })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-xs font-mono font-semibold">{c.to_unit}</span>
                        <span className="text-[var(--text-4)] text-xs">{UNIT_LABELS[c.to_unit]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">
                      1 {c.from_unit} = {c.factor.toLocaleString('es-MX', { maximumFractionDigits: 6 })} {c.to_unit}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {editingId === c.id ? (
                          <>
                            <button
                              onClick={() => confirmEdit(c.id)}
                              className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                              title="Confirmar"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-4)] transition-colors"
                              title="Cancelar"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(c)}
                              className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"
                              title="Editar factor"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => deleteConversion(c.id)}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Product-specific conversions ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
        <div className="px-5 py-4 border-b border-[var(--accent-line)]">
          <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
            <Package size={16} className="text-purple-400" />
            Conversiones por producto
          </h3>
          <p className="text-xs text-[var(--text-4)] mt-1">Conversiones especificas de un producto (ej. 1 caja de leche = 12 litros)</p>
        </div>
        {productConversions.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={32} className="mx-auto text-[var(--text-4)] mb-3" />
            <p className="text-sm text-[var(--text-3)]">No hay conversiones por producto</p>
            <p className="text-xs text-[var(--text-4)] mt-1">Usa el boton de producto al agregar una conversion</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--accent-line)]">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Producto</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Origen</th>
                  <th className="px-4 py-3 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Factor</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Destino</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productConversions.map(c => (
                  <tr key={c.id} className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-medium text-purple-300">{c.product_name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-xs font-mono font-semibold">{c.from_unit}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {editingId === c.id ? (
                        <input
                          type="number"
                          step="any"
                          value={editFactor}
                          onChange={e => setEditFactor(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && confirmEdit(c.id)}
                          autoFocus
                          className="w-24 h-8 rounded-lg bg-[var(--surface-2)] border border-blue-500 px-2 text-sm text-[var(--text-1)] font-mono text-center focus:outline-none"
                        />
                      ) : (
                        <span className="font-mono text-sm font-semibold text-[var(--text-1)] tnum">
                          {c.factor.toLocaleString('es-MX', { maximumFractionDigits: 6 })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-xs font-mono font-semibold">{c.to_unit}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {editingId === c.id ? (
                          <>
                            <button onClick={() => confirmEdit(c.id)} className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400 transition-colors"><Check size={14} /></button>
                            <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-4)] transition-colors"><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"><Pencil size={14} /></button>
                            <button onClick={() => deleteConversion(c.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Save indicator ── */}
      {saving && (
        <div className="fixed bottom-6 right-6 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 shadow-xl">
          <Loader2 size={14} className="animate-spin" />
          Guardando...
        </div>
      )}
    </div>
  )
}
