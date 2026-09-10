# Lectura cloud de cocina por sucursal

El endpoint `/api/pos/kitchen` recibe `client_id` y la sucursal instalada
`location_id`. El KDS obtiene esta última de `FULLSITE_LOCATION_ID`, inyectada por
la identidad de Electron. Conserva el mecanismo de token de cocina existente.
Este contrato de lectura no autoriza cambios de estado ni pagos.

La consulta de turnos y la consulta de órdenes usan el mismo restaurante y
sucursal. Se exige un único turno abierto: cero devuelve tablero vacío confirmado;
más de uno devuelve conflicto. Un error o respuesta inválida devuelve
indisponibilidad; no amplía a órdenes de las últimas doce horas.

Una instalación legacy sin sucursal sólo puede resolver un turno inequívoco y
leer órdenes sin `location_id`. No adopta automáticamente una sucursal. Los
terminales provisionados necesitan el esquema del materializador pendiente,
que agrega `pos_turnos.location_id`; no se reintenta una consulta fallida quitando
el filtro de sucursal. La migración y el despliegue deben coordinarse.

Las filas de cocina incluyen identidad de restaurante, sucursal y turno. El
cliente captura su identidad al iniciar la lectura, filtra respuestas/caché por
ella y descarta resultados si cambia durante la consulta. El contrato común
`kitchen-read-scope.ts` impide utilizar caché sin procedencia o de otra sucursal.
La procedencia del bridge se obtiene de la conexión descubierta y autenticada;
no se infiere del payload ni se agrega después de cambiar de instalación.

Refrescar cocina o barra no cambia estados por antigüedad. Las comandas pendientes
del turno siguen visibles aunque hayan pasado cuatro horas; el reloj indica
demora, no entrega. El cambio de estado requiere una acción del personal. Barra
también respeta el rechazo explícito de `updateOrderStatus` y no registra éxito
en auditoría cuando la escritura devuelve `false`.

H12 permanece abierto: esta tanda no certifica sesiones exclusivas, huella,
proveedores ni todos los caminos de escritura cloud. El caché offline aún usa
ventana temporal y requiere reconciliación de turno al recuperar conectividad;
no equivale a una respuesta actual confirmada del servidor.
