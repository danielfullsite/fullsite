'use client'

import { useState, useEffect, useCallback } from 'react'
import { useClientId } from '@/hooks/useClientId'
import { Plus, Trash2, Save, X, Tag, Percent, DollarSign, Zap, ToggleLeft, ToggleRight, Calendar, Clock, ShoppingCart, Layers, Package } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const DAYS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']
const PROMO_TYPES = [
  { value: 'percentage', label: '% Descuento', icon: Percent },
  { value: 'fixed', label: '$ Fijo', icon: DollarSign },
  { value: '2x1', label: '2x1', icon: Layers },
  { value: 'combo', label: 'Combo', icon: Package },
] as const

const APPLIES_TO_OPTIONS = [
  { value: 'order', label: 'Toda la orden', icon: ShoppingCart },
  { value: 'category', label: 'Categoria', icon: Tag },
  { value: 'item', label: 'Producto', icon: Package },
] as const

type PromoType = 'percentage' | 'fixed' | '2x1' | 'combo'
type AppliesTo = 'order' | 'category' | 'item'

interface PromoSchedule {
  days: number[]
  start_time: string
  end_time: string
  start_date: string
  end_date: string
}

interface Promotion {
  id?: string
  name: string
  type: PromoType
  value: number
  applies_to: AppliesTo
  category_ids: string[]
  item_ids: string[]
  schedule: PromoSchedule
  auto_apply: boolean
  max_per_day: number | null
  active: boolean
  created_at?: string
  client_id?: string
}

const emptySchedule: PromoSchedule = { days: [], start_time: '', end_time: '', start_date: '', end_date: '' }
const emptyPromo: Promotion = {
  name: '', type: 'percentage', value: 0, applies_to: 'order',
  category_ids: [], item_ids: [], schedule: { ...emptySchedule },
  auto_apply: false, max_per_day: null, active: true,
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts?.method === 'DELETE' ? '' : 'return=representation',
      ...opts?.headers,
    },
  })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function getStatus(p: Promotion): 'active' | 'inactive' | 'scheduled' {
  if (!p.active) return 'inactive'
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  if (p.schedule.start_date && p.schedule.start_date > today) return 'scheduled'
  if (p.schedule.end_date && p.schedule.end_date < today) return 'inactive'
  return 'active'
}

function statusBadge(status: 'active' | 'inactive' | 'scheduled') {
  const styles = {
    active: 'bg-emerald-500/15 text-emerald-400',
    inactive: 'bg-[var(--surface-2)] text-[var(--text-3)]',
    scheduled: 'bg-amber-500/15 text-amber-400',
  }
  const labels = { active: 'Activa', inactive: 'Inactiva', scheduled: 'Programada' }
  return (
    <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function typeLabel(type: PromoType) {
  return PROMO_TYPES.find(t => t.value === type)?.label || type
}

export default function PromocionesPage() {
  const CLIENT_ID = useClientId()
  const [promos, setPromos] = useState<Promotion[]>([])
  const [editing, setEditing] = useState<Promotion | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'scheduled'>('all')

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    if (!CLIENT_ID) return
    setLoading(true)
    try {
      const data = await api(`pos_promotions?client_id=eq.${CLIENT_ID}&order=created_at.desc`)
      setPromos(data || [])
    } catch {
      setPromos([])
    }
    setLoading(false)
  }, [CLIENT_ID])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.name) { showToast('Nombre es requerido', 'err'); return }
    if ((editing.type === 'percentage' || editing.type === 'fixed') && !editing.value) {
      showToast('Valor del descuento es requerido', 'err'); return
    }
    try {
      const payload = {
        name: editing.name,
        type: editing.type,
        value: editing.value,
        applies_to: editing.applies_to,
        category_ids: editing.category_ids,
        item_ids: editing.item_ids,
        schedule: editing.schedule,
        auto_apply: editing.auto_apply,
        max_per_day: editing.max_per_day,
        active: editing.active,
        client_id: CLIENT_ID,
      }
      if (editing.id) {
        await api(`pos_promotions?id=eq.${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        showToast(`"${editing.name}" actualizada`)
      } else {
        await api('pos_promotions', { method: 'POST', body: JSON.stringify(payload) })
        showToast(`"${editing.name}" creada`)
      }
      setEditing(null)
      load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      showToast(msg, 'err')
    }
  }

  const toggleActive = async (p: Promotion) => {
    try {
      await api(`pos_promotions?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !p.active }),
      })
      showToast(`"${p.name}" ${!p.active ? 'activada' : 'desactivada'}`)
      load()
    } catch { showToast('Error al cambiar estado', 'err') }
  }

  const remove = async (p: Promotion) => {
    if (!confirm(`Eliminar "${p.name}"?`)) return
    try {
      await api(`pos_promotions?id=eq.${p.id}`, { method: 'DELETE' })
      showToast(`"${p.name}" eliminada`)
      load()
    } catch { showToast('Error al eliminar', 'err') }
  }

  const toggleDay = (day: number) => {
    if (!editing) return
    const days = editing.schedule.days.includes(day)
      ? editing.schedule.days.filter(d => d !== day)
      : [...editing.schedule.days, day].sort()
    setEditing({ ...editing, schedule: { ...editing.schedule, days } })
  }

  const filtered = promos.filter(p => {
    if (filter === 'all') return true
    return getStatus(p) === filter
  })

  const counts = {
    all: promos.length,
    active: promos.filter(p => getStatus(p) === 'active').length,
    inactive: promos.filter(p => getStatus(p) === 'inactive').length,
    scheduled: promos.filter(p => getStatus(p) === 'scheduled').length,
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Promociones"
        subtitle={`${promos.length} promociones configuradas`}
        eyebrow="Admin"
        action={
          <button
            onClick={() => setEditing({ ...emptyPromo })}
            className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm active:scale-95 transition-all"
          >
            <Plus size={18} /> Nueva promocion
          </button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {([['all', 'Todas'], ['active', 'Activas'], ['scheduled', 'Programadas'], ['inactive', 'Inactivas']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              filter === key
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-[var(--surface)] text-[var(--text-3)] border border-[var(--line)] hover:border-[var(--text-3)]'
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {/* Editor / Creator form */}
      {editing && (
        <div className="bg-[var(--surface)] border border-emerald-500/30 rounded-2xl p-6 mb-6 space-y-5">
          <h3 className="font-semibold text-[var(--text-1)] text-base">
            {editing.id ? `Editar: ${editing.name}` : 'Nueva promocion'}
          </h3>

          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 block">Nombre</label>
            <input
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder='Ej. "2x1 Margaritas", "Happy Hour -20%"'
              className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-2 block">Tipo de promocion</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PROMO_TYPES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setEditing({ ...editing, type: value })}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    editing.type === value
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 shadow-sm'
                      : 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] hover:border-[var(--text-3)]'
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Value (for percentage and fixed) */}
          {(editing.type === 'percentage' || editing.type === 'fixed') && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 block">
                {editing.type === 'percentage' ? 'Porcentaje de descuento' : 'Monto fijo de descuento'}
              </label>
              <div className="relative w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">
                  {editing.type === 'percentage' ? '%' : '$'}
                </span>
                <input
                  type="number"
                  min={0}
                  max={editing.type === 'percentage' ? 100 : 99999}
                  value={editing.value || ''}
                  onChange={e => setEditing({ ...editing, value: Number(e.target.value) })}
                  placeholder={editing.type === 'percentage' ? '20' : '50'}
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl pl-8 pr-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
          )}

          {/* Combo price */}
          {editing.type === 'combo' && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 block">
                Precio combo (MXN)
              </label>
              <div className="relative w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  value={editing.value || ''}
                  onChange={e => setEditing({ ...editing, value: Number(e.target.value) })}
                  placeholder="199"
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl pl-8 pr-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
          )}

          {/* Applies to */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-2 block">Aplica a</label>
            <div className="grid grid-cols-3 gap-2">
              {APPLIES_TO_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setEditing({ ...editing, applies_to: value })}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    editing.applies_to === value
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                      : 'bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] hover:border-[var(--text-3)]'
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Category / Item IDs */}
          {editing.applies_to === 'category' && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 block">
                IDs de categorias (separados por coma)
              </label>
              <input
                value={editing.category_ids.join(', ')}
                onChange={e => setEditing({ ...editing, category_ids: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="bebidas, postres, chilaquiles"
                className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          )}

          {editing.applies_to === 'item' && (
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-1.5 block">
                IDs de productos (separados por coma)
              </label>
              <input
                value={editing.item_ids.join(', ')}
                onChange={e => setEditing({ ...editing, item_ids: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="margarita-clasica, cerveza-artesanal"
                className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          )}

          {/* Schedule section */}
          <div className="border-t border-[var(--line)] pt-5">
            <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3 block flex items-center gap-1.5">
              <Calendar size={14} /> Horario y vigencia
            </label>

            {/* Days of week */}
            <div className="mb-4">
              <p className="text-xs text-[var(--text-3)] mb-2">Dias de la semana (vacio = todos los dias)</p>
              <div className="flex gap-1.5">
                {DAYS.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`w-12 h-11 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                      editing.schedule.days.includes(i)
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--line)]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Time range */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5 flex items-center gap-1"><Clock size={12} /> Hora inicio</p>
                <input
                  type="time"
                  value={editing.schedule.start_time}
                  onChange={e => setEditing({ ...editing, schedule: { ...editing.schedule, start_time: e.target.value } })}
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5 flex items-center gap-1"><Clock size={12} /> Hora fin</p>
                <input
                  type="time"
                  value={editing.schedule.end_time}
                  onChange={e => setEditing({ ...editing, schedule: { ...editing.schedule, end_time: e.target.value } })}
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5">Fecha inicio (vacio = sin limite)</p>
                <input
                  type="date"
                  value={editing.schedule.start_date}
                  onChange={e => setEditing({ ...editing, schedule: { ...editing.schedule, start_date: e.target.value } })}
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5">Fecha fin (vacio = sin limite)</p>
                <input
                  type="date"
                  value={editing.schedule.end_date}
                  onChange={e => setEditing({ ...editing, schedule: { ...editing.schedule, end_date: e.target.value } })}
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
          </div>

          {/* Behavior section */}
          <div className="border-t border-[var(--line)] pt-5">
            <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3 block flex items-center gap-1.5">
              <Zap size={14} /> Comportamiento
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Auto-apply toggle */}
              <button
                onClick={() => setEditing({ ...editing, auto_apply: !editing.auto_apply })}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all border ${
                  editing.auto_apply
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text-2)]'
                }`}
              >
                {editing.auto_apply ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                <div className="text-left">
                  <p className="font-semibold">{editing.auto_apply ? 'Auto-aplicar' : 'Manual'}</p>
                  <p className="text-[11px] text-[var(--text-3)]">
                    {editing.auto_apply ? 'Se aplica automaticamente' : 'El mesero la selecciona'}
                  </p>
                </div>
              </button>

              {/* Max uses per day */}
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5">Usos max/dia (vacio = sin limite)</p>
                <input
                  type="number"
                  min={0}
                  value={editing.max_per_day ?? ''}
                  onChange={e => setEditing({ ...editing, max_per_day: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Sin limite"
                  className="w-full border border-[var(--line)] bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
          </div>

          {/* Active toggle */}
          <div className="border-t border-[var(--line)] pt-5">
            <button
              onClick={() => setEditing({ ...editing, active: !editing.active })}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all border ${
                editing.active
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {editing.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              {editing.active ? 'Promocion activa' : 'Promocion inactiva'}
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              onClick={() => setEditing(null)}
              className="flex items-center gap-1.5 px-5 py-3 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded-xl transition-colors"
            >
              <X size={16} /> Cancelar
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-sm active:scale-95 transition-all"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>
      )}

      {/* Promotions list */}
      {loading ? (
        <div className="text-center py-16 text-[var(--text-3)] text-sm">Cargando promociones...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-12 text-center">
          <Tag size={32} className="mx-auto mb-3 text-[var(--text-4)]" />
          <p className="text-[var(--text-3)] text-sm">
            {filter === 'all' ? 'No hay promociones configuradas' : `No hay promociones ${filter === 'active' ? 'activas' : filter === 'scheduled' ? 'programadas' : 'inactivas'}`}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => setEditing({ ...emptyPromo })}
              className="mt-4 px-4 py-2.5 bg-emerald-500/15 text-emerald-400 rounded-xl text-sm font-medium hover:bg-emerald-500/25 transition-colors"
            >
              Crear primera promocion
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => {
            const status = getStatus(p)
            const TypeIcon = PROMO_TYPES.find(t => t.value === p.type)?.icon || Tag
            return (
              <div
                key={p.id}
                className={`bg-[var(--surface)] border rounded-2xl p-5 transition-all hover:shadow-md ${
                  status === 'active' ? 'border-emerald-500/20' : 'border-[var(--line)]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                      <TypeIcon size={16} className="text-[var(--text-3)] shrink-0" />
                      <span className="font-semibold text-[var(--text-1)] text-base truncate">{p.name}</span>
                      {statusBadge(status)}
                      <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] px-2.5 py-1 rounded-full uppercase font-semibold">
                        {typeLabel(p.type)}
                      </span>
                      {p.auto_apply && (
                        <span className="text-[10px] bg-blue-500/15 text-blue-400 px-2.5 py-1 rounded-full uppercase font-semibold flex items-center gap-1">
                          <Zap size={10} /> Auto
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-3)]">
                      {/* Value */}
                      {p.type === 'percentage' && p.value > 0 && <span>{p.value}% descuento</span>}
                      {p.type === 'fixed' && p.value > 0 && <span>${p.value} descuento</span>}
                      {p.type === 'combo' && p.value > 0 && <span>Combo ${p.value}</span>}
                      {p.type === '2x1' && <span>2x1</span>}

                      {/* Applies to */}
                      <span>
                        {p.applies_to === 'order' && 'Toda la orden'}
                        {p.applies_to === 'category' && `Categorias: ${p.category_ids?.join(', ') || '-'}`}
                        {p.applies_to === 'item' && `Productos: ${p.item_ids?.join(', ') || '-'}`}
                      </span>

                      {/* Schedule info */}
                      {p.schedule?.days?.length > 0 && (
                        <span>{p.schedule.days.map(d => DAYS[d]).join(', ')}</span>
                      )}
                      {p.schedule?.start_time && p.schedule?.end_time && (
                        <span>{p.schedule.start_time} - {p.schedule.end_time}</span>
                      )}
                      {p.schedule?.start_date && <span>Desde {p.schedule.start_date}</span>}
                      {p.schedule?.end_date && <span>Hasta {p.schedule.end_date}</span>}

                      {/* Max per day */}
                      {p.max_per_day && <span>Max {p.max_per_day}/dia</span>}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleActive(p)}
                      title={p.active ? 'Desactivar' : 'Activar'}
                      className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 ${
                        p.active
                          ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400'
                          : 'bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-3)]'
                      }`}
                    >
                      {p.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                    <button
                      onClick={() => setEditing({ ...p, schedule: { ...emptySchedule, ...p.schedule } })}
                      className="w-11 h-11 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center transition-all active:scale-90"
                      title="Editar"
                    >
                      <Tag size={16} />
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="w-11 h-11 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-all active:scale-90"
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium ${
          toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
