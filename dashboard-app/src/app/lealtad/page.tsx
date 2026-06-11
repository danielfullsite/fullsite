'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Star, Gift, Percent, Plus, Pencil, Trash2, Save, X,
  Search, Award, Coffee, Sparkles, Clock, ArrowRight, Settings,
  Crown, Coins, ShoppingBag, PartyPopper, Cake,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

// ─── Types ───────────────────────────────────────────────────────────
interface LoyaltyConfig {
  points_per_peso: number       // e.g. 0.1 = 1 point per $10
  redemption_rate: number       // e.g. 0.5 = 100 pts = $50
  welcome_bonus: number
  birthday_bonus: number
  min_redemption: number        // min points to redeem
  program_name: string
  active: boolean
}

interface Reward {
  id: string
  name: string
  points_cost: number
  type: 'discount' | 'free_item' | 'experience'
  description: string
  active: boolean
}

interface CustomerPoints {
  id: string
  name: string
  phone: string
  points_balance: number
  points_earned: number
  points_redeemed: number
  last_activity: string | null
}

interface ActivityLog {
  id: string
  customer_name: string
  type: 'earn' | 'redeem' | 'bonus' | 'welcome' | 'birthday'
  points: number
  description: string
  timestamp: string
}

type Tab = 'config' | 'rewards' | 'customers' | 'activity'

// ─── Storage ─────────────────────────────────────────────────────────
const KEYS = {
  config: 'loyalty_config',
  rewards: 'loyalty_rewards',
  customers: 'loyalty_points',
  activity: 'loyalty_activity',
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function save<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data))
}

function uuid(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const DEFAULT_CONFIG: LoyaltyConfig = {
  points_per_peso: 0.1,
  redemption_rate: 0.5,
  welcome_bonus: 50,
  birthday_bonus: 100,
  min_redemption: 100,
  program_name: 'AMALAY Rewards',
  active: true,
}

const REWARD_TYPE_LABELS: Record<Reward['type'], string> = {
  discount: 'Descuento',
  free_item: 'Producto gratis',
  experience: 'Experiencia',
}

const REWARD_TYPE_ICONS: Record<Reward['type'], typeof Gift> = {
  discount: Percent,
  free_item: Coffee,
  experience: Sparkles,
}

const TYPE_COLORS: Record<Reward['type'], string> = {
  discount: 'text-emerald-400 bg-emerald-500/15',
  free_item: 'text-amber-400 bg-amber-500/15',
  experience: 'text-purple-400 bg-purple-500/15',
}

// ─── Component ───────────────────────────────────────────────────────
export default function LealtadPage() {
  const [tab, setTab] = useState<Tab>('config')
  const [config, setConfig] = useState<LoyaltyConfig>(DEFAULT_CONFIG)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [customers, setCustomers] = useState<CustomerPoints[]>([])
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [editingReward, setEditingReward] = useState<Reward | null>(null)
  const [isNewReward, setIsNewReward] = useState(false)
  const [search, setSearch] = useState('')
  const [configDirty, setConfigDirty] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  // Load from localStorage
  useEffect(() => {
    setConfig(load(KEYS.config, DEFAULT_CONFIG))
    setRewards(load(KEYS.rewards, []))
    setCustomers(load(KEYS.customers, []))
    setActivity(load(KEYS.activity, []))
  }, [])

  // ─── KPI calculations ──────────────────────────────────────────────
  const totalCustomers = customers.length
  const totalEarned = customers.reduce((s, c) => s + c.points_earned, 0)
  const totalRedeemed = customers.reduce((s, c) => s + c.points_redeemed, 0)
  const redemptionRate = totalEarned > 0 ? ((totalRedeemed / totalEarned) * 100) : 0

  // ─── Config handlers ──────────────────────────────────────────────
  const updateConfig = (patch: Partial<LoyaltyConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }))
    setConfigDirty(true)
  }

  const saveConfig = () => {
    save(KEYS.config, config)
    setConfigDirty(false)
    showToast('Configuracion guardada')
  }

  // ─── Reward handlers ──────────────────────────────────────────────
  const emptyReward: Reward = { id: '', name: '', points_cost: 0, type: 'discount', description: '', active: true }

  const startNewReward = () => {
    setEditingReward({ ...emptyReward, id: uuid() })
    setIsNewReward(true)
  }

  const saveReward = () => {
    if (!editingReward || !editingReward.name || editingReward.points_cost <= 0) return
    let updated: Reward[]
    if (isNewReward) {
      updated = [...rewards, editingReward]
    } else {
      updated = rewards.map(r => r.id === editingReward.id ? editingReward : r)
    }
    setRewards(updated)
    save(KEYS.rewards, updated)
    setEditingReward(null)
    setIsNewReward(false)
    showToast(isNewReward ? 'Recompensa creada' : 'Recompensa actualizada')
  }

  const deleteReward = (id: string) => {
    const updated = rewards.filter(r => r.id !== id)
    setRewards(updated)
    save(KEYS.rewards, updated)
    showToast('Recompensa eliminada')
  }

  // ─── Filtered customers ──────────────────────────────────────────
  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  )

  const tabs: { key: Tab; label: string; icon: typeof Settings }[] = [
    { key: 'config', label: 'Configuracion', icon: Settings },
    { key: 'rewards', label: 'Recompensas', icon: Gift },
    { key: 'customers', label: 'Clientes', icon: Users },
    { key: 'activity', label: 'Actividad', icon: Clock },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Programa de Lealtad"
        subtitle="Puntos y recompensas"
        eyebrow="FIDELIZACION"
        action={
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
              config.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.active ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {config.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        }
      />

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KPICard label="Total clientes" value={totalCustomers.toLocaleString()} icon={Users} accentClass="kpi-accent-blue" index={0} />
        <KPICard label="Puntos emitidos" value={totalEarned.toLocaleString()} icon={Coins} accentClass="kpi-accent-green" index={1} />
        <KPICard label="Puntos canjeados" value={totalRedeemed.toLocaleString()} icon={Gift} accentClass="kpi-accent-amber" index={2} />
        <KPICard label="Tasa de redencion" value={`${redemptionRate.toFixed(1)}%`} icon={Percent} accentClass="kpi-accent-purple" index={3} />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 rounded-xl p-1" style={{ background: 'var(--surface)' }}>
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────── */}

      {/* CONFIG TAB */}
      {tab === 'config' && (
        <div className="space-y-4">
          {/* Program name + toggle */}
          <div className="rounded-2xl border border-[var(--accent-line)] p-5 sm:p-6" style={{ background: 'var(--bento-card)' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
                  <Crown size={20} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Nombre del programa</h3>
                  <p className="text-xs text-[var(--text-3)]">Como lo veran tus clientes</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.active}
                  onChange={e => updateConfig({ active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[var(--surface-2)] rounded-full peer peer-checked:bg-blue-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>
            <input
              type="text"
              value={config.program_name}
              onChange={e => updateConfig({ program_name: e.target.value })}
              className="w-full sm:w-96 px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          {/* Points config */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Earn rate */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <Coins size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Acumulacion de puntos</h3>
                  <p className="text-xs text-[var(--text-3)]">Puntos que gana el cliente por cada peso</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Puntos por cada $1 MXN</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={config.points_per_peso}
                    onChange={e => updateConfig({ points_per_peso: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-xs text-emerald-400">
                    <Star size={12} className="inline mr-1" />
                    Con un ticket de {formatCurrency(500)}, el cliente gana <strong>{Math.round(500 * config.points_per_peso)} puntos</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Redemption rate */}
            <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <Gift size={20} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Canje de puntos</h3>
                  <p className="text-xs text-[var(--text-3)]">Valor en pesos de cada punto canjeado</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Valor por punto (MXN)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={config.redemption_rate}
                    onChange={e => updateConfig({ redemption_rate: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Minimo de puntos para canjear</label>
                  <input
                    type="number"
                    min="0"
                    value={config.min_redemption}
                    onChange={e => updateConfig({ min_redemption: parseInt(e.target.value) || 0 })}
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400">
                    <Gift size={12} className="inline mr-1" />
                    100 puntos = <strong>{formatCurrency(100 * config.redemption_rate)}</strong> de descuento
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Bonuses */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
                  <PartyPopper size={20} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Bono de bienvenida</h3>
                  <p className="text-xs text-[var(--text-3)]">Puntos al registrarse por primera vez</p>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={config.welcome_bonus}
                onChange={e => updateConfig({ welcome_bonus: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <p className="mt-2 text-xs text-[var(--text-4)]">Equivale a {formatCurrency(config.welcome_bonus * config.redemption_rate)} en descuentos</p>
            </div>

            <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-pink-500/15 flex items-center justify-center">
                  <Cake size={20} className="text-pink-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">Bono de cumpleanos</h3>
                  <p className="text-xs text-[var(--text-3)]">Puntos extra en el mes de cumpleanos</p>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={config.birthday_bonus}
                onChange={e => updateConfig({ birthday_bonus: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <p className="mt-2 text-xs text-[var(--text-4)]">Equivale a {formatCurrency(config.birthday_bonus * config.redemption_rate)} en descuentos</p>
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={saveConfig}
              disabled={!configDirty}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                configDirty
                  ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/25'
                  : 'bg-[var(--surface-2)] text-[var(--text-4)] cursor-not-allowed'
              }`}
            >
              <Save size={14} />
              Guardar configuracion
            </button>
          </div>
        </div>
      )}

      {/* REWARDS TAB */}
      {tab === 'rewards' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Catalogo de recompensas</h3>
            <button
              onClick={startNewReward}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/25"
            >
              <Plus size={14} />
              Agregar recompensa
            </button>
          </div>

          {/* Reward form */}
          {editingReward && (
            <div className="rounded-2xl border border-blue-500/30 p-5" style={{ background: 'var(--bento-card)' }}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-[var(--text-1)]">{isNewReward ? 'Nueva recompensa' : 'Editar recompensa'}</h4>
                <button onClick={() => { setEditingReward(null); setIsNewReward(false) }} className="text-[var(--text-4)] hover:text-[var(--text-1)]">
                  <X size={16} />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Nombre</label>
                  <input
                    type="text"
                    value={editingReward.name}
                    onChange={e => setEditingReward({ ...editingReward, name: e.target.value })}
                    placeholder="Ej: Cafe gratis, 10% descuento..."
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Costo en puntos</label>
                  <input
                    type="number"
                    min="1"
                    value={editingReward.points_cost}
                    onChange={e => setEditingReward({ ...editingReward, points_cost: parseInt(e.target.value) || 0 })}
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Tipo</label>
                  <select
                    value={editingReward.type}
                    onChange={e => setEditingReward({ ...editingReward, type: e.target.value as Reward['type'] })}
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="discount">Descuento</option>
                    <option value="free_item">Producto gratis</option>
                    <option value="experience">Experiencia</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-3)] font-mono">Descripcion</label>
                  <input
                    type="text"
                    value={editingReward.description}
                    onChange={e => setEditingReward({ ...editingReward, description: e.target.value })}
                    placeholder="Descripcion breve..."
                    className="mt-1 w-full px-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <label className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                  <input
                    type="checkbox"
                    checked={editingReward.active}
                    onChange={e => setEditingReward({ ...editingReward, active: e.target.checked })}
                    className="rounded"
                  />
                  Activa
                </label>
                <button
                  onClick={saveReward}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                >
                  <Save size={14} />
                  Guardar
                </button>
              </div>
            </div>
          )}

          {/* Rewards list */}
          {rewards.length === 0 && !editingReward ? (
            <div className="rounded-2xl border border-dashed border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Gift size={28} className="text-amber-400" />
              </div>
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">Sin recompensas</h3>
              <p className="text-xs text-[var(--text-3)] mb-4 max-w-sm mx-auto">
                Agrega recompensas al catalogo para que tus clientes puedan canjear sus puntos por descuentos, productos gratis o experiencias.
              </p>
              <button
                onClick={startNewReward}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                <Plus size={14} />
                Crear primera recompensa
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rewards.map(r => {
                const TypeIcon = REWARD_TYPE_ICONS[r.type]
                const colorClass = TYPE_COLORS[r.type]
                return (
                  <div
                    key={r.id}
                    className={`rounded-2xl border border-[var(--accent-line)] p-4 transition-all hover:border-blue-500/30 ${
                      !r.active ? 'opacity-50' : ''
                    }`}
                    style={{ background: 'var(--bento-card)' }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClass}`}>
                        <TypeIcon size={18} />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingReward(r); setIsNewReward(false) }}
                          className="p-1.5 rounded-lg text-[var(--text-4)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteReward(r.id)}
                          className="p-1.5 rounded-lg text-[var(--text-4)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <h4 className="text-sm font-bold text-[var(--text-1)] mb-0.5">{r.name}</h4>
                    {r.description && <p className="text-xs text-[var(--text-3)] mb-2">{r.description}</p>}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-[var(--text-3)]">{REWARD_TYPE_LABELS[r.type]}</span>
                      <span className="inline-flex items-center gap-1 text-sm font-black text-[var(--text-1)]">
                        <Star size={12} className="text-amber-400" />
                        {r.points_cost.toLocaleString()} pts
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* CUSTOMERS TAB */}
      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
            <span className="text-xs text-[var(--text-3)] font-mono">{filteredCustomers.length} clientes</span>
          </div>

          {customers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                <Users size={28} className="text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">Sin clientes registrados</h3>
              <p className="text-xs text-[var(--text-3)] mb-4 max-w-sm mx-auto">
                Los clientes se registraran automaticamente al realizar su primera compra con el programa de lealtad activo.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs bg-[var(--surface-2)] text-[var(--text-3)]">
                <Award size={14} />
                Conectado con POS para registro automatico
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--accent-line)]">
                      <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Cliente</th>
                      <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Telefono</th>
                      <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Balance</th>
                      <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Ganados</th>
                      <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Canjeados</th>
                      <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">Ultima actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(c => (
                      <tr key={c.id} className="border-b border-[var(--accent-line)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 font-medium text-[var(--text-1)]">{c.name}</td>
                        <td className="px-4 py-3 text-[var(--text-3)] font-mono text-xs">{c.phone}</td>
                        <td className="px-4 py-3 text-right font-black text-[var(--text-1)]">
                          <span className="inline-flex items-center gap-1">
                            <Star size={12} className="text-amber-400" />
                            {c.points_balance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-400 font-mono text-xs">{c.points_earned.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-amber-400 font-mono text-xs">{c.points_redeemed.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-[var(--text-4)] text-xs">{c.last_activity ?? '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ACTIVITY TAB */}
      {tab === 'activity' && (
        <div className="space-y-4">
          {activity.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                <Clock size={28} className="text-purple-400" />
              </div>
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">Sin actividad registrada</h3>
              <p className="text-xs text-[var(--text-3)] max-w-sm mx-auto">
                Aqui aparecera el historial de puntos ganados, canjeados y bonos otorgados a tus clientes.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--accent-line)] divide-y divide-[var(--accent-line)]" style={{ background: 'var(--bento-card)' }}>
              {activity.slice(0, 50).map(a => {
                const isEarn = a.type === 'earn' || a.type === 'bonus' || a.type === 'welcome' || a.type === 'birthday'
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isEarn ? 'bg-emerald-500/15' : 'bg-amber-500/15'
                    }`}>
                      {a.type === 'earn' && <Coins size={14} className="text-emerald-400" />}
                      {a.type === 'redeem' && <Gift size={14} className="text-amber-400" />}
                      {a.type === 'bonus' && <Star size={14} className="text-emerald-400" />}
                      {a.type === 'welcome' && <PartyPopper size={14} className="text-emerald-400" />}
                      {a.type === 'birthday' && <Cake size={14} className="text-emerald-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-1)]">
                        <span className="font-bold">{a.customer_name}</span>
                        <span className="text-[var(--text-3)]"> — {a.description}</span>
                      </p>
                      <p className="text-[10px] text-[var(--text-4)] font-mono">{a.timestamp}</p>
                    </div>
                    <span className={`text-sm font-black ${isEarn ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {isEarn ? '+' : '-'}{a.points.toLocaleString()} pts
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300">
          {toast}
        </div>
      )}
    </div>
  )
}
