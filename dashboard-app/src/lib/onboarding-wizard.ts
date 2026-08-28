// Wizard de alta clonable: reanudable e idempotente, sin exportar secretos.
//
// POR QUÉ
// provisionTenant() ya es idempotente, pero el wizard (app/onboarding) es client-only y NO
// reanuda: si el navegador se cierra a medias, se empieza de cero. Este módulo es el contrato
// de progreso: qué pasos hay, cuál sigue, cómo se aplica un paso de forma idempotente, y —
// crítico— cómo se sanea el estado antes de persistirlo para que NUNCA viaje un secreto.
//
// El progreso se guarda en clients.pos_settings['onboarding.progress'] (reusa el sistema de
// settings; sin tabla nueva). PIN/contraseña/token jamás entran ahí: se aplican en su paso y se
// descartan del estado persistido.

export const WIZARD_STEPS = [
  'cliente', 'marcas', 'sucursales', 'menu', 'usuarios',
  'dispositivos', 'impresoras', 'prueba', 'activacion',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export interface WizardProgress {
  /** Pasos completados, en orden de completado. */
  completed: WizardStep[]
  /** Datos NO sensibles por paso (ya saneados). */
  data: Record<string, unknown>
  updatedAt?: string
}

// Llaves que jamás se persisten. Un secreto en el estado del wizard es un secreto exportado.
const SECRETO = /(pin|password|passwd|pwd|secret|token|service.?role|api.?key|bearer|authorization|credential|clave)/i

const esStep = (s: unknown): s is WizardStep =>
  typeof s === 'string' && (WIZARD_STEPS as readonly string[]).includes(s)

/** Progreso seguro desde cualquier entrada (null, corrupto, parcial). Nunca lanza. */
export function normalizeProgress(raw: unknown): WizardProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const completedRaw = Array.isArray(r.completed) ? r.completed : []
  // Sólo pasos válidos, sin duplicados, en el orden canónico.
  const set = new Set(completedRaw.filter(esStep))
  const completed = WIZARD_STEPS.filter((s) => set.has(s))
  const data = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {}
  return { completed, data: sanitizeForPersistence(data) as Record<string, unknown>, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined }
}

/** Elimina RECURSIVAMENTE cualquier llave que parezca un secreto. Devuelve una copia. */
export function sanitizeForPersistence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForPersistence)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRETO.test(k)) continue // el secreto se descarta, no se enmascara: no se persiste
      out[k] = sanitizeForPersistence(v)
    }
    return out
  }
  return value
}

/** true si el estado NO contiene ninguna llave secreta (para validar en la frontera del API). */
export function isSecretFree(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isSecretFree)
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).every(
      ([k, v]) => !SECRETO.test(k) && isSecretFree(v),
    )
  }
  return true
}

/** El primer paso incompleto, o null si el wizard terminó. */
export function nextStep(progress: WizardProgress): WizardStep | null {
  const done = new Set(progress.completed)
  return WIZARD_STEPS.find((s) => !done.has(s)) ?? null
}

export function isComplete(progress: WizardProgress): boolean {
  return nextStep(progress) === null
}

/**
 * Aplica un paso de forma IDEMPOTENTE: lo marca completo (sin duplicar) y funde su payload ya
 * saneado. Reaplicar el mismo paso no cambia el orden ni duplica. El payload se sanea aquí
 * también, de modo que un secreto nunca llega al estado ni aunque el llamador se descuide.
 */
export function applyStep(progress: WizardProgress, step: WizardStep, payload?: unknown): WizardProgress {
  if (!esStep(step)) return progress
  const base = normalizeProgress(progress)
  const completed = base.completed.includes(step) ? base.completed : [...base.completed, step]
  const orderedCompleted = WIZARD_STEPS.filter((s) => completed.includes(s))
  const data = { ...base.data }
  if (payload !== undefined) data[step] = sanitizeForPersistence(payload)
  return { completed: orderedCompleted, data, updatedAt: base.updatedAt }
}
