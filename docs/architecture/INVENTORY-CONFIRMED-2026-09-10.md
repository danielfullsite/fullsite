# Inventario confirmado, candidato 10 de septiembre

## Movimientos manuales

`inventory.ts:recordMovement` conserva el contrato de request/result; invoca una
sola operación autenticada en `/api/pos/inventory/movement`. El servidor verifica
gerente y tenant, y sustituye actor por la identidad verificada. El RPC
`pos_record_inventory_movement` compromete recibo de operación, cada renglón del
ledger, existencias y costo promedio dentro de una transacción. La misma clave
con otro contenido se rechaza. Ingredientes repetidos de una factura se procesan
en su secuencia original; los locks se adquieren en orden determinístico.

La recuperación del navegador conserva el request antes de enviarlo. Una respuesta
perdida no permite reconstruir diferencias contra un saldo que ya pudo cambiar.
No se considera éxito la sola existencia de un ledger legacy sin recibo atómico.

## Consumo por venta

`/api/pos/inventory/reconcile` acepta sólo order_id; restaurante viene de la sesión.
`inventory-reconcile-server.ts` ejecuta `r1_reconcile_order`, que bloquea y lee la
orden comprometida. R1 conserva receta/stock fijados, consumo aplicado, revisión
de mutación y referencia del ledger. La autoridad `r1` y clasificación explícita
siguen siendo requisitos: no se cambia configuración ni se aproxima por nombre.

Cancelar un artículo sin preparar guarda `inventory_disposition=return_stock`.
Cancelar uno preparado guarda `retain_consumption`: el consumo físico permanece
aunque el renglón se retire después del ticket. La disposición no especificada
mantiene conciliación pendiente; nunca autoriza devolución especulativa. Reportar
la merma y su causa requiere conservar también la evidencia de cancelación.

Transferencia mueve el mismo registro de conciliación a la cuenta destino dentro
de la transacción de ambas cuentas; mantiene su PK, receta fijada y referencias
de movimientos. Reconciliar origen y destino no revierte ni vuelve a consumir.

Errores de red, RPC ausente y clasificaciones bloqueadas dejan inventario pendiente.
La venta/cancelación ya confirmada no se deshace por ese resultado. La interfaz
ofrece reintento por identidad de orden sin enviar cantidades o ingredientes.

La anulación completa también exige disposición por renglón. Un estado
`cancelada` o una lista vacía no prueban devolución física: si el historial
contiene consumo sin disposición, la transacción de conciliación falla y
conserva stock y revisión completa anteriores. `retain_consumption` permanece
consumido aun al retirar el renglón; `return_stock` revierte sólo el consumo
histórico fijado. La pantalla legacy muestra inventario pendiente y ya no llama
al cálculo por recetas actuales ni escribe existencias directamente al anular.
La entrada de compatibilidad `reverseIngredientDeduction` sólo solicita R1 por
identidad de orden y rechaza el resultado pendiente. Sigue faltando el flujo
de autorización/captura de disposición para la anulación completa.

## Despliegue y evidencia

Migraciones 20260910050000 y 20260910060000 permanecen PENDIENTES, junto con la
transferencia 20260910010000 modificada. Deben instalarse de forma coordinada con
los handlers en el entorno de validación antes de producción.

Laboratorios aislados: `run-inventory-movement-local.cjs` y
`run-inventory-reconcile-local.cjs`, con tablas y funciones extraídas del baseline.
El segundo prueba consumo, retry concurrente de cancelación, receta histórica,
datos malformados, tenant/roles, clasificación bloqueada, transferencia y
retención del consumo preparado después de retirar el artículo del ticket.

Quedan fuera de este cierre parcial la materialización de inventario en autoridad
Caja, disposición de anulaciones legacy completas y conciliación de movimientos
históricos sin recibo. No se declara H08 completo.
