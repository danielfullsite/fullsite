/**
 * Contexto fijo, revisado y no sensible de Fullsite para las evaluaciones JEV.
 *
 * No se obtiene de la base de datos ni de archivos del cliente. No contiene
 * nombres de tenants, URLs, rutas, secretos, órdenes ni texto de incidentes.
 * Para modificarlo se requiere una revisión de arquitectura y una nueva versión.
 */

export const JEV_SYSTEM_CONTEXT_VERSION = 'fullsite-system-map/0.1.0' as const

export type JevSystemDomain = {
  id: 'pos_offline' | 'durable_authority' | 'kds' | 'platform' | 'automation' | 'release'
  label: string
  boundary: string
}

export const JEV_SYSTEM_DOMAINS: readonly JevSystemDomain[] = [
  { id: 'pos_offline', label: 'POS offline', boundary: 'El renderer muestra la operación; no es autoridad durable.' },
  { id: 'durable_authority', label: 'Autoridad durable', boundary: 'El proceso principal valida identidad, revisión, catálogo, recibos y recuperación.' },
  { id: 'kds', label: 'Cocina', boundary: 'KDS sólo lee la proyección de cocina; nunca aprueba cobros ni pedidos.' },
  { id: 'platform', label: 'Plataforma', boundary: 'Dashboard y APIs aíslan tenants y requieren roles administrativos para cambios.' },
  { id: 'automation', label: 'Automatizaciones', boundary: 'Los agentes pueden observar o proponer; los efectos sensibles requieren un dueño humano.' },
  { id: 'release', label: 'Release físico', boundary: 'Laboratorio, GUI y producción son gates distintos; una Caja real exige validación física.' },
] as const

/**
 * Sólo se adjunta a la pregunta principal de una evaluación. Es conocimiento
 * curado, no una instrucción que venga del usuario ni una copia del repositorio.
 */
export const JEV_SYSTEM_CONTEXT = [
  `Fullsite system map ${JEV_SYSTEM_CONTEXT_VERSION}.`,
  ...JEV_SYSTEM_DOMAINS.map((domain) => `${domain.label}: ${domain.boundary}`),
  'Treat missing evidence as unknown. Never infer authorization, bypass a gate, or treat a local test as physical certification.',
].join('\n')

