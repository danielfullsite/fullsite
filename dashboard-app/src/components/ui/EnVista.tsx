'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Monta a sus hijos la primera vez que entran en pantalla.
 *
 * Nace de una pregunta concreta de Daniel: "cuando una gráfica se abra se tiene
 * que ver animada".
 *
 * Recharts anima AL MONTAR. Como el dashboard monta todo de un jalón cuando
 * termina de cargar, las gráficas que están debajo del pliegue ya terminaron su
 * animación para cuando el usuario llega a ellas: se las pierde completas. Y al
 * volver a esa pantalla, tampoco anima, porque el componente ya estaba montado.
 *
 * Esto lo arregla retrasando el montaje hasta que el elemento se asoma. La
 * gráfica se dibuja justo cuando la estás viendo, que es cuando la animación
 * sirve para algo — la misma sensación de TailPanel, que fue la referencia.
 *
 * Tres cosas que NO hace, a propósito:
 *
 *   · No desmonta al salir de vista. Animar cada vez que subes y bajas marea, y
 *     además Recharts volvería a calcular todo en cada pasada.
 *   · No espera si el navegador no soporta IntersectionObserver, ni en el render
 *     de servidor: ahí monta de inmediato. Un adorno no puede ser la razón de que
 *     alguien no vea sus ventas.
 *   · No retiene el contenido con `prefers-reduced-motion`. Quien pidió menos
 *     movimiento recibe el mismo dato, montado de una vez.
 *
 * El `minAlto` reserva el espacio antes de montar. Sin él la página daría un
 * brinco al aparecer cada gráfica, que se ve peor que no animar nada.
 */

export interface EnVistaProps {
  children: ReactNode
  /** Alto reservado mientras no se monta. Debe parecerse al del contenido real. */
  minAlto?: number
  /** Cuánto tiene que asomarse para contar como visible. */
  margen?: string
  className?: string
}

export default function EnVista({
  children,
  minAlto = 260,
  margen = '120px',
  className,
}: EnVistaProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Sin IntersectionObserver (servidor, navegador viejo) o con movimiento
  // reducido, se monta de una vez: el contenido nunca depende del adorno.
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    if (typeof IntersectionObserver === 'undefined') return true
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    return false
  })

  useEffect(() => {
    if (visible) return
    const nodo = ref.current
    if (!nodo) return

    const obs = new IntersectionObserver(
      entradas => {
        if (entradas.some(e => e.isIntersecting)) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: margen },
    )
    obs.observe(nodo)
    return () => obs.disconnect()
  }, [visible, margen])

  return (
    <div ref={ref} className={className} style={visible ? undefined : { minHeight: minAlto }}>
      {visible ? children : null}
    </div>
  )
}
