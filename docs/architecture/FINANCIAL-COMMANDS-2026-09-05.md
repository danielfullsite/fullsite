# Cuentas y pagos durables en Caja

Estado: paquete T7 del candidato de cierre. No activa por sí solo autoridad en producción ni sustituye la validación bancaria. Reglas de producto: [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md); persistencia: [comandos durables](DURABLE-COMMANDS-2026-09-05.md).

## Contrato para POS, Caja y materializador

Cada request conserva `command_type`, `command_id`, `order_id` y `expected_revision`. Todos los importes del contrato son **centavos enteros seguros**, positivos para totales e intentos. Moneda inicial: `MXN`. No se convierte `NaN`, strings, infinito, fracciones ni totales ausentes a cero.

| Comando | Campos adicionales | Resultado |
|---|---|---|
| `FINANCIAL_OPEN` | `turno_id`, `expected_order_revision`, `total_cents`, `currency: 'MXN'`; revisión financiera inicial `0` | Verifica orden guardada, total exacto, revisión operativa y turno actual. Crea cuenta estable `${order_id}:full`. |
| `FINANCIAL_SPLIT` | `accounts: [{account_id, total_cents, label?}]` | Guarda **todas** las cuentas de una vez. La suma debe ser exacta. Sólo antes del primer intento de pago. |
| `FINANCIAL_PAYMENT_START` | `payment_id`, `account_id`, `amount_cents`, `method: 'cash'|'external'`, `provider` si externo | Guarda intento pendiente y reserva el importe antes de recibir dinero o llamar al proveedor. No suma como pagado. |
| `FINANCIAL_PAYMENT_RESULT` | `payment_id`, `status: 'accepted'|'rejected'|'unknown'`, `evidence` | Aceptado aplica dinero; rechazado libera reserva; desconocido mantiene reserva y saldo impago hasta conciliar. |

La revisión financiera es independiente de `order_revision`. La orden madre mantiene su identidad; dividir nunca reemplaza su ID con el de una cuenta. Una cuenta pendiente/resultado desconocido reserva saldo: otra terminal no puede iniciar un segundo cobro por ese mismo importe. Cambios concurrentes de revisión requieren recargar, sin repetición silenciosa de un pago nuevo.

`event.payload` conserva el request original. `event.result.financial_order` contiene:

```text
order_id, turno_id, currency, revision, order_revision,
total_cents, paid_cents, reserved_cents, balance_cents,
status: open|settled, settled_at?,
accounts: [{account_id, total_cents, paid_cents, reserved_cents, balance_cents, label?}],
payments: [{payment_id, account_id, amount_cents, method, status,
            provider?, evidence?, change_cents?}]
```

El evento y ese resultado se confirman juntos. Un reintento por `command_id` obtiene el **resultado original**; no reevalúa el request contra una revisión posterior. Repetir `payment_id` mediante otro command ID no vuelve a aplicar dinero: contenido idéntico devuelve el intento conocido, contenido diferente falla. El mismo ID de pago no puede pertenecer a dos órdenes; una misma referencia de autorización externa no puede pagar dos intentos.

## Evidencias de resultado

- Efectivo aceptado: `{kind:'cash_received', received_by, received_cents}`. La cantidad recibida cubre el importe aplicado; el cambio queda registrado separadamente en `change_cents` y nunca se suma a la venta.
- Efectivo rechazado/desconocido: `{kind:'operator_record', recorded_by, reason}`.
- Externo: `{kind:'provider_result', provider, reference, currency:'MXN', amount_cents, status}`. Proveedor, importe, moneda y estado deben coincidir con el intento reservado.

**Validar esa estructura no prueba autenticidad del banco.** La integración de actor/permisos y el adaptador confiable deben derivar identidades de sesión y entregar resultados externos; un body del POS no equivale a confirmación bancaria. Permisos comprobados por el contexto autenticado del servidor: `pos.accounts.manage`, `pos.payments.collect`, `pos.payments.reconcile` y `pos.payments.external_result` reservado al adaptador.

## Proyección y concurrencia

`CommandHandler` serializa lectura, validación, commit y aplicación de **todos** los comandos. El módulo puro `FinancialDomain` prepara el resultado desde `state.getFinancialOrders()`, `state.getOrder(order_id)` y `state.getTurno()`.

`RestaurantState` proyecta los eventos `FINANCIAL_*` desde `event.result.financial_order`; incluye `financial_orders` en snapshot e hidratación, junto con `getFinancialOrder` y `getFinancialOrders`. El salón convierte `balance_cents / 100` a su campo `saldo`, marca pagada sólo al liquidar y mantiene intacta la preparación. El materializador de nube debe consumir el resultado comprometido y devolver su recibo, sin inventar cuentas desde contadores de UI.

Una orden con cuentas durables rechaza `ORDER_CLOSED` como sustituto de pago y bloquea ediciones, cancelaciones o reenvíos que podrían invalidar sus saldos. Actualizar únicamente preparación sigue permitido. Cambiar/cerrar turno con deuda o reservas pendientes se rechaza. Los resultados financieros **no emiten `ORDER_CLOSED` ni vacían cocina**.

## Límites explícitos de esta entrega

- No incluye conexión bancaria ni confianza criptográfica de proveedor. La autorización de empleados se conecta por el paquete de acceso de Caja; la UI financiera todavía requiere integración.
- Apertura financiera exige una orden operacional guardada y un turno coherente. Aún se requiere certificar el cálculo de precios/impuestos/descuentos que produjo ese total.
- No incluye ajustes a cuentas después de iniciar cobros, reembolsos, propina, cortesías, reasignación de consumos ni cancelación financiera. Se bloquean cambios incompatibles; no se corrigen saldos retroactivamente.
- Órdenes legacy sin cuenta financiera conservan su ruta anterior hasta el cambio de escritor por sucursal. La nueva autoridad no debe habilitarse parcialmente con otro escritor cloud activo.
- Cocina y dinero son independientes: la prueba de liquidación conserva los productos pendientes. Turno X/Z completo, UI de pago, migración cloud, Windows y servicio real continúan como aceptación de producto.

## Verificación local integrada

El manejador exige `context.actor` derivado por el servidor, sesión no vencida y permisos. Ignora identidades/roles enviados en el body. Efectivo exige atribución al empleado autenticado; conciliar un resultado desconocido exige permiso de conciliación. Ningún permiso ordinario de cajero autoriza resultados externos. HTTP y WS conectan este contexto con la [autoridad de PIN en Caja](ACTOR-AUTHORITY-2026-09-05.md); la UI de pago sigue pendiente.

Pruebas integradas: **369/369** del servidor; **20** del dominio/runtime financiero. Casos adicionales reproducidos y corregidos: revisión operativa ausente aceptada como cero; descuentos y cambio de turno/revisión por una edición legacy después de definir cuentas; preparación con metadatos legítimos rechazada después de abrir cuentas; un snapshot cloud atrasado que cambiaba el turno y dejaba inaccesible un pago parcial local. La proyección conserva el turno con deuda/reservas pendientes frente a ese snapshot. No se aplicó migración ni se conectó banco alguno.
