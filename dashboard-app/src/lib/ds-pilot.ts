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
        if (vivo) setResuelto({ cid: clientId, activo: isEnabledForTenant(cfg.flags?.[DS_PILOT_FLAG], clientId) })
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
