'use client'

import { useEffect, useState } from 'react'
import { Flag, Settings2, Megaphone, RefreshCw, AlertTriangle, Save, Users } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { ToastProvider, useToast, ConfirmModal } from '@/components/platform/PlatformFeedback'

// Control Plane · /platform/flags — feature flags + settings + announcement.
// Toda escritura pasa por /api/platform/* (admin-gated + service_role + audit).
// Acciones GLOBALES o destructivas piden confirmación ("afecta a N tenants").

interface Rollout { cohort?: string; client_ids?: string[]; percentage?: number }
interface FlagRow { key: string; enabled: boolean; rollout: Rollout; description?: string; updated_by?: string; updated_at?: string }
interface SettingRow { key: string; value: unknown; description?: string; updated_by?: string; updated_at?: string }
interface ClientRow { id: string; display_name?: string }

function FlagsInner() {
  const toast = useToast()
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [settings, setSettings] = useState<SettingRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState(false)

  // confirm modal state
  const [confirm, setConfirm] = useState<null | { title: string; affected?: number; run: () => Promise<void> }>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setDenied(false); setError(false)
    try {
      const res = await fetch('/api/platform/config', { credentials: 'include' })
      if (res.status === 401 || res.status === 403) { setDenied(true); return }
      if (!res.ok) { setError(true); return }
      const json = await res.json()
      setFlags(Array.isArray(json.flags) ? json.flags : [])
      setSettings(Array.isArray(json.settings) ? json.settings : [])
      setClients(Array.isArray(json.clients) ? json.clients : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const tenantCount = clients.length

  async function postFlag(row: FlagRow, successMsg: string) {
    const res = await fetch('/api/platform/flags', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: row.key, enabled: row.enabled, rollout: row.rollout, description: row.description }),
    })
    if (res.ok) { toast('success', successMsg); await load() }
    else if (res.status === 429) toast('error', 'Límite de escrituras excedido. Espera un momento.')
    else toast('error', 'No se pudo guardar el flag.')
  }

  function toggleFlag(row: FlagRow) {
    const next = { ...row, enabled: !row.enabled }
    const isCohort = Array.isArray(row.rollout?.client_ids) && row.rollout.client_ids!.length > 0
    const affected = isCohort ? row.rollout.client_ids!.length : tenantCount
    setConfirm({
      title: `${next.enabled ? 'Activar' : 'Desactivar'} "${row.key}"`,
      affected,
      run: async () => { await postFlag(next, `Flag "${row.key}" ${next.enabled ? 'activado' : 'desactivado'}`) },
    })
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <PageHeader title="Flags & Config global" subtitle="Un cambio → todos los tenants" eyebrow="CONTROL GLOBAL" />
        <button onClick={load} className="p-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors" aria-label="Refrescar">
          <RefreshCw size={16} />
        </button>
      </div>

      {denied ? (
        <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
          <AlertTriangle size={32} className="text-red-400" />
          <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
          <p className="text-sm text-[var(--text-3)]">Solo administradores de plataforma.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-sm text-[var(--text-2)]">
          Error cargando la configuración. <button onClick={load} className="underline text-[var(--accent-bright)]">Reintentar</button>
        </div>
      ) : (
        <div className="space-y-6">
          <AnnouncementCard settings={settings} tenantCount={tenantCount}
            onConfirm={(title, affected, run) => setConfirm({ title, affected, run })} onDone={load} />

          {/* Feature flags */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
              <Flag size={15} className="text-[var(--accent-bright)]" />
              <b className="text-sm text-[var(--text-1)]">Feature flags</b>
              <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">{flags.length} flags</span>
            </div>
            {flags.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-3)]">No hay feature flags.</div>
            ) : (
              <div className="divide-y divide-[var(--line-soft)]">
                {flags.map(f => (
                  <FlagRowItem key={f.key} row={f} clients={clients} tenantCount={tenantCount}
                    onToggle={() => toggleFlag(f)}
                    onSaveRollout={(rollout) => {
                      const isCohort = Array.isArray(rollout.client_ids) && rollout.client_ids.length > 0
                      const affected = isCohort ? rollout.client_ids!.length : tenantCount
                      setConfirm({
                        title: `Actualizar rollout de "${f.key}"`, affected,
                        run: async () => { await postFlag({ ...f, rollout }, `Rollout de "${f.key}" actualizado`) },
                      })
                    }} />
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
              <Settings2 size={15} className="text-[var(--accent-bright)]" />
              <b className="text-sm text-[var(--text-1)]">Platform settings</b>
              <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">{settings.length} settings</span>
            </div>
            {settings.filter(s => s.key !== 'announcement').length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-3)]">No hay settings.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {['Key', 'Value', 'Actualizado por'].map((h, i) => (
                        <th key={i} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)] font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {settings.filter(s => s.key !== 'announcement').map(s => (
                      <tr key={s.key} className="border-t border-[var(--line-soft)]">
                        <td className="px-4 py-3 font-mono text-[var(--text-1)]">{s.key}</td>
                        <td className="px-4 py-3 font-mono text-[var(--text-3)] max-w-md truncate">{JSON.stringify(s.value)}</td>
                        <td className="px-4 py-3 text-[var(--text-3)] text-xs">{s.updated_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title || ''}
        affected={confirm?.affected}
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

function FlagRowItem({ row, clients, tenantCount, onToggle, onSaveRollout }: {
  row: FlagRow; clients: ClientRow[]; tenantCount: number
  onToggle: () => void; onSaveRollout: (r: Rollout) => void
}) {
  const isCohort = Array.isArray(row.rollout?.client_ids) && row.rollout.client_ids!.length > 0
  const [mode, setMode] = useState<'all' | 'cohort'>(isCohort ? 'cohort' : 'all')
  const [selected, setSelected] = useState<string[]>(row.rollout?.client_ids || [])

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          role="switch" aria-checked={row.enabled}
          className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${row.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3,var(--line))]'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${row.enabled ? 'translate-x-4' : ''}`} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm font-semibold text-[var(--text-1)]">{row.key}</div>
          {row.description && <div className="text-xs text-[var(--text-3)]">{row.description}</div>}
        </div>
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${row.enabled ? 'text-emerald-500 bg-emerald-500/10' : 'text-[var(--text-4)] bg-[var(--surface-2)]'}`}>
          {row.enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Rollout editor */}
      <div className="mt-3 ml-13 pl-0 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Users size={13} className="text-[var(--text-4)]" />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> Todos
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === 'cohort'} onChange={() => setMode('cohort')} /> Cohorte
          </label>
        </div>
        {mode === 'cohort' && (
          <div className="flex flex-wrap gap-1.5">
            {clients.map(c => {
              const on = selected.includes(c.id)
              return (
                <button key={c.id}
                  onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                  className={`text-[11px] px-2 py-1 rounded-md border font-mono transition ${
                    on ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--text-1)]'
                       : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
                  {c.display_name || c.id}
                </button>
              )
            })}
          </div>
        )}
        <button
          onClick={() => onSaveRollout(mode === 'cohort' ? { client_ids: selected } : { cohort: 'all' })}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-bright)] hover:underline"
        >
          <Save size={13} /> Guardar rollout ({mode === 'cohort' ? `${selected.length} tenants` : `todos · ${tenantCount}`})
        </button>
      </div>
    </div>
  )
}

function AnnouncementCard({ settings, tenantCount, onConfirm, onDone }: {
  settings: SettingRow[]; tenantCount: number
  onConfirm: (title: string, affected: number, run: () => Promise<void>) => void
  onDone: () => void
}) {
  const current = settings.find(s => s.key === 'announcement')?.value as { text?: string; active?: boolean } | undefined
  const [text, setText] = useState(current?.text || '')
  const [active, setActive] = useState(current?.active ?? false)
  const toast = useToast()

  async function push() {
    const res = await fetch('/api/platform/announce', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, active }),
    })
    if (res.ok) { toast('success', 'Aviso publicado a todos los tenants'); onDone() }
    else if (res.status === 429) toast('error', 'Límite de escrituras excedido.')
    else toast('error', 'No se pudo publicar el aviso.')
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
        <Megaphone size={15} className="text-[var(--accent-bright)]" />
        <b className="text-sm text-[var(--text-1)]">Aviso global</b>
        <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">setting: announcement</span>
      </div>
      <div className="p-4 space-y-3">
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={2}
          placeholder="Mensaje que verán todos los tenants…"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent-line)] resize-none"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)] cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Activo
          </label>
          <button
            disabled={!text.trim()}
            onClick={() => onConfirm(active ? 'Publicar aviso global' : 'Guardar aviso (inactivo)', tenantCount, push)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[#04120c] font-bold text-sm disabled:opacity-40"
          >
            <Megaphone size={14} /> Publicar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FlagsPage() {
  return (
    <ToastProvider>
      <FlagsInner />
    </ToastProvider>
  )
}
