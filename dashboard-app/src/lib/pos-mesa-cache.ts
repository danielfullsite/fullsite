/**
 * El cache de la mesa (`pos_order_${mesa}` en localStorage) es lo único que
 * sabe qué orden vive en una mesa cuando no hay red: `loadMesaOrder` lanza y
 * el catch lee de aquí; el "instant cache" del montaje también.
 *
 * P0 del barrido 2026-09-10 (offline-queue LENTE-2): al ENVIAR sin red la
 * rama OFFLINE_QUEUED nunca escribía `id` ni `revision` aquí — el efecto de
 * persistencia sólo guarda `{ts, items}` y conserva lo que ya hubiera. En una
 * mesa nueva no había nada: al reabrirla sin red, `setOrderId(generateId())`
 * inventaba OTRA orden (B), la segunda ronda y el cobro salían con B, y al
 * volver el WAN la cola creaba A (abierta para siempre en la nube, mesa
 * ocupada en el plano, comanda pendiente en el KDS) y B (cerrada). Si la
 * orden ya existía online, la revisión guardada se quedaba vieja y el cobro
 * encolado llegaba con `expected_revision` atrasado: STALE terminal, dinero
 * en cajón y orden abierta en la nube.
 *
 * Aquí se escribe lo que la cola sabe, en el mismo momento en que se encola.
 */

export interface OrdenEncolada {
  id: string
  items: unknown[]
  mesero: string
  personas: number
  discount: number
  notas: string
  /** Revisión que tendrá la orden cuando la cola suba este envío. */
  revision: number
}

export function recordarOrdenEncolada(mesa: number, orden: OrdenEncolada): void {
  if (!(mesa > 0)) return
  try {
    const existing = localStorage.getItem(`pos_order_${mesa}`)
    const prev = existing ? JSON.parse(existing) : {}
    localStorage.setItem(`pos_order_${mesa}`, JSON.stringify({
      ...prev,
      id: orden.id,
      items: orden.items,
      mesero: orden.mesero,
      personas: orden.personas,
      discount: orden.discount,
      notas: orden.notas,
      revision: orden.revision,
      updatedAt: new Date().toISOString(),
      ts: Date.now(),
    }))
  } catch { /* storage bloqueado: la cola sigue siendo la verdad */ }
}
