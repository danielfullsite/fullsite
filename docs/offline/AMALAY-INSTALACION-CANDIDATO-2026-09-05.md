# AMALAY: qué instalar y cómo comprobarlo

Estado: preparación local. AMALAY no está operando según Daniel; eso permite programar pruebas, pero no demuestra que sus turnos, cobros o colas anteriores estén vacíos. No se ha instalado este candidato ni aplicado su migración allí.

## Qué lleva cada equipo

| Equipo | Paquete y función |
| --- | --- |
| Caja principal | Fullsite POS para Windows x64, rol `server_pos`. Incluye Pedro, almacenamiento durable, impresión y código de la interfaz para arrancar sin internet. Es la única computadora que confirma la operación de la sucursal. |
| Otros puntos de venta | Fullsite POS de la misma publicación, rol `pos`. Su Pedro local se conecta con la IP y puerto de Caja. Cada terminal conserva su identidad; no se clona el directorio de datos de Caja. |
| Pantallas de cocina/barra | Fullsite KDS de la misma publicación, rol `kds`, con su estación y enlace a Caja. Cocina conserva preparación pendiente aunque el cliente ya haya pagado. |
| Nube | Migraciones de cuentas y materialización, con respaldo, ensayo y transición del escritor por sucursal. Una actualización de la página no sustituye estas instalaciones. |

No se requiere instalar Node, PostgreSQL o un servidor Next en el restaurante para ejecutar estos paquetes. Electron incorpora el runtime; PostgreSQL sigue en la nube. Los drivers de impresoras y dispositivos existentes deben verificarse en Windows.

## Orden de trabajo en el restaurante

1. Entrar a Windows o a su escritorio remoto y registrar equipos, versión, arquitectura, IP de Caja, puerto, impresoras y módulos utilizados. El PIN de Fullsite sólo autoriza operaciones dentro del producto.
2. Cerrar Fullsite de forma controlada y respaldar su directorio real `userData`, configuración, impresoras, eventos, cola de impresión y datos de navegador. Conservar el instalador anterior. No desinstalar borrando perfiles ni clonar identidad de terminal.
3. Conciliar órdenes, turnos, pagos y colas antiguas con sus registros en nube. Documentar secuencia y hash iniciales. No activar la nueva autoridad sobre una cuenta antigua sin migración explícita.
4. Instalar el candidato compatible en todos los equipos del ensayo. Comprobar restaurante, sucursal, identidad única, secretos LAN, IP/puerto y rol. Preparar catálogo completo, PIN autorizados, estaciones y rutas de impresión mientras haya conexión.
5. Aplicar la transición coordinada de sucursal descrita en el contrato de materialización. Instalar el binario mantiene `localAuthorityEnabled` desactivado hasta ese paso; activar sólo un equipo y conservar otros escritores no es una transición válida.
6. Hacer el servicio de prueba siguiente, registrar resultados y comprobarlos en tablas de negocio al reconectar. Habilitar operación cuando pasen también los módulos realmente utilizados por AMALAY.

## Prueba de aceptación

- Caja abre turno; POS2 guarda una cuenta; POS3 la abre con los mismos productos, importe e ID y agrega una ronda.
- Cocina/barra reciben exclusivamente lo enviado, en sus pantallas e impresoras correctas. Verificar ticket físico, copias y caracteres.
- Cambiar de mesa, anular con permiso, dividir y registrar pagos parciales. Repetir un intento cuya respuesta se perdió y comprobar que no duplica cobro ni comanda.
- Quitar sólo internet manteniendo LAN. Continuar el recorrido y reiniciar una terminal para comprobar el arranque offline con PIN y catálogo preparados.
- Detener Caja. Los POS conservan borradores y muestran la interrupción; no permiten confirmar envíos, cobros, división o traslados. Recuperar Caja y comprobar cuenta y saldo.
- Pagar antes de preparar conserva comida en cocina; entregar antes de cobrar conserva deuda. Cerrar con fondo, ventas, efectivo contado y diferencia explicable.
- Recuperar internet y comparar orden, cuentas, intentos de pago, turno y recibos de nube. Una cola shadow vacía no demuestra conciliación económica.

## Lo que todavía impide llamarlo producto cerrado

El perfil local implementado cubre captura, rondas, cambio de mesa, anulación anterior al cobro, cocina, división en partes iguales, efectivo parcial y cierre contado básico. Aún no cubre como operación local completa propinas, tarjeta/proveedor, descuentos/cortesías, transferencia individual de consumo, cambios después de abrir cuentas financieras, retiros/depósitos, recibo/cajón del nuevo cobro ni X/Z con esos movimientos.

Inventario y reportes legacy necesitan integrar los resultados nuevos: una orden pagada ya no usa preparación como indicador de liquidación. Hardware, Windows ejecutando el servicio, instalación/rollback y acceso a los equipos de AMALAY siguen pendientes de aceptación. Los ensayos locales usan datos sintéticos.

Un instalador técnico construido con configuración sintética sirve para verificar empaquetado, no para conectar AMALAY. La publicación destinada al restaurante debe incluir configuración pública correcta, identidad de versión y hashes revisados, sin PIN ni credenciales privadas. El formato durable nuevo no admite volver al binario antiguo conservando el mismo log sin una migración validada.

## Contratos para ejecutar la transición

- [Operaciones, impresión y cierre](../architecture/OPERATIONAL-COMMANDS-2026-09-05.md).
- [Materialización y barrera de escritura cloud](../architecture/CAJA-CLOUD-MATERIALIZATION-2026-09-05.md).
- [Interfaz instalada para arranque offline](../architecture/OFFLINE-UI-PACKAGE-2026-09-05.md).
- [Construcción del candidato Windows](../architecture/WINDOWS-CANDIDATE-PACKAGING-2026-09-05.md).
