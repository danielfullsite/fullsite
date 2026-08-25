'use client'

import { useEffect, useState } from 'react'
import { getPlatformConfig, isEnabledForTenant } from '@/lib/platform-config'

/**
 * Piloto visual del DS v3, por tenant.
 *
 * El rediseño es global: tokens y componentes compartidos aplican a los 8
 * clientes por igual. Eso está bien para lo que ya está probado, pero no permite
 * enseñar un cambio de aspecto a UN restaurante antes de soltarlo a todos.
 *
 * Esto lo resuelve con la infraestructura que ya existe —`feature_flags` con
 * `rollout.client_ids`, admin-gated y auditada— en vez de una lista de tenants
 * escrita en el código, que es justo lo que el protocolo del repo prohíbe.
 *
 * Cuando está activo, se marca `data-ds="v3"` en la raíz de la app y el CSS del
 * piloto (globals.css) engancha ahí. Nada fuera de ese selector cambia, así que
 * apagar el flag revierte el aspecto sin desplegar nada.
 *
 * Para soltarlo a todos: quitar `client_ids` del rollout (queda `enabled` global),
 * y cuando ya no haya vuelta atrás, borrar el selector y el flag.
 */
export const DS_PILOT_FLAG = 'ds_v3'

/**
 * La tipografía de display del piloto se carga SÓLO cuando el piloto está
 * activo, no con `next/font` en el layout.
 *
 * Razón: `next/font` es estático — se descargaría para los 8 tenants y la usaría
 * uno. Es exactamente el defecto que arreglamos hoy, cuando la app bajaba Inter
 * completo y renderizaba en Arial. No lo repetimos.
 *
 * Schibsted Grotesk sólo trae los pesos 400 y 500: el sistema de savio.mx vive
 * en peso 400, y traer 600/700 sería peso muerto para un título que nunca los usa.
 */
const HREF_DISPLAY =
  'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500&display=swap'

function cargarDisplay(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[data-ds-display]')) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = HREF_DISPLAY
  l.setAttribute('data-ds-display', '')
  document.head.appendChild(l)
}

export function useDsPilot(clientId: string | null | undefined): boolean {
  // El estado guarda PARA QUÉ tenant se resolvió. Así el valor es derivado y no
  // hay que sincronizarlo con un setState al cambiar de cliente: mientras la
  // respuesta del nuevo tenant no llegue, el piloto simplemente está apagado.
  const [resuelto, setResuelto] = useState<{ cid: string; activo: boolean } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let vivo = true
    getPlatformConfig()
      .then(cfg => {
        if (!vivo) return
        const activo = isEnabledForTenant(cfg.flags?.[DS_PILOT_FLAG], clientId)
        if (activo) cargarDisplay()
        setResuelto({ cid: clientId, activo })
      })
      // Si la config no carga, el piloto queda APAGADO: ante la duda, el aspecto
      // que ya está probado, no el experimental.
      .catch(() => {
        if (vivo) setResuelto({ cid: clientId, activo: false })
      })
    return () => {
      vivo = false
    }
  }, [clientId])

  return !!clientId && resuelto?.cid === clientId && resuelto.activo
}
