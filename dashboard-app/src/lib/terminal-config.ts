import { randomUUID } from 'crypto'

/**
 * Esqueleton clonable (Feature 1) — Generador de TerminalConfig por cliente.
 *
 * El Electron ("offline shell") es un instalador GENÉRICO: no se compila por cliente,
 * la identidad la da un config.json (TerminalConfig). Hoy se teclea a mano en el
 * wizard. Este generador produce ese config desde admin al crear/gestionar un cliente,
 * para: (a) descargarlo e importarlo en la terminal (el wizard ya soporta import), y
 * (b) armar un deep-link/QR (fullsite-pos://provision?data=…) para provisionar sin teclear.
 *
 * DEBE calcar electron-app/local-server/config-schema.js (validate()) — si cambia allá,
 * cambiar aquí. Campos requeridos: config_version, restaurant_id, terminal_id,
 * terminal_role, terminal_name, local_server_host, local_server_port, protocol_version,
 * provisioned_at.
 */

export type TerminalRole = 'server_pos' | 'pos' | 'kds' | 'admin'
export const TERMINAL_ROLES: TerminalRole[] = ['server_pos', 'pos', 'kds', 'admin']

export const ROLE_LABELS: Record<TerminalRole, string> = {
  server_pos: 'Caja (servidor Pedro)',
  pos: 'POS (mesero)',
  kds: 'KDS (cocina)',
  admin: 'Admin',
}

export interface TerminalConfig {
  config_version: number
  restaurant_id: string
  terminal_id: string
  terminal_role: TerminalRole
  terminal_name: string
  local_server_host: string
  local_server_port: number
  protocol_version: string
  provisioned_at: string
  client_id: string
  /**
   * Sucursal (client_locations.id) del mismo tenant. Se estampa como campo ADICIONAL: el
   * schema del Electron (config-schema.js validate()) sólo exige su lista `required[]` y
   * acepta campos extra, así que las instalaciones actuales lo aceptan sin instalador nuevo.
   * Volverlo obligatorio en el Electron es otro PR (offline), fuera de este bloque.
   */
  location_id: string
  channel: string
  kds_only?: boolean
  pos_server_ip?: string | null
  /**
   * Zona horaria IANA de la sucursal (p.ej. America/Tijuana). El Electron la inyecta
   * a localStorage `fullsite_timezone` al arrancar (main.js) para que el día/cortes/
   * reportes usen la zona de ESTA sucursal, no México centro. Si viene vacía, el shell
   * cae a la zona de la propia máquina (Intl) — la sucursal donde está instalada.
   * Campo ADICIONAL: el schema del Electron acepta extras, no requiere instalador nuevo.
   */
  timezone?: string
}

export interface GenerateInput {
  clientId: string
  /** Sucursal destino. Obligatoria: no se emite config sin sucursal. */
  locationId: string
  role: TerminalRole
  name?: string
  /** IP LAN de la caja/Pedro. Requerida para pos/kds en máquinas distintas a la caja. */
  bridgeHost?: string
  /** Zona IANA de la sucursal (client_locations.timezone). Vacía = el shell auto-detecta. */
  timezone?: string
}

/**
 * Genera un TerminalConfig válido (mismo shape que el wizard del Electron) atado a una
 * sucursal. Lanza si falta clientId o locationId — la validación de que la sucursal
 * pertenece al tenant se hace en la ruta (server-side, contra client_locations).
 */
export function generateTerminalConfig(input: GenerateInput): TerminalConfig {
  const { clientId, role } = input
  const locationId = input.locationId?.trim() || ''
  if (!clientId) throw new Error('generateTerminalConfig: clientId requerido')
  if (!locationId) throw new Error('generateTerminalConfig: locationId requerido')
  const bridge = input.bridgeHost?.trim() || ''
  // La caja (server_pos) corre Pedro local → 127.0.0.1. Las demás (pos/kds/admin) le
  // hablan a la caja por la LAN → IP de la caja.
  const host = role === 'server_pos' ? '127.0.0.1' : (bridge || '127.0.0.1')
  const now = new Date().toISOString()
  const config: TerminalConfig = {
    config_version: 1,
    restaurant_id: clientId,
    terminal_id: randomUUID(),
    terminal_role: role,
    terminal_name: input.name?.trim() || `${ROLE_LABELS[role]} · ${clientId}`,
    local_server_host: host,
    local_server_port: 7717,
    protocol_version: '1.0',
    provisioned_at: now,
    client_id: clientId,
    location_id: locationId,
    channel: 'stable',
  }
  // Zona de la sucursal: se estampa para que la terminal use el día/cortes de su huso.
  // Vacía → el shell (main.js) cae a la zona de la máquina donde está instalada.
  const tz = input.timezone?.trim()
  if (tz) config.timezone = tz
  // Terminales remotas (pos/kds) hablan con la caja por la LAN → pos_server_ip.
  // Es EL campo que hace funcionar el offline: el POS secundario REENVÍA prints/eventos
  // a la caja, y el KDS dedicado lee /state de la caja. Coincide con los configs de
  // campo probados (config-ENTRADA.json / config-KDS.json). Antes solo se seteaba para
  // kds → un POS secundario generado por el esqueleton NO reenviaba offline (gap P4).
  if (role === 'pos' || role === 'kds') {
    config.pos_server_ip = bridge || null
  }
  if (role === 'kds') {
    config.kds_only = true
  }
  return config
}

/** Deep-link para provisionar una terminal sin teclear (el Electron lo captura). */
export function buildProvisionDeepLink(config: TerminalConfig): string {
  const b64 = Buffer.from(JSON.stringify(config), 'utf8').toString('base64url')
  return `fullsite-pos://provision?data=${b64}`
}

/** Valida lo mínimo antes de emitir (defensa; el Electron re-valida con su schema). */
export function isRoleRemote(role: TerminalRole): boolean {
  return role === 'pos' || role === 'kds'
}
