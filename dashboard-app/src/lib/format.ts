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
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][date.getDay()]
  const dayMonth = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  return `${dow} ${dayMonth}`
}

export function percentChange(current: number | null | undefined, previous: number | null | undefined): number {
  if (!current || !previous || previous === 0) return 0
  const result = ((current - previous) / previous) * 100
  return isNaN(result) ? 0 : result
}


/**
 * Fecha corta para la interfaz: "26 ago".
 *
 * Existe porque varias pantallas imprimian el ISO crudo —"2026-07-26 → 2026-08-25"
 * en el encabezado de Cortes, "2026-08-12" en la tabla de gastos— mientras que en
 * la MISMA fila los montos si pasaban por formatCurrency. Una fecha ISO en pantalla
 * es una fuga de la base de datos hacia el usuario.
 *
 * Devuelve la cadena original si no es una fecha valida: es preferible enseñar el
 * dato crudo a enseñar "Invalid Date".
 */
export function fechaCorta(iso: string | null | undefined, conAnio = false): string {
  if (!iso) return '—'
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    ...(conAnio ? { year: 'numeric' } : {}),
  })
}
