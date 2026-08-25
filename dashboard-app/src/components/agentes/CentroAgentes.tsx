'use client'

import { useState } from 'react'
import { Sparkles, ChevronRight, CircleCheck } from 'lucide-react'
import PanelAgente, { type AccionAgente } from '@/components/agentes/PanelAgente'
import NotificacionFullsite from '@/components/agentes/NotificacionFullsite'
import { saludo, type Deteccion } from '@/lib/agentes/detectar'

/**
 * "Buenos días — N cosas para hoy".
 *
 * Reemplaza el bloque anterior, que escribía así:
 *
 *     Alerta de Stock     ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo
 *     Salud del Sistema   19 issues: 0 critical, 11 high
 *     Configuración       1 issues
 *
 * Eso es salida de sistema puesta en la cara del dueño: mayúsculas sostenidas,
 * inglés a medias, plural roto ("1 issues"), cero pesos y cero acción. Un
 * cafetero no sabe qué hacer con "19 issues: 0 critical, 11 high" — y peor,
 * esas tres líneas eran de OTRO restaurante (P0 aparte).
 *
 * Aquí cada renglón es una frase que empieza con un verbo, dice el hecho con su
 * número y contra qué se compara, y lleva el dinero a la derecha. Se hace clic y
 * se abre la evidencia completa.
 *
 * Cuando no hay nada, lo dice — no desaparece. Un panel que se esfuma no
 * distingue "revisé y todo bien" de "no revisé", y esas dos cosas son muy
 * distintas para quien confía en que algo lo está cuidando.
 */

export interface CentroAgentesProps {
  detecciones: Deteccion[]
  /** Mientras carga no se pinta nada: aparecer y desaparecer arriba empuja la página. */
  cargando?: boolean
  /** Qué revisó, para el estado "todo en orden". */
  ambito?: string
  onAccion?: (id: string, accion: AccionAgente) => void
}

const pesos = (n: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(n))

export default function CentroAgentes({
  detecciones, cargando, ambito = 'ventas, propinas y equipo', onAccion,
}: CentroAgentesProps) {
  const [abierta, setAbierta] = useState<Deteccion | null>(null)
  const [resueltas, setResueltas] = useState<Record<string, AccionAgente>>({})

  if (cargando) return null

  const vivas = detecciones.filter(d => resueltas[d.id] !== 'descartar')

  function manejar(id: string, accion: AccionAgente) {
    setResueltas(prev => ({ ...prev, [id]: accion }))
    onAccion?.(id, accion)
  }

  // El panel y el aviso se renderizan SIEMPRE al final, nunca dentro de una de
  // las dos ramas. Cuando estaban dentro, marcar "No aplica" en la última
  // detección vaciaba la lista, entraba la rama de "Todo en orden" y el panel
  // se desmontaba de golpe — sin alcanzar a enseñar el acuse de lo que acababas
  // de hacer. Lo encontró una prueba, no una revisión visual.
  const cuerpo = vivas.length === 0 ? (
    // ── Todo en orden ─────────────────────────────────────────────────────
    (
      <div
        className="mb-5 flex items-center gap-3 rounded-[18px] border border-[var(--line)] px-4 py-3.5"
        style={{ background: 'var(--bento-card)' }}
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]"
          style={{ background: 'var(--ok-soft)', color: 'var(--ok-ink)' }}
        >
          <CircleCheck size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--text-1)]">Todo en orden</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
            Revisé {ambito} del último día con datos. Nada que atender.
          </p>
        </div>
      </div>
    )
  ) : (
      <section
        className="mb-5 overflow-hidden rounded-[18px] border border-[var(--line)]"
        style={{ background: 'var(--bento-card)' }}
      >
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
          <Sparkles size={16} style={{ color: 'var(--accent-ink)' }} />
          <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[var(--text-1)]">
            {saludo(vivas.length)}
          </h3>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
            tus agentes
          </span>
        </div>

        <ul>
          {vivas.map((d, i) => {
            const negativo = (d.impacto ?? 0) < 0
            const atendida = resueltas[d.id]
            return (
              <li key={d.id} className="border-t border-[var(--line)]">
                <button
                  onClick={() => setAbierta(d)}
                  className="ag-entra-fila flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className="h-9 w-[3px] shrink-0 rounded-full"
                    style={{
                      background: d.severidad === 'alta' ? 'var(--crit)' : d.severidad === 'media' ? 'var(--warn)' : 'var(--accent)',
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] leading-[1.45] text-[var(--text-1)]">
                      <b className="font-bold">{d.verbo}:</b> {d.linea}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-[var(--text-4)]">{d.agente}</span>
                  </span>

                  {atendida && (
                    <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--ok-ink)' }}>
                      {atendida === 'aplicar' ? 'atendido' : 'mañana'}
                    </span>
                  )}

                  {d.impacto !== null && d.impacto !== 0 && (
                    <span
                      className="shrink-0 text-[13.5px] font-bold tnum"
                      style={{ color: negativo ? 'var(--crit-ink)' : 'var(--ok-ink)' }}
                    >
                      {negativo ? '−' : '+'}{pesos(d.impacto)}
                    </span>
                  )}
                  <ChevronRight size={15} className="shrink-0 text-[var(--text-4)]" />
                </button>
              </li>
            )
          })}
        </ul>
      </section>
  )

  return (
    <>
      {cuerpo}

      {/* El aviso vive aquí y no en la página para que al tocarlo abra ESTE
          panel. Si estuviera arriba haría falta subir el estado a page.tsx y
          bajarlo por props sólo para eso. */}
      <NotificacionFullsite detecciones={vivas} onAbrir={setAbierta} />

      <PanelAgente deteccion={abierta} onCerrar={() => setAbierta(null)} onAccion={manejar} />
    </>
  )
}
