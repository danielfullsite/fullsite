// Routing de estaciones consciente de la sucursal.
//
// Extiende —no reemplaza— getStationForItem(). El default de sistema (categoría/keywords) sigue
// siendo la base; esta capa aplica, POR SUCURSAL: (1) overrides de categoría→estación, y (2) el
// conjunto de estaciones que existen en esa sucursal, plegando de forma determinista una estación
// ausente a una presente (igual que hoy pos.kds_stations pliega barra/caja→cocina).
//
// LEGACY COMPAT: sin config de sucursal (feature flag apagada, o sucursal sin filas en
// pos_location_stations), resolveStationForLocation devuelve EXACTAMENTE getStationForItem(). El
// gate factory.stations_per_location decide si el llamador pasa config o no.
import { getStationForItem, type StationName } from './pos-constants'

/** Config de estaciones de UNA sucursal (proyección de pos_location_stations). */
export interface LocationStationConfig {
  /** Estaciones que existen en esta sucursal. Vacío = no hay override → todas permitidas. */
  enabledStations: StationName[]
  /** categoryId → estación forzada en esta sucursal. */
  overrides: Record<string, StationName>
}

// Orden de plegado determinista cuando la estación resuelta no existe en la sucursal.
// Espeja la regla actual (barra/caja se pliegan a cocina si no tienen pantalla propia).
const FOLD: Record<StationName, StationName[]> = {
  barra: ['barra', 'cocina', 'caja'],
  caja: ['caja', 'cocina', 'barra'],
  cocina: ['cocina', 'barra', 'caja'],
}

/**
 * Estación de un item EN UNA SUCURSAL. Determinista: misma entrada → misma salida.
 *
 * @param config  null/undefined → comportamiento legacy exacto (getStationForItem).
 */
export function resolveStationForLocation(
  input: { categoryId: string; itemName: string },
  config?: LocationStationConfig | null,
): StationName {
  // 1. Base: override de sucursal por categoría, si existe; si no, el default de sistema.
  const base: StationName =
    (config && config.overrides[input.categoryId]) ||
    getStationForItem(input.categoryId, input.itemName)

  // 2. Sin restricción de estaciones (legacy o sucursal que las tiene todas) → base tal cual.
  if (!config || config.enabledStations.length === 0) return base

  // 3. Plegar a una estación que SÍ exista en esta sucursal, en orden determinista.
  const enabled = new Set(config.enabledStations)
  if (enabled.has(base)) return base
  for (const candidato of FOLD[base]) {
    if (enabled.has(candidato)) return candidato
  }
  // 4. Config incoherente (ninguna estación habilitada válida): cae a la base, nunca lanza.
  return base
}

/**
 * Construye LocationStationConfig desde las filas de pos_location_stations de una sucursal.
 * Filas vacías → null (el resolver hará legacy). Mantiene el contrato en un solo lugar.
 */
export function buildLocationStationConfig(
  rows: { station: string; category_overrides?: Record<string, string> | null }[],
): LocationStationConfig | null {
  if (!rows || rows.length === 0) return null
  const enabledStations = rows
    .map(r => r.station)
    .filter((s): s is StationName => s === 'cocina' || s === 'barra' || s === 'caja')
  const overrides: Record<string, StationName> = {}
  for (const r of rows) {
    for (const [cat, st] of Object.entries(r.category_overrides ?? {})) {
      if (st === 'cocina' || st === 'barra' || st === 'caja') overrides[cat] = st
    }
  }
  return { enabledStations, overrides }
}
