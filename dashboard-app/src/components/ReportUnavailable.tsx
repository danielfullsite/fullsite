'use client'

/** A failed financial read is not an empty report. Reload retries the whole
 * dependency chain, including authentication and the selected source. Screens
 * with a local loader can supply it to retain their current report filters. */
export default function ReportUnavailable({ onRetry }: { onRetry?: () => void }) {
  return <section role="alert" className="m-6 rounded-xl border border-amber-500/40 bg-[var(--surface-2)] p-6 text-[var(--text-1)]">
    <h2 className="text-lg font-semibold">Datos no disponibles</h2>
    <p className="mt-2 text-sm">No pudimos confirmar los datos del reporte. Vuelve a intentar para consultarlos.</p>
    <button type="button" onClick={onRetry || (() => window.location.reload())} className="mt-4 rounded-lg border border-[var(--line)] px-4 py-2">Reintentar</button>
  </section>
}
