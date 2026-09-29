// Punto de entrada de la eval de exactitud: `npm run eval:ia` (vitest.eval-ia.config.ts).
//
// Pide al chat REAL (app/api/chat/route.ts, Groq real, datos de staging) y compara contra
// la verdad en SQL. La autenticación se simula con vi.mock (requireTenant → tenant de la
// eval, sesión por service key): no existe ningún "modo eval" en el código de producción.
// Falla (exit 1) si la exactitud < EVAL_IA_UMBRAL o si falla una trampa (dato inventado).
// Lista: banco de preguntas.ts + muestra de EVAL_IA_MUESTRA preguntas generadas sobre los
// datos del tenant (generador.ts; semilla EVAL_IA_SEMILLA). Si Groq agota la cuota diaria,
// se detiene y reporta lo que alcanzó (infraestructura, no falla del modelo).
import { expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  armarLista, bloquearEscrituras, configDesdeEnv, consultaVerdad, correrEvalCompleta, escribirReportes, fijarAhora, preguntarEnProceso,
  resumir, vigilarGroq, type DetallePregunta,
} from './correr'
import { pasaCompuerta } from './puntaje'

vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth')>()),
  requireTenant: async () => ({
    clientId: process.env.EVAL_IA_TENANT || 'chickin-demo',
    staffId: `eval-ia-${Math.random().toString(36).slice(2)}`,
    staffName: 'eval-ia',
    role: 'dueño',
    authType: 'eval',
  }),
}))

it('exactitud de la IA del dueño (preguntas con verdad en SQL)', { timeout: 180 * 60_000 }, async () => {
  const c = configDesdeEnv()
  if (!c.ok) {
    throw new Error(`Faltan variables para la eval: ${c.faltan.join(', ')}. Ver docs/ai/IA-DEL-DUENO.md §3c.`)
  }
  const cfg = c.cfg
  // La ruta lee estas variables: apuntan a STAGING (nunca a las de la máquina).
  process.env.NEXT_PUBLIC_SUPABASE_URL = cfg.sbUrl
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = cfg.anonKey
  process.env.SUPABASE_SERVICE_KEY = cfg.serviceKey
  // Sin respaldo de pago: se mide el modelo configurado, no el de respaldo.
  delete process.env.ANTHROPIC_API_KEY

  // Nombre de los reportes con la hora REAL (antes de fijar el reloj de la eval).
  const stamp = new Date().toISOString()
  const restaurarFetch = bloquearEscrituras()
  const limites = vigilarGroq()
  const restaurarAhora = cfg.ahora ? fijarAhora(cfg.ahora) : () => {}
  try {
    const consultar = (sql: string) => consultaVerdad(cfg, sql)
    const { lista, reserva, info } = await armarLista({ cfg, consultar })
    process.stdout.write(`[eval-ia] ${info.base} del banco + ${info.muestra} generadas (de ${info.generadas} posibles; semilla ${info.semilla})\n`)
    const { POST } = await import('@/app/api/chat/route')
    // Detalle con datos (preguntas, respuestas, verdad) SÓLO en local y a pedido: nunca en CI.
    const conDetalle = process.env.EVAL_IA_DETALLE_LOCAL === '1' && !process.env.CI
    const detalles: DetallePregunta[] = []
    const { resultados: rs, corrida } = await correrEvalCompleta({
      cfg,
      preguntas: lista,
      reserva,
      limites,
      preguntar: preguntarEnProceso(POST as never),
      consultar,
      detalle: conDetalle ? d => detalles.push(d) : undefined,
      progreso: (r, i, n) => process.stdout.write(`[eval-ia] ${i + 1}/${n} ${r.id}: ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}\n`),
    })
    const resumen = resumir(rs, corrida)
    const rutas = escribirReportes(cfg, rs, resumen, stamp, info)
    if (conDetalle) {
      mkdirSync(cfg.dirSalida, { recursive: true })
      const f = join(cfg.dirSalida, `${stamp.replace(/[:.]/g, '-')}.detalle-local.json`)
      writeFileSync(f, JSON.stringify(detalles, null, 2))
      process.stdout.write(`[eval-ia] detalle local (con datos; no lo compartas): ${f}\n`)
    }
    const g = pasaCompuerta(resumen, cfg.umbral)
    process.stdout.write(`\n[eval-ia] exactitud ${(resumen.exactitud * 100).toFixed(1)}% `
      + `(IC 95% ${(resumen.ic95[0] * 100).toFixed(1)}–${(resumen.ic95[1] * 100).toFixed(1)}%; ${resumen.aprobadas}/${resumen.evaluadas}), `
      + `omitidas ${resumen.omitidas.length}, trampas fallidas ${resumen.trampasFallidas.length}`
      + `${corrida.detenida ? `, PARCIAL (${corrida.detenida}; ${corrida.noCorridas} sin correr)` : ''} → ${g.ok ? 'PASA' : 'NO PASA'}\n`
      + `[eval-ia] reportes: ${rutas.md} · ${rutas.json}\n`)
    expect(g.motivos).toEqual([])
  } finally {
    restaurarAhora()
    limites.restaurar()
    restaurarFetch()
  }
})
