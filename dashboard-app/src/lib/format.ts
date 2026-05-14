export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '$0'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '0'
  return new Intl.NumberFormat('es-MX').format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '+0.0%'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
  })
}

export function percentChange(current: number | null | undefined, previous: number | null | undefined): number {
  if (!current || !previous || previous === 0) return 0
  const result = ((current - previous) / previous) * 100
  return isNaN(result) ? 0 : result
}
