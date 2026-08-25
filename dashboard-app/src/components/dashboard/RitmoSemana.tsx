'use client'

import { formatCurrency } from '@/lib/format'

/**
 * Qué esperar hoy, según el día de la semana.
 *
 * Esta es la pieza nueva del rediseño, y sale de una pregunta de restaurantero
 * que el dashboard no contestaba: ¿con cuánta gente y cuánto insumo abro hoy?
 *
 * El patrón más fuerte de una cafetería es el día de la semana, y en Espresso
 * Lab es enorme — medido sobre sus 30 días reales de operación:
 *
 *     Domingo   $10,679   28.8 cuentas
 *     Sábado     $9,663   25.5
 *     Lunes      $7,514   20.8
 *     Jueves     $7,451   20.0
 *     Viernes    $6,444   17.8
 *     Martes     $6,021   16.8
 *     Miércoles  $5,880   16.8
 *
 * Un domingo vale 1.8 veces un miércoles. Con eso se decide si entran dos
 * baristas o uno, y cuánto se hornea. El dashboard tenía trece widgets y
 * ninguno mostraba esto: el dato existía y nunca se puso en pantalla.
 *
 * Se muestran el promedio Y el rango del día. Un promedio solo esconde que el
 * mejor jueves fue $10,230 y el peor $6,270 — y para decidir el pedido, esa
 * distancia importa tanto como la media.
 */

export interface DiaSemana {
  /** 1 = lunes … 7 = domingo (ISO). */
  dow: number
  nombre: string
  ventaProm: number
  cuentasProm: number
  peor: number
  mejor: number
  /** Cuántos días reales forman el promedio. */
  n: number
}

export interface RitmoSemanaProps {
  filas: DiaSemana[]
  /** Día de la semana de hoy, ISO 1-7. */
  hoyDow: number
}

/** Con menos de esto, un "promedio del martes" no es un promedio. */
const MUESTRA_MINIMA = 2

export default function RitmoSemana({ filas, hoyDow }: RitmoSemanaProps) {
  const conDatos = filas.filter(f => f.n > 0)
  if (conDatos.length < 3) return null

  const hoy = conDatos.find(f => f.dow === hoyDow) ?? null
  const max = Math.max(...conDatos.map(f => f.ventaProm))
  const ordenados = [...conDatos].sort((a, b) => b.ventaProm - a.ventaProm)
  const mejor = ordenados[0]
  const flojo = ordenados[ordenados.length - 1]

  return (
    <div className="mb-5 rounded-[18px] border border-[var(--line)] p-5" style={{ background: 'var(--bento-card)' }}>
      <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[var(--text-1)]">Qué esperar hoy</h3>

      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[var(--text-2)]">
        {hoy && hoy.n >= MUESTRA_MINIMA ? (
          <>
            Un {hoy.nombre.toLowerCase()} normal son{' '}
            <span className="font-semibold text-[var(--text-1)] tnum">{formatCurrency(hoy.ventaProm)}</span>
            {' '}y{' '}
            <span className="font-semibold text-[var(--text-1)] tnum">{Math.round(hoy.cuentasProm)}</span>
            {' '}cuentas
            <span className="text-[var(--text-4)]">
              {' '}· {hoy.n} {hoy.nombre.toLowerCase()}s de historia, de {formatCurrency(hoy.peor)} a {formatCurrency(hoy.mejor)}
            </span>
          </>
        ) : (
          <span className="text-[var(--text-4)]">
            Todavía no hay {MUESTRA_MINIMA} {hoy ? `${hoy.nombre.toLowerCase()}s` : 'días iguales'} en el
            historial para decir qué esperar hoy.
          </span>
        )}
      </p>

      <ul className="mt-4 space-y-2">
        {conDatos.map(f => {
          const esHoy = f.dow === hoyDow
          return (
            <li key={f.dow} className="flex items-center gap-2.5">
              <span
                className={`w-9 shrink-0 text-[11.5px] ${esHoy ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}
              >
                {f.nombre.slice(0, 3)}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--line-soft)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${max > 0 ? (f.ventaProm / max) * 100 : 0}%`,
                    background: esHoy ? 'var(--accent)' : 'var(--text-4)',
                  }}
                />
              </span>
              <span
                className={`w-20 shrink-0 text-right text-[12.5px] tnum ${esHoy ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}
              >
                {formatCurrency(f.ventaProm)}
              </span>
              <span className="hidden w-16 shrink-0 text-right text-[11.5px] text-[var(--text-4)] tnum sm:block">
                {f.cuentasProm.toFixed(1)} ct
              </span>
            </li>
          )
        })}
      </ul>

      {mejor.dow !== flojo.dow && flojo.ventaProm > 0 && (
        <p className="mt-3.5 border-t border-[var(--line)] pt-3 text-[12.5px] leading-[1.5] text-[var(--text-2)]">
          Tu día fuerte es el {mejor.nombre.toLowerCase()} ({formatCurrency(mejor.ventaProm)}):{' '}
          {(mejor.ventaProm / flojo.ventaProm).toFixed(1)} veces un {flojo.nombre.toLowerCase()}.
        </p>
      )}
    </div>
  )
}
