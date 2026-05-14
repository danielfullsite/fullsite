interface PageHeaderProps {
  title: string
  subtitle?: string
  eyebrow?: string
}

export default function PageHeader({ title, subtitle, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <p className="text-xs font-medium text-accent uppercase tracking-wider mb-1">
          {eyebrow}
        </p>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-text">
        {title}
      </h1>
      {subtitle && (
        <p className="text-text-soft text-sm mt-1">{subtitle}</p>
      )}
    </div>
  )
}
