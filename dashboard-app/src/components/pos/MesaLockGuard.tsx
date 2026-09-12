'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { adquirirMesa, liberarMesa, MESA_LOCK_RENEW_MS, MesaLockError } from '@/lib/mesa-lock'
import { requiereCaja } from '@/lib/pedro-cliente'
import { POS_MESA_EXIT_EVENT, resolveMesa, type PosMesaExitDetail } from '@/lib/pos-navigation'

type Estado = 'inactivo' | 'confirmando' | 'adquirido' | 'saliendo' | 'conflicto' | 'sin-caja'

// React StrictMode monta, limpia y vuelve a montar cada effect en desarrollo.
// Las dos instancias comparten la identidad física de la terminal: si la limpieza
// vieja manda MESA_UNLOCK después de que la nueva renovó el lease, Caja no puede
// distinguirlas y borra el lock vigente. Este registro entrega el lease a la
// instancia más nueva de la misma página/mesa; una limpieza genuina (sin relevo)
// sí lo libera.
const efectoActivoPorMesa = new Map<number, symbol>()

export default function MesaLockGuard({ enabled, children }: Readonly<{ enabled: boolean; children?: React.ReactNode }>) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.toString()
  const [retry, setRetry] = useState(0)
  const [estado, setEstado] = useState<Estado>('inactivo')

  // El editor usa el query y, si el App Router lo perdió offline, el destino
  // estacionado en sessionStorage. Se memoriza por URL: el propio editor consume
  // ese destino al montar y no debe hacer que la guardia salte después a mesa 1.
  const mesa = useMemo(() => resolveMesa(new URLSearchParams(query).get('mesa')), [pathname, query])
  const params = new URLSearchParams(query)
  const debeBloquear = enabled && pathname === '/pos' && !params.get('cuenta') && !params.get('mostrador') && requiereCaja()

  useEffect(() => {
    if (!debeBloquear) { setEstado('inactivo'); return }
    const efecto = Symbol(`mesa-${mesa}`)
    efectoActivoPorMesa.set(mesa, efecto)
    let vivo = true
    let adquirido = false
    let renovando = false
    let saliendo = false
    let adquisicion: Promise<void> | null = null
    setEstado('confirmando')

    const adquirir = () => {
      if (renovando || saliendo) return adquisicion ?? Promise.resolve()
      renovando = true
      adquisicion = (async () => {
        try {
          await adquirirMesa(mesa)
          if (!vivo || saliendo) {
            // Un remount inmediato de la misma página ya comparte este lease con
            // la misma identidad de terminal. Su acquire/renew es el dueño actual;
            // un unlock de esta instancia vieja lo dejaría editando sin exclusión.
            const relevo = efectoActivoPorMesa.get(mesa)
            if (!saliendo && relevo && relevo !== efecto) return
            // La salida ganó la carrera contra un acquire/renew ya en vuelo.
            // Esperar este unlock dentro de la misma promesa evita que la
            // navegación lo aborte y que un renew tardío reviva el lease.
            await liberarMesa(mesa).catch(() => {})
            adquirido = false
            return
          }
          adquirido = true
          setEstado('adquirido')
        } catch (error) {
          if (!vivo || saliendo) return
          setEstado(error instanceof MesaLockError && error.code === 'MESA_LOCK_CONFLICT' ? 'conflicto' : 'sin-caja')
        } finally { renovando = false }
      })()
      return adquisicion
    }

    const timer = window.setInterval(() => { void adquirir() }, MESA_LOCK_RENEW_MS)
    const salir = (raw: Event) => {
      const event = raw as CustomEvent<PosMesaExitDetail>
      if (event.detail?.mesa !== mesa) return
      event.preventDefault()
      if (saliendo) return
      saliendo = true
      window.clearInterval(timer)
      setEstado('saliendo')
      void (async () => {
        try { await adquisicion } catch { /* adquirir ya traduce el error */ }
        if (adquirido) {
          adquirido = false
          await liberarMesa(mesa).catch(() => {})
        }
        event.detail.navigate()
      })()
    }

    window.addEventListener(POS_MESA_EXIT_EVENT, salir)
    void adquirir()
    return () => {
      vivo = false
      window.clearInterval(timer)
      window.removeEventListener(POS_MESA_EXIT_EVENT, salir)
      // Darle un microtask al remount de StrictMode permite transferir la
      // titularidad antes de decidir si éste fue un desmontaje real.
      queueMicrotask(() => {
        if (efectoActivoPorMesa.get(mesa) !== efecto) return
        efectoActivoPorMesa.delete(mesa)
        if (adquirido && !saliendo) {
          adquirido = false
          void liberarMesa(mesa).catch(() => {})
        }
      })
    }
  }, [debeBloquear, mesa, retry])

  // Fail closed desde el primer render. `inactivo` es el estado inicial antes
  // de que corra el effect; montar los hijos aquí abriría una ventana breve en
  // la que el editor ejecuta efectos sin que Caja haya confirmado el lease.
  if (!debeBloquear || estado === 'adquirido') return children

  if (estado === 'inactivo' || estado === 'confirmando' || estado === 'saliendo') return (
    <div className="h-dvh flex items-center justify-center bg-[#0a0a0f] text-white" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-lg font-bold">{estado === 'saliendo' ? `Liberando mesa ${mesa}…` : `Confirmando mesa ${mesa} con Caja…`}</p>
        <p className="mt-2 text-sm text-white/55">{estado === 'saliendo' ? 'Un momento; estamos confirmando la salida con Caja.' : 'Un momento; todavía no se puede editar la comanda.'}</p>
      </div>
    </div>
  )

  const conflicto = estado === 'conflicto'
  return (
    <div className="h-dvh flex items-center justify-center bg-[#0a0a0f] px-5 text-white" role="alert" aria-live="assertive">
      <div className="w-full max-w-md rounded-3xl border border-amber-400/30 bg-[#15151d] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-3xl">!</div>
        <h2 className="text-2xl font-black">{conflicto ? `Mesa ${mesa} en uso` : 'Caja no confirmó la mesa'}</h2>
        <p className="mt-3 text-base leading-relaxed text-white/70">
          {conflicto
            ? 'Otra terminal está editando esta mesa. Regresa al mapa o inténtalo cuando termine.'
            : 'No abrimos la comanda sin confirmación de Caja para evitar cambios cruzados entre terminales.'}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button onClick={() => router.replace('/pos/mesas')} className="min-h-14 rounded-2xl bg-white/10 px-5 font-bold active:scale-[0.98]">
            Volver a mesas
          </button>
          <button onClick={() => setRetry(value => value + 1)} className="min-h-14 rounded-2xl bg-emerald-600 px-5 font-bold active:scale-[0.98]">
            Reintentar
          </button>
        </div>
      </div>
    </div>
  )
}
