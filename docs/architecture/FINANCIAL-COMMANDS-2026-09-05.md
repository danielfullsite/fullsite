# Cuentas y pagos durables en Caja

Estado: paquete T7 del candidato de cierre. No activa por sí solo autoridad en producción ni sustituye la validación bancaria. Reglas de producto: [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md); persistencia: [comandos durables](DURABLE-COMMANDS-2026-09-05.md).

Actualización del 8 de septiembre: efectivo, tarjeta independiente y transferencia verificada, propina separada, consumo adicional conservando pagos, corte X y cierre contado conectados con Caja; materializador probado con PostgreSQL local. Ver [operaciones](OPERATIONAL-COMMANDS-2026-09-05.md), [paquete](OFFLINE-UI-PACKAGE-2026-09-05.md) y [materialización](CAJA-CLOUD-MATERIALIZATION-2026-09-05.md). Reembolsos, cancelación financiera, descuentos, movimientos de efectivo, integración bancaria y aceptación de campo siguen abiertos.

## Contrato para POS, Caja y materializador

Cada request conserva `command_type`, `command_id`, `order_id` y `expected_revision`. Todos los importes del contrato son **centavos enteros seguros**, positivos para totales e intentos. Moneda inicial: `MXN`. No se convierte `NaN`, strings, infinito, fracciones ni totales ausentes a cero.

| Comando | Campos adicionales | Resultado |
|---|---|---|
| `FINANCIAL_OPEN` | `turno_id`, `expected_order_revision`, `total_cents`, `currency: 'MXN'`; revisión financiera inicial `0` | Verifica orden guardada, todos sus consumos enviados a cocina, total exacto, revisión operativa y turno actual. Crea cuenta estable `${order_id}:full`. |
| `FINANCIAL_SPLIT` | `accounts: [{account_id, total_cents, label?}]` | Guarda **todas** las cuentas de una vez. La suma debe ser exacta. Sólo antes del primer intento de pago. |
| `FINANCIAL_PAYMENT_START` | `payment_id`, `account_id`, `amount_cents`, `method: 'cash'|'manual'|'external'`, `tip_cents` opcional; `tender: 'card'|'transfer'` si manual; `provider` si integrado | Guarda intento pendiente y reserva el importe antes de recibir dinero o llamar al proveedor. No suma como pagado. |
| `FINANCIAL_PAYMENT_RESULT` | `payment_id`, `status: 'accepted'|'rejected'|'unknown'`, `evidence` | Aceptado aplica dinero; rechazado libera reserva; desconocido mantiene reserva y saldo impago hasta conciliar. |

La revisión financiera es independiente de `order_revision`. La orden madre mantiene su identidad; dividir nunca reemplaza su ID con el de una cuenta. Una cuenta pendiente/resultado desconocido reserva saldo: otra terminal no puede iniciar un segundo cobro por ese mismo importe. Cambios concurrentes de revisión requieren recargar, sin repetición silenciosa de un pago nuevo.

`event.payload` conserva el request original. `event.result.financial_order` contiene:

```text
order_id, turno_id, currency, revision, order_revision,
total_cents, paid_cents, reserved_cents, balance_cents, tip_cents, reserved_tip_cents,
status: open|settled, settled_at?,
accounts: [{account_id, total_cents, paid_cents, reserved_cents, balance_cents, label?}],
payments: [{payment_id, account_id, amount_cents, method, status,
            provider?, tender?, tip_cents?, evidence?, change_cents?,
            created_at?, resolved_at?, accepted_at?}]
```

El evento y ese resultado se confirman juntos. Un reintento por `command_id` obtiene el **resultado original**; no reevalúa el request contra una revisión posterior. Repetir `payment_id` mediante otro command ID no vuelve a aplicar dinero: contenido idéntico devuelve el intento conocido, contenido diferente falla. El mismo ID de pago no puede pertenecer a dos órdenes; una misma referencia de autorización externa no puede pagar dos intentos.

## Apertura y pertenencia de la cuenta

El candidato exige que cada renglón guardado tenga `sent_quantity === cantidad`, con ambas cantidades enteras válidas, antes de `FINANCIAL_OPEN`. El detalle ausente, ilegible o parcialmente enviado produce `ORDER_SEND_REQUIRED` sin crear cuentas ni bloquear consumos. La pantalla muestra el motivo y deshabilita Preparar cuenta para cobrar. Basta con enviar: se permite cobrar mientras cocina aún prepara o entrega, conservando separados ambos estados.

El runtime comprueba la sesión y el permiso de cada comando. Además, el dominio financiero aplica la misma pertenencia que órdenes: un actor distinto de `created_by` requiere `ver_todas_cuentas`. Esto también cubre dividir, reservar y resolver pagos, incluidos intentos repetidos bajo un comando nuevo. Los perfiles autorizados de Caja conservan acceso transversal; un mesero no puede preparar ni alterar cuentas ajenas.

Verificación específica: `financial-open-policy.test.js` (7 escenarios) y `financial-open-policy.dom.test.ts` (4 escenarios, incluido el modal real). No abre cuentas financieras antes del envío ni amplía los ajustes posteriores a cobros.

## Evidencias de resultado

- Efectivo aceptado: `{kind:'cash_received', received_by, received_cents}`. La cantidad recibida cubre consumo más propina; el cambio queda registrado separadamente en `change_cents` y nunca se suma a la venta.
- Efectivo rechazado/desconocido: `{kind:'operator_record', recorded_by, reason}`.
- Tarjeta independiente/transferencia: `{kind:'manual_received', received_by, source, reference, tender, currency:'MXN', amount_cents}`. Requiere terminal/banco, referencia y cantidad bruta exacta (consumo + propina). Es una declaración del operador autenticado, no una autorización obtenida del banco. Una misma referencia de terminal/banco y medio, sin diferencias de mayúsculas o espacios exteriores, no se puede reutilizar en otro pago del turno. Rechazo/desconocido exige motivo y autor; desconocido sólo lo concilia un encargado.
- Externo integrado: `{kind:'provider_result', provider, reference, currency:'MXN', amount_cents, status}`. Proveedor, importe bruto con propina, moneda y estado deben coincidir con el intento reservado.

**Validar esa estructura no prueba autenticidad del banco.** La integración de actor/permisos y el adaptador confiable deben derivar identidades de sesión y entregar resultados externos; un body del POS no equivale a confirmación bancaria. Permisos comprobados por el contexto autenticado del servidor: `pos.accounts.manage`, `pos.payments.collect`, `pos.payments.reconcile` y `pos.payments.external_result` reservado al adaptador.

## Proyección y concurrencia

`CommandHandler` serializa lectura, validación, commit y aplicación de **todos** los comandos. El módulo puro `FinancialDomain` prepara el resultado desde `state.getFinancialOrders()`, `state.getOrder(order_id)` y `state.getTurno()`.

`RestaurantState` proyecta los eventos `FINANCIAL_*` desde `event.result.financial_order`; incluye `financial_orders` en snapshot e hidratación, junto con `getFinancialOrder` y `getFinancialOrders`. El salón convierte `balance_cents / 100` a su campo `saldo`, marca pagada sólo al liquidar y mantiene intacta la preparación. El materializador de nube debe consumir el resultado comprometido y devolver su recibo, sin inventar cuentas desde contadores de UI.

Una orden con cuentas durables rechaza `ORDER_CLOSED` como sustituto de pago. `ORDER_SAVE`, `ORDER_SEND` y `ORDER_MOVE` incluyen el resultado financiero en el mismo commit: preservan pagos, actualizan la revisión y redistribuyen únicamente saldo no pagado. No se editan mientras exista reserva o después de liquidar. La cancelación financiera sigue bloqueada. Actualizar únicamente preparación sigue permitido. Cambiar/cerrar turno con deuda o reservas pendientes se rechaza. Los resultados financieros **no emiten `ORDER_CLOSED` ni vacían cocina**.

## Límites explícitos de esta entrega

- No incluye conexión bancaria ni confianza criptográfica de proveedor. La autorización de empleados usa el paquete de acceso de Caja. La UI permite efectivo, registro manual de tarjeta/transferencia, propina y división en partes iguales.
- Apertura financiera exige una orden operacional guardada, todo el consumo enviado y un turno coherente. Precios e impuestos provienen del catálogo de Caja; descuentos y ajustes todavía están bloqueados.
- Agregar consumo después de un pago parcial conserva el recibo y la asignación pagada; en cuenta dividida crea o amplía una cuenta de Consumo adicional. Quitar cantidades aún no enviadas sólo reduce asignaciones no pagadas y nunca baja de lo cobrado. No incluye reembolsos, cortesías, reasignación entre órdenes ni cancelación financiera. Los renglones enviados conservan las restricciones operativas.
- Órdenes legacy sin cuenta financiera conservan su ruta anterior hasta el cambio de escritor por sucursal. La nueva autoridad no debe habilitarse parcialmente con otro escritor cloud activo.
- Cocina y dinero son independientes: la prueba de liquidación conserva los productos pendientes. X/Z completo, transición cloud del restaurante, Windows y servicio real continúan como aceptación de producto.

## Verificación local integrada

El manejador exige `context.actor` derivado por el servidor, sesión no vencida y permisos. Ignora identidades/roles enviados en el body. Efectivo exige atribución al empleado autenticado; conciliar un resultado desconocido exige permiso de conciliación. Ningún permiso ordinario de cajero autoriza resultados externos. HTTP y WS conectan este contexto con la [autoridad de PIN en Caja](ACTOR-AUTHORITY-2026-09-05.md), también utilizada por la UI de pago.

Pruebas de la entrega inicial: **369/369** del servidor; **20** del dominio/runtime financiero. Casos adicionales reproducidos y corregidos: revisión operativa ausente aceptada como cero; descuentos y cambio de turno/revisión por una edición legacy después de definir cuentas; preparación con metadatos legítimos rechazada después de abrir cuentas; un snapshot cloud atrasado que cambiaba el turno y dejaba inaccesible un pago parcial local. La proyección conserva el turno con deuda/reservas pendientes frente a ese snapshot. No se aplicó migración ni se conectó banco alguno.

## Consumo, propina y corte (8 de septiembre)

`amount_cents` mide sólo venta. `tip_cents` queda fuera del saldo y del ingreso por consumo. El cajón esperado incluye propinas recibidas en efectivo; tarjeta y transferencia no incrementan efectivo. Las fechas de creación, resolución y aceptación se generan en Caja, no en la pantalla. La materialización actualiza `pos_orders.updated_at` con el evento para descubrir pagos recibidos después del día de creación de la orden.

Los reintentos conservan método, medio, importe, propina, cuenta e identidad. El materializador rechaza cambiar esos campos, quitar historial o aplicar una edición operativa sin su resultado financiero acoplado. Error en cualquier parte revierte orden, cuenta, pago, recibo y avance de stream juntos.

Verificación nueva: `manual-payments-rebase.test.js` (5 escenarios de runtime con log durable y reinicio) y `run-materializador-local.cjs` (14 escenarios, incluidos tarjeta, transferencia, propina, consumo adicional y rollback acoplado). Son pruebas con datos sintéticos, no aceptación de AMALAY ni aplicación de migraciones remotas.
