import { useEffect, useRef } from 'react'

/**
 * setInterval que SOLO corre cuando la pestaña está VISIBLE.
 *
 * Por qué existe: las pantallas de POS/KDS/dashboard hacían polling cada 2–10s con
 * `setInterval` crudo, que sigue golpeando la API aunque el tab esté en segundo plano
 * u olvidado. Ése es el driver #1 del gasto (invocaciones de Vercel + compute de
 * Supabase) — millones de requests de tabs idle. Este hook:
 *   - Pausa el intervalo cuando `document.visibilityState !== 'visible'`.
 *   - Al volver a primer plano, dispara el callback UNA vez (datos frescos) y reanuda.
 *   - NO dispara en el montaje: la página normalmente ya hace su fetch inicial aparte,
 *     así que evitamos duplicarlo. (Haz el primer fetch tú en el mismo useEffect si lo
 *     necesitas, igual que con setInterval.)
 *
 * Reemplazo directo de:
 *   useEffect(() => { fetchX(); const i = setInterval(fetchX, 2000); return () => clearInterval(i) }, [])
 * por:
 *   useEffect(() => { fetchX() }, [])            // fetch inicial (si lo quieres)
 *   useVisibleInterval(fetchX, 10000)            // refresco, solo visible
 *
 * No cambia la UX cuando miras la pantalla (sigue refrescando); solo calla los tabs
 * ocultos. Cero pérdida de datos.
 */
export function useVisibleInterval(callback: () => void, delayMs: number, enabled = true): void {
  const savedCallback = useRef(callback)
  useEffect(() => { savedCallback.current = callback }, [callback])

  useEffect(() => {
    if (!enabled || delayMs <= 0) return
    if (typeof document === 'undefined') return

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (timer === null) timer = setInterval(() => savedCallback.current(), delayMs) }
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null } }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current() // refresca al volver a primer plano
        start()
      } else {
        stop()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') start() // no dispara callback en montaje

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [delayMs, enabled])
}
