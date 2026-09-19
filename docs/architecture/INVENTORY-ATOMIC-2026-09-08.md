# Inventario manual transaccional — H08

Estado: candidato local del 8 de septiembre de 2026. La migración está pendiente;
no se aplicó a bases remotas y no cambia la operación de Wansoft.

## Contrato y autoridad

`dashboard-app/src/lib/inventory.ts::recordMovement()` conserva la interfaz de
sus ocho consumidores actuales. Envía una sola petición autenticada a
`POST /api/pos/inventory-movement`; esa ruta usa `withPOSAuth` para resolver el
restaurante y la identidad, exige gerente/admin/dueño, y llama por `fetch` a
PostgREST `rpc/record_inventory_movement_atomic`. No usa el SDK ni recurre a
INSERT/PATCH separados si falta la migración o falla la red.

RPC: `public.record_inventory_movement_atomic(p_request jsonb, p_actor jsonb)`.
Solamente `service_role` puede ejecutarlo. La ruta construye `p_actor` con
`client_id`, `id`, `name`, `role`, `auth_type` desde la autenticación validada.
`p_request.actor` es una etiqueta de interfaz; nunca autoriza ni sustituye al
empleado autenticado. El body que pide otro restaurante se rechaza. El cliente
declara también la identidad que está viendo; debe coincidir con la autenticada
antes de escribir, para rechazar sesiones mezcladas de cookie y navegador.

Movimientos manuales admitidos: `entry`, `invoice_entry`, `restock`, `waste`,
`adjustment`, `return`. Entradas positivas, mermas/devoluciones negativas y
ajustes con signo explícito. `deduction` necesita un recibo de venta; `reversal`
necesita su origen y transferencias requieren dos patas. Esos tipos todavía no
tienen consumidores de `recordMovement` y se rechazan en esta frontera manual.

La RPC escribe exclusivamente:

- `pos_inventory_movements`: una fila por línea, vinculada a operación y número
  de línea, identidad auditada y nota de la línea.
- `pos_inventory`: existencias y fechas de las claves restaurante/ingrediente.
- `pos_ingredients.cost_per_unit`: costo promedio ponderado de entradas con
  precio positivo; precio omitido/cero conserva el costo vigente.
- `pos_inventory_operation_receipts`: petición exacta, actor y recibo completos.

No escribe órdenes, saldos, pagos, turnos ni autoridad de Caja. Inventario manual
puede operar con un escritor Caja activo; eso no modifica ni evade la cerca de
órdenes. No integra todavía el consumo automático por venta.

## Atomicidad, concurrencia e idempotencia

Todo sucede en la transacción de la RPC. La clave es única por
`(client_id, idempotency_key)` con igualdad exacta. La RPC serializa la clave y
bloquea ingredientes en orden estable antes de actualizar las existencias.
Líneas repetidas del mismo ingrediente usan el resultado de la anterior. Una
salida superior a las existencias revierte la operación completa; no se registra
un consumo ficticio ni se trunca el stock a cero.

El promedio se calcula con `numeric` de PostgreSQL y se conserva a 12 decimales.
Cada recibo incluye cantidad, stock/costo antes y después y el ID de movimiento
por línea. Un fallo al actualizar stock/costo o insertar el recibo revierte
también el ledger. Los huecos de secuencia por rollback son normales.

La repetición exacta devuelve el recibo original con `was_duplicate=true`, sin
aplicar existencias otra vez. La misma clave con otra petición o identidad
devuelve `INVENTORY_IDEMPOTENCY_CONFLICT`. Los contadores del recibo describen
la operación confirmada original, incluso en una repetición. No significan
filas nuevas insertadas por ese intento HTTP.

Para entradas con `metadata.cfdi_uuid`, la base reserva también
`(client_id, source_document_key)` con el UUID normalizado. Importar ese CFDI
por otra pantalla, empleado, formato de clave o uso de mayúsculas devuelve
`INVENTORY_SOURCE_ALREADY_RECORDED`; no añade existencias otra vez. Esto
protege entradas registradas por H08. Antes del corte deben conciliarse los
CFDI históricos ingresados por las rutas anteriores; no se inventan recibos
transaccionales para esos movimientos legados.

Recibo versión 1: `committed`, `operation_id`, `client_id`, `idempotency_key`,
`request_echo`, `actor`, `stock_scope`, `movements_created`, `stock_updates`,
`cost_updates`, `was_duplicate`, `details`. Ruta y cliente verifican la petición
exacta, identidades, números de filas, continuidad de stock y promedio de costo.
Un HTTP 200 con `ok:true`, respuesta incompleta o recibo ajeno no es éxito.

Un timeout puede ocurrir después de COMMIT. Antes de enviar, el cliente conserva
la petición completa en una transacción IndexedDB. La partición incluye
restaurante, tipo de autenticación e ID del empleado; no guarda tokens/PIN.
Las claims del token sólo eligen esa partición local: el servidor sigue
verificando la identidad. Dos pestañas no pueden reemplazar una petición
pendiente por otra. Si falla la persistencia previa, no se envía el movimiento.

El nuevo clic o recarga con el mismo contenido reutiliza la petición y clave
originales, aunque el formulario genere otro timestamp. Renovar el token del
mismo empleado tampoco pierde el pendiente. Un recibo exacto o rechazo
confirmado de la base libera el intento. Un rechazo de autenticación posterior
a un resultado ambiguo no demuestra que el intento anterior no haya hecho
COMMIT; por eso conserva el pendiente.

Si el formulario cambia mientras hay un pendiente, el cliente sólo consulta
`POST /api/pos/inventory-movement?receipt_only=true`, que llama a
`get_inventory_movement_receipt(p_request,p_actor)`. Esa RPC usa el mismo lock
de clave para observar la transacción anterior y no modifica stock. Encontrar
su recibo libera el pendiente e informa que la operación anterior se confirmó;
la nueva requiere revisar existencias y volver a pulsar Guardar. No se ejecuta
ninguno de los dos contenidos como efecto de esa consulta. Si no existe
recibo, no se asume cancelación: una petición antigua todavía puede llegar.
Se conserva la petición hasta resolver el intento original exacto. La
recuperación no transforma una edición del formulario en un reenvío oculto.

Los registros H08 del ledger no pueden editarse/borrarse. Un trigger impide
que los permisos REST legados inserten una fila falsa vinculada al recibo; no
usa marcadores de transacción que un cliente pueda falsificar. La tabla de
recibos no concede acceso directo a `anon`, `authenticated` ni `service_role`.
Las escrituras REST legadas ajenas a H08 y el cierre global de sus permisos son
el alcance de H09; proteger recibos H08 no afirma que todas esas rutas estén
cerradas.

## Alcance físico y conexión

El esquema vigente tiene UNIQUE `(client_id, ingredient_id)` y carece de stock
por sucursal/almacén. Por eso el recibo declara `stock_scope: tenant`.
`location_id`, si se proporciona, se valida contra una sucursal activa de ese
restaurante y se guarda como procedencia. `metadata.warehouse` es descriptivo;
no crea un saldo separado. Multi almacén y transferencias requieren otro
contrato y migración, no pueden declararse resueltos por esta RPC.

Esta frontera de inventario manual requiere conexión con el servicio cloud.
El POS por LAN, su cobro local y el stock manual cloud son alcances diferentes;
la pérdida de internet no convierte una petición de inventario en confirmada.

## Pruebas y aplicación

Migración nueva:
`supabase/migrations/PENDIENTE_20260908010000_inventory_movement_atomic.sql`.
Preparar y revisar en sandbox antes de aplicarla junto con los permisos H09 y
la ruta. No hay aplicación automática, cambio de fuente Wansoft ni activación
de consumo de venta.

Laboratorio reproducible (sólo crea y elimina su propio PostgreSQL temporal):

```sh
FULLSITE_TEST_PG_BIN=/opt/homebrew/opt/postgresql@16/bin node electron-app/lab/run-inventory-atomic-local.cjs
```

El laboratorio usa las definiciones de tablas del baseline real y las
migraciones pendientes de Caja/H08. Prueba fallos después de stock y al insertar
recibo, concurrencia de claves distintas y repetidas, orden de locks, reinicio
real de PostgreSQL, aislamiento de actor/restaurante/sucursal, underflow,
claves por igualdad, consulta de recibo sin mutación, duplicidad de CFDI entre
pantallas, ledger inmutable y convivencia con la cerca Caja activa.
Evidencia: `output/closure/inventory-atomic/result.json` y
`receipt-example.json`, exclusivamente sintéticos.

Pruebas de cliente/ruta:

```sh
cd dashboard-app
node node_modules/vitest/vitest.mjs run src/__tests__/inventory-atomic.test.ts src/__tests__/inventory-movement-route.test.ts
```

Resultado local final: PostgreSQL **17/17**; cliente/ruta H08 **40/40**;
regresión de inventario **150/150** en siete archivos. `tsc --noEmit` pasó con
el runtime de dependencias privado preparado por el proceso de cierre.
