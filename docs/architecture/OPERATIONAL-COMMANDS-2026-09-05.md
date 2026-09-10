# Operación autorizada por Caja

Estado: candidato local integrado, no instalado en AMALAY. Complementa [dinero](FINANCIAL-COMMANDS-2026-09-05.md), [durabilidad](DURABLE-COMMANDS-2026-09-05.md) y [UI](OPERATIONAL-UI-CAJA-2026-09-05.md).

## Activación y autoridad

`localAuthorityEnabled:true` es una transición explícita por sucursal. Instalar el binario no activa ese modo. Sólo la Caja sin servidor ascendente prepara resultados; los secundarios reenvían comandos y leen su estado. El snapshot publica `write_authority:caja`. Se desactiva el poll cloud y los eventos de observación legacy no pueden modificar órdenes ni turnos. Un log que ya contiene operaciones de Caja rechaza volver al escritor anterior sin migración validada.

El empleado se autentica en Caja. Cada operación vuelve a comprobar sesión y permiso, incluso al recuperar un recibo. La revisión leída, validación, preparación, commit y proyección se serializan en `CommandHandler`. El navegador envía intención; no decide precios, impuestos, identidad del empleado ni preparación confirmada.

Todos los comandos financieros exigen la transición explícita y una orden cuya autoridad sea Caja. Un mesero sin permiso de ver todas las cuentas no puede abrir, dividir o cobrar la cuenta de otro. Antes de abrir cuentas financieras se exige haber enviado todo el consumo; no se exige haberlo preparado o entregado. Así, tocar Cobrar sobre productos guardados no bloquea su envío posterior.

| Comando | Intención y confirmación |
| --- | --- |
| `TURN_OPEN` | ID único de turno y fondo en centavos; exige permiso y ausencia de turno abierto. |
| `ORDER_SAVE` | ID de cuenta, turno, revisión, catálogo, mesa/nombre, personas, notas y líneas con ID de producto/opciones. Caja calcula precio e IVA desde su catálogo y confirma el consumo. Guardar no crea trabajo en cocina. |
| `ORDER_SEND` | Cuenta y revisión. Confirma sólo las cantidades aún no enviadas, con IDs de ronda y renglón estables. |
| `ORDER_MOVE` | Cuenta/revisión y destino libre. Conserva la identidad del consumo y libera la mesa anterior. |
| `ORDER_VOID` | Cuenta/revisión y motivo. Exige permiso de anulación; conserva el registro y retira las proyecciones activas. |
| `KITCHEN_SET` | IDs de renglones enviados, revisión de cocina y estado progresivo. Cocina puede avanzar después del pago; nunca modifica saldos. |
| `CASH_MOVEMENT` | Retiro o depósito con identidad estable, importe positivo en centavos y motivo. Exige turno abierto, actor con `retiros_programados`; rechazo por efectivo insuficiente. Snapshot, replay y nube conservan una sola operación. |
| `TURN_CLOSE` | Turno, efectivo contado y notas. Rechaza deuda, reservas y preparación pendiente; conserva un cierre calculado y consultable después de reiniciar. |

La revisión de cocina es independiente de la del consumo y de la financiera. `items` representa consumo completo; `kitchen_items` representa rondas enviadas. Salón presenta deuda y cocina presenta preparación. Abrir cuentas financieras bloquea cambios incompatibles de consumo; el candidato del 10 de septiembre añade únicamente consumo aditivo posterior al pago parcial.

Con cuentas financieras abiertas, `ORDER_SAVE` y `ORDER_SEND` exigen también
`expected_financial_revision`. Guardar exige `account_id` de la cuenta destino y
no permite retirar ni reducir líneas existentes. El resultado único contiene
`operational_order` y `financial_order`: revisiones enlazadas, saldo descontando
abonos y todos los pagos/reservas conservados. `financial_allocation` registra
cuenta destino, incremento en centavos, deltas de renglones y empleado verificado.
Los importes previos y su IVA se conservan; sólo se calcula el consumo agregado.
Guardar no imprime; enviar mantiene el algoritmo de rondas por cantidades pendientes.
La materialización cloud también aplica las dos proyecciones en una transacción.

Un nuevo intento de cobro exige todo el consumo enviado. Una reserva ya existente
se puede resolver aunque haya una ronda pendiente: no se bloquea la aclaración de
un resultado incierto. No se reabre una orden liquidada ni se habilitan todavía
disminuciones, devoluciones, descuentos, fusiones o transferencias posteriores a
la apertura financiera.

## Catálogo e impresión

Caja exige una revisión de catálogo vigente, modificadores obligatorios válidos y precios/impuestos presentes. No acepta precios ni descuentos propuestos por el navegador. Un renglón enviado no puede borrarse o cambiar por una edición normal; un precio nuevo exige una línea nueva.

`pos.station_routing` asigna categorías inequívocamente a cocina, barra o caja. `pos.no_print_stations` declara explícitamente qué estaciones operan sin papel. Sin esa política, ruta o impresora configurada, el envío falla antes de comprometer la ronda.

Los tickets de `ORDER_SEND` se preparan a partir del resultado canónico y quedan en `event.effects.print_jobs` con bytes, destino, copias e IDs estables por estación. Dos estaciones pueden compartir una impresora sin colisionar. El texto no permite inyectar controles ESC/POS y un envío a cocina nunca abre el cajón.

Si la cola de impresión falla después del commit, la ronda continúa visible y el reintento recupera su intención original, aunque haya cambiado la configuración de impresoras. El recibo significa trabajo guardado; la confirmación TCP no prueba que salió papel. Los envíos inciertos requieren comprobación del operador según el contrato de durabilidad.

En modo Caja se rechazan las rutas legacy de impresión cruda, cajón, prueba, configuración y resolución manual, así como `PRINT_COMMAND`. Una credencial de transporte no equivale a autorización de empleado. La impresión canónica de `ORDER_SEND` continúa disponible. Precuenta, recibo y resolución autorizada de papel incierto siguen el [contrato de documentos](CANONICAL-PRINT-2026-09-10.md); el cajón usa su [contrato autorizado de pulso único](CANONICAL-DRAWER-2026-09-10.md).

## Cierre de turno y límites

El cierre suma fondo inicial, pagos aceptados en efectivo y depósitos, y resta retiros; compara contra el efectivo contado. Mantiene total cobrado por todos los medios del dominio y conserva diferencias en centavos. Propinas, papel y conciliación de inventario conservan sus condiciones de cierre propias.

Las acciones no integradas están bloqueadas en la pantalla nueva. También `syncAll` conserva sin reenviar las colas legacy cuando Caja es autoridad o no responde. El [materializador](CAJA-CLOUD-MATERIALIZATION-2026-09-05.md) añade la barrera en base de datos; la transición exige conciliar colas antes de activarla.

El actualizador requiere que la publicación declare `fullsite.supportedStoreFormats` incluyendo `fullsite-command-transactions-v1` antes de instalar automáticamente. Un turno cerrado no vuelve compatible un lector antiguo del log. Esto no impide un downgrade manual fuera de Fullsite: el respaldo y procedimiento de transición siguen siendo necesarios.

## Evidencia

`operational-runtime.test.js`: 17 escenarios con precios/opciones, concurrencia, disco lleno, reinicio, pago/preparación independientes, permisos, cierre contado y transporte. Incluye dos tickets sobre TCP loopback, reintento/reinicio sin duplicar, falta de configuración antes del commit y fallo de cola después del commit. No contacta impresoras físicas ni producción.

El laboratorio `FULLSITE_LAB_OPERATIONAL=1` añade botones reales para guardar, enviar, mover/anular con PIN, dividir, recibir efectivo, reiniciar Caja, preparar/entregar y cerrar turno. `FULLSITE_LAB_UI_BUNDLE` permite repetirlo con el paquete instalado y sin servidor Next. Sus resultados deben consultarse sobre la revisión concreta de UI, sin convertir un contador histórico en certificación de campo.


## Corte X antes de la visita (10 de septiembre)

`GET /reports/turn?turno_id=...` exige credencial LAN, actor verificado por Caja y
permiso `corte_x`. Una terminal secundaria reenvía también el actor. Sin Caja no
sustituye el reporte por su estado parcial. Comparte `core/turn-report.js` con
`TURN_CLOSE`: suma aceptados (incluidos parciales), separa reservas y saldo, e
incluye consumo aún no preparado para pago. La preparación de cocina no filtra
los cobros. La página `/pos/corte` consulta esta ruta cuando Caja es la autoridad.
Retiros y depósitos se incluyen en X/Z desde `CASH_MOVEMENT`. Propinas siguen sujetas a H03; arqueo e impresión requieren su propia evidencia de H05/H06.
