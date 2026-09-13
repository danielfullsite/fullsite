'use client'

import { AlertTriangle } from 'lucide-react'
import { retryFailedReports, useReportStatus } from '@/lib/report-status'

/**
 * Aviso de lectura no confirmada.
 *
 * Una lectura financiera que falla NO es un reporte vacío — por eso el aviso es
 * un `role="alert"` permanente y no se puede cerrar. Pero tampoco es motivo para
 * tapar la pantalla: el encabezado, los filtros y los formularios se siguen
 * dibujando, porque capturar información no depende de que el reporte haya
 * cargado. Las cifras de KPI se enmascaran mientras este aviso esté arriba (ver
 * `lib/report-status.ts`); tablas y gráficas simplemente salen vacías, y por eso
 * el texto avisa que lo de abajo no es cifra buena.
 *
 * Reintentar vuelve a correr la cadena completa —autenticación y origen de datos
 * incluidos—, conservando los filtros cuando la pantalla trajo su propio
 * cargador.
 */
export default function ReportUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <section
      role="alert"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-[var(--surface-2)] p-4 text-[var(--text-1)] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold">Datos no disponibles</h2>
          <p className="mt-0.5 text-sm text-[var(--text-2)]">
            No pudimos confirmar los datos del reporte. Lo que se ve abajo puede estar
            incompleto o en cero — no lo tomes como cifra buena. El resto de la pantalla
            sigue disponible.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry || (() => window.location.reload())}
        className="shrink-0 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface)]"
      >
        Reintentar
      </button>
    </section>
  )
}

/**
 * Pinta el aviso una sola vez por pantalla, arriba del contenido. Va montado en
 * el AppShell: así el aviso aparece tome la rama que tome la página (cargando,
 * vacía o con datos) y sin que cada pantalla tenga que acomodarlo en su JSX.
 */
export function ReportUnavailableHost() {
  const { failed } = useReportStatus()
  if (!failed) return null
  return <ReportUnavailable onRetry={retryFailedReports} />
}
