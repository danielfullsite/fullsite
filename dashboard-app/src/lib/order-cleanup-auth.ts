const CLEANUP_OWNER_TENANT = 'amalay'
const CLEANUP_OWNER_NAMES = new Set(['daniel', 'daniel ramonfaur'])
const CLEANUP_ROLES = new Set(['gerente', 'admin', 'dueño'])

export interface OrderCleanupIdentity {
  clientId: string
  staffName: string
  role: string
  staffId?: string
}

/** Destructive test-order cleanup is reserved for Daniel at AMALAY. */
export function canCleanupAllOrders(identity: OrderCleanupIdentity): boolean {
  const name = identity.staffName.trim().toLocaleLowerCase('es-MX')
  if (identity.clientId !== CLEANUP_OWNER_TENANT) return false
  if (!CLEANUP_OWNER_NAMES.has(name)) return false
  if (!CLEANUP_ROLES.has(identity.role)) return false

  // Once a stable staff UUID is configured in production, it becomes an
  // additional mandatory factor without changing the deployed code.
  const configuredIds = (process.env.POS_ORDER_CLEANUP_STAFF_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean)
  return configuredIds.length === 0 || (!!identity.staffId && configuredIds.includes(identity.staffId))
}
