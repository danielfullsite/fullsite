/** Persist an intent ID before dispatch; retain it on a lost response. Repeating
 * the same transfer recovers its database receipt instead of moving twice. */
export function prepararTransferenciaItem(clientId: string, orderId: string, itemId: string, mesa: number) {
  const key = `pos_transfer:${JSON.stringify([clientId, orderId, itemId, mesa])}`
  const previous = localStorage.getItem(key)
  const operationId = previous || crypto.randomUUID()
  if (!previous) localStorage.setItem(key, operationId)
  return { operationId, confirmada: () => localStorage.removeItem(key) }
}
