'use client'
/**
 * Galería del rediseño del panel.
 *
 * Existe para poder VER el rediseño sin entrar al sistema ni tener datos: el
 * armazón, las cifras, las tablas, los esqueletos de carga y los estados
 * vacíos, los tres en la misma pantalla y conmutables.
 *
 * Sólo vive en desarrollo. En producción responde 404, así que no agrega
 * superficie pública al producto.
 */
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { Clock, TriangleAlert, Wallet, Receipt } from 'lucide-react'
import {
  Tarjeta, TarjetaEncabezado, Cifra, Segmentado, Pastilla,
  Hueso, CifraEsqueleto, TarjetaEsqueleto, FilasEsqueleto, Cargando,
} from '@/components/ui/Superficie'

type Vista = 'datos' | 'cargando' | 'vacio'

const MESEROS = [
  { nombre: 'Ana Martínez', ordenes: 34, total: 28450, pct: 100 },
  { nombre: 'Luis Hernández', ordenes: 29, total: 24100, pct: 85 },
  { nombre: 'Sofía Ramírez', ordenes: 22, total: 19800, pct: 70 },
  { nombre: 'Diego Torres', ordenes: 18, total: 14200, pct: 50 },
  { nombre: 'Carmen Ruiz', ordenes: 11, total: 9350, pct: 33 },
]

const PENDIENTES = [
  { titulo: 'Jamón ibérico: quedan 3 días de inventario', detalle: 'Pedir 15 kg antes del viernes', tono: 'grave' as const, valor: '$12,400' },
  { titulo: 'Cancelaciones concentradas en una terminal', detalle: '7 de 9 cancelaciones salieron de Caja', tono: 'aviso' as const, valor: '$3,180' },
  { titulo: 'Ana Martínez lleva el mejor ticket del mes', detalle: 'Ticket promedio 22% arriba del equipo', tono: 'info' as const, valor: null },
]

const pesos = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })

export default function GaleriaRediseno() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [vista, setVista] = useState<Vista>('datos')
  const [periodo, setPeriodo] = useState<'dia' | 'semana' | 'mes'>('dia')
  const cargando = vista === 'cargando'
  const vacio = vista === 'vacio'

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-[1200px] px-5 py-6">

        {/* Barra de la galería. No es parte del producto. */}
        <div
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
        >
          <div>
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Galería del rediseño</div>
            <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>Sólo en desarrollo · cambia el estado para ver carga y vacío</div>
          </div>
          <Segmentado
            etiquetaAria="Estado a mostrar"
            valor={vista}
            alCambiar={setVista}
            opciones={[
              { id: 'datos', texto: 'Con datos' },
              { id: 'cargando', texto: 'Cargando' },
              { id: 'vacio', texto: 'Sin datos' },
            ]}
          />
        </div>

        {/* ── Encabezado ─────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text-1)' }}>Panel</h1>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
              Hoy · 7 sep 2026 {!cargando && <Pastilla tono="bien">Turno abierto</Pastilla>}
            </p>
          </div>
          <Segmentado
            etiquetaAria="Periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={[{ id: 'dia', texto: 'Día' }, { id: 'semana', texto: 'Semana' }, { id: 'mes', texto: 'Mes' }]}
          />
        </div>

        {cargando && <Cargando que="el panel" />}

        {/* ── Cifras ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cargando ? [0, 1, 2, 3].map(i => <CifraEsqueleto key={i} />) : (
            <>
              <Cifra
                etiqueta="Ventas del día" icono={<Wallet size={15} />}
                valor={vacio ? null : pesos(96020)}
                nota={vacio ? 'Sin cierre todavía' : <span style={{ color: 'var(--ok-ink)' }}>+8.2% vs mismo día</span>}
              />
              <Cifra
                etiqueta="Ticket promedio" icono={<Receipt size={15} />}
                valor={vacio ? null : pesos(797)}
                nota={vacio ? 'Sin cierre todavía' : '124 cuentas cerradas'}
              />
              <Cifra
                etiqueta="Propinas" icono={<Clock size={15} />}
                valor={vacio ? null : pesos(10275)}
                nota={vacio ? 'Sin cierre todavía' : '10.7% sobre ventas'}
              />
              <Cifra
                etiqueta="Cancelaciones" icono={<TriangleAlert size={15} />}
                tono={vacio ? 'neutro' : 'grave'}
                valor={vacio ? null : pesos(3180)}
                nota={vacio ? 'Sin cierre todavía' : '9 cuentas · revisar'}
              />
            </>
          )}
        </div>

        {/* ── Pendientes ─────────────────────────────────────────────────── */}
        <div className="mt-3">
          {cargando ? <TarjetaEsqueleto alto="h-[186px]" /> : (
            <Tarjeta padding={false}>
              <div className="px-5 pt-5">
                <TarjetaEncabezado
                  titulo={vacio ? 'Nada por atender' : `${PENDIENTES.length} cosas por atender`}
                  ayuda={vacio ? 'Los agentes revisaron el día y no encontraron nada' : 'Lo que los agentes encontraron hoy'}
                  derecha={!vacio && <Pastilla tono="grave">1 crítica</Pastilla>}
                />
              </div>
              {vacio ? (
                <div className="px-5 py-8 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                  Todo en orden.
                </div>
              ) : (
                <ul className="mt-3">
                  {PENDIENTES.map((p, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 border-t px-5 py-3"
                      style={{ borderColor: 'var(--line-soft)' }}
                    >
                      <span
                        className="h-8 w-[3px] shrink-0 rounded-full"
                        style={{ background: `var(--${p.tono === 'grave' ? 'crit' : p.tono === 'aviso' ? 'warn' : 'info'})` }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium" style={{ color: 'var(--text-1)' }}>{p.titulo}</div>
                        <div className="truncate text-[12px]" style={{ color: 'var(--text-3)' }}>{p.detalle}</div>
                      </div>
                      {p.valor && (
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{p.valor}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          )}
        </div>

        {/* ── Gráfica ────────────────────────────────────────────────────── */}
        <div className="mt-3">
          {cargando ? <TarjetaEsqueleto alto="h-[228px]" /> : (
            <Tarjeta>
              <TarjetaEncabezado titulo="Ventas de los últimos 30 días" ayuda="Capital · comparado con el mes anterior" />
              <div className="mt-5 flex h-[180px] items-end gap-[3px]">
                {Array.from({ length: 30 }, (_, i) => {
                  const alto = vacio ? 2 : 24 + Math.abs(Math.sin(i * 0.7)) * 130
                  const hoy = i === 29
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-[3px]"
                      style={{ height: `${alto}px`, background: hoy && !vacio ? 'var(--accent)' : 'var(--accent-soft)' }}
                    />
                  )
                })}
              </div>
              <div className="mt-2 flex justify-between text-[11px]" style={{ color: 'var(--text-4)' }}>
                <span>9 ago</span><span>23 ago</span><span>7 sep</span>
              </div>
            </Tarjeta>
          )}
        </div>

        {/* ── Dos columnas ───────────────────────────────────────────────── */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Tarjeta>
            <TarjetaEncabezado titulo="Quién vendió" ayuda={cargando ? undefined : `${MESEROS.length} meseros con cuentas cerradas`} />
            <div className="mt-4">
              {cargando ? <FilasEsqueleto filas={5} conAyuda /> : vacio ? (
                <p className="py-6 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                  Ninguna orden del día trae mesero asignado.
                </p>
              ) : (
                <ul className="space-y-3">
                  {MESEROS.map(m => (
                    <li key={m.nombre}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px]" style={{ color: 'var(--text-1)' }}>{m.nombre}</span>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{pesos(m.total)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                          <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: 'var(--accent)' }} />
                        </div>
                        <span className="w-16 shrink-0 text-right text-[11.5px] tabular-nums" style={{ color: 'var(--text-4)' }}>{m.ordenes} cuentas</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Tarjeta>

          <Tarjeta>
            <TarjetaEncabezado titulo="Eficiencia del día" ayuda="Contra el promedio de los últimos 30 días" />
            <div className="mt-4">
              {cargando ? <FilasEsqueleto filas={4} /> : (
                <dl className="space-y-3">
                  {[
                    ['Cuentas cerradas', vacio ? null : '124', 'bien'],
                    ['Tiempo medio de mesa', vacio ? null : '47 min', 'neutro'],
                    ['Comandas devueltas', vacio ? null : '2', 'aviso'],
                    ['Cobrado a tiempo', vacio ? null : '79.4%', 'neutro'],
                  ].map(([etiqueta, valor, tono]) => (
                    <div key={etiqueta as string} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: 'var(--line-soft)' }}>
                      <dt className="text-[13px]" style={{ color: 'var(--text-2)' }}>{etiqueta}</dt>
                      <dd
                        className="text-[14px] font-semibold tabular-nums"
                        style={{ color: valor === null ? 'var(--text-4)' : tono === 'bien' ? 'var(--ok-ink)' : tono === 'aviso' ? 'var(--warn-ink)' : 'var(--text-1)' }}
                      >
                        {valor ?? '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </Tarjeta>
        </div>

        <p className="mt-6 text-center text-[11.5px]" style={{ color: 'var(--text-4)' }}>
          La raya significa «no hay dato», y es distinta de un cero, que sí es un dato.
        </p>
      </div>
    </div>
  )
}
