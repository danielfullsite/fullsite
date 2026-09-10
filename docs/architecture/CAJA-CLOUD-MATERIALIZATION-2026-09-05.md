# Materialización de Caja en la nube

Estado: candidato local. SQL pendiente, ninguna sucursal activada y ninguna escritura remota. Amplía el [contrato financiero](FINANCIAL-COMMANDS-2026-09-05.md) y conserva la separación entre cobro y preparación del producto.

## Qué demuestra el recibo

El outbox anterior sólo copiaba `payload` a `pos_local_events`, sin `event.result`. Confirmar esa copia no demostraba que existieran orden, cuentas o pagos en las tablas de negocio. Su unicidad por restaurante y secuencia tampoco distinguía dos sucursales o una Caja reinstalada.

El nuevo `BusinessOutbox` lee el log comprometido de Caja y envía una secuencia de negocio independiente del indicador `synced` de shadow. Incluye ID, secuencia, tipo, fecha, identidad de origen, payload original y **resultado completo comprometido**. Omite metadatos de sincronización y bytes de impresión. No reconstruye precios o dinero desde el request del navegador.

La RPC `apply_pos_caja_event` escribe una proyección y su recibo dentro de **una transacción PostgreSQL**. Si falla una restricción, se revierten recibo, progreso y cambios de negocio. Una respuesta perdida después del commit se resuelve comparando el evento original, sin ejecutar otra venta. Un 200 sin el recibo exacto no avanza el archivo local.

## Tablas y estados

| Tabla | Resultado que recibe |
| --- | --- |
| `pos_turnos` | Turno abierto y cierre contado, sucursal explícita y snapshot completo. Los importes de cierre provienen de `closed_turno`. |
| `pos_orders` | Consumo completo, importes en centavos convertidos a pesos, revisión operativa y cocina por producto/ronda. Snapshots operacional y financiero conservados separados. |
| `pos_order_accounts` | Todas las cuentas del split desde que se define, con identidad explícita y snapshot. |
| `pos_cash_movements` | Retiros y depósitos durables de Caja, identidad de movimiento y autorización de empleado verificadas; replay no duplica el ledger. |
| `pos_payment_attempts` | Intentos pendientes, desconocidos, aceptados y rechazados; evidencia y cambio en el snapshot. Sólo aceptados suman al pago. |
| `pos_caja_streams` | Sucursal, stream, Caja, credencial hasheada, punto inicial y progreso de la secuencia. |
| `pos_caja_business_receipts` | Evento inmutable, hashes de historial, transacción y recibo de proyección. |

Liquidar actualiza `payment_status` y `saldo`; no cambia `status` de preparación, `closed_at` ni productos pendientes de cocina. La cocina confirma por separado `KITCHEN_SET`. No se inserta un cierre legacy para simular que el plato ya se entregó. Las filas nuevas están ligadas al stream y rechazan apropiación de IDs existentes de otra sucursal, otro restaurante o una instalación legacy.

La migración nueva depende de `PENDIENTE_20260904000000_cuentas_divididas_modelo_durable.sql`; amplía ese esquema con sucursal, snapshots, RLS y estado desconocido. Los comentarios históricos de la migración anterior sobre cerrar cocina al liquidar no son la política vigente. No se modifica historia de pagos legacy ni se deducen cuentas del sufijo de un ID.

## Una sola autoridad de escritura

El fence de base de datos protege órdenes, turnos, cuentas, intentos, cierres y movimientos de caja. Rechaza escrituras legacy, incluso a través de APIs con service role. Sólo permite las escrituras de una RPC que ya registró su recibo **en la transacción actual**, con la misma sucursal y stream. Un marcador de sesión inventado o un recibo de una transacción anterior no basta. Cambiar o vaciar `location_id` tampoco permite escapar de la protección. Retiros y depósitos usan `CASH_MOVEMENT`, con permiso `retiros_programados`, importe positivo en centavos, motivo, turno abierto e identidad durable. El efectivo esperado incluye depósitos menos retiros; no se permite retirar más del efectivo esperado.

`writer_authority` mantiene el fence; `active` controla la credencial de sincronización. Son independientes: **revocar sincronización no vuelve a habilitar un escritor legacy**. Sólo hay un stream con autoridad por restaurante y sucursal. Las tablas de control no tienen lectura o escritura pública, y la RPC valida una credencial dedicada de Caja de al menos 32 caracteres aleatorios. No acepta PIN, shiftToken de empleado ni secreto LAN como credencial de nube.

En Electron, `localAuthorityEnabled` es opt-in explícito en config; no se activa por instalar una versión. En ese modo se apaga el poll operacional de Supabase. El worker sólo arranca para rol `server_pos`, sin Caja ascendente y con configuración de sincronización explícita. La credencial permanece en main, fuera de la identidad enviada al renderer.

## Historial y recuperación

La secuencia pertenece a un stream de una sucursal. Cada evento deriva un hash del prefijo anterior y del sobre de negocio canónico. Antes de usar un checkpoint, el worker verifica el prefijo del log local y el punto inicial acordado. Un archivo restaurado con historial diferente o con secuencias faltantes no puede saltarse eventos mediante un cursor antiguo.

El servidor exige la siguiente secuencia y el hash anterior exactos. Ante un reintento compara todo el evento y ambos hashes. Reutilizar un ID con contenido distinto, dentro del stream o en otro stream de la misma sucursal, se rechaza. No se avanza sobre gaps, resultados inválidos o eventos de negocio desconocidos.

`STATE_SYNC`, locks y solicitudes de impresión pueden tener recibo de transporte con `materialized:false`; no se cuentan como ventas. Los eventos legacy que mutan órdenes se rechazan después del punto inicial, en vez de mezclarlos silenciosamente con resultados de Caja.

El checkpoint `business-sync-checkpoint.json` se escribe mediante reemplazo durable después del recibo; no contiene credenciales. `/sync/status` requiere credencial LAN y los secundarios consultan la situación de Caja. Expone secuencia confirmada, pendientes y error; no declara que shadow equivalga a negocio.

## Transición por sucursal

Antes de activar una instalación se necesita:

1. Instalar y revisar el esquema en sandbox, con las políticas y triggers reales del destino. Esta prueba usa definiciones canónicas de las tablas, pero no carga todos los triggers y funciones de inventario del proyecto completo.
2. Detener temporalmente los escritores legacy y conciliar turno, órdenes abiertas, intentos de pago y colas de los navegadores. Una Caja sin servicio no implica que no queden colas pendientes. El punto inicial del log debe documentarse con secuencia y hash; cero sólo corresponde a un stream nuevo sin historia a importar.
3. Crear administrativamente un stream de la sucursal y una credencial aleatoria exclusiva de Caja, inicialmente sin autoridad. Verificar enrolamiento, restaurante, sucursal y terminal; preparar un respaldo y evidencia de conciliación.
4. Activar fence y credencial en una transacción controlada, instalar config `localAuthorityEnabled:true` y `business_sync` en Caja, y reiniciar todas las terminales con el mismo candidato. No hay adopción automática de órdenes legacy: requieren una migración explícita antes de continuar.
5. Verificar una operación completa en las tablas y su recibo, cortar WAN, operar, reconectar y comparar Caja/nube. Para rollback, detener escritores, drenar o conciliar todo lo pendiente y cambiar la autoridad mediante otro corte coordinado. Cambiar sólo un flag no es un rollback seguro.

`business_sync` contiene `stream_id`, `credential`, `baseline_sequence` y `baseline_history_hash`. La sucursal y el restaurante se toman de la instalación. El worker usa HTTPS a `/api/pos/caja/materialize` de app.fullsite.mx (override administrativo `materialize_url`). Esa ruta invoca únicamente `apply_pos_caja_event` con la service key del servidor; la RPC valida la credencial exclusiva del stream antes de cualquier efecto. La terminal no recibe service key y no invoca la RPC con anon. El límite HTTP permite el presupuesto SQL de 4 MiB más el sobre de transporte. Ninguna de estas filas se crea automáticamente al iniciar el POS.

## Verificación reproducible

`node electron-app/lab/run-materializador-local.cjs` crea su propio clúster PostgreSQL en loopback con puerto libre, usa las definiciones `pos_orders`, `pos_turnos` y `pos_cash_movements` del baseline, aplica ambas migraciones pendientes y lo elimina al terminar. Requiere PostgreSQL disponible mediante `pg_config`, o `FULLSITE_TEST_PG_BIN` con su carpeta de binarios. No acepta una URL remota ni modifica servidores existentes.

El laboratorio genera eventos mediante **CommandHandler y NDJSON reales**. Ejecuta la función SQL real bajo rol service_role, igual que la ruta fija del servidor; simula pérdida de la respuesta después de un commit PostgreSQL confirmado. Verifica orden de eventos, credencial, retry, historial alterado, restauración, fence, sucursales, rollback transaccional, reserva desconocida, pago total sin retirar cocina y cierre contado después de entrega. Las pruebas de worker ejercitan HTTP loopback, rechazo de recibo falso, coalescencia y diagnóstico autenticado.

Evidencia local actualizada: 12 recorridos PostgreSQL (incluye retiro, depósito, replay y Z neto) y 15 pruebas de worker más outbox shadow. Resultados y logs en `output/closure/materializer`. Esto no certifica el transporte PostgREST desplegado, migración en AMALAY ni aceptación del hardware.

## Lo que este recibo no cierra

El materializador cubre órdenes, cuentas, intentos, turnos y movimientos de efectivo. **No confirma consumo de inventario**, receta ni food cost. Los contadores de conciliación de inventario no se adelantan. Hace falta conectar el módulo canónico de inventario mediante su propia evidencia sin permitir que vuelva a escribir órdenes por una ruta legacy fuera del fence.

Los reportes que filtran únicamente `status=cerrada` deben adaptarse a `payment_status=pagada` y al modelo de cuentas: cambiar preparación para satisfacer ese filtro rompería la decisión de producto. Propinas, descuentos, reembolsos, promociones y resultados de terminal bancaria requieren sus resultados de dominio completos; no se inventan desde totales legacy. Tampoco se publica una página ni se activa ninguna instalación al aplicar este cambio de código.
