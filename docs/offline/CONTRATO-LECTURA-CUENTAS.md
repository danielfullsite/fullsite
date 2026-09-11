# Lectura operacional de cuentas — H2/T5

La Caja confirma el estado compartido de la sucursal. `GET /state` contiene dos
proyecciones distintas de las órdenes del mismo `RestaurantState`:

- `salon_orders`: cuentas completas pendientes de liquidar/cancelar. Incluye
  `entregada`, cuentas por nombre y órdenes con un arreglo de ítems vacío real.
- `kds_orders`: trabajo de preparación pendiente. Incluye una cuenta pagada
  antes de cocinar. `status` representa preparación; `payment_status` representa
  el dinero. `kds_queue` tampoco conserva entregas completas.
- `order_snapshot_complete`: permite distinguir una lista vacía confirmada de
  bootstrap incompleto. Un Pedro legacy con sólo ocupación y sin detalles no
  puede confirmar que una cuenta está vacía.
- `financial_orders`: resultados aceptados del dominio financiero, cuentas y
  pagos en centavos. `financial_order.revision` no sustituye `order_revision`.
  La propiedad `saldo` expuesta al POS está en MXN.

El snapshot y su hidratación conservan las dos proyecciones y el resultado
financiero. `STATE_SYNC` admite `orders` con registros completos y
`order_snapshot_complete: true` para bootstrap;
la ausencia de una orden local en nube, incluso tras 45 segundos, no constituye
un recibo de cierre. Los comandos aceptados no se borran por ese poll.

**Una fila presente en nube con estado `cerrada`/`pagada` sí es recibo de liquidación
de una orden local (2026-09-10, sólo en modo legacy).** En ese modo la nube es la
autoridad de cobro: el POS le guarda el cobro antes de avisar `ORDER_CLOSED` a la LAN.
Si ese aviso se pierde, el poll liquida la orden —`payment_status: pagada`, `saldo 0`,
`closed_at` de la nube— y libera la mesa sólo si todavía apunta a esa orden. Platillos
y preparación se conservan (D2). Una fila abierta sigue sin tocar la orden local; la
ausencia sigue sin cerrar nada; en modo `caja` el poll sigue siendo observacional.
Pruebas: `state.test.js`, «una fila cerrada en nube liquida la orden local».

## Consumidores

En una terminal local, mapa y editor leen Caja antes de consultar nube. Se
selecciona primero por ID de cuenta, después por nombre o mesa cuando se busca
una nueva. Si otra cuenta ocupa la misma mesa, no reemplaza al ID ya abierto.

`leerCuenta` devuelve `existente`, `libre`, `cerrada` o `incierta`. Sólo una lista
completa y autoritativa permite `libre`. Ítems ausentes/corruptos, HTTP 401/403,
fallo de red y datos parciales devuelven incertidumbre. Un arreglo `items: []`
confirmado conserva la identidad de la cuenta. Las lecturas HTTP usan
`cache: no-store`, incluidos los puertos distintos de 7717.

El editor sondea cada segundo sin solapar lecturas. Reconcilia respecto a la
última versión confirmada: agrega cambios remotos, conserva ítems nuevos y
ediciones locales, y bloquea confirmación si ambas terminales cambiaron el mismo
ítem/campo. La resolución explícita conserva el borrador conflictivo antes de
cargar Caja. El caché conserva sello de confirmación y borrador separado.

El guard de UI vuelve a leer antes de enviar/cobrar/transferir/cancelar. Requiere
revisión y saldo reales para una cuenta existente; no fabrica revisiones.
Perder Caja mantiene lectura con hora visible y permite capturar borradores;
no autoriza cobro/división/transferencia ni presenta el borrador como enviado.
Esta comprobación complementa OCC y permisos en el servidor; no los sustituye.

## Evidencia y límite del paquete

Las pruebas `salon-projection.test.js`, `cuenta-pedro-authority.test.ts` y
`pos-order-reconciliation.test.ts` ejercitan entrega/deuda, pago previo a cocina,
rehidratación/replay, bootstrap, nombres, campos completos, errores de lectura,
vacíos reales, identidad y conflictos. El laboratorio UI real separado debe verificar
los consumidores montados en Electron antes de cerrar la integración.

Este paquete no convierte `saveOrder` ni `addOrderItems` en comandos de escritura
local. La integración de turno, órdenes y dinero autoritativos debe completarse
en los paquetes siguientes; los guards pueden bloquear una orden legacy sin
revisión. Tampoco certifica hardware, impresión ni producción.

Decisiones: [ADR-005](../adr/ADR-005-AUTORIDAD-OFFLINE-Y-ESTADOS.md).


## Recuperación de borrador después de cierre — 10 de septiembre

Al cerrar una cuenta se liberan tanto las referencias como la identidad/revisión del editor. Un borrador posterior recibe UUID nuevo. La copia actual recuperable —confirmada o con borrador, incluso vacío— tiene prioridad sobre la caché del formato anterior. La migración no puede recuperar una identidad pagada por encima de productos propios pendientes.

El transporte LAN recuerda los valores de enum no soportados por el motor; no confunde esa incompatibilidad con desconexión o denegación de acceso. Las credenciales, señales y cuerpos conservan el mismo contenido en el único fallback de compatibilidad.
