'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText, FileJson, ChevronDown } from 'lucide-react'
import { downloadTable, type ExportFormat } from '@/lib/export-client'

// Botón de export reusable para las páginas de reporte del cliente. Excel / CSV / JSON.
export default function ExportButton({ rows, filename }: { rows: Record<string, unknown>[]; filename: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const disabled = !rows || rows.length === 0
  function go(fmt: ExportFormat) { downloadTable(rows, filename, fmt); setOpen(false) }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] disabled:opacity-40"
        title={disabled ? 'Sin datos para exportar' : 'Exportar'}
      >
        <Download size={14} /> Exportar <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-xl z-50 overflow-hidden">
          <button onClick={() => go('xls')} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[var(--text-1)] hover:bg-[var(--surface-2)]"><FileSpreadsheet size={15} className="text-emerald-500" /> Excel</button>
          <button onClick={() => go('csv')} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[var(--text-1)] hover:bg-[var(--surface-2)] border-t border-[var(--line)]"><FileText size={15} className="text-[var(--text-3)]" /> CSV</button>
          <button onClick={() => go('json')} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[var(--text-1)] hover:bg-[var(--surface-2)] border-t border-[var(--line)]"><FileJson size={15} className="text-[var(--text-3)]" /> JSON</button>
        </div>
      )}
    </div>
  )
}
