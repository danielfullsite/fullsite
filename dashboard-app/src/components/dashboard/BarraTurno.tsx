'use client'

import { formatCurrency } from '@/lib/format'

/**
 * La barra de turno.
 *
 * Un restaurante no vive en días: vive en turnos. Se abre caja, se sirve, se
 * corta. "Cuánto llevas" sólo significa algo dentro de un turno.
 *
 * El estado vacío es la mitad del componente, y a propósito. AMALAY hoy tiene 17
 * turnos históricos y NINGUNO abierto, porque todavía no opera en Fullsite. La
 * barra lo dice con esas palabras en vez de mostrar ceros — un cero se lee como
 * "vendimos nada", y no es eso: es "no hay turno".
 */

export interface Turno {
  id: string
  numero: number | null
  abiertoPor: string | null
  abiertoAt: string | null
  fondoInicial: number | null
}

export interface ResumenTurno {
  ventas: number | null
  ordenes: number | null
  personas: number | null
  mesasOcupadas: number | null
  mesasTotal: number | null
}

function hora(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
}

function Celda({
  etiqueta,
  valor,
  sub,
  activa = false,
}: {
  etiqueta: string
  valor: React.ReactNode
  sub?: string | null
  activa?: boolean
}) {
  return (
    <div className="relative bg-[var(--panel)] px-4 py-3.5">
      {activa && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />}
      <p className="text-[11.5px] font-semibold text-[var(--text-3)] mb-1">{etiqueta}</p>
      <p className="text-[21px] font-bold tracking-[-0.02em] text-[var(--text-1)] tabular-nums leading-none">
        {valor}
      </p>
      {sub && <p className="text-[12px] text-[var(--text-4)] mt-1.5 leading-snug">{sub}</p>}
    </div>
  )
}

export default function BarraTurno({
  turno,
  resumen,
}: {
  turno: Turno | null
  resumen: ResumenTurno
}) {
  // Sin turno abierto la barra NO muestra ceros: dice que no hay turno.
  // Un "$0" se lee como "no vendimos"; esto es otra cosa.
  if (!turno) {
    return (
      <div className="mb-5 rounded-[12px] border border-dashed border-[var(--line)] px-4 py-3.5 flex items-center gap-3">
        <span aria-hidden="true" className="w-[3px] self-stretch rounded-full bg-[var(--text-4)] flex-none" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--text-2)]">Sin turno abierto</p>
          <p className="text-[12.5px] text-[var(--text-4)] mt-0.5">
            Las cifras de abajo son del último día con datos, no de hoy.
          </p>
        </div>
      </div>
    )
  }

  const desde = hora(turno.abiertoAt)
  const quien = turno.abiertoPor

  return (
    <div className="mb-5 grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--line)] border border-[var(--line)] rounded-[12px] overflow-hidden">
      <Celda
        etiqueta="Turno"
        valor={turno.numero ?? '—'}
        sub={[desde ? `abierto ${desde}` : null, quien].filter(Boolean).join(' · ') || null}
      />
      <Celda
        etiqueta="Llevas"
        activa
        valor={resumen.ventas != null ? formatCurrency(resumen.ventas) : '—'}
        sub={
          resumen.ordenes != null || resumen.personas != null
            ? [
                resumen.ordenes != null ? `${resumen.ordenes} órdenes` : null,
                resumen.personas != null ? `${resumen.personas} personas` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
      />
      <Celda
        etiqueta="En piso"
        valor={
          resumen.mesasOcupadas != null && resumen.mesasTotal != null ? (
            <>
              {resumen.mesasOcupadas}
              <span className="text-[14px] text-[var(--text-4)] font-semibold"> / {resumen.mesasTotal}</span>
            </>
          ) : (
            '—'
          )
        }
        sub={null}
      />
      <Celda
        etiqueta="Corte"
        valor={<span className="text-[var(--text-3)]">—</span>}
        sub="pendiente"
      />
    </div>
  )
}
