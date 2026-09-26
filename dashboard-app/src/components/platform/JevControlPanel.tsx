'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, FilePlus2, LoaderCircle, Play, RefreshCw, ShieldCheck, X } from 'lucide-react'

type Evidence = { id: string; source_ref: string; source_sha256: string; decision_input: { state?: Record<string, unknown> } }
type Decision = { id: string; evidence_id: string; recommendation: Record<string, unknown> }
type Review = { decision_id: string; disposition: 'accepted' | 'rejected' }
type Snapshot = { ready: boolean; evidence: Evidence[]; decisions: Decision[]; reviews: Review[] }
type Form = Record<string, string | boolean>

const initial: Form = {
  source_ref: '', source_sha256: '', tenant_ref: '', claimed_status: 'tested_locally', tests_passed: '0', tests_failed: '0',
  requires_physical_validation: true, ci_green: 'pending', field_validated_same_commit: 'pending', adversarial_review_done: 'pending',
  rollback_verified: 'pending', docs_updated: 'pending', branch_aligned_with_main: 'pending',
}
const checks = [
  ['ci_green', 'CI verde'], ['field_validated_same_commit', 'Validación física, mismo commit'], ['adversarial_review_done', 'Revisión adversarial'],
  ['rollback_verified', 'Rollback verificado'], ['docs_updated', 'Documentación actualizada'], ['branch_aligned_with_main', 'Rama alineada con main'],
] as const

function booleanOrNull(value: string | boolean): boolean | null { return value === 'yes' ? true : value === 'no' ? false : null }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

export default function JevControlPanel() {
  const [data, setData] = useState<Snapshot>({ ready: false, evidence: [], decisions: [], reviews: [] })
  const [form, setForm] = useState<Form>(initial)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/platform/jev', { credentials: 'include' })
      if (!res.ok) throw new Error('No se pudo consultar JEV.')
      const next = await res.json() as Partial<Snapshot>
      setData({ ready: next.ready === true, evidence: Array.isArray(next.evidence) ? next.evidence : [], decisions: Array.isArray(next.decisions) ? next.decisions : [], reviews: Array.isArray(next.reviews) ? next.reviews : [] })
    } catch { setNotice('No se pudo cargar JEV. Reintenta o verifica tu sesión de administrador.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    // El fetch empieza después del primer paint; no convierte el efecto de montaje en
    // una actualización síncrona y permite que la pantalla pinte su estado de carga.
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const reviews = useMemo(() => new Map(data.reviews.map((review) => [review.decision_id, review])), [data.reviews])
  const set = (key: string, value: string | boolean) => setForm((prior) => ({ ...prior, [key]: value }))

  async function send(path: string, body: unknown, key: string, success: string) {
    setBusy(key); setNotice(null)
    try {
      const res = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await res.json() as { error?: string }
      if (!res.ok) throw new Error(result.error || 'La operación no se pudo completar.')
      setNotice(success); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'La operación no se pudo completar.') }
    finally { setBusy(null) }
  }

  function saveEvidence(event: React.FormEvent) {
    event.preventDefault()
    const payload = {
      ...form, tests_passed: Number(form.tests_passed), tests_failed: Number(form.tests_failed),
      requires_physical_validation: form.requires_physical_validation === true,
      ...Object.fromEntries(checks.map(([key]) => [key, booleanOrNull(form[key])])),
    }
    void send('/api/platform/jev', payload, 'register', 'Fuente registrada. Ya puedes solicitar el veredicto.')
    setShowForm(false)
  }

  return <div className="mt-6 space-y-5">
    {notice && <div className="flex gap-3 rounded-xl border border-violet-400/25 bg-violet-400/10 px-4 py-3 text-sm text-[var(--text-2)]"><CircleAlert size={17} className="mt-0.5 shrink-0 text-violet-300" />{notice}</div>}
    <section className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
      <div className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] bg-[linear-gradient(120deg,rgba(139,92,246,0.13),transparent_58%)] px-6 py-6"><p className="text-sm font-medium text-violet-300">Control de evidencia</p><h2 className="mt-2 text-xl font-semibold text-[var(--text-1)]">Veredictos trazables, nunca acciones</h2><p className="mt-2 text-sm leading-6 text-[var(--text-3)]">JEV contrasta hechos redactados con reglas locales. Su resultado nunca despliega, publica ni altera el POS.</p></div>
        <div className="grid divide-y divide-[var(--line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"><Metric label="Fuentes" value={data.evidence.length} detail={data.ready ? 'Paquetes registrados' : 'Migración pendiente'} /><Metric label="Veredictos" value={data.decisions.length} detail="Siempre modo sombra" /><Metric label="Cambios" value={0} detail="JEV no opera" accent /></div>
      </div>
      <aside className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6"><h2 className="font-semibold text-[var(--text-1)]">Cómo se controla</h2><ol className="mt-4 space-y-3 text-sm text-[var(--text-3)]"><li>1. Registra un paquete ya revisado.</li><li>2. Pide una opinión tipada de JEV.</li><li>3. Acepta o rechaza el veredicto como humano.</li></ol></aside>
    </section>

    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4"><div><h2 className="font-semibold text-[var(--text-1)]">Fuentes aprobadas</h2><p className="mt-1 text-sm text-[var(--text-3)]">Sólo hash y hechos tipados; no se suben reportes crudos.</p></div><div className="flex gap-2"><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-2)]"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Actualizar</button><button onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={15} />Registrar fuente</button></div></div>
      {showForm && <form onSubmit={saveEvidence} className="grid gap-4 border-b border-[var(--line)] bg-[var(--surface-2)] p-5 md:grid-cols-2">
        <Field label="Referencia"><input required value={String(form.source_ref)} onChange={(e) => set('source_ref', e.target.value)} placeholder="fresh-p19-pos-kds-integral-20260926" /></Field><Field label="SHA-256"><input required value={String(form.source_sha256)} onChange={(e) => set('source_sha256', e.target.value)} placeholder="64 caracteres hexadecimales" /></Field>
        <Field label="Tenant opaco"><input required value={String(form.tenant_ref)} onChange={(e) => set('tenant_ref', e.target.value)} placeholder="t_…" /></Field><Field label="Estado declarado"><select value={String(form.claimed_status)} onChange={(e) => set('claimed_status', e.target.value)}>{['implemented','tested_locally','deployed','field_validated','certified','closed'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Pruebas aprobadas"><input required min="0" type="number" value={String(form.tests_passed)} onChange={(e) => set('tests_passed', e.target.value)} /></Field><Field label="Pruebas fallidas"><input required min="0" type="number" value={String(form.tests_failed)} onChange={(e) => set('tests_failed', e.target.value)} /></Field>
        <label className="flex items-center gap-3 text-sm text-[var(--text-2)]"><input type="checkbox" checked={form.requires_physical_validation === true} onChange={(e) => set('requires_physical_validation', e.target.checked)} />Requiere validación física</label><p className="text-xs leading-5 text-[var(--text-4)]">Copia únicamente los hechos verificados del gate. El hash referencia el paquete sin exponerlo.</p>
        <div className="col-span-full grid gap-3 md:grid-cols-3">{checks.map(([key, label]) => <Field key={key} label={label}><select value={String(form[key])} onChange={(e) => set(key, e.target.value)}><option value="pending">Pendiente</option><option value="yes">Sí</option><option value="no">No</option></select></Field>)}</div>
        <div className="col-span-full flex justify-end"><button disabled={busy === 'register'} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy === 'register' && <LoaderCircle size={15} className="animate-spin" />}Guardar evidencia</button></div>
      </form>}
      {loading ? <Loading /> : !data.ready ? <Empty text="La migración de evidencia no está aplicada todavía. Esta pantalla no inventa fuentes ni veredictos." /> : data.evidence.length === 0 ? <Empty text="Aún no hay una fuente registrada." /> : <div className="divide-y divide-[var(--line)]">{data.evidence.map((item) => <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-mono text-sm font-medium text-[var(--text-1)]">{item.source_ref}</p><p className="mt-1 truncate font-mono text-xs text-[var(--text-4)]">{item.source_sha256}</p></div><span className="text-xs text-[var(--text-3)]">{String(item.decision_input?.state?.claimed_status || '—')}</span><button disabled={busy === `eval:${item.id}`} onClick={() => void send('/api/platform/jev/evaluate', { evidence_id: item.id }, `eval:${item.id}`, 'Veredicto registrado; todavía requiere revisión humana.')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-400/30 px-3 py-2 text-sm font-semibold text-violet-300 disabled:opacity-50"><Play size={14} />Pedir veredicto</button></div>)}</div>}
    </section>

    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)]"><div className="border-b border-[var(--line)] px-5 py-4"><h2 className="font-semibold text-[var(--text-1)]">Bandeja de veredictos</h2><p className="mt-1 text-sm text-[var(--text-3)]">Aceptar o rechazar sólo deja constancia. No ejecuta un cambio.</p></div>{loading ? <Loading /> : data.decisions.length === 0 ? <Empty text="No hay veredictos guardados." /> : <div className="divide-y divide-[var(--line)]">{data.decisions.map((decision) => { const rec = asRecord(decision.recommendation); const rules = asRecord(rec.rules); const jev = asRecord(rec.jev); const review = reviews.get(decision.id); return <div key={decision.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-xs font-semibold text-violet-300">{String(rules.label || 'sin decisión')}</span><span className="text-xs text-[var(--text-3)]">Autoridad: {String(rec.authority || '—')}</span><span className="text-xs text-[var(--text-4)]">JEV: {String(jev.status || '—')}</span></div><p className="mt-3 text-sm text-[var(--text-2)]">La decisión efectiva sigue siendo la regla local. Ejecutable: no.</p><p className="mt-1 font-mono text-xs text-[var(--text-4)]">{String(rec.input_hash || '')}</p></div><div className="flex gap-2 lg:justify-end">{review ? <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-3)]">{review.disposition === 'accepted' ? <Check size={14} className="text-emerald-300" /> : <X size={14} className="text-red-300" />}{review.disposition === 'accepted' ? 'Aceptado' : 'Rechazado'}</span> : <><button onClick={() => void send('/api/platform/jev/review', { decision_id: decision.id, disposition: 'accepted' }, `review:${decision.id}`, 'Revisión humana aceptada; no se ejecutó ningún cambio.')} className="rounded-lg border border-emerald-400/30 px-3 py-2 text-sm font-semibold text-emerald-300">Aceptar</button><button onClick={() => void send('/api/platform/jev/review', { decision_id: decision.id, disposition: 'rejected' }, `review:${decision.id}`, 'Revisión humana rechazada; no se ejecutó ningún cambio.')} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-3)]">Rechazar</button></>}</div></div> })}</div>}</section>
    <div className="flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text-3)]"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-300" />La llave de AI Gateway sólo se lee en el servidor durante una evaluación. No se muestra, no se almacena aquí y no llega al navegador.</div>
  </div>
}

function Metric({ label, value, detail, accent = false }: { label: string; value: number; detail: string; accent?: boolean }) { return <div className="p-5"><p className="text-sm text-[var(--text-3)]">{label}</p><p className={`mt-2 text-3xl font-semibold ${accent ? 'text-emerald-300' : 'text-[var(--text-1)]'}`}>{value}</p><p className="mt-2 text-xs text-[var(--text-4)]">{detail}</p></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-xs font-medium text-[var(--text-3)]">{label}{children}</label> }
function Empty({ text }: { text: string }) { return <div className="px-5 py-10 text-center text-sm text-[var(--text-3)]">{text}</div> }
function Loading() { return <div className="flex justify-center px-5 py-10"><LoaderCircle size={22} className="animate-spin text-violet-300" /></div> }
