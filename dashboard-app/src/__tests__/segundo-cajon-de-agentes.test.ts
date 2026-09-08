import { describe, it, expect } from 'vitest'
import { desdeResultados, desdeEventos, ordenar, type ResultadoAgente, type EventoAgente } from '@/lib/atencion'

// Diecinueve agentes escriben en `agent_results` y la pantalla de inicio sólo
// leía `agent_events`, donde escriben cinco. Medido en la base de AMALAY el
// 2026-09-08: 1,107 hallazgos guardados contra 86 visibles.
//
// Pero volcarlos todos habría sido peor que no traerlos. En ese cajón conviven
// «ALERTAS: 225 sin stock» con «Sin problemas de calidad» y con avisos de
// nuestra propia infraestructura («4 agentes con último run fallido»). Estas
// pruebas son sobre el filtro, que es lo que decide si la lista sirve o estorba.

const AHORA = new Date('2026-09-08T18:00:00Z')
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86400000).toISOString()

function resultado(p: Partial<ResultadoAgente>): ResultadoAgente {
  return { id: crypto.randomUUID(), agent_id: 'stock-alert', fecha: '2026-09-08',
    summary: 'Un hallazgo', priority: 'warning', updated_at: hace(0), ...p }
}

describe('qué pasa el filtro y qué no', () => {
  it('pasa lo que el agente marcó como crítico o de atención', () => {
    const r = desdeResultados([
      resultado({ agent_id: 'stock-alert', priority: 'critical', summary: '225 insumos sin existencia' }),
      resultado({ agent_id: 'table-time', priority: 'warning', summary: 'Tickets por hora: 1.3 contra 5.4 del histórico' }),
    ], AHORA)
    expect(r).toHaveLength(2)
    expect(r.map(x => x.severidad)).toEqual(expect.arrayContaining(['critical', 'warning']))
  })

  it('NO pasa lo informativo: es el agente diciendo «revisé y no hay nada»', () => {
    // Literal de la base: el agente de cocina escribe esto todos los días.
    const r = desdeResultados([
      resultado({ agent_id: 'kitchen', priority: 'info', summary: 'Sin problemas de calidad' }),
      resultado({ agent_id: 'climate', priority: 'info', summary: 'Cloudy , 3 eventos hoy' }),
    ], AHORA)
    expect(r).toEqual([])
  })

  it('NO pasa el clima: es contexto, no algo que atender', () => {
    // Su resumen real dice «Light drizzle, 4 eventos hoy», marcado warning. El
    // detalle que guarda adentro sí sirve, pero el resumen no dice qué hacer, y
    // la lista pierde credibilidad por el renglón más flojo.
    const r = desdeResultados([
      resultado({ agent_id: 'climate', priority: 'warning', summary: 'Light drizzle, 4 eventos hoy' }),
    ], AHORA)
    expect(r).toEqual([])
  })

  it('NO pasan los agentes que hablan del sistema, no del restaurante', () => {
    // Su trabajo importa, pero a quien administra un restaurante no le toca
    // resolver que un cron falle. Meterlos convierte la lista en bitácora de
    // servidores.
    const r = desdeResultados([
      resultado({ agent_id: 'hermes', priority: 'warning', summary: '20 issues: 0 critical, 10 high' }),
      resultado({ agent_id: 'config-validator', priority: 'warning', summary: '4 agentes con último run fallido' }),
    ], AHORA)
    expect(r).toEqual([])
  })

  it('NO pasa lo viejo: un hallazgo de hace semanas es historia, no un pendiente', () => {
    const r = desdeResultados([
      resultado({ agent_id: 'stock-alert', updated_at: hace(1) }),
      resultado({ agent_id: 'waste', updated_at: hace(20) }),
    ], AHORA)
    expect(r).toHaveLength(1)
    expect(r[0].tipo).toBe('stock-alert')
  })

  it('un agente que escribe a diario aporta UN renglón, no treinta', () => {
    // stock-alert escribe cada día. Sin esto, la lista sería su historial.
    const r = desdeResultados(
      [0, 1, 2].map(d => resultado({ agent_id: 'stock-alert', summary: `día ${d}`, updated_at: hace(d) })),
      AHORA,
    )
    expect(r).toHaveLength(1)
    expect(r[0].titulo).toBe('día 0')   // el más reciente
  })

  it('sin resumen no hay renglón: no se inventa un título', () => {
    const r = desdeResultados([
      resultado({ summary: null }), resultado({ summary: '   ' }),
    ], AHORA)
    expect(r).toEqual([])
  })
})

describe('lo que el renglón promete', () => {
  it('lleva al lugar donde se resuelve, con la acción escrita', () => {
    const [r] = desdeResultados([resultado({ agent_id: 'auto86', priority: 'critical', summary: '3 platillos sin ingrediente' })], AHORA)
    expect(r.href).toBe('/auto86')
    expect(r.accion).toBe('Ver platillos')
  })

  it('un agente sin destino conocido sale sin botón, no con uno equivocado', () => {
    const [r] = desdeResultados([resultado({ agent_id: 'agente-que-no-conozco' })], AHORA)
    expect(r.titulo).toBeTruthy()
    expect(r.href).toBeUndefined()
    expect(r.accion).toBeUndefined()
  })

  it('no inventa pesos ni confianza: agent_results no los guarda', () => {
    // Es la regla del archivo: si el dato no está, no se rellena.
    const [r] = desdeResultados([resultado({})], AHORA)
    expect(r.valor).toBeNull()
    expect(r.confianza).toBeNull()
  })
})

describe('los dos cajones se ordenan como una sola lista', () => {
  it('un crítico del segundo cajón queda arriba de un informativo del primero', () => {
    // Éste es el punto de sacar el orden afuera: si cada origen se ordenara por
    // su lado, el orden de llegada mandaría sobre la gravedad.
    const evento: EventoAgente = {
      id: 'ev1', severity: 'info', title: 'Un dato informativo', explanation: '', suggested_action: '',
      estimated_value: null, confidence: 0.9, status: null, created_at: hace(0), expires_at: null, type: 'dow_insight',
    }
    const lista = ordenar([
      ...desdeEventos([evento], AHORA),
      ...desdeResultados([resultado({ agent_id: 'stock-alert', priority: 'critical', summary: 'Sin existencia' })], AHORA),
    ])
    expect(lista[0].severidad).toBe('critical')
    expect(lista[0].titulo).toBe('Sin existencia')
  })

  it('dentro de la misma gravedad, primero el que trae dinero estimado', () => {
    const conDinero: EventoAgente = {
      id: 'ev2', severity: 'critical', title: 'Con dinero', explanation: '', suggested_action: '',
      estimated_value: 12400, confidence: 0.9, status: null, created_at: hace(0), expires_at: null, type: 'out_of_stock',
    }
    const lista = ordenar([
      ...desdeResultados([resultado({ agent_id: 'waste', priority: 'critical', summary: 'Sin dinero estimado' })], AHORA),
      ...desdeEventos([conDinero], AHORA),
    ])
    expect(lista[0].titulo).toBe('Con dinero')
  })

  it('los identificadores de los dos orígenes no chocan', () => {
    const [r] = desdeResultados([resultado({ id: 'abc' })], AHORA)
    expect(r.id).toBe('resultado:abc')
  })
})
