# Autenticación del transporte de Pedro

Implementación de cierre T2, septiembre 2026. Verificada localmente; no equivale a instalador Windows ni operación de campo certificados.

## Contrato

- Caja resuelve su `lan-secret` persistido antes de construir HTTP/WS y antes de escuchar. Un fallo de lectura/escritura impide abrir el servidor. Un archivo vacío no se reemplaza silenciosamente.
- Las secundarias reciben `lan_secret` al enrolarse; no generan un secreto diferente. Sin él sólo ofrecen `/health` y `/identity`; las rutas operativas responden 401.
- HTTP presenta `x-fullsite-lan`; opcionalmente declara `x-fullsite-restaurante`, `x-fullsite-terminal`, `x-fullsite-sucursal`. El restaurante/sucursal declarados deben coincidir con la instalación. También se valida el scope declarado en comandos, antes de ejecutar un batch.
- WS de Node puede presentar las mismas cabeceras durante upgrade. El browser presenta `lan_secret` en `SUBSCRIBE`, nunca en URL. Ningún socket recibe estado, broadcasts, PONG operativo o ACK de comandos antes de una suscripción autenticada. Se cierra con 1008 al recibir un comando previo; credencial incorrecta de upgrade responde 401.
- El transport auth acredita la instalación. **No sustituye** los permisos de actor, aprobación de gerente ni comprobación de revisiones de los comandos de negocio.

## Renderer y KDS

`preload.js` y `preload-kds.js` obtienen la identidad instalada por IPC síncrono antes del código de página. Main sólo responde a sus propias ventanas y frame principal en `https://app.fullsite.mx`, `/kds` del Pedro loopback propio, o el origen loopback configurado con `FULLSITE_DEV=1`. No deriva identidad desde query params ni la entrega a una navegación externa.

La copia generada por Caja también se pasa al renderer; ya no depende de que el secreto existiera antes en config.json. Las claves de una configuración anterior se reemplazan o eliminan.

El POS conserva `FULLSITE_BRIDGE_URL=http://127.0.0.1:<puerto>` y el relay Node hacia Caja. El KDS sigue cargando por HTTP desde su Pedro. Main presenta cabeceras al cargar su `/kds` local protegido; sólo esa página autenticada contiene las cabeceras para leer `/state` y emitir `/events`. Una lectura anónima de `/kds` no revela la credencial. No se usa HTTPS→IP LAN como atajo.

`localNetworkFetch` conserva cabeceras de autenticación, tipos `Headers`, body, señal y método si Chromium rechaza `targetAddressSpace`. Sólo retira ese campo en el reintento; errores de red reales no generan reintento encubierto.

## Integración del estado y efectos pendientes

El poll cloud sólo se inicia en Caja. Lee órdenes completas, conserva las pagadas para la proyección de preparación y entrega `orders` en `STATE_SYNC`. Un fallo al consultar turno o autenticar no se presenta como salón vacío; el estado conserva operaciones LAN sin recibo cloud. La semántica de mezcla pertenece a `RestaurantState`.

La lectura aplica tenant, sucursal y turno en todas las páginas de 500 órdenes, con orden estable. Comparte un deadline total de 6 segundos y un límite de 20 páginas; cualquier fallo, deadline o exceso impide publicar el snapshot parcial y se registra en el log de Pedro. Los polls no se solapan. Esta paginación evita el límite por respuesta de PostgREST; no representa una transacción de lectura entre varias peticiones cloud.

La cola de impresión vive en el dataDir. Al arrancar se recuperan efectos pendientes si el CommandHandler dispone de ese contrato. `GET /print/uncertain` y `POST /print/resolve` (`job_id`, `resolution: printed|reprint`) requieren autenticación; una reimpresión aceptada responde `queued`, no «papel impreso». El endpoint legacy `/print` conserva `command_id`/`idempotency_key` cuando el caller lo provee.

## Límites de este cierre

La credencial es compartida por instalación: revocar una terminal requiere rotarla en las demás. No aporta cifrado TLS de la LAN ni revocación individual. No se registra ninguna parte del secreto. La migración exige enrolar las secundarias antes del rollout; no hay modo de compatibilidad anónimo.

Pruebas: servidores HTTP/WS reales en loopback, acceso legítimo y no enrolado, scope incorrecto, primer request después de preload, navegación externa, persistencia del secreto, headers KDS y regresión Chromium. La prueba de UI Electron real, instalador, red física y hardware permanece como gate separado.
