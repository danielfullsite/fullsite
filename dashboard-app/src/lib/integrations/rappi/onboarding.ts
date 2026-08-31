/**
 * Callback de self-onboarding de Rappi — evento STORE_PROVISIONING_STATUS.
 *
 * POR QUÉ EXISTE
 * Rodrigo Murguía (TAM de Integraciones en Rappi) condicionó el aprovisionamiento
 * de Fullsite_PROD a que existiera este callback en DEV: "primero necesito el
 * callback en dev para el desarrollo de su lado del self onboarding".
 *
 * Rappi lo llama cuando termina de aprovisionar (o desaprovisionar) tiendas para
 * una integración, con el resultado de cada una.
 *
 * LA DECISIÓN DE DISEÑO QUE IMPORTA — no se inventa el tenant.
 * El payload trae `storeId` (el id de la tienda EN RAPPI) pero NO dice a qué
 * restaurante de Fullsite corresponde. Ese puente vive en
 * `integration_store_mappings`, y lo pone un humano.
 *
 * Así que este handler:
 *   · Si YA existe el mapeo → lo actualiza.
 *   · Si NO existe → registra el evento y lo deja PENDIENTE DE MAPEO. No crea la
 *     fila con un client_id adivinado.
 *
 * Adivinar aquí significaría amarrar una tienda de Rappi al restaurante
 * equivocado, y a partir de ahí sus órdenes entrarían al POS de otro. Es
 * exactamente lo que CLAUDE.md §12 prohíbe: fallar cerrado cuando no hay mapping.
 */

import { auditLog } from '@/lib/integrations/audit-logger'

export type OperacionAprovisionamiento = 'PROVISION' | 'DEPROVISION'
export type EstadoTienda = 'ACTIVE' | 'INACTIVE' | 'FAILED'

export interface ResultadoTienda {
  storeId: string
  integrationId?: string
  brand?: string
  status: EstadoTienda
  errorMessage?: string
  httpCode?: number
}

export interface PayloadAprovisionamiento {
  batchId: string
  integrationId?: string
  operation: OperacionAprovisionamiento
  results: ResultadoTienda[]
  timestamp?: string
}

export interface ResumenProceso {
  batchId: string
  operation: OperacionAprovisionamiento
  total: number
  mapeadas: string[]      // tiendas que ya tenían mapeo y se actualizaron
  sinMapeo: string[]      // tiendas ACTIVE que nadie ha ligado a un client_id
  fallidas: string[]      // tiendas que Rappi reporta como FAILED
  duplicado: boolean      // este batchId ya se había procesado
}

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || ''

function encabezados(extra?: Record<string, string>) {
  const key = SB_KEY()
  if (!SB_URL() || !key) throw new Error('SUPABASE_SERVICE_KEY_REQUIRED')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function sb<T>(ruta: string, init?: RequestInit): Promise<{ ok: boolean; status: number; rows: T[] }> {
  const res = await fetch(`${SB_URL()}/rest/v1/${ruta}`, {
    ...init,
    headers: encabezados(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => [])
  return { ok: res.ok, status: res.status, rows: Array.isArray(data) ? (data as T[]) : [] }
}

/**
 * Valida la forma del payload. Rappi es un tercero: nada de confiar en que venga
 * completo. Devuelve el motivo exacto para que quede en el log si se rechaza.
 */
export function validarPayload(crudo: unknown): { ok: true; payload: PayloadAprovisionamiento } | { ok: false; motivo: string } {
  if (!crudo || typeof crudo !== 'object') return { ok: false, motivo: 'payload no es un objeto' }
  const p = crudo as Record<string, unknown>

  const batchId = typeof p.batchId === 'string' ? p.batchId.trim() : ''
  if (!batchId) return { ok: false, motivo: 'falta batchId' }

  const operation = p.operation
  if (operation !== 'PROVISION' && operation !== 'DEPROVISION') {
    return { ok: false, motivo: `operation inválida: ${String(operation)}` }
  }

  if (!Array.isArray(p.results)) return { ok: false, motivo: 'results no es un arreglo' }

  const results: ResultadoTienda[] = []
  for (const r of p.results) {
    if (!r || typeof r !== 'object') return { ok: false, motivo: 'un elemento de results no es objeto' }
    const item = r as Record<string, unknown>
    const storeId = typeof item.storeId === 'string' ? item.storeId.trim() : ''
    if (!storeId) return { ok: false, motivo: 'un elemento de results no trae storeId' }
    const status = item.status
    if (status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'FAILED') {
      return { ok: false, motivo: `status inválido en ${storeId}: ${String(status)}` }
    }
    results.push({
      storeId,
      integrationId: typeof item.integrationId === 'string' ? item.integrationId : undefined,
      brand: typeof item.brand === 'string' ? item.brand : undefined,
      status,
      errorMessage: typeof item.errorMessage === 'string' ? item.errorMessage : undefined,
      httpCode: typeof item.httpCode === 'number' ? item.httpCode : undefined,
    })
  }

  return {
    ok: true,
    payload: {
      batchId,
      integrationId: typeof p.integrationId === 'string' ? p.integrationId : undefined,
      operation,
      results,
      timestamp: typeof p.timestamp === 'string' ? p.timestamp : undefined,
    },
  }
}

/**
 * Procesa el callback. Idempotente por `batchId`: Rappi puede reintentar y no
 * debe duplicar nada.
 */
export async function procesarAprovisionamiento(
  payload: PayloadAprovisionamiento,
  correlationId: string,
): Promise<ResumenProceso> {
  const inicio = Date.now()

  // El evento se registra SIEMPRE, aunque después no se pueda mapear ninguna
  // tienda: es la evidencia de que Rappi nos llamó y qué nos dijo.
  // `on_conflict` sobre (provider, provider_event_id) hace la idempotencia.
  const evento = await sb<{ id: string }>(
    'integration_webhook_events?on_conflict=provider,provider_event_id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        provider: 'rappi',
        provider_event_id: payload.batchId,
        event_type: 'STORE_PROVISIONING_STATUS',
        correlation_id: correlationId,
        payload,
        status: 'received',
      }),
    },
  )

  const mapeadas: string[] = []
  const sinMapeo: string[] = []
  const fallidas: string[] = []

  for (const r of payload.results) {
    if (r.status === 'FAILED') {
      fallidas.push(r.storeId)
      continue
    }

    const idCodificado = encodeURIComponent(r.storeId)
    const existente = await sb<{ id: string; client_id: string }>(
      `integration_store_mappings?provider=eq.rappi&provider_store_id=eq.${idCodificado}&select=id,client_id&limit=1`,
    )

    if (!existente.rows[0]) {
      // Sin mapeo previo: NO se inventa el client_id. Ver el encabezado.
      sinMapeo.push(r.storeId)
      continue
    }

    // PROVISION → la tienda queda operable. DEPROVISION o INACTIVE → se cierra.
    const abierta = payload.operation === 'PROVISION' && r.status === 'ACTIVE'
    await sb(`integration_store_mappings?id=eq.${encodeURIComponent(existente.rows[0].id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ store_open: abierta, updated_at: new Date().toISOString() }),
    })
    mapeadas.push(r.storeId)
  }

  await auditLog({
    provider: 'rappi',
    correlation_id: correlationId,
    action: `onboarding.${payload.operation.toLowerCase()}`,
    request: { batchId: payload.batchId, tiendas: payload.results.length },
    response: { mapeadas: mapeadas.length, sinMapeo: sinMapeo.length, fallidas: fallidas.length },
    status_code: 200,
    duration_ms: Date.now() - inicio,
  })

  return {
    batchId: payload.batchId,
    operation: payload.operation,
    total: payload.results.length,
    mapeadas,
    sinMapeo,
    fallidas,
    // Sin fila devuelta = merge-duplicates encontró el batchId ya registrado.
    duplicado: evento.ok && evento.rows.length === 0,
  }
}
