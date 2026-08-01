// Integration Framework — canonical types shared across all providers.

export type IntegrationProvider = 'ubereats' | 'rappi' | 'didi'

export type WebhookEventStatus = 'received' | 'processing' | 'processed' | 'failed' | 'dlq'

export interface CanonicalOrderItem {
  name: string
  quantity: number
  unit_price: number
  total_price: number
  notes: string
  sku?: string
  modifiers: Array<{
    group_name: string
    name: string
    price: number
  }>
}

export interface CanonicalOrder {
  provider: IntegrationProvider
  provider_order_id: string
  provider_store_id: string
  client_id: string
  status: 'nueva' | 'preparando' | 'lista' | 'cancelada'
  customer_name: string
  customer_phone?: string
  delivery_address?: string
  items: CanonicalOrderItem[]
  subtotal: number
  delivery_fee: number
  tip: number
  total: number
  notes?: string
  estimated_pickup_at?: string
  /** Generated once per webhook event — never changes across retries. */
  correlation_id: string
  /** Exactly-once key for DB ON CONFLICT. Format: `{provider}-order-{provider_order_id}` */
  idempotency_key: string
  raw_payload: unknown
}

export interface IntegrationResult<T = void> {
  ok: boolean
  data?: T
  error?: string
  status_code?: number
  correlation_id: string
}
