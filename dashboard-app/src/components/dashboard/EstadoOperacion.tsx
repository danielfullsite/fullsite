'use client'

import { Radio, CircleAlert, CircleCheck } from 'lucide-react'

/**
 * Una sola línea de estado, arriba de todo.
 *
 * Hoy el dashboard dice lo mismo tres veces en los primeros 220 píxeles:
 *
 *   1. la barra de turno:  "Sin turno abierto · Las cifras de abajo son del
 *                           último día con datos, no de hoy"
 *   2. la línea de sync:   "Datos del viernes, 24 de julio de 2026 · último
 *                           cierre 2:02 p.m. — hoy aún no sincroniza"
 *   3. el chip de la fecha: "viernes, 24 de julio de 2026  ÚLTIMO CIERRE"
 *
 * Tres mensajes, tres estilos, un solo hecho. Y ninguno dice el dato que de
 * verdad importa: Espresso Lab lleva 32 DÍAS sin mandar datos. Ese número no
 * aparece en ningún lado de la pantalla — hay que restar dos fechas a mano.
 *
 * Un restaurantero que abre esto ve "$2,070" en tipografía gigante y entiende
 * "vendí $2,070". No: vendió eso hace un mes y el POS lleva un mes callado.
 *
 * Este componente sustituye los tres mensajes por uno que empieza por el número
 * que cambia la decisión.
 */

export interface TurnoVivo {
  numero: number | null
  abiertoPor: string | null
  abiertoAt: string | null
}

export interface EstadoOperacionProps {
  turno: TurnoVivo | null
  /** Último día CON datos, 'YYYY-MM-DD'. null = nunca ha mandado nada. */
  ultimaFecha: string | null
  /** Hoy en horario de México, 'YYYY-MM-DD'. */
  hoy: string
  /** Hora del último cierre, si la hay. */
  syncTime?: string | null
  cargando?: boolean
}

/** Días completos entre dos fechas 'YYYY-MM-DD'. null si alguna no es válida. */
export function diasEntre(desde: string | null, hasta: string): number | null {
  if (!desde) return null
  // Mediodía a propósito: evita que el cambio de horario de verano mueva la
  // resta un día. Con T00:00 una de las dos fechas puede caer en la hora que
  // el reloj repite o se salta.
  const a = new Date(`${desde}T12:00:00`)
  const b = new Date(`${hasta}T12:00:00`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function fechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
}

function hora(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
}

/**
 * es-MX formatea la tarde como "2:28 p.m." — CON punto final. Al pegarle el
 * punto de la oración salía "a las 2:28 p.m..", con dos puntos, visible en
 * pantalla. Se le quita el suyo y la oración pone el que le toca.
 */
function sinPuntoFinal(s: string | null): string | null {
  return s ? s.replace(/\.$/, '') : null
}

export default function EstadoOperacion({
  turno, ultimaFecha, hoy, syncTime, cargando,
}: EstadoOperacionProps) {
  // Mientras carga no se pinta nada. Un bloque que aparece y desaparece arriba
  // de todo empuja la página entera y es más molesto que esperar.
  if (cargando) return null

  const dias = diasEntre(ultimaFecha, hoy)
  const desde = hora(turno?.abiertoAt ?? null)

  // ── Operando ────────────────────────────────────────────────────────────
  if (turno) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[18px] border border-[var(--ok-soft)] bg-[var(--ok-soft)] px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-full text-[var(--ok-ink)]">
          <Radio size={14} />
        </span>
        <span className="text-[14px] font-semibold text-[var(--ok-ink)]">
          {turno.numero != null ? `Turno ${turno.numero} abierto` : 'Turno abierto'}
        </span>
        {(desde || turno.abiertoPor) && (
          <span className="text-[13px] text-[var(--text-2)]">
            {desde && `desde las ${desde}`}
            {desde && turno.abiertoPor && ' · '}
            {turno.abiertoPor && `abrió ${turno.abiertoPor}`}
          </span>
        )}
      </div>
    )
  }

  // ── Nunca ha mandado datos ──────────────────────────────────────────────
  if (dias === null) {
    return (
      <div className="mb-5 rounded-[18px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
        <p className="text-[14px] font-semibold text-[var(--text-1)]">Todavía no hay ventas registradas</p>
        <p className="mt-0.5 text-[13px] text-[var(--text-3)]">
          En cuanto cierres la primera cuenta en el POS, aquí aparece el resumen del día.
        </p>
      </div>
    )
  }

  // ── Cerrado, pero al día ────────────────────────────────────────────────
  if (dias <= 0) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[18px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-full text-[var(--text-3)]">
          <CircleCheck size={14} />
        </span>
        <span className="text-[14px] font-semibold text-[var(--text-1)]">Sin turno abierto</span>
        <span className="text-[13px] text-[var(--text-3)]">
          Los datos de hoy están al día{syncTime ? ` · último cierre ${sinPuntoFinal(syncTime)}` : ''}
        </span>
      </div>
    )
  }

  // ── Datos viejos: el caso que la pantalla no sabía contar ───────────────
  // El tono sube con los días. Un día de retraso es normal (ayer cerró tarde);
  // un mes es que el POS está desconectado. La misma alerta para los dos casos
  // enseña a ignorarla.
  const grave = dias >= 3
  const marco = grave
    ? 'border-[var(--crit-soft)] bg-[var(--crit-soft)]'
    : 'border-[var(--warn-soft)] bg-[var(--warn-soft)]'
  const tinta = grave ? 'text-[var(--crit-ink)]' : 'text-[var(--warn-ink)]'

  return (
    <div className={`mb-5 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-[18px] border px-4 py-3 ${marco}`}>
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${tinta}`}>
        <CircleAlert size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[14px] font-semibold ${tinta}`}>
          {dias === 1
            ? 'El POS no ha mandado datos de hoy'
            : `El POS lleva ${dias} días sin mandar datos`}
        </p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-[var(--text-2)]">
          Lo último que cerró fue el {fechaLarga(ultimaFecha)}
          {syncTime ? ` a las ${sinPuntoFinal(syncTime)}` : ''}. Todas las cifras de abajo son de ese día.
        </p>
      </div>
    </div>
  )
}
