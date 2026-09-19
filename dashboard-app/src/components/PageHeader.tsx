import ExportButton from '@/components/ExportButton'

interface PageHeaderProps {
  title: string
  subtitle?: string
  eyebrow?: string
  action?: React.ReactNode
  // Export cliente (esqueleton): si se pasan filas, aparece el botón Exportar
  // (Excel/CSV/JSON) en el header — consistente en toda la app.
  exportData?: Record<string, unknown>[]
  exportName?: string
}

export default function PageHeader({ title, subtitle, eyebrow, action, exportData, exportName }: PageHeaderProps) {
  const showExport = Array.isArray(exportData) && exportData.length > 0
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="text-[11px] font-semibold text-[var(--accent-ink)] uppercase tracking-widest mb-1">
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl sm:text-xl font-bold leading-tight tracking-tight text-[var(--text-1)] break-words">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--text-3)] text-sm mt-1">{subtitle}</p>
        )}
      </div>
      {(action || showExport) && (
        <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-shrink-0 sm:overflow-visible sm:pb-0">
          {action}
          {showExport && <ExportButton rows={exportData!} filename={exportName || 'reporte'} />}
        </div>
      )}
    </div>
  )
}
