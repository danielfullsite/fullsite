export function resolvePayrollHours(
  measuredHours: number | null | undefined,
  daysWorked: number,
): { total: number; measured: boolean } {
  if (typeof measuredHours === 'number' && Number.isFinite(measuredHours) && measuredHours > 0) {
    return { total: measuredHours, measured: true }
  }
  return { total: Math.max(0, daysWorked) * 8, measured: false }
}
