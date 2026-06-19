'use client'

import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, Check, AlertTriangle, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

type ImportType = 'ingredients' | 'inventory' | 'recipes' | 'menu'

const IMPORT_TYPES: { id: ImportType; label: string; desc: string; columns: string; table: string }[] = [
  { id: 'ingredients', label: 'Ingredientes', desc: 'Catálogo de insumos con costos', columns: 'id, name, unit, cost_per_unit, category', table: 'pos_ingredients' },
  { id: 'inventory', label: 'Inventario (stocks)', desc: 'Stock actual de cada ingrediente', columns: 'ingredient_id, stock, reorder_point, reorder_quantity', table: 'pos_inventory' },
  { id: 'recipes', label: 'Recetas', desc: 'Platillo con ingredientes y cantidades', columns: 'menu_item_id, menu_item_name, ingredient_id, quantity, unit', table: 'pos_recipes_old' },
  { id: 'menu', label: 'Menú (platillos)', desc: 'Platillos con precios y categoría', columns: 'id, name, price, category_id, active, barcode', table: 'pos_menu_items' },
]

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals: string[] = []
    let current = ''
    let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { vals.push(current.trim()); current = ''; continue }
      current += ch
    }
    vals.push(current.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] || '' })
    return row
  })
}

export default function CargaMasivaPage() {
  const [importType, setImportType] = useState<ImportType>('ingredients')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [imported, setImported] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const config = IMPORT_TYPES.find(t => t.id === importType)!

  async function handleFile(f: File) {
    setFile(f)
    setStatus('idle')
    setMessage('')
    const text = await f.text()
    const rows = parseCSV(text)
    setPreview(rows.slice(0, 10))
    if (rows.length === 0) {
      setMessage('Archivo vacío o formato inválido')
      setStatus('error')
    }
  }

  async function handleImport() {
    if (!file) return
    setStatus('loading')
    setMessage('Importando...')
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length === 0) { setStatus('error'); setMessage('Sin datos'); return }

      // Add client_id to each row
      const withClient = rows.map(row => ({ ...row, client_id: _cid() }))

      // Batch in chunks of 100
      let total = 0
      for (let i = 0; i < withClient.length; i += 100) {
        const batch = withClient.slice(i, i + 100)
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${config.table}`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(batch),
        })
        if (!res.ok) {
          const err = await res.text()
          setStatus('error')
          setMessage(`Error en lote ${i}: ${err.slice(0, 150)}`)
          return
        }
        total += batch.length
        setImported(total)
        setMessage(`Importando... ${total}/${withClient.length}`)
      }

      setStatus('success')
      setMessage(`${total} registros importados exitosamente`)
      setImported(total)
    } catch (e) {
      setStatus('error')
      setMessage(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    }
  }

  function downloadTemplate() {
    const csv = config.columns + '\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plantilla_${config.id}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Carga masiva" subtitle="Importa datos por CSV — ingredientes, inventario, recetas o menú" eyebrow="Admin" />

      {/* Type selector */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {IMPORT_TYPES.map(t => (
          <button key={t.id} onClick={() => { setImportType(t.id); setFile(null); setPreview([]); setStatus('idle') }}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${importType === t.id
              ? 'bg-emerald-600 text-white' : 'bg-[var(--surface)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Info + template */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-[var(--text-1)] mb-2">{config.label}</h3>
        <p className="text-sm text-[var(--text-3)] mb-3">{config.desc}</p>
        <p className="text-xs text-[var(--text-4)] mb-3">Columnas esperadas: <code className="bg-[var(--surface-2)] px-2 py-0.5 rounded text-emerald-500">{config.columns}</code></p>
        <button onClick={downloadTemplate}
          className="flex items-center gap-2 text-sm text-emerald-500 hover:text-emerald-400 transition-colors">
          <FileSpreadsheet size={14} /> Descargar plantilla CSV
        </button>
      </div>

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-[var(--line)] rounded-xl p-8 mb-6 text-center cursor-pointer hover:border-emerald-500/50 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <Upload size={32} className="mx-auto mb-3 text-[var(--text-4)]" />
        {file ? (
          <p className="text-sm text-[var(--text-1)]">{file.name} <span className="text-[var(--text-3)]">({preview.length > 0 ? `${preview.length}+ filas` : 'procesando...'})</span></p>
        ) : (
          <p className="text-sm text-[var(--text-3)]">Arrastra un CSV aquí o haz click para seleccionar</p>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-1)]">Vista previa (primeras 10 filas)</span>
            <button onClick={handleImport} disabled={status === 'loading'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 transition-colors">
              {status === 'loading' ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Upload size={14} />}
              {status === 'loading' ? `Importando ${imported}...` : 'Importar todo'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-soft)]">
                  {Object.keys(preview[0]).map(h => (
                    <th key={h} className="text-left px-4 py-2 text-xs text-[var(--text-3)] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--line-soft)]">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-4 py-2 text-[var(--text-2)] truncate max-w-[200px]">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className={`flex items-center gap-3 px-5 py-3 rounded-xl ${
          status === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500' :
          status === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-500' :
          'bg-blue-500/10 border border-blue-500/20 text-blue-500'
        }`}>
          {status === 'success' ? <Check size={18} /> : status === 'error' ? <AlertTriangle size={18} /> : <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
          <span className="text-sm">{message}</span>
        </div>
      )}
    </>
  )
}
