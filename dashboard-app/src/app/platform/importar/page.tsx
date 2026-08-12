'use client'

import { useState, useEffect } from 'react'
import { Upload, Loader2, Check, AlertTriangle, FileUp } from 'lucide-react'

// Control Plane · Importar datos. Sube un CSV (menú/categorías/pagos) → valida +
// preview → confirmar → upsert. Nunca escribe sin confirmar.
interface Tenant { id: string; name: string }
interface Validation { total: number; validas: number; errores: { fila: number; error: string }[]; preview: Record<string, unknown>[] }

const DATASETS = [
  { key: 'menu', label: 'Menú (platillos)', cols: 'name, price, category_id, active, sort_order' },
  { key: 'categorias', label: 'Categorías', cols: 'name, color, sort_order, active' },
  { key: 'pagos', label: 'Métodos de pago', cols: 'name, type, commission_pct, active' },
]

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false } else field += c }
    else if (c === '"') inQ = true
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }
  if (rows.length === 0) return []
  const header = rows[0].map(h => h.trim())
  return rows.slice(1).filter(r => r.some(c => c.trim() !== '')).map(r => {
    const o: Record<string, string> = {}; header.forEach((h, i) => o[h] = (r[i] ?? '').trim()); return o
  })
}

export default function ImportarPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [clientId, setClientId] = useState('')
  const [dataset, setDataset] = useState('menu')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [val, setVal] = useState<Validation | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/platform/tenants', { credentials: 'include' })
        if (res.status === 401 || res.status === 403) { setDenied(true); return }
        const j = await res.json().catch(() => ({}))
        const list: Tenant[] = Array.isArray(j.tenants) ? j.tenants : []
        setTenants(list); if (list[0]) setClientId(list[0].id)
      } catch { /* noop */ }
    })()
  }, [])

  function reset() { setRows([]); setFileName(''); setVal(null); setResult(null) }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    reset(); setFileName(f.name)
    const text = await f.text()
    const parsed = parseCsv(text)
    setRows(parsed)
    if (parsed.length) validate(parsed)
  }

  async function validate(parsed: Record<string, string>[]) {
    setBusy(true); setVal(null); setResult(null)
    try {
      const res = await fetch('/api/platform/import', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, dataset, rows: parsed, mode: 'validate' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setResult(`❌ ${j.error || 'error'}`); return }
      setVal(j)
    } finally { setBusy(false) }
  }

  async function commit() {
    setBusy(true)
    try {
      const res = await fetch('/api/platform/import', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, dataset, rows, mode: 'commit' }),
      })
      const j = await res.json().catch(() => ({}))
      setResult(res.ok ? `✅ Importadas ${j.importadas} filas${j.ignoradas ? ` (${j.ignoradas} ignoradas)` : ''}.` : `❌ ${j.error || 'error'}`)
      if (res.ok) setVal(null)
    } finally { setBusy(false) }
  }

  if (denied) return <div className="flex flex-col items-center justify-center h-96 gap-3 text-center"><AlertTriangle size={32} className="text-red-400" /><p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p></div>

  const cols = DATASETS.find(d => d.key === dataset)?.cols

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Upload size={20} /></span>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--text-1)]">Importar datos</h1>
          <p className="text-xs text-[var(--text-4)]">Sube un CSV · valida y previsualiza · confirma</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={clientId} onChange={e => { setClientId(e.target.value); reset() }} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
        <select value={dataset} onChange={e => { setDataset(e.target.value); reset() }} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
          {DATASETS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      <p className="text-[11px] text-[var(--text-4)] mb-3">Columnas esperadas (encabezado del CSV): <span className="font-mono text-[var(--text-3)]">{cols}</span>. Si no traes <span className="font-mono">id</span>, se genera por nombre (idempotente: reimportar actualiza).</p>

      <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--text-3)] cursor-pointer hover:border-[var(--accent)]">
        <FileUp size={18} /> {fileName || 'Elegir archivo CSV…'}
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
      </label>

      {busy && !val && <div className="flex items-center gap-2 mt-4 text-[var(--text-4)] text-sm"><Loader2 size={16} className="animate-spin" /> Validando…</div>}

      {val && (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs rounded-full px-2.5 py-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)]">{val.total} filas leídas</span>
            <span className="text-xs rounded-full px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{val.validas} válidas</span>
            {val.errores.length > 0 && <span className="text-xs rounded-full px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400">{val.errores.length} con error</span>}
          </div>
          {val.errores.length > 0 && (
            <div className="mb-3 max-h-32 overflow-y-auto text-[11px] text-amber-300/90 space-y-0.5">
              {val.errores.slice(0, 20).map((e, i) => <div key={i}>Fila {e.fila}: {e.error}</div>)}
            </div>
          )}
          {val.preview.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] mb-1">Preview (primeras {val.preview.length})</p>
              <pre className="text-[11px] text-[var(--text-2)] bg-black/20 rounded-lg p-2 overflow-x-auto">{JSON.stringify(val.preview, null, 1)}</pre>
            </div>
          )}
          <button onClick={commit} disabled={busy || val.validas === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#04130d] disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirmar import ({val.validas})
          </button>
        </div>
      )}

      {result && <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-1)]">{result}</div>}
    </div>
  )
}
