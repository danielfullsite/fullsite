// Service model del POS — cómo nacen las órdenes en este tenant (Fase 2 de
// docs/strategy/BIBLE-SQUARE.md).
//
// Contract: este módulo es el ÚNICO puente clients.type → ServiceModel para el
// POS. `getServiceModel()` resuelve online (fetchClientConfig, caché 5 min) y
// persiste el resultado en localStorage; `peekServiceModel()` lee ese caché de
// forma síncrona y sin red, para que las decisiones de navegación funcionen
// offline (mismo espíritu que pos-navigation.ts).
//
// Fail-safe: ante cualquier duda (sin config, type que no es vertical, storage
// bloqueado, red caída) la respuesta es 'tables' — el POS se comporta EXACTAMENTE
// como hoy. Un tenant solo entra a modo mostrador con un clients.type válido.

import { fetchClientConfig } from './client-config'
import { getActiveClientSlug } from './data'
import { isVerticalId, resolveVerticalPreset, type ServiceModel } from './vertical-presets'

export const POS_SERVICE_MODEL_KEY = 'pos_service_model'

const MODELS: ServiceModel[] = ['tables', 'counter', 'tabs', 'channels']

function isServiceModel(v: unknown): v is ServiceModel {
  return typeof v === 'string' && (MODELS as string[]).includes(v)
}

/** Lectura síncrona y sin red del último service model conocido. */
export function peekServiceModel(): ServiceModel {
  if (typeof window === 'undefined') return 'tables'
  try {
    const cached = localStorage.getItem(POS_SERVICE_MODEL_KEY)
    if (isServiceModel(cached)) return cached
  } catch { /* storage bloqueado */ }
  return 'tables'
}

/** Resuelve clients.type → ServiceModel y refresca el caché local. */
export async function getServiceModel(): Promise<ServiceModel> {
  try {
    const cfg = await fetchClientConfig(getActiveClientSlug())
    const model: ServiceModel = isVerticalId(cfg?.type)
      ? resolveVerticalPreset(cfg.type).serviceModel
      : 'tables'
    try { localStorage.setItem(POS_SERVICE_MODEL_KEY, model) } catch { /* SSR */ }
    return model
  } catch {
    // Sin red: el último valor conocido; sin caché: el comportamiento de siempre.
    return peekServiceModel()
  }
}

/** ¿Este tenant opera sin mapa de mesas? (mostrador o solo-canales) */
export function isCounterModel(model: ServiceModel): boolean {
  return model === 'counter' || model === 'channels'
}

/**
 * Home operativo de un tenant sin mapa de mesas:
 * - counter (fast food, cafetería) → la siguiente orden de mostrador.
 * - channels (dark kitchen) → el tablero de despacho: sus órdenes nacen en
 *   Rappi/Uber y caen a delivery_orders, no se capturan en el POS.
 */
export function counterHomePath(model: ServiceModel): string {
  return model === 'channels' ? '/pos/delivery' : '/pos?mostrador=1'
}

/**
 * Nombre de cuenta para una orden nueva de mostrador. Único por orden: la
 * deduplicación de órdenes busca por customer_name, así que dos órdenes
 * llamadas igual se fusionarían. Legible en ticket y KDS ("Mostrador 1435-k2").
 */
export function nextMostradorCuenta(now: Date = new Date()): string {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  // 5 chars alfanuméricos (~60M combinaciones) y con padding: slice(2,5) de 3
  // chars daba ~2.7% de colisión al generar 50 (cumpleaños) — test flaky en CI.
  const salt = Math.random().toString(36).slice(2, 7).padEnd(5, '0')
  return `Mostrador ${hhmm}-${salt}`
}
