interface PageHeaderProps {
  title: string
  subtitle?: string
  eyebrow?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, eyebrow, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-widest mb-1">
            {eyebrow}
          </p>
        )}
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--text-3)] text-sm mt-1">{subtitle}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
