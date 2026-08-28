// Validación server-side del enrolamiento de terminales por sucursal.
//
// Dos garantías que NO pueden quedar sólo en la base:
//   1. La sucursal de una terminal pertenece al MISMO tenant (se consulta client_locations
//      con service_role antes de escribir). El FK compuesto de la migración es el respaldo;
//      esto da un 400 claro en vez de un 500 de Postgres.
//   2. metadata no lleva secretos. La whitelist de aquí calca EXACTAMENTE el CHECK
//      pos_terminals_metadata_ck de la migración; si una cambia, cambiar la otra.
import { randomUUID, randomBytes, createHash } from 'crypto'
import { platformServiceFetch } from './platform-auth'

// ── Identidad generada por el servidor ───────────────────────────────────────
// El dispositivo nunca elige su device_id. Lo genera el servidor al crear el enrolamiento.

/** device_id opaco generado por el servidor. Cumple DEVICE_RE (^[\w-]{1,64}$). */
export function generateDeviceId(): string {
  return `dev-${randomUUID()}`
}

/**
 * Código de enrolamiento de un solo uso. Alta entropía (24 bytes), legible/tecleable en
 * base64url. Se devuelve UNA vez y jamás se persiste en claro; en la base sólo vive su hash.
 */
export function generateEnrollmentCode(): string {
  return randomBytes(24).toString('base64url')
}

/** Hash con el que se guarda y se busca el código. Nunca el código en claro. */
export function hashEnrollmentCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Llaves permitidas en metadata. Espejo del CHECK en la migración. */
export const METADATA_ALLOWED_KEYS = [
  'model', 'os', 'app_build', 'screen', 'notes', 'ip_lan', 'hostname', 'printer_model',
] as const

const METADATA_MAX_BYTES = 4096

export class MetadataInvalida extends Error {}

/**
 * Valida metadata y devuelve un objeto seguro para escribir. Lanza `MetadataInvalida` si:
 * no es objeto plano, excede el tope, trae una llave fuera de la whitelist, un valor no
 * escalar, o algo que parezca un secreto. La ruta traduce el throw a un 400.
 */
export function validateMetadata(input: unknown): Record<string, string | number | boolean> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new MetadataInvalida('metadata debe ser un objeto')
  }
  const obj = input as Record<string, unknown>
  const SECRETO = /(pass|pwd|secret|token|service.?role|api.?key|bearer|authorization|credential)/i
  for (const [k, v] of Object.entries(obj)) {
    if (!METADATA_ALLOWED_KEYS.includes(k as (typeof METADATA_ALLOWED_KEYS)[number])) {
      throw new MetadataInvalida(`metadata: llave no permitida "${k}"`)
    }
    // Defensa extra además de la whitelist: aunque ninguna llave permitida lo parece hoy,
    // si alguien amplía la whitelist con una llave sensible, esto la sigue bloqueando.
    if (SECRETO.test(k)) throw new MetadataInvalida(`metadata: llave prohibida "${k}"`)
    if (v === null || typeof v === 'object') {
      throw new MetadataInvalida(`metadata: "${k}" debe ser un valor escalar`)
    }
  }
  if (Buffer.byteLength(JSON.stringify(obj), 'utf8') > METADATA_MAX_BYTES) {
    throw new MetadataInvalida('metadata excede 4KB')
  }
  return obj as Record<string, string | number | boolean>
}

const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const LOCATION_RE = /^[a-z0-9_-]{1,64}$/i

/**
 * true sólo si `locationId` es una sucursal ACTIVA de `clientId`. Filtra por client_id Y
 * por id en la misma consulta: aunque un id exista en otro tenant, la fila no vuelve.
 */
export async function locationBelongsToClient(clientId: string, locationId: string): Promise<boolean> {
  if (!CLIENT_RE.test(clientId) || !LOCATION_RE.test(locationId)) return false
  try {
    const res = await platformServiceFetch(
      `client_locations?client_id=eq.${encodeURIComponent(clientId)}` +
        `&id=eq.${encodeURIComponent(locationId)}&active=eq.true&select=id&limit=1`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return false
    const rows = await res.json().catch(() => [])
    return Array.isArray(rows) && rows.length === 1
  } catch {
    return false
  }
}
