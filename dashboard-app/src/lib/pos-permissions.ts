import permissionContract from '../../../electron-app/local-server/core/permission-profiles.json'

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
export const PERMISSION_PROFILES: Record<string, POSPermissions> = permissionContract.profiles

/**
 * Aliases de rol → perfil. El provisioning y roles.ts usan 'dueño'/'staff'
 * (DashboardRole), pero los perfiles se definieron con 'admin'. Sin este mapeo
 * un dueño recién provisionado caía al perfil de MESERO y no podía ni abrir
 * turno (bloqueo #1 del Minute-0, visto en campo 2026-08-29 con carls-jr).
 */
const ROLE_ALIASES: Record<string, string> = permissionContract.aliases

/** Get permissions for a role. Falls back to mesero if unknown. */
export function getPermissions(role: string): POSPermissions {
  return PERMISSION_PROFILES[role] || PERMISSION_PROFILES[ROLE_ALIASES[role]] || PERMISSION_PROFILES.mesero
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
  actualizar_informacion: 'Actualización de información',
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
