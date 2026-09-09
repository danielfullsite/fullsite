// GUARD-08 — pure logic for open-order guard during shift close.
// Extracted for testability and re-use in CierreCajaWizard.

export const OPEN_ORDER_STATUSES = ['enviada', 'preparando', 'lista'] as const
export type OpenOrderStatus = (typeof OPEN_ORDER_STATUSES)[number]

export interface OpenOrder {
  id: string
  mesa: number
  mesero: string
  status: OpenOrderStatus
  total: number
}

/** Returns orders that block a clean shift close. */
export function filterOpenOrders(
  orders: Array<{ id: string; mesa: number; mesero: string; status: string; total: number }>
): OpenOrder[] {
  return orders.filter((o) =>
    OPEN_ORDER_STATUSES.includes(o.status as OpenOrderStatus)
  ) as OpenOrder[]
}

export interface EscalationValidation {
  valid: boolean
  error?: string
}

const MIN_NOTA_LENGTH = 10

/** Validates the manager's override note. */
export function validateEscalationNota(nota: string): EscalationValidation {
  const trimmed = nota.trim()
  if (!trimmed) return { valid: false, error: 'La nota de autorización es obligatoria' }
  if (trimmed.length < MIN_NOTA_LENGTH) {
    return {
      valid: false,
      error: `Mínimo ${MIN_NOTA_LENGTH} caracteres (${trimmed.length}/${MIN_NOTA_LENGTH})`,
    }
  }
  return { valid: true }
}

/**
 * Merges GUARD-08 escalation fields into any cierre payload.
 * Fields are always present so the sync queue has full context even offline.
 * Requires DB migration: see docs/playbooks/SQL-MIGRATION.md (GUARD-08).
 */
export function withEscalationPayload<T extends Record<string, unknown>>(
  payload: T,
  openOrders: OpenOrder[],
  authorizedBy: string | null,
  nota: string | null
): T & {
  cierre_con_ordenes_abiertas: boolean
  ordenes_pendientes: string[]
  cierre_autorizado_por: string | null
  cierre_nota: string | null
} {
  return {
    ...payload,
    cierre_con_ordenes_abiertas: openOrders.length > 0,
    ordenes_pendientes: openOrders.map((o) => o.id),
    cierre_autorizado_por: authorizedBy,
    cierre_nota: nota,
  }
}

const STATUS_LABELS: Record<OpenOrderStatus, string> = {
  enviada: 'Enviada a cocina',
  preparando: 'En preparación',
  lista: 'Lista — sin cobrar',
}

/** Human-readable status label for the guard screen order list. */
export function openOrderStatusLabel(status: OpenOrderStatus): string {
  return STATUS_LABELS[status] ?? status
}

// ─── Guarda al ABRIR turno (regla de Eduardo) ────────────────────────────────
//
// Eduardo Esquivel, AMALAY:
//   "No puedes abrir un turno si sigues teniendo cuentas abiertas del turno
//    anterior… hay que matarlas todas."
//   "No puede haber cuentas abiertas de un día para otro."
//
// El módulo ya tenía la guarda al CERRAR (GUARD-08). La de ABRIR no existía:
// `filterOpenOrders` sólo lo consumía `CierreCajaWizard`. Ésta es la simétrica.
//
// DOS REGLAS QUE CHOCAN, Y CÓMO SE RESUELVEN
//
// Eduardo dice BLOQUEAR. El protocolo de offline dice que abrir el día NUNCA se
// bloquea por red (regla dura #3 de OFFLINE-LAN-FIELD-PROVEN §4). Las dos son
// correctas y no se contradicen si se separa el caso:
//
//   - La consulta SÍ se pudo hacer y hay cuentas  -> BLOQUEA (Eduardo).
//   - La consulta SÍ se pudo hacer y no hay nada  -> abre normal.
//   - La consulta NO se pudo hacer (401, sin red) -> ABRE, con aviso.
//
// Bloquear el arranque del día por un fetch fallido sería repetir el error del
// 2026-08-31: un fallo leído como si fuera un hecho. Ver `clasificar-fallo.ts`.

/** Resultado de buscar cuentas abiertas antes de abrir turno. */
export type LecturaDeCuentas =
  /** El servidor contestó. `cuentas` es la verdad. */
  | { determinado: true; cuentas: OpenOrder[] }
  /** No se pudo saber. NO es lo mismo que "no hay". */
  | { determinado: false; motivo: string }

export interface VeredictoApertura {
  /** ¿Se puede abrir turno? */
  permitido: boolean
  /** Cuentas que hay que cerrar antes. Vacío si no bloquean. */
  bloqueantes: OpenOrder[]
  /** Aviso a mostrar aunque se permita abrir. `null` si no hay nada que decir. */
  aviso: string | null
}

/**
 * ¿Se puede abrir turno con lo que se sabe?
 *
 * Pura: no toca red ni almacenamiento. Toda la política vive aquí para poder
 * probarla sin montar el componente.
 */
export function evaluarAperturaDeTurno(lectura: LecturaDeCuentas): VeredictoApertura {
  if (!lectura.determinado) {
    // Nunca se bloquea el día por no haber podido comprobar. Se avisa.
    return {
      permitido: true,
      bloqueantes: [],
      aviso: `No se pudieron revisar las cuentas del turno anterior (${lectura.motivo}). ` +
             `Revisa en la caja que no quede ninguna abierta.`,
    }
  }
  const bloqueantes = filterOpenOrders(lectura.cuentas)
  if (bloqueantes.length === 0) return { permitido: true, bloqueantes: [], aviso: null }
  return {
    permitido: false,
    bloqueantes,
    aviso: `Hay ${bloqueantes.length} ${bloqueantes.length === 1 ? 'cuenta abierta' : 'cuentas abiertas'} ` +
           `del turno anterior. Ciérralas antes de abrir turno.`,
  }
}

/** Suma de lo que está colgando, para enseñarlo antes de matar nada. */
export function totalDeCuentas(cuentas: OpenOrder[]): number {
  return cuentas.reduce((acc, c) => acc + (Number(c.total) || 0), 0)
}

// ─── El arqueo de caja: lo que la pantalla prometía y no cumplía ─────────────
//
// Encontrado el 2026-09-08, leyendo `pos_cierres` de AMALAY en la caja real:
//
//   folio_z  fecha        total_ventas  total_contado  diferencia
//        3   2026-09-03      5,957.76           0.00   -5,957.76
//        4   2026-09-05           0.00          0.00       -1.00
//   ...y así los OCHO cierres que existen, desde julio. `total_contado` = 0
//   en todos, sin una sola excepción, y ninguno con nota.
//
// La causa no era que nadie contara el efectivo. Era el propio wizard:
//
//   1. `CierreCajaWizard.tsx:200` — `Number(cashInput) || 0`. El campo del paso 1
//      no era obligatorio y el botón "Siguiente" no validaba nada, así que
//      avanzar sin escribir dejaba un 0 que se ve igual que un 0 contado.
//   2. `CierreCajaWizard.tsx:784` — con diferencia > $50 la pantalla decía
//      "requiere explicacion"… junto a un campo rotulado "Notas (opcional)", y el
//      botón de cerrar sólo pedía `pin.length >= 4`. La explicación se anunciaba
//      y no se exigía.
//
// Una alerta que se puede ignorar con un clic no es un control: es decoración que
// además enseña a ignorar las alertas de verdad. El corte de caja existe para
// detectar un faltante; aceptando 0 en silencio detectaba exactamente nada.
//
// El patrón correcto ya vivía en este archivo — `validateEscalationNota`, que sí
// bloquea el cierre con órdenes abiertas. Esto sólo lo aplica al dinero.

/** Arriba de esto, la diferencia deja de ser redondeo y hay que explicarla. */
export const UMBRAL_EXPLICACION_MXN = 50

export interface VeredictoArqueo {
  /** ¿Se puede cerrar la caja con lo capturado? */
  puedeCerrar: boolean
  /** ¿La diferencia obliga a escribir una explicación? */
  exigeExplicacion: boolean
  /** Qué le falta al cajero. `null` si no falta nada. */
  motivo: string | null
}

/**
 * ¿Se puede cerrar la caja?
 *
 * `contado` es `null` cuando el campo se dejó VACÍO. Es deliberado que sea
 * distinto de `0`: "no conté" y "conté y no había nada" son hechos distintos, y
 * confundirlos es lo que produjo ocho cierres con el mismo cero mudo. Un cero
 * escrito a mano es una afirmación; un cero por omisión no dice nada.
 *
 * Pura: no toca red ni estado. Toda la política vive aquí para poder probarla sin
 * montar el componente — que además es lo único posible hoy, porque el carril de
 * jsdom está declarado y sin instalar.
 */
export function evaluarArqueo(contado: number | null, diferencia: number, nota: string): VeredictoArqueo {
  if (contado === null || !Number.isFinite(contado)) {
    return {
      puedeCerrar: false,
      exigeExplicacion: false,
      motivo: 'Escribe cuánto efectivo hay en caja. Si no hay nada, escribe 0.',
    }
  }
  if (contado < 0) {
    return { puedeCerrar: false, exigeExplicacion: false, motivo: 'El efectivo contado no puede ser negativo.' }
  }

  const exigeExplicacion = Math.abs(diferencia) > UMBRAL_EXPLICACION_MXN
  if (!exigeExplicacion) return { puedeCerrar: true, exigeExplicacion: false, motivo: null }

  // Se reusa la misma regla que ya gobierna la escalación por órdenes abiertas,
  // para que "explicar" signifique lo mismo en las dos puertas del cierre.
  const v = validateEscalationNota(nota)
  if (!v.valid) {
    return {
      puedeCerrar: false,
      exigeExplicacion: true,
      motivo: `Diferencia de más de $${UMBRAL_EXPLICACION_MXN} — ${v.error}`,
    }
  }
  return { puedeCerrar: true, exigeExplicacion: true, motivo: null }
}

/** Lee el campo de texto del arqueo. Vacío o basura -> `null`, nunca 0. */
export function leerContado(entrada: string): number | null {
  const t = entrada.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ─── El aviso de órdenes huérfanas tenía que poder apagarse solo ─────────────
//
// Visto en la caja de AMALAY el 2026-09-08: la pantalla de Turnos llevaba SIETE
// DÍAS mostrando "Cierre anterior con 13 ordenes abiertas — Verifica el mapa de
// mesas para localizar las ordenes huérfanas".
//
// Comprobado contra la base ese mismo día: las 13 órdenes existen, y NINGUNA
// sigue abierta. El aviso era falso, y llevaba dos cierres Z encima (Z#3 el 3 de
// septiembre, Z#4 el 5) sin apagarse.
//
// La causa está en `pos/turno/page.tsx`: la consulta pedía
// `cierre_con_ordenes_abiertas=eq.true&order=created_at.desc&limit=1`, o sea el
// último cierre que TUVO órdenes abiertas — un hecho histórico que nunca deja de
// ser cierto — y contaba la longitud del arreglo guardado aquel día. Nadie
// preguntaba si esas órdenes seguían abiertas hoy.
//
// Un aviso que no se puede resolver trabajando deja de leerse, y se lleva por
// delante la credibilidad de los avisos que sí importan. Peor: tenía una "X"
// para cerrarlo, así que la única forma de quitarlo era ignorarlo.
//
// POR QUÉ NO SE ESCONDE CUANDO NO SE PUEDE COMPROBAR. Si la consulta de estado
// falla (sin red, 401, timeout), no sabemos si quedan huérfanas. Callar sería
// convertir un fallo en un "no hay", que es el error que ya costó caro el
// 2026-08-31. Se muestra el aviso diciendo que no se pudo verificar.

export interface AvisoDeHuerfanas {
  /** ¿Hay que enseñar el aviso? */
  mostrar: boolean
  /** Cuántas siguen abiertas. `null` si no se pudo comprobar. */
  siguenAbiertas: number | null
  /** Texto para el operador. `null` si no hay nada que decir. */
  texto: string | null
}

/**
 * ¿Sigue vigente el aviso del último cierre con órdenes abiertas?
 *
 * `declaradas` son los ids que ese cierre guardó. `lectura` es lo que se pudo
 * averiguar HOY sobre ellas. Pura: la política vive aquí, no en el componente.
 */
export function evaluarAvisoDeHuerfanas(
  declaradas: string[],
  lectura: { determinado: true; abiertas: string[] } | { determinado: false; motivo: string },
  nota: string | null,
): AvisoDeHuerfanas {
  if (declaradas.length === 0) return { mostrar: false, siguenAbiertas: 0, texto: null }

  if (!lectura.determinado) {
    return {
      mostrar: true,
      siguenAbiertas: null,
      texto: `Un cierre anterior dejó ${declaradas.length} ${declaradas.length === 1 ? 'orden abierta' : 'órdenes abiertas'}` +
             `${nota ? ` (motivo: ${nota})` : ''}. No se pudo comprobar si siguen abiertas (${lectura.motivo}) — ` +
             `revisa el mapa de mesas.`,
    }
  }

  // Sólo cuentan las declaradas que de verdad siguen abiertas. Una orden abierta
  // NUEVA no es huérfana de aquel cierre y no le toca a este aviso.
  const vivas = lectura.abiertas.filter((id) => declaradas.includes(id))
  if (vivas.length === 0) return { mostrar: false, siguenAbiertas: 0, texto: null }

  return {
    mostrar: true,
    siguenAbiertas: vivas.length,
    texto: `Quedan ${vivas.length} de ${declaradas.length} ${vivas.length === 1 ? 'orden' : 'órdenes'} ` +
           `sin cerrar de un cierre anterior${nota ? ` (motivo: ${nota})` : ''}. Búscalas en el mapa de mesas.`,
  }
}
