import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { puedeArchivarseSinVeredicto } from '@/lib/agents/engine'
import type { AgentId } from '@/lib/agents/types'

// El motor archiva («resolved») todo hallazgo vencido en cada corrida. El feed de
// /agentes pide status=new, así que archivar equivale a borrar de la pantalla — y nadie
// puede opinar sobre lo que ya no ve.
//
// Medido en la base el 2026-09-08, con el archivado sin excepciones:
//
//   155 hallazgos · 6 veredictos · 54 CRÍTICOS archivados solos sin que nadie los viera
//   De esos, 3 eran de fraude. El único agente con veredictos (close-predictor) es
//   justamente el único que no pasa por este archivado.
//
// Archivar y callar son el mismo acto: el hallazgo se va sin que un humano decida. Por
// eso comparten la lista de quién tiene permiso.

const raiz = join(__dirname, '..')
const sinComentarios = (f: string) =>
  readFileSync(join(raiz, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('quién puede archivar sus hallazgos solo', () => {
  it('fraude no: su alerta espera veredicto por vieja que esté', () => {
    expect(puedeArchivarseSinVeredicto('fraud')).toBe(false)
  })

  it('los agentes de rutina sí, para que el feed no se llene de avisos viejos', () => {
    for (const a of ['operations', 'inventory', 'staff', 'finance'] as AgentId[]) {
      expect(puedeArchivarseSinVeredicto(a)).toBe(true)
    }
  })

  it('un agente nuevo que nadie pensó tampoco archiva solo', () => {
    // Lo seguro por omisión es que el hallazgo espere, no que se borre.
    expect(puedeArchivarseSinVeredicto('cuadre' as AgentId)).toBe(false)
  })

  it('usa la MISMA lista que el silenciamiento, no una copia que se desincroniza', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/puedeCallarse/)
  })
})

describe('la consulta que archiva deja fuera lo crítico', () => {
  it('un agente que archiva sus avisos sigue sin poder archivar sus críticos', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/severity=neq\.critical/)
  })

  it('el archivado está detrás del permiso, no suelto', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    // El patch de archivado vive dentro del if, no antes.
    expect(motor).toMatch(/if \(puedeArchivarseSinVeredicto\(agentId\)\) \{[\s\S]*?status: 'resolved'[\s\S]*?\}/)
  })
})

// Acotar al cuerpo de submitOutcome. Buscar `if (!res.ok)` en todo el archivo no sirve:
// ya existía en otra función y la prueba pasaba contra el código roto.
function cuerpoDeSubmitOutcome(): string {
  const pantalla = sinComentarios('app/agentes/page.tsx')
  const desde = pantalla.indexOf('async function submitOutcome')
  expect(desde).toBeGreaterThan(-1)
  const hasta = pantalla.indexOf('\n  }', desde)
  return pantalla.slice(desde, hasta)
}

describe('lo que no se archiva tampoco se duplica', () => {
  // La consecuencia que no vi al quitar el archivado, y que encontró la auditoría
  // adversarial del 2026-09-08: un crítico que se queda `new` para siempre deja de
  // aparecer en el dedupe en cuanto vence su expires_at —4 horas para un desabasto—, y
  // desde ahí cada corrida del cron inserta una copia. 48 duplicados al día del mismo
  // aviso, en rojo, sin que nada los limpie. Es peor que el problema original.
  it('el dedupe pregunta por veredicto pendiente, no sólo por vigencia', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/outcome\.is\.null/)
  })

  it('usa la MISMA lista que el archivado, para que no se puedan desincronizar', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    // Si un día alguien cambia quién archiva y no cambia quién deduplica, vuelve el bug.
    const i = motor.indexOf('esperandoVeredicto')
    expect(i).toBeGreaterThan(-1)
    expect(motor.slice(i, i + 200)).toMatch(/puedeArchivarseSinVeredicto\(agentId\)/)
  })

  it('para fraude retiene todo; para los demás sólo sus críticos', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/and\(severity\.eq\.critical,outcome\.is\.null\)/)
  })

  it('el filtro entra en la consulta, no se queda en una variable suelta', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/dedupeWindow\}\$\{esperandoVeredicto\}/)
  })
})

describe('el veredicto no se pierde en silencio', () => {
  it('submitOutcome revisa la respuesta antes de quitar la tarjeta', () => {
    expect(cuerpoDeSubmitOutcome()).toMatch(/if \(!res\.ok\)/)
  })

  it('un guardado fallido se dice, no se disfraza de éxito', () => {
    expect(cuerpoDeSubmitOutcome()).toMatch(/setNoSeGuardo\(true\)/)
    expect(sinComentarios('app/agentes/page.tsx')).toMatch(/role="alert"/)
  })

  it('onOutcome ya no corre pase lo que pase', () => {
    const cuerpo = cuerpoDeSubmitOutcome()
    // El patrón viejo: dispara el fetch sin mirarlo y acto seguido quita la tarjeta.
    const iFetch = cuerpo.lastIndexOf('fetch(')
    const iGuarda = cuerpo.indexOf('if (!res.ok)')
    const iQuitar = cuerpo.indexOf('onOutcome(')
    expect(iGuarda).toBeGreaterThan(iFetch)   // primero mirar
    expect(iQuitar).toBeGreaterThan(iGuarda)  // luego quitar
  })

  it('un fetch que revienta tampoco se lee como veredicto guardado', () => {
    expect(cuerpoDeSubmitOutcome()).toMatch(/catch \{[\s\S]*?setNoSeGuardo\(true\)/)
  })
})
