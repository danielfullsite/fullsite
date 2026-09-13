'use client'

import { useEffect, useState } from 'react'
import { estadoHuellaEnCaja } from '@/lib/pedro-actor'

export function useEstadoHuellaCaja() {
  const [estado, setEstado] = useState<{ disponible: boolean; motivo?: string }>({
    disponible: false,
    motivo: 'Comprobando lector DigitalPersona…',
  })

  useEffect(() => {
    let alive = true
    void estadoHuellaEnCaja().then(result => { if (alive) setEstado(result) })
    return () => { alive = false }
  }, [])

  return estado
}
