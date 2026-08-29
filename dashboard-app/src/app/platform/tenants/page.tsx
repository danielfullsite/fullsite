'use client'

import { useEffect, useState } from 'react'
import { Store, Plus, Activity, AlertTriangle, ArrowUpRight, Bot, RefreshCw, X, Sparkles, Circle, Power } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { ToastProvider, useToast, ConfirmModal } from '@/components/platform/PlatformFeedback'
import { VERTICAL_PRESETS, VERTICAL_IDS, type VerticalId } from '@/lib/vertical-presets'

// Control Plane: sin anon key. Todo pasa por /api/platform/* (admin-gated + service_role).
// Fase 4: alta de tenant (POST /api/platform/onboard), activar/desactivar
// (POST /api/platform/tenant-toggle) y punto de entrada "Entrar" (act-as placeholder).

interface Tenant {
  id: string
  name: string
  lastData: string | null
  hoursAgo: number | null
  openEvents: number
  active?: boolean
}

function TenantsInner() {
  const toast = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [confirm, setConfirm] = useState<null | { title: string; message?: string; run: () => Promise<void> }>(null)
  const [busy, setBusy] = useState(false)

  // Act-as real: el server da membresía (service_role) → RLS deja leer el tenant.
  // Guardamos el flag + client_id y navegamos al dashboard del tenant.
  async function enterTenant(t: Tenant) {
    setBusy(true)
    try {
      const res = await fetch('/api/platform/act-as', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: t.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast(j.error || 'No se pudo entrar al tenant', 'error'); return }
      try {
        localStorage.setItem('fullsite_actas', t.id)
        localStorage.setItem('fullsite_client_id', t.id)
      } catch { /* SSR */ }
      window.location.href = '/'
    } finally { setBusy(false) }
  }

  async function load() {
    setLoading(true)
    setDenied(false)
    try {
      const res = await fetch('/api/platform/tenants', { credentials: 'include' })
      if (res.status === 401 || res.status === 403) {
        setDenied(true)
        setTenants([])
        return
      }
      if (!res.ok) {
        console.error('Error loading tenants: HTTP', res.status)
        return
      }
      const json = (await res.json()) as { tenants: Tenant[] }
      setTenants(Array.isArray(json.tenants) ? json.tenants : [])
    } catch (err) {
      console.error('Error loading tenants:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleTenant(t: Tenant, active: boolean) {
    const res = await fetch('/api/platform/tenant-toggle', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: t.id, active }),
    })
    if (res.ok) { toast('success', `${t.name} ${active ? 'activado' : 'desactivado'}`); await load() }
    else if (res.status === 429) toast('error', 'Límite de escrituras excedido.')
    else toast('error', 'No se pudo cambiar el estado del tenant.')
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
        <AlertTriangle size={32} style={{ color: '#f43f5e' }} />
        <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
        <p className="text-sm text-[var(--text-3)]">Esta consola es solo para administradores de plataforma.</p>
      </div>
    )
  }

  const withData = tenants.filter(t => t.hoursAgo !== null).length
  const totalAlerts = tenants.reduce((s, t) => s + t.openEvents, 0)

  const kpis = [
    { label: 'Tenants', value: tenants.length, icon: Store, color: 'var(--accent-bright)' },
    { label: 'Con datos', value: withData, icon: Activity, color: 'var(--accent-bright)' },
    { label: 'Detecciones abiertas', value: totalAlerts, icon: AlertTriangle, color: '#fbbf24' },
    { label: 'Agentes', value: 'activos', icon: Bot, color: 'var(--accent-bright)' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <PageHeader title="Tenants" subtitle="Todos los clientes de Fullsite · un solo cerebro" eyebrow="PLATAFORMA" />
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
            aria-label="Refrescar"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[#04120c] font-bold text-sm hover:brightness-110 transition"
          >
            <Plus size={16} /> Nuevo cliente
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => {
          const Icon = k.icon
          return (
            <div key={k.label} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">
                <Icon size={13} style={{ color: k.color }} /> {k.label}
              </div>
              <div className="text-2xl font-black text-[var(--text-1)] mt-2 tabular-nums">{k.value}</div>
            </div>
          )
        })}
      </div>

      {/* Tenants table */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
          <Store size={15} className="text-[var(--accent-bright)]" />
          <b className="text-sm text-[var(--text-1)]">Clientes</b>
          <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">{tenants.length} tenants · misma app, mismo Core</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No hay tenants aún.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {['Cliente', 'ID', 'Últimos datos', 'Detecciones', ''].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)] font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const stale = t.hoursAgo !== null && t.hoursAgo > 48
                  const warn = t.hoursAgo !== null && t.hoursAgo > 24
                  const dot = t.hoursAgo === null ? 'var(--text-4)' : stale ? '#f43f5e' : warn ? '#fbbf24' : 'var(--accent)'
                  const isActive = t.active !== false
                  return (
                    <tr key={t.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 font-semibold text-[var(--text-1)]">
                        <span className="inline-flex items-center gap-2">
                          <Circle size={8} fill={dot} stroke="none" /> {t.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-3)]">{t.id}</td>
                      <td className="px-4 py-3 text-[var(--text-2)] tabular-nums">
                        {t.hoursAgo === null ? <span className="text-[var(--text-4)]">sin datos aún</span> : `${t.hoursAgo}h`}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {t.openEvents > 0
                          ? <span style={{ color: '#fbbf24' }} className="font-semibold">{t.openEvents}</span>
                          : <span className="text-[var(--text-4)]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setConfirm({
                              title: `${isActive ? 'Desactivar' : 'Activar'} "${t.name}"`,
                              message: isActive
                                ? 'El tenant dejará de operar hasta reactivarlo.'
                                : 'El tenant volverá a estar activo.',
                              run: async () => { await toggleTenant(t, !isActive) },
                            })}
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${isActive ? 'text-[var(--text-3)] hover:text-red-400' : 'text-emerald-500 hover:text-emerald-400'}`}
                          >
                            <Power size={13} /> {isActive ? 'Desactivar' : 'Activar'}
                          </button>
                          {/* Act-as real: pide membresía al server (service_role) y entra al tenant */}
                          <button
                            onClick={() => enterTenant(t)}
                            disabled={busy}
                            title="Entrar al panel de este tenant como admin"
                            className="inline-flex items-center gap-1 text-[var(--accent-bright)] font-semibold text-xs hover:underline disabled:opacity-50"
                          >
                            Entrar <ArrowUpRight size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">
        &quot;Entrar&quot; te da acceso de admin al panel de ese tenant (impersonation con membresía temporal vía service_role, auditada). Sal con el banner &quot;Salir&quot; arriba.
      </p>

      {showNew && <NewTenantModal onClose={() => setShowNew(false)} onDone={load} toast={toast} tenantCount={tenants.length} />}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message}
        busy={busy}
        onCancel={() => { if (!busy) setConfirm(null) }}
        onConfirm={async () => {
          if (!confirm) return
          setBusy(true)
          try { await confirm.run() } finally { setBusy(false); setConfirm(null) }
        }}
      />
    </>
  )
}

const ACCENT_OPTIONS = ['emerald', 'blue', 'violet', 'amber', 'pink', 'cyan']

function NewTenantModal({ onClose, onDone, toast, tenantCount }: {
  onClose: () => void; onDone: () => void
  toast: (k: 'success' | 'error', m: string) => void; tenantCount: number
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accent, setAccent] = useState('emerald')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [logo, setLogo] = useState('')
  const [mesas, setMesas] = useState('10')
  const [vertical, setVertical] = useState<VerticalId>('casual_dining')
  const [creds, setCreds] = useState<{
    staffPins: Array<{ role: string; pin: string }>
    localServer: { email: string; password: string } | null
  } | null>(null)
  const [mesasTouched, setMesasTouched] = useState(false)
  const [locationsText, setLocationsText] = useState('Principal')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const autoSlug = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const valid = name && slug && email && password.length >= 6
  const locations = locationsText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [locationName, ...addressParts] = line.split('|')
    return { name: locationName.trim(), address: addressParts.join('|').trim() }
  })

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/platform/onboard', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: slug, email, password, display_name: name,
          accent_color: accent, default_theme: theme,
          logo_url: logo || undefined,
          // Solo mandar mesas si el operador las editó; si no, aplica el default del preset.
          mesas: mesasTouched ? (parseInt(mesas, 10) || 0) : undefined,
          vertical,
          locations,
        }),
      })
      if (res.ok) {
        // NO cerrar todavía: las credenciales (PINs de plantilla + service
        // account del Local Server) solo viajan UNA vez. Mostrarlas para que
        // el operador las guarde (gap Minute-0 #2/#3).
        const j = await res.json().catch(() => ({})) as {
          staff_pins?: Array<{ role: string; pin: string }>
          local_server?: { email: string; password: string } | null
        }
        toast('success', `Tenant "${slug}" dado de alta`)
        setCreds({ staffPins: j.staff_pins || [], localServer: j.local_server || null })
        onDone()
      }
      else if (res.status === 429) toast('error', 'Límite de escrituras excedido.')
      else {
        const j = await res.json().catch(() => ({}))
        toast('error', j.error || 'No se pudo dar de alta el tenant.')
      }
    } catch {
      toast('error', 'Error de red al dar de alta.')
    } finally {
      setBusy(false); setConfirmOpen(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center gap-3 sticky top-0 bg-[var(--bg)]">
          <Sparkles size={18} className="text-[var(--accent-bright)]" />
          <div>
            <div className="font-bold text-[var(--text-1)]">Nuevo cliente</div>
            <div className="text-[11px] text-[var(--text-3)]">Alta completa · onboarding cero-código</div>
          </div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text-1)]"><X size={18} /></button>
        </div>
        {creds ? (
          // Pantalla de credenciales — se muestran UNA vez; el server no las
          // vuelve a mandar. El operador debe guardarlas antes de cerrar.
          <div className="p-5 space-y-4">
            <p className="text-sm font-semibold text-[var(--text-1)]">Guarda estas credenciales — no se volverán a mostrar</p>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
              <p className="text-xs text-[var(--text-3)] mb-1">URL del KDS (ábrela una vez en la tablet de cocina; queda configurada)</p>
              <p className="font-mono break-all text-[var(--text-1)]">app.fullsite.mx/kds?client={slug}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
              <p className="text-xs text-[var(--text-3)] mb-1">Login del dueño</p>
              <p className="font-mono text-[var(--text-1)]">{email} · {password}</p>
            </div>
            {creds.staffPins.length > 0 && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                <p className="text-xs text-[var(--text-3)] mb-2">PINs de plantilla del POS (rotarlos en Personal &amp; PINs)</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {creds.staffPins.map(sp => (
                    <p key={sp.role} className="flex justify-between gap-2"><span className="capitalize text-[var(--text-2)]">{sp.role}</span><span className="font-mono tabular-nums text-[var(--text-1)]">{sp.pin}</span></p>
                  ))}
                </div>
              </div>
            )}
            {creds.localServer && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                <p className="text-xs text-[var(--text-3)] mb-1">Service account del Local Server (Pedro)</p>
                <p className="font-mono break-all text-[var(--text-1)]">{creds.localServer.email}</p>
                <p className="font-mono text-[var(--text-1)]">{creds.localServer.password}</p>
              </div>
            )}
            <button
              onClick={() => {
                const lines = [
                  `Tenant: ${slug}`,
                  `Dueño: ${email} / ${password}`,
                  ...creds.staffPins.map(sp => `PIN ${sp.role}: ${sp.pin}`),
                  ...(creds.localServer ? [`Local Server: ${creds.localServer.email} / ${creds.localServer.password}`] : []),
                ]
                navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('success', 'Credenciales copiadas'))
              }}
              className="w-full py-2.5 rounded-xl border border-[var(--line)] text-sm font-semibold text-[var(--text-1)] hover:border-[var(--accent-line)]">
              Copiar todo
            </button>
            <button onClick={onClose}
              className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#04120c] font-bold">
              Listo, ya las guardé
            </button>
          </div>
        ) : (
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Nombre del restaurante</span>
            <input value={name} onChange={e => { setName(e.target.value); setSlug(autoSlug(e.target.value)) }}
              placeholder="La Costa Verde"
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)]" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Client ID (tenant / subdominio)</span>
            <div className="mt-1 flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden">
              <input value={slug} onChange={e => setSlug(autoSlug(e.target.value))} placeholder="lacostaverde"
                className="flex-1 bg-transparent px-3 py-2.5 text-[var(--text-1)] outline-none font-mono text-sm" />
              <span className="px-3 text-[var(--text-4)] text-sm font-mono border-l border-[var(--line)]">.app.fullsite.mx</span>
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Tipo de restaurante</span>
            <select value={vertical}
              onChange={e => {
                const v = e.target.value as VerticalId
                setVertical(v)
                if (!mesasTouched) setMesas(String(VERTICAL_PRESETS[v].defaultMesas))
              }}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm">
              {VERTICAL_IDS.map(v => <option key={v} value={v}>{VERTICAL_PRESETS[v].label}</option>)}
            </select>
            <span className="mt-1 block text-[11px] text-[var(--text-4)]">{VERTICAL_PRESETS[vertical].description}</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Email del dueño</span>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="dueno@rest.mx"
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Password inicial</span>
              <input value={password} onChange={e => setPassword(e.target.value)} type="text" placeholder="mín. 6 caracteres"
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Color de acento</span>
              <select value={accent} onChange={e => setAccent(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm">
                {ACCENT_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Tema por defecto</span>
              <select value={theme} onChange={e => setTheme(e.target.value as 'light' | 'dark')}
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm">
                <option value="light">light</option>
                <option value="dark">dark</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Logo URL (opcional)</span>
              <input value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://…"
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-3)]">Mesas</span>
              <input value={mesas} onChange={e => { setMesasTouched(true); setMesas(e.target.value.replace(/\D/g, '')) }} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm tabular-nums" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Sucursales</span>
            <textarea
              value={locationsText}
              onChange={e => setLocationsText(e.target.value)}
              rows={5}
              placeholder={'Principal | Av. Ejemplo 100\nSucursal Centro | Centro, Monterrey'}
              className="mt-1 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] text-sm"
            />
            <span className="mt-1 block text-[11px] text-[var(--text-4)]">Una por línea. Usa “Nombre | Dirección”. Se crearán {locations.length}.</span>
          </label>
          <button disabled={!valid} onClick={() => setConfirmOpen(true)}
            className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#04120c] font-bold disabled:opacity-40 flex items-center justify-center gap-2">
            <Plus size={16} /> Dar de alta cliente
          </button>
        </div>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={`Dar de alta "${slug}"`}
        message={`Se creará el usuario dueño, el mapping y el skeleton de "${VERTICAL_PRESETS[vertical].label}" (menú semilla, módulos y mesas del tipo). Es idempotente. Actualmente hay ${tenantCount} tenants.`}
        confirmLabel="Crear tenant"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmOpen(false) }}
        onConfirm={submit}
      />
    </div>
  )
}

export default function TenantsConsole() {
  return (
    <ToastProvider>
      <TenantsInner />
    </ToastProvider>
  )
}
