'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Plus,
  Search,
  FileText,
  RefreshCw,
  Loader2,
  Check,
  X,
  Filter,
  ReceiptText,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import { formatCurrency } from '@/lib/format'

// ── Types ───────────────────────────────────────────────────────────

const TIPOS = ['devolucion', 'descuento', 'error', 'otro'] as const
type TipoNota = (typeof TIPOS)[number]

const TIPO_LABELS: Record<TipoNota, string> = {
  devolucion: 'Devolucion',
  descuento: 'Descuento',
  error: 'Error',
  otro: 'Otro',
}

const TIPO_COLORS: Record<TipoNota, string> = {
  devolucion: 'bg-purple-500/20 text-purple-400',
  descuento: 'bg-blue-500/20 text-blue-400',
  error: 'bg-red-500/20 text-red-400',
  otro: 'bg-zinc-500/20 text-zinc-400',
}

type Status = 'pendiente' | 'aplicada' | 'cancelada'

const STATUS_COLORS: Record<Status, string> = {
  pendiente: 'bg-amber-500/20 text-amber-400',
  aplicada: 'bg-emerald-500/20 text-emerald-400',
  cancelada: 'bg-red-500/20 text-red-400',
}

const STATUS_LABELS: Record<Status, string> = {
  pendiente: 'Pendiente',
  aplicada: 'Aplicada',
  cancelada: 'Cancelada',
}

interface CreditNote {
  id: string
  folio: string
  fecha: string
  tipo: TipoNota
  factura_ref: string
  cliente_proveedor: string
  monto: number
  motivo: string
  status: Status
  created_at: string
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ─────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function generateFolio() {
  const now = new Date()
  const seq = Math.floor(Math.random() * 9000) + 1000
  return `NC-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${seq}`
}

function generateDataKey(folio: string) {
  return `credit_notes_${folio}`
}

// ── Component ───────────────────────────────────────────────────────

export default function NotasCreditoPage() {
  const clientId = getActiveClientSlug()

  // State
  const [notes, setNotes] = useState<CreditNote[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form fields
  const [tipo, setTipo] = useState<TipoNota>('devolucion')
  const [facturaRef, setFacturaRef] = useState('')
  const [clienteProveedor, setClienteProveedor] = useState('')
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(todayStr())

  // Filters
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  // ── Load data ─────────────────────────────────────────────────────

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.credit_notes_%&order=fecha.desc&limit=500`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const rows: { data_key: string; fecha: string; data: unknown }[] = await res.json()
      const parsed: CreditNote[] = rows
        .map((row) => {
          const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>
          return {
            id: row.data_key,
            folio: (d.folio as string) || row.data_key.replace('credit_notes_', ''),
            fecha: (d.fecha as string) || row.fecha,
            tipo: (d.tipo as TipoNota) || 'otro',
            factura_ref: (d.factura_ref as string) || '',
            cliente_proveedor: (d.cliente_proveedor as string) || '',
            monto: Number(d.monto) || 0,
            motivo: (d.motivo as string) || '',
            status: (d.status as Status) || 'pendiente',
            created_at: row.fecha,
          }
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
      setNotes(parsed)
    } catch (err) {
      console.error('Error loading credit notes:', err)
    }
  }, [clientId])

  useEffect(() => {
    loadNotes().then(() => setLoading(false))
  }, [loadNotes])

  // ── Save note ─────────────────────────────────────────────────────

  async function handleSave() {
    const amount = parseFloat(monto)
    if (!amount || amount <= 0) return
    if (!clienteProveedor.trim()) return
    setSaving(true)

    const folio = generateFolio()
    const dataKey = generateDataKey(folio)
    const payload = {
      folio,
      fecha,
      tipo,
      factura_ref: facturaRef,
      cliente_proveedor: clienteProveedor,
      monto: amount,
      motivo,
      status: 'pendiente',
    }

    const ok = await sbPost('wansoft_data', clientId, {
      data_key: dataKey,
      fecha,
      data: payload,
    })

    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setTipo('devolucion')
      setFacturaRef('')
      setClienteProveedor('')
      setMonto('')
      setMotivo('')
      setFecha(todayStr())
      setShowForm(false)
      await loadNotes()
    }
    setSaving(false)
  }

  // ── Update status ─────────────────────────────────────────────────

  async function updateStatus(note: CreditNote, newStatus: Status) {
    const dataKey = note.id
    const payload = {
      folio: note.folio,
      fecha: note.fecha,
      tipo: note.tipo,
      factura_ref: note.factura_ref,
      cliente_proveedor: note.cliente_proveedor,
      monto: note.monto,
      motivo: note.motivo,
      status: newStatus,
    }

    const ok = await sbPost('wansoft_data', clientId, {
      data_key: dataKey,
      fecha: note.fecha,
      data: payload,
    }, { upsert: true })

    if (ok) await loadNotes()
  }

  // ── Computed ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = notes
    if (filterTipo) list = list.filter((n) => n.tipo === filterTipo)
    if (filterStatus) list = list.filter((n) => n.status === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (n) =>
          n.folio.toLowerCase().includes(q) ||
          n.cliente_proveedor.toLowerCase().includes(q) ||
          n.factura_ref.toLowerCase().includes(q) ||
          n.motivo.toLowerCase().includes(q)
      )
    }
    return list
  }, [notes, filterTipo, filterStatus, search])

  const totalPendiente = useMemo(
    () => notes.filter((n) => n.status === 'pendiente').reduce((s, n) => s + n.monto, 0),
    [notes]
  )
  const totalAplicada = useMemo(
    () => notes.filter((n) => n.status === 'aplicada').reduce((s, n) => s + n.monto, 0),
    [notes]
  )
  const totalNotas = notes.length

  // ── Render ────────────────────────────────────────────────────────

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const labelCls = 'block text-xs font-medium text-[var(--text-2)] mb-1'

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Notas de Credito"
        subtitle="Correcciones y ajustes a facturas"
        action={
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Cancelar' : 'Nueva Nota'}
          </button>
        }
      />

      {/* ── KPI Row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Total Notas</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalNotas}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Pendientes</p>
          <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalPendiente)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Aplicadas</p>
          <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalAplicada)}</p>
        </div>
      </div>

      {/* ── Create Form ──────────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-6 mb-6">
          <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">Nueva Nota de Credito</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoNota)}
                className={inputCls}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Factura Original (Referencia)</label>
              <input
                type="text"
                value={facturaRef}
                onChange={(e) => setFacturaRef(e.target.value)}
                placeholder="Ej. FAC-2026-001"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cliente / Proveedor</label>
              <input
                type="text"
                value={clienteProveedor}
                onChange={(e) => setClienteProveedor(e.target.value)}
                placeholder="Nombre"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Monto (MXN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className={labelCls}>Motivo</label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Razon de la nota de credito"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={handleSave}
              disabled={saving || !monto || !clienteProveedor.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : (
                <ReceiptText className="h-4 w-4" />
              )}
              {saving ? 'Guardando...' : saved ? 'Guardado' : 'Crear Nota'}
            </button>
          </div>
        </div>
      )}

      {/* ── Search & Filters ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por folio, cliente, factura..."
            className={`${inputCls} pl-9`}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--text-2)] hover:bg-white/10 transition-colors"
        >
          <Filter className="h-4 w-4" />
          Filtros
        </button>
        <button
          onClick={() => { setLoading(true); loadNotes().then(() => setLoading(false)) }}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--text-2)] hover:bg-white/10 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className={`${inputCls} w-auto`}
          >
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>{TIPO_LABELS[t]}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`${inputCls} w-auto`}
          >
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="aplicada">Aplicada</option>
            <option value="cancelada">Cancelada</option>
          </select>
          {(filterTipo || filterStatus) && (
            <button
              onClick={() => { setFilterTipo(''); setFilterStatus('') }}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-3)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--text-3)]">
          <FileText className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No hay notas de credito</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Folio</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Referencia</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Cliente/Proveedor</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Monto</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((note) => (
                <tr key={note.id} className="hover:bg-white/[.02] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-1)]">{note.folio}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{note.fecha}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_COLORS[note.tipo]}`}>
                      {TIPO_LABELS[note.tipo]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{note.factura_ref || '-'}</td>
                  <td className="px-4 py-3 text-[var(--text-1)]">{note.cliente_proveedor}</td>
                  <td className="px-4 py-3 text-right font-medium text-[var(--text-1)]">{formatCurrency(note.monto)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[note.status]}`}>
                      {STATUS_LABELS[note.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {note.status === 'pendiente' && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => updateStatus(note, 'aplicada')}
                          className="rounded p-1 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          title="Aplicar"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => updateStatus(note, 'cancelada')}
                          className="rounded p-1 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Cancelar"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
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
