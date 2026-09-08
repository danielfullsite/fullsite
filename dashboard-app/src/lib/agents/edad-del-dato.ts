/**
 * La edad del dato viaja con la afirmación.
 *
 * Un hallazgo dice algo en PRESENTE — «41 ingredientes sin stock, los platillos que los
 * requieren no se pueden preparar» — y quien lo lee asume que habla de hoy. Si la tabla de
 * atrás lleva 60 días sin moverse, la frase es falsa con el cálculo perfecto. Y suena
 * exactamente igual de creíble que la verdad, que es lo que la hace cara.
 *
 * NO ES HIPOTÉTICO. Medido en producción el 2026-09-08:
 *
 *   pos_inventory_products de AMALAY   ·  último updated_at: 2026-07-10, hace 60 días
 *   ingredientes con punto de reorden  ·  83
 *   de esos, con stock en cero         ·  41
 *   hallazgos de inventory en la base  ·  71 de 155, 56 de ellos «critical»
 *
 * O sea: el agente de mayor volumen del sistema lleva dos meses diciendo, en presente y
 * en rojo, qué no se puede cocinar hoy — leyendo una tabla que no se mueve desde julio.
 *
 * LA RESPUESTA NO ES CALLAR AL AGENTE.
 *
 * Eso ya se decidió con el fraude (ver `puedeCallarse` en learning.ts): lo que se esconde
 * no se puede juzgar, y un hallazgo suprimido se ve igual que un restaurante sano. La
 * respuesta es FECHAR la afirmación. Un hallazgo viejo sigue sirviendo si dice que es
 * viejo; deja de servir cuando se disfraza de hoy.
 *
 * Gemelo de `edad_del_dato` / `fechar_afirmacion` en .github/scripts/agent_common.py, que
 * hace lo mismo para los agentes de Python. Dos lenguajes, una sola regla.
 */

/**
 * Un hallazgo sobre la operación de hoy se cocina en horas, no en días. Más allá de esto
 * la frase deja de ser sobre el presente y tiene que decir de cuándo habla.
 */
export const HORAS_PARA_HABLAR_EN_PRESENTE = 24

export interface EdadDelDato {
  /** false cuando el agente no dijo de cuándo es su dato. NO significa que esté fresco. */
  declarada: boolean
  horas: number | null
  dias: number | null
  /** true sólo si el dato es lo bastante nuevo para hablar en presente. */
  enPresente: boolean
  hasta: string | null
}

const SIN_DECLARAR: EdadDelDato = {
  declarada: false, horas: null, dias: null, enPresente: false, hasta: null,
}

/**
 * Qué tan viejo es el dato detrás de una afirmación.
 *
 * `datosHasta` es la fecha o timestamp del registro MÁS NUEVO que se usó para concluir.
 * Sin él, `declarada` es false — que no es lo mismo que decir que el dato está fresco, y
 * nunca debe leerse así.
 */
export function edadDelDato(datosHasta?: string | null, ahora: number = Date.now()): EdadDelDato {
  if (!datosHasta) return SIN_DECLARAR

  const texto = String(datosHasta)
  // Una fecha suelta (2026-07-10) se toma al final de ese día: es lo más favorable para
  // el agente, y aun así 60 días siguen siendo 60 días.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? `${texto}T23:59:59Z` : texto
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return { ...SIN_DECLARAR, hasta: texto }

  const horas = (ahora - ms) / 3_600_000
  return {
    declarada: true,
    horas: Math.round(horas * 10) / 10,
    dias: Math.round((horas / 24) * 10) / 10,
    enPresente: horas <= HORAS_PARA_HABLAR_EN_PRESENTE,
    hasta: texto,
  }
}

/**
 * Antepone la edad del dato cuando la afirmación ya no es sobre hoy.
 *
 * No suaviza el hallazgo, no le baja la severidad y no lo esconde: lo fecha.
 *
 *   «41 ingredientes sin stock»
 *   → «Con datos al 2026-07-10 (hace 60 días): 41 ingredientes sin stock»
 *
 * Un texto vacío se queda vacío: fechar la nada produciría una tarjeta que sólo dice una
 * fecha.
 */
export function fecharAfirmacion(texto: string, edad: EdadDelDato): string {
  if (!texto) return texto
  if (!edad.declarada || edad.enPresente) return texto
  const cuando = (edad.hasta ?? '').slice(0, 10)
  const sello = edad.dias === null
    ? `Con datos al ${cuando}: `
    : `Con datos al ${cuando} (hace ${Math.round(edad.dias)} días): `
  return sello + texto
}

/**
 * El valor de fecha más nuevo de un lote de filas, para pasarlo como `datos_hasta`.
 *
 * Devuelve null cuando no hay ninguno — y null significa «no lo declaré», nunca «está
 * fresco».
 */
export function masReciente<T extends object>(
  // Genérico a propósito: una `interface` de TypeScript NO es asignable a
  // `Record<string, unknown>` —no lleva index signature implícita—, y con esa firma cada
  // agente habría tenido que castear su propio tipo de fila para poder declarar su
  // frescura. Una fricción así es exactamente la que hace que la regla se deje de aplicar.
  filas: ReadonlyArray<T> | null | undefined,
  ...campos: string[]
): string | null {
  const buscar = campos.length
    ? campos
    : ['data_freshness', 'generated_at', 'updated_at', 'created_at', 'fecha']
  let mayor: string | null = null
  for (const fila of filas ?? []) {
    if (!fila || typeof fila !== 'object') continue
    const registro = fila as Record<string, unknown>
    for (const campo of buscar) {
      const v = registro[campo]
      if (v !== null && v !== undefined && v !== '') {
        const s = String(v)
        if (mayor === null || s > mayor) mayor = s
        break
      }
    }
  }
  return mayor
}
