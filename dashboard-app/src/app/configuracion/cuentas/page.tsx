'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Loader2,
  Landmark,
  Building2,
  ChevronRight,
  RefreshCw,
  Save,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import { formatCurrency } from '@/lib/format'

// ── Types ───────────────────────────────────────────────────────────

const TIPOS_CUENTA = ['activo', 'pasivo', 'ingreso', 'egreso', 'capital'] as const
type TipoCuenta = (typeof TIPOS_CUENTA)[number]

const TIPO_LABELS: Record<TipoCuenta, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  capital: 'Capital',
}

// DS v2.1 account-type badge tints — Activo=info, Pasivo=crit, Ingreso=ok(accent), Egreso=warn, Capital=violet(st-barra)
type TipoTint = { color: string; bg: string; border: string }
const TIPO_TINT: Record<TipoCuenta, TipoTint> = {
  activo:  { color: 'var(--info-ink)',   bg: 'var(--info-soft)',   border: 'color-mix(in srgb, var(--info) 38%, transparent)' },
  pasivo:  { color: 'var(--crit-ink)',   bg: 'var(--crit-soft)',   border: 'color-mix(in srgb, var(--crit) 35%, transparent)' },
  ingreso: { color: 'var(--accent-ink)', bg: 'var(--accent-soft)', border: 'var(--accent-line)' },
  egreso:  { color: 'var(--warn-ink)',   bg: 'var(--warn-soft)',   border: 'color-mix(in srgb, var(--warn) 38%, transparent)' },
  capital: { color: 'var(--st-barra)',   bg: 'color-mix(in srgb, var(--st-barra) 12%, transparent)', border: 'color-mix(in srgb, var(--st-barra) 38%, transparent)' },
}

// Tokens de estación DS v2.1 (violet st-barra — no viven en globals, scoped a esta página)
const CUENTAS_TOKENS = `
  .cta-scope{ --st-barra:#a78bfa; }
  [data-theme="light"] .cta-scope{ --st-barra:#7c3aed; }
`

interface CuentaContable {
  id: string
  codigo: string
  nombre: string
  tipo: TipoCuenta
  parent_id: string
}

interface CuentaBancaria {
  id: string
  banco: string
  numero_cuenta: string
  clabe: string
  titular: string
  saldo: number
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ─────────────────────────────────────────────────────────

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Component ───────────────────────────────────────────────────────

export default function CuentasPage() {
  const clientId = getActiveClientSlug()

  const [tab, setTab] = useState<'contables' | 'bancarias'>('contables')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── Cuentas Contables ─────────────────────────────────────────────
  const [cuentas, setCuentas] = useState<CuentaContable[]>([])
  const [showCuentaForm, setShowCuentaForm] = useState(false)
  const [editCuentaId, setEditCuentaId] = useState<string | null>(null)
  const [cuentaCodigo, setCuentaCodigo] = useState('')
  const [cuentaNombre, setCuentaNombre] = useState('')
  const [cuentaTipo, setCuentaTipo] = useState<TipoCuenta>('activo')
  const [cuentaParent, setCuentaParent] = useState('')

  // ── Cuentas Bancarias ─────────────────────────────────────────────
  const [bancos, setBancos] = useState<CuentaBancaria[]>([])
  const [showBancoForm, setShowBancoForm] = useState(false)
  const [editBancoId, setEditBancoId] = useState<string | null>(null)
  const [bancoNombre, setBancoNombre] = useState('')
  const [bancoNumero, setBancoNumero] = useState('')
  const [bancoClabe, setBancoClabe] = useState('')
  const [bancoTitular, setBancoTitular] = useState('')
  const [bancoSaldo, setBancoSaldo] = useState('')

  // ── Load data ─────────────────────────────────────────────────────

  const loadCuentas = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,data&client_id=eq.${clientId}&data_key=eq.chart_of_accounts`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const rows: { data_key: string; data: unknown }[] = await res.json()
      if (rows.length > 0) {
        const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
        if (Array.isArray(d)) setCuentas(d as CuentaContable[])
      }
    } catch (err) {
      console.error('Error loading chart of accounts:', err)
    }
  }, [clientId])

  const loadBancos = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,data&client_id=eq.${clientId}&data_key=eq.bank_accounts`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const rows: { data_key: string; data: unknown }[] = await res.json()
      if (rows.length > 0) {
        const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
        if (Array.isArray(d)) setBancos(d as CuentaBancaria[])
      }
    } catch (err) {
      console.error('Error loading bank accounts:', err)
    }
  }, [clientId])

  useEffect(() => {
    Promise.all([loadCuentas(), loadBancos()]).then(() => setLoading(false))
  }, [loadCuentas, loadBancos])

  // ── Save helpers ──────────────────────────────────────────────────

  async function saveCuentas(updated: CuentaContable[]) {
    setSaving(true)
    const ok = await sbPost('wansoft_data', clientId, {
      data_key: 'chart_of_accounts',
      fecha: new Date().toISOString().slice(0, 10),
      data: updated,
    }, { upsert: true })
    if (ok) {
      setCuentas(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  async function saveBancos(updated: CuentaBancaria[]) {
    setSaving(true)
    const ok = await sbPost('wansoft_data', clientId, {
      data_key: 'bank_accounts',
      fecha: new Date().toISOString().slice(0, 10),
      data: updated,
    }, { upsert: true })
    if (ok) {
      setBancos(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  // ── Cuenta CRUD ───────────────────────────────────────────────────

  function resetCuentaForm() {
    setCuentaCodigo('')
    setCuentaNombre('')
    setCuentaTipo('activo')
    setCuentaParent('')
    setEditCuentaId(null)
    setShowCuentaForm(false)
  }

  function startEditCuenta(c: CuentaContable) {
    setCuentaCodigo(c.codigo)
    setCuentaNombre(c.nombre)
    setCuentaTipo(c.tipo)
    setCuentaParent(c.parent_id)
    setEditCuentaId(c.id)
    setShowCuentaForm(true)
  }

  async function handleSaveCuenta() {
    if (!cuentaCodigo.trim() || !cuentaNombre.trim()) return
    let updated: CuentaContable[]
    if (editCuentaId) {
      updated = cuentas.map((c) =>
        c.id === editCuentaId
          ? { ...c, codigo: cuentaCodigo, nombre: cuentaNombre, tipo: cuentaTipo, parent_id: cuentaParent }
          : c
      )
    } else {
      const newCuenta: CuentaContable = {
        id: genId(),
        codigo: cuentaCodigo,
        nombre: cuentaNombre,
        tipo: cuentaTipo,
        parent_id: cuentaParent,
      }
      updated = [...cuentas, newCuenta]
    }
    await saveCuentas(updated)
    resetCuentaForm()
  }

  async function deleteCuenta(id: string) {
    const updated = cuentas.filter((c) => c.id !== id && c.parent_id !== id)
    await saveCuentas(updated)
  }

  // ── Banco CRUD ────────────────────────────────────────────────────

  function resetBancoForm() {
    setBancoNombre('')
    setBancoNumero('')
    setBancoClabe('')
    setBancoTitular('')
    setBancoSaldo('')
    setEditBancoId(null)
    setShowBancoForm(false)
  }

  function startEditBanco(b: CuentaBancaria) {
    setBancoNombre(b.banco)
    setBancoNumero(b.numero_cuenta)
    setBancoClabe(b.clabe)
    setBancoTitular(b.titular)
    setBancoSaldo(b.saldo.toString())
    setEditBancoId(b.id)
    setShowBancoForm(true)
  }

  async function handleSaveBanco() {
    if (!bancoNombre.trim() || !bancoNumero.trim()) return
    let updated: CuentaBancaria[]
    if (editBancoId) {
      updated = bancos.map((b) =>
        b.id === editBancoId
          ? { ...b, banco: bancoNombre, numero_cuenta: bancoNumero, clabe: bancoClabe, titular: bancoTitular, saldo: parseFloat(bancoSaldo) || 0 }
          : b
      )
    } else {
      const newBanco: CuentaBancaria = {
        id: genId(),
        banco: bancoNombre,
        numero_cuenta: bancoNumero,
        clabe: bancoClabe,
        titular: bancoTitular,
        saldo: parseFloat(bancoSaldo) || 0,
      }
      updated = [...bancos, newBanco]
    }
    await saveBancos(updated)
    resetBancoForm()
  }

  async function deleteBanco(id: string) {
    const updated = bancos.filter((b) => b.id !== id)
    await saveBancos(updated)
  }

  // ── Hierarchical rendering ────────────────────────────────────────

  const parentCuentas = cuentas.filter((c) => !c.parent_id)
  const childrenOf = (parentId: string) => cuentas.filter((c) => c.parent_id === parentId)

  // ── Render ────────────────────────────────────────────────────────

  const inputCls =
    'w-full rounded-[11px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-soft)]'
  const labelCls = 'block text-xs font-semibold text-[var(--text-3)] mb-1.5'
  const tabBtnStyle = (active: boolean) =>
    active
      ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'var(--accent-line)' }
      : { background: 'var(--surface-2)', color: 'var(--text-3)', borderColor: 'var(--line)' }

  if (loading) {
    return (
      <div className="cta-scope mx-auto max-w-6xl px-4 py-8">
        <style dangerouslySetInnerHTML={{ __html: CUENTAS_TOKENS }} />
        <PageHeader title="Cuentas Contables y Bancarias" subtitle="Configuracion contable" />
        <div className="flex flex-col items-center justify-center gap-2.5 py-20">
          <div className="w-[26px] h-[26px] border-[2.5px] rounded-full animate-spin" style={{ borderColor: 'var(--line)', borderTopColor: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Cargando cuentas…</span>
          <span className="text-xs" style={{ color: 'var(--text-4)' }}>Consultando configuración contable</span>
        </div>
      </div>
    )
  }

  return (
    <div className="cta-scope mx-auto max-w-6xl px-4 py-8">
      <style dangerouslySetInnerHTML={{ __html: CUENTAS_TOKENS }} />
      <PageHeader
        title="Cuentas Contables y Bancarias"
        subtitle="Configuracion contable"
        action={
          <button
            onClick={() => { setLoading(true); Promise.all([loadCuentas(), loadBancos()]).then(() => setLoading(false)) }}
            className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors min-h-[44px]"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
          >
            <RefreshCw className="h-4 w-4" />
            Recargar
          </button>
        }
      />

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-6">
        <button
          className="inline-flex items-center gap-2 rounded-[11px] border px-4 py-2.5 text-[13.5px] font-semibold transition-colors"
          style={tabBtnStyle(tab === 'contables')}
          onClick={() => setTab('contables')}
        >
          <Landmark className="h-4 w-4" />Cuentas Contables
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-[11px] border px-4 py-2.5 text-[13.5px] font-semibold transition-colors"
          style={tabBtnStyle(tab === 'bancarias')}
          onClick={() => setTab('bancarias')}
        >
          <Building2 className="h-4 w-4" />Cuentas Bancarias
        </button>
      </div>

      {/* ── Cuentas Contables Tab ────────────────────────────────── */}
      {tab === 'contables' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-[var(--text-3)]">{cuentas.length} cuenta{cuentas.length !== 1 ? 's' : ''} registrada{cuentas.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => { resetCuentaForm(); setShowCuentaForm(!showCuentaForm) }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold min-h-[44px] transition-[filter] hover:brightness-105" style={{ background: "linear-gradient(150deg, var(--accent-bright), var(--accent-deep))", color: "#04140d", boxShadow: "0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)" }}
            >
              {showCuentaForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showCuentaForm ? 'Cancelar' : 'Agregar Cuenta'}
            </button>
          </div>

          {/* Form */}
          {showCuentaForm && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-6 mb-6">
              <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">
                {editCuentaId ? 'Editar Cuenta' : 'Nueva Cuenta Contable'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Codigo</label>
                  <input
                    type="text"
                    value={cuentaCodigo}
                    onChange={(e) => setCuentaCodigo(e.target.value)}
                    placeholder="Ej. 1100"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Nombre</label>
                  <input
                    type="text"
                    value={cuentaNombre}
                    onChange={(e) => setCuentaNombre(e.target.value)}
                    placeholder="Ej. Bancos"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Tipo</label>
                  <select
                    value={cuentaTipo}
                    onChange={(e) => setCuentaTipo(e.target.value as TipoCuenta)}
                    className={inputCls}
                  >
                    {TIPOS_CUENTA.map((t) => (
                      <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cuenta Padre (opcional)</label>
                  <select
                    value={cuentaParent}
                    onChange={(e) => setCuentaParent(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">-- Sin padre (raiz) --</option>
                    {cuentas
                      .filter((c) => !c.parent_id && c.id !== editCuentaId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} - {c.nombre}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveCuenta}
                  disabled={saving || !cuentaCodigo.trim() || !cuentaNombre.trim()}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold min-h-[44px] transition-[filter] hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "linear-gradient(150deg, var(--accent-bright), var(--accent-deep))", color: "#04140d", boxShadow: "0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)" }}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Guardando...' : saved ? 'Guardado' : editCuentaId ? 'Actualizar' : 'Guardar'}
                </button>
              </div>
            </div>
          )}

          {/* Hierarchical List */}
          {cuentas.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed py-[34px] px-5 text-center" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
              <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                <Landmark className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>No hay cuentas contables registradas</span>
              <span className="text-xs" style={{ color: 'var(--text-4)' }}>Agrega la primera cuenta para construir tu catálogo.</span>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line-soft)]">
              {parentCuentas.map((cuenta) => {
                const children = childrenOf(cuenta.id)
                return (
                  <div key={cuenta.id}>
                    {/* Parent row */}
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-2)] transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-[var(--text-2)] w-16">{cuenta.codigo}</span>
                        <span className="text-sm font-semibold text-[var(--text-1)]">{cuenta.nombre}</span>
                        <span
                          className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold border"
                          style={{ color: TIPO_TINT[cuenta.tipo].color, background: TIPO_TINT[cuenta.tipo].bg, borderColor: TIPO_TINT[cuenta.tipo].border }}
                        >
                          {TIPO_LABELS[cuenta.tipo]}
                        </span>
                        {children.length > 0 && (
                          <span className="text-xs text-[var(--text-3)]">({children.length} sub)</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditCuenta(cuenta)}
                          className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteCuenta(cuenta.id)}
                          className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--crit-ink)] hover:bg-[var(--crit-soft)] transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {/* Children rows */}
                    {children.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center justify-between px-4 py-2.5 pl-10 hover:bg-[var(--surface-2)] transition-colors border-t border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--text-1)_2.5%,transparent)]"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronRight className="h-3 w-3 text-[var(--text-3)]" />
                          <span className="font-mono text-xs text-[var(--text-3)] w-16">{child.codigo}</span>
                          <span className="text-sm text-[var(--text-2)]">{child.nombre}</span>
                          <span
                            className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold border"
                            style={{ color: TIPO_TINT[child.tipo].color, background: TIPO_TINT[child.tipo].bg, borderColor: TIPO_TINT[child.tipo].border }}
                          >
                            {TIPO_LABELS[child.tipo]}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditCuenta(child)}
                            className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteCuenta(child.id)}
                            className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--crit-ink)] hover:bg-[var(--crit-soft)] transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Cuentas Bancarias Tab ────────────────────────────────── */}
      {tab === 'bancarias' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-[var(--text-3)]">{bancos.length} cuenta{bancos.length !== 1 ? 's' : ''} bancaria{bancos.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => { resetBancoForm(); setShowBancoForm(!showBancoForm) }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold min-h-[44px] transition-[filter] hover:brightness-105" style={{ background: "linear-gradient(150deg, var(--accent-bright), var(--accent-deep))", color: "#04140d", boxShadow: "0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)" }}
            >
              {showBancoForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showBancoForm ? 'Cancelar' : 'Agregar Cuenta'}
            </button>
          </div>

          {/* Form */}
          {showBancoForm && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-6 mb-6">
              <h3 className="text-sm font-semibold text-[var(--text-1)] mb-4">
                {editBancoId ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Banco</label>
                  <input
                    type="text"
                    value={bancoNombre}
                    onChange={(e) => setBancoNombre(e.target.value)}
                    placeholder="Ej. BBVA, Banorte, HSBC"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Numero de Cuenta</label>
                  <input
                    type="text"
                    value={bancoNumero}
                    onChange={(e) => setBancoNumero(e.target.value)}
                    placeholder="Ej. 0123456789"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>CLABE</label>
                  <input
                    type="text"
                    value={bancoClabe}
                    onChange={(e) => setBancoClabe(e.target.value)}
                    placeholder="18 digitos"
                    maxLength={18}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Titular</label>
                  <input
                    type="text"
                    value={bancoTitular}
                    onChange={(e) => setBancoTitular(e.target.value)}
                    placeholder="Nombre del titular"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Saldo (MXN)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bancoSaldo}
                    onChange={(e) => setBancoSaldo(e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveBanco}
                  disabled={saving || !bancoNombre.trim() || !bancoNumero.trim()}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold min-h-[44px] transition-[filter] hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "linear-gradient(150deg, var(--accent-bright), var(--accent-deep))", color: "#04140d", boxShadow: "0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)" }}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Guardando...' : saved ? 'Guardado' : editBancoId ? 'Actualizar' : 'Guardar'}
                </button>
              </div>
            </div>
          )}

          {/* Bank accounts list */}
          {bancos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed py-[34px] px-5 text-center" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
              <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                <Building2 className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>No hay cuentas bancarias registradas</span>
              <span className="text-xs" style={{ color: 'var(--text-4)' }}>Agrega la primera cuenta para registrar saldos.</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Banco</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">No. Cuenta</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">CLABE</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Titular</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Saldo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {bancos.map((banco) => (
                    <tr key={banco.id} className="hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--text-1)]">{banco.banco}</td>
                      <td className="px-4 py-3 font-mono text-xs tnum text-[var(--text-2)]">{banco.numero_cuenta}</td>
                      <td className="px-4 py-3 font-mono text-xs tnum text-[var(--text-2)]">{banco.clabe || '-'}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{banco.titular || '-'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium tnum text-[var(--text-1)]">{formatCurrency(banco.saldo)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEditBanco(banco)}
                            className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteBanco(banco.id)}
                            className="rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--crit-ink)] hover:bg-[var(--crit-soft)] transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--line)] bg-[var(--surface-2)]">
                    <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-[var(--text-2)]">Total</td>
                    <td className="px-4 py-3 text-right text-sm font-mono font-extrabold tnum text-[var(--text-1)]">
                      {formatCurrency(bancos.reduce((s, b) => s + b.saldo, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
