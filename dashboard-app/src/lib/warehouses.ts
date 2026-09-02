import { getActiveClientSlug } from './data'

/**
 * Almacenes (departamentos de inventario) POR TENANT.
 *
 * Antes estaban HARDCODEADOS en cada página de inventario-real con la estructura de
 * AMALAY (Cocina, Barra, Panaderia, Market, Venta Terceros) → un cliente nuevo como
 * ChickIn (pollo frito) veía "Panaderia"/"Market"/"Venta Terceros", que no son suyos.
 * NO era fuga de datos (solo etiquetas del dropdown), pero sí un bug de clonabilidad.
 *
 * DEUDA: lo correcto es que cada tenant configure sus almacenes en la BD (tabla o
 * clients.features). Por ahora: base universal + extras específicos de amalay, en UN
 * solo lugar (no repetido en 5 páginas). Un tenant nuevo hereda solo la base.
 */
export interface Warehouse { key: string; label: string }

const BASE: Warehouse[] = [
  { key: 'cocina', label: 'Cocina' },
  { key: 'barra', label: 'Barra' },
]

// Extras por tenant (café + market + panadería de amalay). TODO: mover a config en BD.
const EXTRAS_POR_TENANT: Record<string, Warehouse[]> = {
  amalay: [
    { key: 'panaderia', label: 'Panaderia' },
    { key: 'market', label: 'Market' },
    { key: 'venta_terceros', label: 'Venta Terceros' },
  ],
}

/** Almacenes del tenant activo (o del clientId dado). */
export function getWarehouses(clientId: string = getActiveClientSlug()): Warehouse[] {
  return [...BASE, ...(EXTRAS_POR_TENANT[clientId] ?? [])]
}

/** Solo las etiquetas (para dropdowns que usan string[]). */
export function getWarehouseLabels(clientId: string = getActiveClientSlug()): string[] {
  return getWarehouses(clientId).map(w => w.label)
}
