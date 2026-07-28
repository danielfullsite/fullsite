/**
 * Registro formal de aliases aprobados para el pipeline de migración.
 *
 * Propósito: resolver ingredient_id que no pueden resolverse por transformación
 * determinista (NORMALIZED_EXACT, ACCENT_INSENSITIVE, etc.) y requieren una
 * decisión explícita de un humano.
 *
 * Reglas:
 * - Ningún alias puede agregarse sin aprobación explícita del founder o del
 *   responsable técnico designado (campo aprobado_por).
 * - Los candidatos de SINGLE_FUZZY_CANDIDATE solo pueden promoverse a alias
 *   después de verificación manual.
 * - Un alias no reemplaza la corrección de datos en origen — es un mecanismo
 *   de última instancia.
 * - El campo `confidence` es informativo, no ejecutable — el pipeline no aplica
 *   aliases con confidence < HIGH sin revisión adicional.
 * - Este archivo es la fuente de verdad. No crear aliases en ningún otro lugar.
 *
 * Uso en el pipeline:
 *   import { APPROVED_ALIASES } from './maps/approved-aliases'
 *   // El pipeline consulta este registro ANTES del fuzzy check y DESPUÉS
 *   // de las transformaciones deterministas (NORMALIZED_EXACT, etc.)
 */

export type AliasConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ApprovedAlias {
  /** ingredient_id exacto tal como aparece en la fuente (orphan_ingredient_id del reporte) */
  original: string
  /** codigo del catálogo al que debe mapearse */
  destino: string
  /** nombre legible del destino, para trazabilidad humana */
  destino_nombre: string
  /** explicación del porqué de este alias */
  motivo: string
  /** nivel de confianza en la correspondencia */
  confidence: AliasConfidence
  /** email o identificador del aprobador */
  aprobado_por: string
  /** fecha de aprobación YYYY-MM-DD */
  fecha: string
  /** referencia al reporte que identificó el orphan (e.g., "MT-03") */
  origen_reporte: string
}

/**
 * Aliases aprobados activos.
 *
 * Estado actual: 0 aliases aprobados.
 *
 * Pendientes de aprobación (identificados en MT-03, commit ad13889):
 *
 * - original: "kambucha_original_377_ml"
 *   destino: "BEB85066" (KOMBUCHA ORIGINAL 377 ML.)
 *   motivo: typo KAMBUCHA vs KOMBUCHA, Levenshtein dist=1
 *   confidence: HIGH
 *   origen: MT-03, categoría SINGLE_FUZZY_CANDIDATE
 *   [PENDIENTE APROBACIÓN]
 *
 * - original: "kambucha_sandia_fresca_377_ml"
 *   destino: "BEB85080" (KOMBUCHA SANDIA FRESA 377 ML.)
 *   motivo: typo KAMBUCHA vs KOMBUCHA + FRESCA vs FRESA, Levenshtein dist=2
 *   confidence: MEDIUM (distancia mayor, revisar que sea el mismo producto)
 *   origen: MT-03, categoría SINGLE_FUZZY_CANDIDATE
 *   [PENDIENTE APROBACIÓN]
 */
export const APPROVED_ALIASES: ApprovedAlias[] = [
  // Sin aliases aprobados aún.
  // Para agregar un alias, copiar la estructura de ApprovedAlias y obtener
  // aprobación explícita antes de hacer commit.
]

/**
 * Índice de lookup para uso en el pipeline.
 * Construido en tiempo de módulo — O(1) por lookup.
 */
export const ALIAS_INDEX: ReadonlyMap<string, ApprovedAlias> = new Map(
  APPROVED_ALIASES.map(a => [a.original, a])
)
