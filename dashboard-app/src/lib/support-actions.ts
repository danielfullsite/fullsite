// Acciones de soporte remoto — allowlist estricta, sin shell arbitrario.
//
// POR QUÉ
// El soporte necesita diagnosticar y accionar sobre la caja de un cliente, pero NUNCA con un
// shell remoto arbitrario ni credenciales visibles. Este contrato fija QUÉ acciones existen,
// cuáles son de sólo lectura, cuáles exigen consentimiento del cliente, y valida ese
// consentimiento (temporal, con expiración). Todo lo demás se rechaza.

export interface SupportAction {
  id: string
  label: string
  description: string
  /** Sólo lee estado; no cambia nada en la caja. */
  readOnly: boolean
  /** Exige consentimiento vigente del cliente antes de ejecutarse. */
  requiresConsent: boolean
}

// La lista ES el límite. Nada fuera de aquí se ejecuta. Sin 'exec', 'shell', 'sql' ni nada
// que abra una puerta arbitraria.
export const SUPPORT_ACTIONS: SupportAction[] = [
  {
    id: 'diagnose',
    label: 'Diagnóstico',
    description: 'Lee salud, versión, cola de sync e impresoras desde el heartbeat. Sólo lectura.',
    readOnly: true,
    requiresConsent: false,
  },
  {
    id: 'request_sync',
    label: 'Pedir sincronización',
    description: 'Solicita a la caja vaciar su outbox. Se encola y audita; no ejecuta nada destructivo.',
    readOnly: false,
    requiresConsent: true,
  },
  {
    id: 'restart_print_queue',
    label: 'Reiniciar cola de impresión',
    description: 'Reintenta los jobs de impresión pendientes. No borra jobs.',
    readOnly: false,
    requiresConsent: true,
  },
]

export function findSupportAction(id: unknown): SupportAction | null {
  if (typeof id !== 'string') return null
  return SUPPORT_ACTIONS.find((a) => a.id === id) ?? null
}

export interface SupportConsent {
  grantedBy?: string
  /** ISO. El consentimiento es TEMPORAL: fuera de esta ventana, no vale. */
  expiresAt?: string
}

/** true si hay consentimiento vigente (existe y no venció). Fail-closed ante datos raros. */
export function isConsentValid(consent: unknown, nowMs: number): boolean {
  if (!consent || typeof consent !== 'object') return false
  const exp = (consent as SupportConsent).expiresAt
  if (typeof exp !== 'string') return false
  const t = Date.parse(exp)
  return Number.isFinite(t) && t > nowMs
}
