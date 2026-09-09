/**
 * El catálogo del contrato — qué puede consultar el analista y qué NO.
 *
 * POR QUÉ EXISTE
 * Hoy `api/chat` decide qué datos ve el modelo con coincidencia literal de palabras:
 *
 *     const wantsFoodCost = ['costo','cost','margen','insumo',...].some(kw => q.includes(kw))
 *
 * Si preguntas "¿por qué se me está yendo el dinero?", ninguna palabra pega, el modelo
 * nunca recibe los costos, y responde con seguridad usando media base. El prompt le pide
 * "entender INTENCIÓN, no sólo palabras" mientras los datos se eligieron por palabras.
 *
 * Aquí se invierte: el modelo declara QUÉ necesita y el código lo trae. Y como lo declara
 * por escrito, ese plan es también la procedencia de la respuesta — el "shows the logic and
 * data sources behind every answer" no hay que reconstruirlo después, ya está.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN
 *
 * 1. Sólo vistas del contrato, nunca SQL. El plan lo escribe un modelo a partir del texto
 *    de un usuario; si de ahí saliera SQL, el usuario escribiría el SQL. La lista blanca de
 *    abajo es exhaustiva y se valida por igualdad exacta, no por patrón.
 *
 * 2. El tenant NUNCA sale del plan. Lo pone el servidor desde `requireTenant`, y esta capa
 *    ni siquiera acepta un campo donde ponerlo. Ver la fuga F-2 (cerrada el 2026-08-30):
 *    el chat tomaba `client_id` del body y cualquier usuario logueado leía las ventas y los
 *    nombres del staff de otro restaurante. Un plan generado por un LLM es exactamente la
 *    misma superficie con otra cara.
 */

/** Una vista del contrato, descrita para que un modelo pueda elegirla bien. */
export interface VistaDelContrato {
  /** Nombre real en la base. Es también la clave de la lista blanca. */
  nombre: string
  /** Qué pregunta de negocio responde. Esto es lo que lee el modelo al planear. */
  responde: string
  /** Columnas disponibles. Se validan: una columna fuera de aquí se descarta. */
  columnas: readonly string[]
  /** Columna de fecha por la que se filtra el rango. */
  fecha: string
  /** Columnas por las que se puede agrupar/filtrar además del tenant. */
  filtrables: readonly string[]
  /**
   * Columnas que publican cuánta señal FALTA. Se citan siempre que la vista se use:
   * un cero por falta de captura y un cero real se leen igual sin ellas.
   */
  cobertura: readonly string[]
  /** Cuándo conviene usarla. Ejemplos concretos ayudan más que una descripción. */
  ejemplos: readonly string[]
}

export const CONTRATO: readonly VistaDelContrato[] = [
  {
    nombre: 'ops_daily_history',
    responde: '¿Cómo cerró cada día? Ventas, tickets, personas, propinas, efectivo vs tarjeta.',
    columnas: ['fecha', 'ventas_dia', 'ventas_brutas', 'descuentos', 'efectivo', 'tarjeta',
               'tickets_count', 'mesas_atendidas', 'personas_restaurant',
               'ticket_promedio_restaurant', 'propinas_total', 'meseros', 'platillos_top',
               'pago_metodos', 'source_system'],
    fecha: 'fecha',
    filtrables: [],
    cobertura: ['source_system'],
    ejemplos: [
      '¿cómo vamos este mes?',
      '¿cuál fue el mejor día de la semana pasada?',
      'compara agosto contra julio',
    ],
  },
  {
    nombre: 'ops_hourly',
    responde: '¿Cómo se reparte el día por hora? Tickets, ventas y personas en cada hora.',
    columnas: ['dia_venta', 'hora', 'location_id', 'tickets', 'ventas', 'personas', 'mesas',
               'ticket_promedio'],
    fecha: 'dia_venta',
    filtrables: ['hora', 'location_id'],
    cobertura: [],
    ejemplos: [
      '¿a qué hora se llena?',
      '¿vale la pena abrir más temprano?',
      '¿cómo va el día comparado con lo normal a esta hora?',
      '¿en qué horas necesito más gente?',
    ],
  },
  {
    nombre: 'ops_personal',
    responde:
      '¿Quién trabajó, cuándo y qué vendió? Incluye las dos señales antifraude ' +
      '(pct_propina y pct_efectivo por mesero) y el tiempo de mesa ya limpio.',
    columnas: ['dia_venta', 'mesero', 'location_id', 'tickets', 'ventas', 'personas', 'mesas',
               'ticket_promedio', 'propina_total', 'pct_propina', 'ventas_efectivo',
               'ventas_tarjeta', 'pct_efectivo', 'tiempo_mesa_p50', 'tiempo_mesa_p95',
               'ordenes_con_tiempo', 'ordenes_sin_cierre', 'ordenes_tiempo_descartado',
               'ordenes_sin_metodo'],
    fecha: 'dia_venta',
    filtrables: ['mesero', 'location_id'],
    cobertura: ['ordenes_con_tiempo', 'ordenes_sin_cierre', 'ordenes_tiempo_descartado',
                'ordenes_sin_metodo'],
    ejemplos: [
      '¿quién vende más?',
      '¿algún mesero se está quedando con dinero?',
      '¿cuánto duran las mesas?',
      '¿por qué fulano trae menos propina que los demás?',
    ],
  },
  {
    nombre: 'ops_consumo',
    responde:
      '¿Qué ingredientes DEBIERON consumirse según lo que se vendió? Es el lado teórico; ' +
      'restarle los movimientos reales de inventario da la merma no declarada.',
    columnas: ['dia_venta', 'location_id', 'ingredient_id', 'ingrediente', 'recipe_unit',
               'stock_unit', 'consumo_receta', 'consumo_stock', 'lineas', 'platillos_vendidos',
               'es_subreceta', 'lineas_sin_unidad_stock', 'lineas_no_convertibles'],
    fecha: 'dia_venta',
    filtrables: ['ingredient_id', 'location_id', 'es_subreceta'],
    cobertura: ['lineas_sin_unidad_stock', 'lineas_no_convertibles'],
    ejemplos: [
      '¿cuánta carne debimos usar esta semana?',
      '¿se está yendo producto?',
      '¿cuadra el inventario con lo que vendimos?',
    ],
  },
  {
    nombre: 'ops_consumo_cobertura',
    responde:
      'Qué fracción de lo vendido tiene receta capturada. Es el denominador OBLIGATORIO ' +
      'de ops_consumo: sin él, lo que nadie capturó parece producto robado.',
    columnas: ['dia_venta', 'lineas_vendidas', 'lineas_con_receta', 'pct_lineas_con_receta',
               'importe_vendido', 'importe_con_receta', 'pct_importe_con_receta',
               'platillos_sin_receta'],
    fecha: 'dia_venta',
    filtrables: [],
    cobertura: ['pct_lineas_con_receta', 'pct_importe_con_receta', 'platillos_sin_receta'],
    ejemplos: ['siempre que se use ops_consumo'],
  },
] as const

/** Lista blanca. Igualdad exacta — nunca prefijo, nunca patrón. */
const PERMITIDAS = new Set(CONTRATO.map((v) => v.nombre))

export function vistaPermitida(nombre: unknown): nombre is string {
  return typeof nombre === 'string' && PERMITIDAS.has(nombre)
}

export function buscarVista(nombre: string): VistaDelContrato | undefined {
  return CONTRATO.find((v) => v.nombre === nombre)
}

/**
 * `ops_consumo` sin su cobertura es la forma más cara de equivocarse que tiene este
 * sistema: acusa a una persona de robo cuando lo que falta es catálogo. Medido el
 * 2026-09-09, dos tenants con más de 15,000 líneas vendidas tienen 0% de recetas
 * capturadas — ahí el "faltante" sería el 100% del consumo.
 *
 * Por eso la cobertura no se le pide al modelo: se agrega sola.
 */
export const EXIGE_COBERTURA: Readonly<Record<string, string>> = {
  ops_consumo: 'ops_consumo_cobertura',
}

/** El catálogo en el formato que ve el modelo al planear. Compacto a propósito. */
export function catalogoParaPlanear(): string {
  return CONTRATO.map((v) => {
    const filtros = v.filtrables.length ? ` · filtrable por: ${v.filtrables.join(', ')}` : ''
    return [
      `${v.nombre} — ${v.responde}`,
      `  columnas: ${v.columnas.join(', ')}`,
      `  rango por: ${v.fecha}${filtros}`,
      `  útil para: ${v.ejemplos.join(' | ')}`,
    ].join('\n')
  }).join('\n\n')
}
