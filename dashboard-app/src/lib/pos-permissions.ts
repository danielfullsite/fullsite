/**
 * POS Granular Permissions System
 * Based on Eduardo's Wansoft screenshots (~50 permissions)
 * Each permission is a boolean flag per role profile.
 */

export interface POSPermissions {
  // === CUENTAS / ORDENES ===
  abrir_cuentas_restaurante: boolean
  abrir_cuentas_llevar: boolean
  abrir_cuentas_domicilio: boolean
  abrir_cuentas_recoger: boolean
  cerrar_cuentas: boolean
  cancelar_ordenes: boolean       // CRITICO — Eduardo: "solo yo tengo este"
  cancelar_facturas: boolean
  cambio_mesa: boolean
  cambio_mesero: boolean          // Cambiar partidas de mesa
  cambio_forma_pago: boolean
  cambio_tipo_cuenta: boolean
  cambio_personas: boolean
  juntar_mesas: boolean
  liberar_ordenes: boolean
  mesas_por_cobrar: boolean
  ver_todas_cuentas: boolean
  ver_cuentas_propias: boolean    // "Solo mis mesas"

  // === DESCUENTOS / CORTESIAS ===
  descuentos_ordenes_pct: boolean
  descuentos_ordenes_monto: boolean
  descuentos_platillos_pct: boolean
  descuentos_platillos_monto: boolean
  platillos_gratis: boolean
  cerrar_cuentas_cortesia: boolean
  platillos_2x1: boolean

  // === IMPRESION / TICKETS ===
  imprimir_cuentas: boolean
  reimpresion_preticket: boolean
  registro_comanda: boolean

  // === CAJA / FINANZAS ===
  cajero: boolean
  corte_turno: boolean
  corte_x: boolean                // Corte parcial
  corte_z: boolean                // Corte final del dia
  corte_mesero: boolean
  retiros_programados: boolean
  propinas: boolean
  tipo_cambio: boolean
  vales: boolean

  // === REPORTES ===
  ventas_mesero: boolean
  ventas_globales: boolean
  reportes: boolean

  // === CONFIGURACION ===
  abrir_dia_operaciones: boolean
  administrar_cliente: boolean
  borrar_platillos: boolean
  actualizar_informacion: boolean
  actualizar_estatus_orden: boolean
  configurar_datos_terminal: boolean
  configurar_funciones_terminal: boolean
  configurar_impresora: boolean
  configurar_huella_digital: boolean
  configurar_numero_terminal: boolean
  configurar_iva: boolean
  control_existencias_pos: boolean
  happy_hour: boolean
  modo_operacion: boolean         // Retail vs restaurante
  operaciones_adicionales: boolean

  // === ROLES ===
  gerente: boolean
  mesero: boolean
  repartidor: boolean
}

// Default permission profiles matching Wansoft's structure
export const PERMISSION_PROFILES: Record<string, POSPermissions> = {
  admin: {
    abrir_cuentas_restaurante: true, abrir_cuentas_llevar: true, abrir_cuentas_domicilio: true,
    abrir_cuentas_recoger: true, cerrar_cuentas: true, cancelar_ordenes: true, cancelar_facturas: true,
    cambio_mesa: true, cambio_mesero: true, cambio_forma_pago: true, cambio_tipo_cuenta: true,
    cambio_personas: true, juntar_mesas: true, liberar_ordenes: true, mesas_por_cobrar: true,
    ver_todas_cuentas: true, ver_cuentas_propias: true,
    descuentos_ordenes_pct: true, descuentos_ordenes_monto: true, descuentos_platillos_pct: true,
    descuentos_platillos_monto: true, platillos_gratis: true, cerrar_cuentas_cortesia: true, platillos_2x1: true,
    imprimir_cuentas: true, reimpresion_preticket: true, registro_comanda: true,
    cajero: true, corte_turno: true, corte_x: true, corte_z: true, corte_mesero: true,
    retiros_programados: true, propinas: true, tipo_cambio: true, vales: true,
    ventas_mesero: true, ventas_globales: true, reportes: true,
    abrir_dia_operaciones: true, administrar_cliente: true, borrar_platillos: true,
    actualizar_informacion: true, actualizar_estatus_orden: true,
    configurar_datos_terminal: true, configurar_funciones_terminal: true,
    configurar_impresora: true, configurar_huella_digital: true,
    configurar_numero_terminal: true, configurar_iva: true,
    control_existencias_pos: true, happy_hour: true, modo_operacion: true,
    operaciones_adicionales: true, gerente: true, mesero: true, repartidor: true,
  },

  gerente: {
    abrir_cuentas_restaurante: true, abrir_cuentas_llevar: true, abrir_cuentas_domicilio: true,
    abrir_cuentas_recoger: true, cerrar_cuentas: true, cancelar_ordenes: false, // NO — solo admin
    cancelar_facturas: true, cambio_mesa: true, cambio_mesero: true, cambio_forma_pago: true,
    cambio_tipo_cuenta: true, cambio_personas: true, juntar_mesas: true, liberar_ordenes: true,
    mesas_por_cobrar: true, ver_todas_cuentas: true, ver_cuentas_propias: true,
    descuentos_ordenes_pct: true, descuentos_ordenes_monto: true, descuentos_platillos_pct: true,
    descuentos_platillos_monto: true, platillos_gratis: true, cerrar_cuentas_cortesia: true, platillos_2x1: true,
    imprimir_cuentas: true, reimpresion_preticket: true, registro_comanda: true,
    cajero: true, corte_turno: true, corte_x: true, corte_z: true, corte_mesero: true,
    retiros_programados: true, propinas: true, tipo_cambio: true, vales: true,
    ventas_mesero: true, ventas_globales: true, reportes: true,
    abrir_dia_operaciones: true, administrar_cliente: false, borrar_platillos: false,
    actualizar_informacion: true, actualizar_estatus_orden: true,
    configurar_datos_terminal: false, configurar_funciones_terminal: false,
    configurar_impresora: false, configurar_huella_digital: false,
    configurar_numero_terminal: false, configurar_iva: false,
    control_existencias_pos: true, happy_hour: true, modo_operacion: false,
    operaciones_adicionales: true, gerente: true, mesero: true, repartidor: false,
  },

  capitan: {
    abrir_cuentas_restaurante: true, abrir_cuentas_llevar: true, abrir_cuentas_domicilio: false,
    abrir_cuentas_recoger: false, cerrar_cuentas: true, cancelar_ordenes: false,
    cancelar_facturas: false, cambio_mesa: true, cambio_mesero: true, cambio_forma_pago: true,
    cambio_tipo_cuenta: false, cambio_personas: true, juntar_mesas: true, liberar_ordenes: false,
    mesas_por_cobrar: true, ver_todas_cuentas: true, ver_cuentas_propias: true,
    descuentos_ordenes_pct: true, descuentos_ordenes_monto: false, descuentos_platillos_pct: true,
    descuentos_platillos_monto: false, platillos_gratis: false, cerrar_cuentas_cortesia: true, platillos_2x1: true,
    imprimir_cuentas: true, reimpresion_preticket: true, registro_comanda: true,
    cajero: false, corte_turno: false, corte_x: false, corte_z: false, corte_mesero: true,
    retiros_programados: false, propinas: true, tipo_cambio: false, vales: false,
    ventas_mesero: true, ventas_globales: false, reportes: false,
    abrir_dia_operaciones: false, administrar_cliente: false, borrar_platillos: false,
    actualizar_informacion: false, actualizar_estatus_orden: true,
    configurar_datos_terminal: false, configurar_funciones_terminal: false,
    configurar_impresora: false, configurar_huella_digital: false,
    configurar_numero_terminal: false, configurar_iva: false,
    control_existencias_pos: false, happy_hour: false, modo_operacion: false,
    operaciones_adicionales: false, gerente: false, mesero: true, repartidor: false,
  },

  cajero: {
    abrir_cuentas_restaurante: false, abrir_cuentas_llevar: true, abrir_cuentas_domicilio: true,
    abrir_cuentas_recoger: true, cerrar_cuentas: true, cancelar_ordenes: false,
    cancelar_facturas: false, cambio_mesa: false, cambio_mesero: false, cambio_forma_pago: true,
    cambio_tipo_cuenta: false, cambio_personas: false, juntar_mesas: false, liberar_ordenes: false,
    mesas_por_cobrar: true, ver_todas_cuentas: true, ver_cuentas_propias: false,
    descuentos_ordenes_pct: false, descuentos_ordenes_monto: false, descuentos_platillos_pct: false,
    descuentos_platillos_monto: false, platillos_gratis: false, cerrar_cuentas_cortesia: false, platillos_2x1: false,
    imprimir_cuentas: true, reimpresion_preticket: true, registro_comanda: true,
    cajero: true, corte_turno: true, corte_x: true, corte_z: false, corte_mesero: false,
    retiros_programados: false, propinas: true, tipo_cambio: false, vales: true,
    ventas_mesero: false, ventas_globales: false, reportes: false,
    abrir_dia_operaciones: false, administrar_cliente: false, borrar_platillos: false,
    actualizar_informacion: false, actualizar_estatus_orden: false,
    configurar_datos_terminal: false, configurar_funciones_terminal: false,
    configurar_impresora: false, configurar_huella_digital: false,
    configurar_numero_terminal: false, configurar_iva: false,
    control_existencias_pos: false, happy_hour: false, modo_operacion: false,
    operaciones_adicionales: false, gerente: false, mesero: false, repartidor: false,
  },

  mesero: {
    abrir_cuentas_restaurante: true, abrir_cuentas_llevar: false, abrir_cuentas_domicilio: false,
    abrir_cuentas_recoger: false, cerrar_cuentas: false, cancelar_ordenes: false,
    cancelar_facturas: false, cambio_mesa: false, cambio_mesero: false, cambio_forma_pago: false,
    cambio_tipo_cuenta: false, cambio_personas: true, juntar_mesas: false, liberar_ordenes: false,
    mesas_por_cobrar: false, ver_todas_cuentas: false, ver_cuentas_propias: true,
    descuentos_ordenes_pct: false, descuentos_ordenes_monto: false, descuentos_platillos_pct: false,
    descuentos_platillos_monto: false, platillos_gratis: false, cerrar_cuentas_cortesia: false, platillos_2x1: false,
    imprimir_cuentas: false, reimpresion_preticket: false, registro_comanda: true,
    cajero: false, corte_turno: false, corte_x: false, corte_z: false, corte_mesero: false,
    retiros_programados: false, propinas: false, tipo_cambio: false, vales: false,
    ventas_mesero: false, ventas_globales: false, reportes: false,
    abrir_dia_operaciones: false, administrar_cliente: false, borrar_platillos: false,
    actualizar_informacion: false, actualizar_estatus_orden: false,
    configurar_datos_terminal: false, configurar_funciones_terminal: false,
    configurar_impresora: false, configurar_huella_digital: false,
    configurar_numero_terminal: false, configurar_iva: false,
    control_existencias_pos: false, happy_hour: false, modo_operacion: false,
    operaciones_adicionales: false, gerente: false, mesero: true, repartidor: false,
  },
}

/** Get permissions for a role. Falls back to mesero if unknown. */
export function getPermissions(role: string): POSPermissions {
  return PERMISSION_PROFILES[role] || PERMISSION_PROFILES.mesero
}

/** Check if a role has a specific permission */
export function hasPermission(role: string, permission: keyof POSPermissions): boolean {
  const perms = getPermissions(role)
  return perms[permission] ?? false
}

/** Get human-readable label for a permission */
export const PERMISSION_LABELS: Record<keyof POSPermissions, string> = {
  abrir_cuentas_restaurante: 'Abrir cuentas restaurante',
  abrir_cuentas_llevar: 'Abrir cuentas para llevar',
  abrir_cuentas_domicilio: 'Abrir cuentas a domicilio',
  abrir_cuentas_recoger: 'Abrir cuentas para recoger',
  cerrar_cuentas: 'Cerrar cuentas',
  cancelar_ordenes: 'Cancelar ordenes (CRITICO)',
  cancelar_facturas: 'Cancelar facturas',
  cambio_mesa: 'Cambio de mesa',
  cambio_mesero: 'Cambiar mesero de cuenta',
  cambio_forma_pago: 'Cambio de forma de pago',
  cambio_tipo_cuenta: 'Cambio tipo de cuenta',
  cambio_personas: 'Cambiar numero de personas',
  juntar_mesas: 'Juntar mesas',
  liberar_ordenes: 'Liberar todas las ordenes',
  mesas_por_cobrar: 'Mesas por cobrar',
  ver_todas_cuentas: 'Ver todas las cuentas',
  ver_cuentas_propias: 'Ver cuentas propias unicamente',
  descuentos_ordenes_pct: 'Descuentos en ordenes %',
  descuentos_ordenes_monto: 'Descuentos en ordenes $',
  descuentos_platillos_pct: 'Descuentos en platillos %',
  descuentos_platillos_monto: 'Descuentos en platillos $',
  platillos_gratis: 'Platillos gratis',
  cerrar_cuentas_cortesia: 'Cerrar cuentas como cortesia',
  platillos_2x1: 'Platillos 2x1',
  imprimir_cuentas: 'Imprimir cuentas',
  reimpresion_preticket: 'Reimpresion de preticket',
  registro_comanda: 'Registro de comanda',
  cajero: 'Cajero',
  corte_turno: 'Corte de turno',
  corte_x: 'Corte X',
  corte_z: 'Corte Z',
  corte_mesero: 'Corte de mesero',
  retiros_programados: 'Retiros programados',
  propinas: 'Propinas',
  tipo_cambio: 'Tipo de cambio',
  vales: 'Vales',
  ventas_mesero: 'Ventas por mesero',
  ventas_globales: 'Ventas globales',
  reportes: 'Reportes',
  abrir_dia_operaciones: 'Abrir dia de operaciones',
  administrar_cliente: 'Administrar cliente',
  borrar_platillos: 'Borrar platillos',
  actualizar_informacion: 'Actualizacion de informacion',
  actualizar_estatus_orden: 'Actualizar estatus de orden',
  configurar_datos_terminal: 'Configurar datos terminal',
  configurar_funciones_terminal: 'Configurar funciones de terminal',
  configurar_impresora: 'Configurar impresora e impresion',
  configurar_huella_digital: 'Configuracion de huella digital',
  configurar_numero_terminal: 'Configurar numero terminal nombre',
  configurar_iva: 'Configurar IVA e impuesto adicional',
  control_existencias_pos: 'Control de existencias en POS',
  happy_hour: 'Happy Hour',
  modo_operacion: 'Modo de operacion',
  operaciones_adicionales: 'Operaciones adicionales',
  gerente: 'Gerente',
  mesero: 'Mesero',
  repartidor: 'Repartidor',
}

/** Group permissions by category for UI display */
export const PERMISSION_GROUPS = [
  { name: 'Cuentas y Ordenes', keys: ['abrir_cuentas_restaurante', 'abrir_cuentas_llevar', 'abrir_cuentas_domicilio', 'abrir_cuentas_recoger', 'cerrar_cuentas', 'cancelar_ordenes', 'cancelar_facturas', 'cambio_mesa', 'cambio_mesero', 'cambio_forma_pago', 'cambio_tipo_cuenta', 'cambio_personas', 'juntar_mesas', 'liberar_ordenes', 'mesas_por_cobrar', 'ver_todas_cuentas', 'ver_cuentas_propias'] },
  { name: 'Descuentos y Cortesias', keys: ['descuentos_ordenes_pct', 'descuentos_ordenes_monto', 'descuentos_platillos_pct', 'descuentos_platillos_monto', 'platillos_gratis', 'cerrar_cuentas_cortesia', 'platillos_2x1'] },
  { name: 'Impresion', keys: ['imprimir_cuentas', 'reimpresion_preticket', 'registro_comanda'] },
  { name: 'Caja y Finanzas', keys: ['cajero', 'corte_turno', 'corte_x', 'corte_z', 'corte_mesero', 'retiros_programados', 'propinas', 'tipo_cambio', 'vales'] },
  { name: 'Reportes', keys: ['ventas_mesero', 'ventas_globales', 'reportes'] },
  { name: 'Configuracion', keys: ['abrir_dia_operaciones', 'administrar_cliente', 'borrar_platillos', 'actualizar_informacion', 'actualizar_estatus_orden', 'configurar_datos_terminal', 'configurar_funciones_terminal', 'configurar_impresora', 'configurar_huella_digital', 'configurar_numero_terminal', 'configurar_iva', 'control_existencias_pos', 'happy_hour', 'modo_operacion', 'operaciones_adicionales'] },
  { name: 'Roles', keys: ['gerente', 'mesero', 'repartidor'] },
] as const
