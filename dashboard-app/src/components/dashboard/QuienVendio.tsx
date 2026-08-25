'use client'

import { formatCurrency } from '@/lib/format'

/**
 * Quién vendió, con el reparto a la vista.
 *
 * Reemplaza "Top meseros del día · Ranking por ventas". Tres cambios, y los
 * tres son de fondo, no de estilo:
 *
 * 1. LA BARRA MIDE CONTRA EL TOTAL, NO CONTRA EL PRIMERO. La versión anterior
 *    calcula el ancho con `m.total / topMeseroMax`, así que el primer lugar
 *    SIEMPRE llena la barra completa. Con dos personas repartidas 51/49 se ve
 *    igual que con 95/5: el primero al 100% y el segundo casi lleno. La barra
 *    dejaba de informar justo cuando el reparto importaba.
 *
 * 2. EL PORCENTAJE VA ESCRITO. El dashboard ya calculaba "Valeria cargó el 70%
 *    de las ventas" y lo mandaba a un banner morado, arriba, lejos de la lista
 *    donde se comprueba. El dato pertenece al renglón de Valeria.
 *
 * 3. SE VA EL ARCOÍRIS. Azul, verde, ámbar y rojo por posición. El rojo en el
 *    cuarto lugar se lee como alarma cuando sólo quiere decir "cuarto". La
 *    concentración sí es una señal, y esa se dice con palabras al pie.
 */

export interface VendedorFila {
  nombre: string
  total: number
}

export interface QuienVendioProps {
  filas: VendedorFila[]
  /**
   * Venta total del periodo. Es el denominador de los porcentajes.
   * Si no se pasa, se usa la suma de las filas — pero ojo: no siempre coinciden
   * (una orden sin mesero asignado entra en la venta y no en ninguna fila), y
   * por eso se prefiere el total real cuando se tiene.
   */
  totalPeriodo?: number | null
  titulo?: string
}

export default function QuienVendio({ filas, totalPeriodo, titulo = 'Quién vendió' }: QuienVendioProps) {
  const sumaFilas = filas.reduce((s, f) => s + (f.total || 0), 0)
  const base = totalPeriodo != null && totalPeriodo > 0 ? totalPeriodo : sumaFilas

  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0)
  const lider = filas.length > 1 && base > 0 ? pct(filas[0].total) : null
  const sinAsignar = totalPeriodo != null && totalPeriodo > sumaFilas ? totalPeriodo - sumaFilas : 0

  return (
    <div className="rounded-[18px] border border-[var(--line)] p-5" style={{ background: 'var(--bento-card)' }}>
      <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[var(--text-1)]">{titulo}</h3>

      {filas.length === 0 ? (
        <p className="mt-3 text-[13px] text-[var(--text-3)]">
          Ninguna orden del día trae mesero asignado.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3.5">
            {filas.map((f, i) => {
              const p = pct(f.total)
              return (
                <li key={f.nombre}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--text-1)]">
                      {f.nombre}
                    </span>
                    <span className="text-[11.5px] text-[var(--text-3)] tnum">{p.toFixed(0)}%</span>
                    <span className="text-[13.5px] font-semibold text-[var(--text-1)] tnum">
                      {formatCurrency(f.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, p))}%`,
                        // El primero se marca con el acento; el resto en un tono
                        // neutro. La jerarquía la da la barra, no cuatro colores.
                        background: i === 0 ? 'var(--accent)' : 'var(--text-4)',
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>

          {sinAsignar > 0 && (
            <p className="mt-3.5 text-[12px] text-[var(--text-4)]">
              {formatCurrency(sinAsignar)} de la venta no tiene mesero asignado.
            </p>
          )}

          {/* La concentración, dicha una sola vez y donde se comprueba. */}
          {lider != null && lider >= 60 && (
            <p className="mt-3.5 border-t border-[var(--line)] pt-3 text-[12.5px] leading-[1.5] text-[var(--text-2)]">
              {filas[0].nombre} cargó el {lider.toFixed(0)}% de la venta del día.
            </p>
          )}
        </>
      )}
    </div>
  )
}
