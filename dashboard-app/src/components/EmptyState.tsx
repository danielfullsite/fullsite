'use client'

import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  iconColor?: string
  iconBg?: string
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  iconColor = 'text-emerald-500',
  iconBg = 'bg-emerald-500/10',
}: EmptyStateProps) {
  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center">
      <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center mx-auto mb-4`}>
        <Icon size={24} className={iconColor} />
      </div>
      <h3 className="text-base font-bold text-[var(--text-1)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-3)] max-w-md mx-auto">{description}</p>
    </div>
  )
}
