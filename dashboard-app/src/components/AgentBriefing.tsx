'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, Bot } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { agentName } from '@/lib/agent-names'
import { useAuth } from '@/contexts/AuthContext'

interface Det {
  agent_id: string
  summary: string
  priority: string
  fecha: string
  client_id?: string
}

function kind(p: string): 'crit' | 'warn' {
  return p === 'critical' ? 'crit' : 'warn'
}
// Severidad vía tokens semánticos → crisp en dark Y light.
const K = {
  crit: { label: 'Alerta', color: 'var(--crit)', soft: 'var(--crit-soft)', ink: 'var(--crit-ink)' },
  warn: { label: 'Ojo', color: 'var(--warn)', soft: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
}

/**
 * P0 — fuga entre restaurantes.
 *
 * Este componente consultaba con `useEffect(..., [])`: una sola vez al montar,
 * sin volver a consultar y sin dejar registro de a que restaurante pertenece lo
 * que pinta. Una vez que la lista queda mal, se queda mal.
 *
 * CORRECCION DE LA CAUSA RAIZ. La primera version de este comentario decia que
 * al cambiar de restaurante "el componente NO se desmonta". Es FALSO y lo
 * refuta el propio codigo: entrar a otro tenant hace
 * `window.location.href = '/'` (platform/tenants/page.tsx) y salir hace lo mismo
 * (ActAsBanner.tsx) — las dos son recargas completas de documento.
 *
 * Los vectores reales, que este parche si cierra:
 *   · getActiveClientSlug() cae a NEXT_PUBLIC_DEFAULT_CLIENT_ID, que en el
 *     deploy vale 'amalay' — verificado en el bundle de produccion. Cualquier
 *     consulta que corra sin tenant resuelto pregunta por AMALAY, no por nada.
 *     El "fail-closed" que promete el comentario de data.ts:320 esta anulado.
 *   · No hay sincronizacion entre pestañas: localStorage se comparte, asi que
 *     cambiar de restaurante en una pestaña no avisa a los componentes montados
 *     en otra. Ahi el `[]` si deja las alertas viejas indefinidamente.
 *   · AuthContext abre la compuerta de AppShell con un setTimeout de 5 s; si la
 *     consulta de membresias tarda mas, los hijos montan sin slug resuelto.
 *   · El logout preserva 'fullsite_client_id' a proposito.
 *
 * Cual de los cuatro produjo la captura concreta no se puede afirmar por
 * lectura. El parche cierra los cuatro porque espera a `clientId` de useAuth(),
 * que es null hasta que las membresias resolvieron.
 *
 * Observado en produccion: el dashboard de coffee-shop mostrando
 * "ALERTAS: 225 sin stock", "19 issues: 0 critical, 11 high" y "1 issues", que
 * son filas de agent_results con client_id='amalay'. coffee-shop tiene CERO
 * filas propias.
 *
 * getDeepTable() ya filtraba bien por tenant — lee getActiveClientSlug() en el
 * momento de la consulta. El agujero no estaba en la consulta sino en CUANDO se
 * hacia: una sola vez, con el tenant viejo.
 *
 * Dos candados:
 *   1. el estado guarda PARA QUE tenant se resolvio, asi que mientras la
 *      respuesta del nuevo no llega, la lista esta vacia — falla cerrado, nunca
 *      enseña lo del anterior.
 *   2. se descarta toda fila cuyo client_id no sea el activo, por si alguna vez
 *      una consulta se salta el filtro.
 */
export default function AgentBriefing() {
  const { clientId } = useAuth()
  const [resuelto, setResuelto] = useState<{ cid: string; dets: Det[] } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    getDeepTable('agent_results', 60)
      .then(rows => {
        if (!alive) return
        const seen = new Set<string>()
        const list: Det[] = []
        for (const r of rows as unknown as Det[]) {
          if (r.priority !== 'critical' && r.priority !== 'warning') continue
          // Candado 2: jamas pintar la fila de otro restaurante.
          if (r.client_id && r.client_id !== clientId) continue
          if (seen.has(r.agent_id)) continue
          seen.add(r.agent_id)
          list.push(r)
        }
        list.sort((a, b) => (a.priority === 'critical' ? 0 : 1) - (b.priority === 'critical' ? 0 : 1))
        setResuelto({ cid: clientId, dets: list.slice(0, 3) })
      })
      .catch(() => setResuelto({ cid: clientId, dets: [] }))
    return () => { alive = false }
  }, [clientId])

  // Candado 1: el valor es derivado. Si el tenant cambio y su respuesta no ha
  // llegado, esto es [] y el bloque no se pinta.
  const dets = resuelto && resuelto.cid === clientId ? resuelto.dets : []

  if (dets.length === 0) return null

  return (
    <div className="rounded-2xl border p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--accent-line)', background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
      <div className="flex items-center gap-2 mb-3.5">
        <Sparkles size={17} style={{ color: 'var(--accent-ink)' }} />
        <b className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
          Buenos días — {dets.length === 1 ? '1 cosa para hoy' : `${dets.length} cosas para hoy`}
        </b>
        <span className="ml-auto text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5" style={{ color: 'var(--accent-ink)' }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />tus agentes IA
        </span>
      </div>
      <div className="space-y-2.5">
        {dets.map((d, i) => {
          const k = K[kind(d.priority)]
          return (
            <Link
              key={`${d.agent_id}-${i}`}
              href="/mission-control"
              className="flex items-stretch gap-3 rounded-xl border p-3 transition-colors"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
            >
              <span className="w-1.5 rounded-full flex-shrink-0" style={{ background: k.color }} />
              <span className="relative grid place-items-center flex-shrink-0 rounded-full self-start" style={{ width: 34, height: 34, background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                <Bot size={17} />
                <span className="absolute rounded-full animate-pulse" style={{ width: 9, height: 9, right: -1, bottom: -1, background: 'var(--accent)', border: '2px solid var(--surface)' }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>{agentName(d.agent_id)}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: k.soft, color: k.ink }}>{k.label}</span>
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-ink)' }}>Agente IA · en vivo</div>
                <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>{d.summary}</p>
              </div>
            </Link>
          )
        })}
      </div>
      <Link href="/mission-control" className="inline-flex items-center gap-1.5 mt-3.5 text-xs font-semibold" style={{ color: 'var(--accent-ink)' }}>
        Ver todas las detecciones <ArrowRight size={13} />
      </Link>
    </div>
  )
}
