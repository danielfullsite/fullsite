'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Estado compartido: "algún reporte de esta pantalla no se pudo confirmar".
 *
 * Antes, cuando una lectura fallaba, la página entera se reemplazaba por una
 * tarjeta de error (`if (reportError) return <ReportUnavailable />`). Eso cumplía
 * la mitad honesta —no enseñar datos fallidos como ceros— pero se llevaba por
 * delante la pantalla completa: encabezado, filtros, botones y formularios. Con
 * un tenant nuevo o una lectura caída, el dueño no podía ni entrar a capturar
 * información.
 *
 * Ahora la página SIEMPRE se dibuja. El fallo se publica aquí, el aviso se pinta
 * una sola vez arriba del contenido (`ReportUnavailableHost`, montado en el
 * AppShell) y las cifras que dependen de la lectura caída se enmascaran en vez
 * de mostrar $0.00 (ver `KPICard`).
 *
 * Varias fuentes pueden fallar en la misma pantalla (una página y su panel de
 * coach, por ejemplo): cada una registra su propia entrada y el aviso vive
 * mientras quede al menos una.
 */

type Entry = { retry?: () => void }

const entries = new Map<symbol, Entry>()
const listeners = new Set<() => void>()

const EMPTY = { failed: false, count: 0 } as const
let snapshot: { failed: boolean; count: number } = EMPTY

function emit() {
  snapshot = entries.size > 0 ? { failed: true, count: entries.size } : EMPTY
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() { return snapshot }
function getServerSnapshot() { return EMPTY }

/** Suscripción al estado. `failed` = hay al menos un reporte sin confirmar. */
export function useReportStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Reintenta todo lo que falló. Si alguna fuente no trajo su propio `onRetry`,
 * recarga: es la única forma de reintentar su cadena completa (autenticación y
 * origen de datos incluidos) sin adivinar cómo carga.
 */
export function retryFailedReports() {
  const all = [...entries.values()]
  const retries = all.map(e => e.retry).filter((r): r is () => void => typeof r === 'function')
  if (all.length > 0 && retries.length === all.length) {
    for (const retry of retries) retry()
    return
  }
  if (typeof window !== 'undefined') window.location.reload()
}

/**
 * Publica que una lectura de esta pantalla no se pudo confirmar.
 *
 * Sustituye al `if (reportError) return <ReportUnavailable />`: se llama en el
 * mismo lugar, pero no corta el render. Es un hook, así que va antes de
 * cualquier `return` condicional del componente.
 */
export function useReportUnavailable(failed: boolean, onRetry?: () => void) {
  const keyRef = useRef<symbol | null>(null)
  if (keyRef.current === null) keyRef.current = Symbol('report')
  const retryRef = useRef<(() => void) | undefined>(onRetry)

  useEffect(() => { retryRef.current = onRetry })

  useEffect(() => {
    if (!failed) return
    const key = keyRef.current as symbol
    entries.set(key, { retry: onRetry ? () => retryRef.current?.() : undefined })
    emit()
    return () => { entries.delete(key); emit() }
    // `onRetry` sólo decide SI hay reintento propio; el actual se lee del ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, !onRetry])
}

/** Sólo para pruebas: deja el estado limpio entre casos. */
export function __resetReportStatus() {
  entries.clear()
  emit()
}
