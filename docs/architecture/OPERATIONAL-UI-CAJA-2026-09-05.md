# Operación desde las pantallas con autoridad en Caja

Estado: candidato local, sin despliegue. Complementa los contratos de [comandos durables](DURABLE-COMMANDS-2026-09-05.md), [empleados](ACTOR-AUTHORITY-2026-09-05.md) y [finanzas](FINANCIAL-COMMANDS-2026-09-05.md).

## Cuenta compartida y reintentos

`pedro-operaciones.ts` envía identidades de productos, opciones, cantidades e intención. Caja calcula importes, valida catálogo, permiso, revisión y turno, y entrega el resultado durable. Guardar no envía a cocina. Enviar prepara una ronda con el incremento todavía no enviado. Preparar cuentas de cobro exige que todo el consumo guardado ya esté enviado; se permite cobrar antes de que cocina prepare o entregue. Si falta enviar, el modal explica el motivo y mantiene deshabilitada la apertura financiera.

`pedro-comandos.ts` conserva el comando original antes de pedir confirmación. Recuperar un recibo anterior no autoriza reemplazar un borrador posterior. El helper de guardado compara el contenido confirmado con el solicitado; si cambió, devuelve `GuardadoAnteriorRecuperado` con la orden anterior para actualizar la base sin borrar el borrador ni enviar automáticamente. La pantalla también conserva ediciones realizadas mientras esperaba la respuesta de Guardar o Enviar, y rechaza adoptar una revisión menor a la ya confirmada.

Un recibo antiguo de Enviar no demuestra que se enviaron productos guardados después. Se recupera aquel recibo y se pide revisar y confirmar la ronda pendiente; sólo entonces se genera el siguiente comando. El journal de reintentos no contiene PIN ni tokens.

## Transferir mesa y anular orden

Los helpers `moverCuentaEnCaja` y `anularCuentaEnCaja` usan `ORDER_MOVE` y `ORDER_VOID`. Exigen una cuenta guardada sin ediciones pendientes. La pantalla no cambia mesa ni elimina la cuenta hasta que Caja confirma. Un rechazo, pérdida de conexión o resultado incierto conserva la cuenta y permite recuperar el mismo intento.

El PIN se verifica por `/auth/pin` en Caja. `autorizarOperacionConPinEnCaja` devuelve la sesión únicamente al comando inmediato; no cambia al empleado conectado ni guarda la sesión de quien autorizó. El token viaja en la cabecera del comando. El servidor aplica el permiso canónico correspondiente; la UI no convierte un nombre, rol local o huella del navegador en autorización.

Caja rechaza mesas ocupadas, revisiones cambiadas y alteraciones después de abrir cuentas financieras. Esta integración no introduce reasignación de consumos ni anulación financiera.

## Acciones que todavía están bloqueadas

Cuando Caja es la autoridad, o una terminal local aún no puede confirmar quién escribe, la pantalla impide llegar a los caminos anteriores de:

- Cancelar un producto ya enviado, transferir un platillo o reasignar mesero.
- Descuentos, cortesías, combos con precio promocional y promociones automáticas.
- Retiros, depósitos y apertura manual del cajón.
- Precuentas, reimpresión de ticket y disparo de tiempos mediante impresión del navegador.
- Formas anteriores de dividir y cobrar. El flujo durable disponible usa el modal de cobro de Caja.

Un producto aún no enviado puede retirarse del borrador; se comparte el cambio al Guardar. El número de mesa del encabezado sirve para navegar a otra cuenta; la transferencia real usa su botón y confirmación en Caja.

Los bloqueos preservan datos y evitan activar otro escritor. Son límites funcionales del candidato, no funciones terminadas. Otras rutas del POS requieren sus propias guardas y la barrera global del materializador; esta página no constituye por sí sola el cierre de todos los escritores.

## Evidencia local

`pedro-operaciones.dom.test.ts`: ocho escenarios con el transporte HTTP simulado y el journal real del navegador. Cubren PIN y permiso rechazados sin fallback cloud, aprobación sin sustituir empleado, pérdida de ACK al guardar con borrador nuevo, guardado idéntico recuperado y envío anterior recuperado con consumo nuevo pendiente y anulación cuyo recibo se perdió. El reintento de anulación usa la identidad guardada aunque la cuenta ya no aparezca abierta en el salón; Caja resuelve el recibo original antes de validar una operación nueva.

TypeScript sin emisión pasó sobre la integración. El laboratorio de pantallas y los instaladores deben verificarse sobre el candidato final. No se usaron PIN de clientes ni datos de AMALAY en estas pruebas.
