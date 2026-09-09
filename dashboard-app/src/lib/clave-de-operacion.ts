'use client'

// LA CLAVE TIENE QUE IDENTIFICAR LA OPERACIÓN, NO EL INSTANTE.
//
// ── LO QUE PASÓ EN PRODUCCIÓN ────────────────────────────────────────────────
//
// Las cinco pantallas de inventario armaban su clave de idempotencia con `nowKey()`,
// que lleva el MINUTO del reloj:
//
//     `${año}-${mes}-${día}_${hora}-${minuto}`
//
// Leído de `pos_inventory_movements` de AMALAY el 2026-09-09 — no es un guion, ocurrió:
//
//   invoice_entry_dashboard_2026-07-20_16-59_A1B2C3D4-E5F
//   invoice_entry_dashboard_2026-07-20_17-00_A1B2C3D4-E5F   ← 1 min 12 s después
//
// La misma factura, con SEIS insumos (15, 10, 6, 5, 1 y 20 unidades), entró dos veces:
// 57 unidades fantasma. Y una merma se duplicó igual, con 1 min 18 s de separación.
//
// El guion es el de siempre: el almacenista guarda, la red del restaurante tarda, la
// página parece no responder, vuelve a guardar. Si en medio cambió el minuto, la clave
// es OTRA, la comprobación de duplicados no encuentra la anterior, y la entrada se
// aplica completa por segunda vez — incluido el recálculo de costo promedio ponderado,
// que a partir de ahí no corresponde a ninguna compra real.
//
// ── EL RIESGO DEL ARREGLO, QUE ES EL OPUESTO ─────────────────────────────────
//
// Una clave demasiado estable es igual de mala por el otro lado: si dos capturas
// LEGÍTIMAS seguidas comparten clave, la segunda se descarta como duplicado y se pierde
// una entrada real. Por eso la clave se renueva en cuanto una operación se confirma:
// vive exactamente lo que dura un intento y sus reintentos, ni más ni menos.

import { useCallback, useRef, useState } from 'react'

/** Un identificador de operación. Aleatorio, no derivado del reloj. */
function nuevaClave(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Respaldo para navegadores viejos: el reloj entra sólo como desempate, acompañado de
  // aleatoriedad suficiente para que dos capturas del mismo minuto no colisionen.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export interface ClaveDeOperacion {
  /** Estable entre reintentos del MISMO guardado. Es lo que se manda como clave. */
  clave: string
  /** Se llama tras un guardado CONFIRMADO. Lo siguiente que se capture es otra operación. */
  confirmar: () => void
}

/**
 * Clave estable para un formulario que puede reintentarse.
 *
 * Se genera al montar y sólo cambia cuando quien llama confirma que la operación quedó
 * guardada. Un reintento tras un error de red lleva LA MISMA clave, que es lo que hace
 * que el servidor pueda reconocerlo como el mismo intento.
 */
export function useClaveDeOperacion(): ClaveDeOperacion {
  const [clave, setClave] = useState(nuevaClave)
  // `useRef` para que `confirmar` no cambie de identidad entre renders y pueda ir en las
  // dependencias de un `useCallback` sin rehacerlo en cada vuelta.
  const setter = useRef(setClave)
  setter.current = setClave
  const confirmar = useCallback(() => { setter.current(nuevaClave()) }, [])
  return { clave, confirmar }
}

/**
 * Versión sin React, para el código que arma la clave fuera de un componente.
 *
 * Devuelve la MISMA clave hasta que se confirma, igual que el hook. El ámbito es el
 * módulo, así que sirve para un flujo a la vez — que es como se capturan estas
 * pantallas: una operación en pantalla, no varias en paralelo.
 */
let claveSuelta = nuevaClave()
export function claveDeOperacionActual(): string { return claveSuelta }
export function confirmarOperacion(): void { claveSuelta = nuevaClave() }
