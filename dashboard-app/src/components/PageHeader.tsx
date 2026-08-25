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
    // DS v3: el título pesa más y respira, y una regla de 1px cierra la cabecera
    // para separarla del contenido sin meter una tarjeta de por medio. El eyebrow
    // baja a mono y deja de competir con el título por la atención.
    <div className="mb-6 pb-4 border-b border-[var(--line)] flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-mono text-[10.5px] font-semibold text-[var(--text-3)] uppercase tracking-[0.14em] mb-1.5">
            {eyebrow}
          </p>
        )}
        <h2 className="text-[26px] font-bold tracking-[-0.022em] text-[var(--text-1)] leading-[1.15] text-balance">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--text-3)] text-[13.5px] mt-1.5 max-w-[68ch]">{subtitle}</p>
        )}
      </div>
      {(action || showExport) && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {action}
          {showExport && <ExportButton rows={exportData!} filename={exportName || 'reporte'} />}
        </div>
      )}
    </div>
  )
}
