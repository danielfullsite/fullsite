export const ORDER_INVENTORY_EVENT = 'pos:order-inventory-pending'
interface PendingOrder { order_id: string; mesa?: number; revision: string }
const key = (clientId: string) => `pos_order_inventory_pending:${clientId}`
export function readPendingOrderInventory(clientId: string): PendingOrder[] {
  try { const rows = JSON.parse(localStorage.getItem(key(clientId)) || '[]'); return Array.isArray(rows) ? rows : [] }
  catch { return [] }
}
/** This journal stores only order identities. Retry reads the server's committed
 * recipe and consumption, never a cached ingredient quantity. */
export function setOrderInventoryPending(clientId: string, orderId: string, pending: boolean, mesa?: number) {
  const rows = readPendingOrderInventory(clientId).filter(row => row.order_id !== orderId)
  if (pending) rows.push({ order_id: orderId, mesa, revision: crypto.randomUUID() })
  localStorage.setItem(key(clientId), JSON.stringify(rows))
  window.dispatchEvent(new Event(ORDER_INVENTORY_EVENT))
}
export function clearOrderInventoryIfUnchanged(clientId: string, orderId: string, revision: string) {
  if (readPendingOrderInventory(clientId).some(row => row.order_id === orderId && row.revision !== revision)) return
  setOrderInventoryPending(clientId, orderId, false)
}
