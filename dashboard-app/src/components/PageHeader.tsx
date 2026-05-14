interface PageHeaderProps {
  title: string
  subtitle?: string
  eyebrow?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, eyebrow, action }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-end justify-between">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-text">
          {title}
        </h1>
        {subtitle && (
          <p className="text-text-soft text-sm mt-1">{subtitle}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
