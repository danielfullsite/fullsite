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
  channel: string
  kds_only?: boolean
  pos_server_ip?: string | null
}

export interface GenerateInput {
  clientId: string
  role: TerminalRole
  name?: string
  /** IP LAN de la caja/Pedro. Requerida para pos/kds en máquinas distintas a la caja. */
  bridgeHost?: string
}

/** Genera un TerminalConfig válido (mismo shape que el wizard del Electron). */
export function generateTerminalConfig(input: GenerateInput): TerminalConfig {
  const { clientId, role } = input
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
    channel: 'stable',
  }
  if (role === 'kds') {
    config.kds_only = true
    config.pos_server_ip = bridge || null
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
