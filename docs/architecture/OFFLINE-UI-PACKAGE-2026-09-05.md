# Paquete de interfaz para arranque sin internet

Estado: candidato local, sin desplegar. Complementa [acceso de empleados en Caja](ACTOR-AUTHORITY-2026-09-05.md) y [catálogo compartido](../offline/CATALOGO-COMPARTIDO-2026-09-05.md). Una interfaz disponible no implica catálogo preparado, usuario autorizado ni cobro bancario disponible.

## Problema y contrato

Electron abría la página remota del POS y dependía del Service Worker del navegador para recuperar HTML y JavaScript. Con un perfil limpio o una versión incompleta, encender sin DNS terminaba en la página de contingencia. Tener órdenes durables en Caja no resolvía la falta de código ejecutable en la terminal.

El instalador debe contener un export estático completo de las rutas POS, sus payloads de navegación React, estilos, fuentes y todos los chunks, incluidos los de carga diferida. No contiene órdenes, precios, personas, secretos de instalación ni APIs de servidor. El catálogo y las credenciales de empleado conservan sus contratos y archivos separados.

`electron-app/offline-ui/package-store.js` verifica inventario de archivos, tamaños, SHA256, rutas mínimas HTML y RSC, ausencia de symlinks y revisión global. La fuente de confianza es el instalador Electron aprobado; los hashes detectan corrupción y descargas/copias incompletas, no sustituyen la firma del instalador. No existe una ruta HTTP o IPC para que el navegador suba código.

## Instalación y recuperación

Al arrancar, antes de abrir ventanas, Electron copia el paquete a `userData/ui-packages/versions/<revision>`, sincroniza archivos y directorios, vuelve a verificar y cambia un puntero mediante rename. Sólo entonces sirve la versión nueva. Conserva la versión anterior y cada proceso utiliza una sola revisión durante toda su vida: una actualización no mezcla pantallas nuevas con chunks anteriores a mitad de operación.

Un candidato inválido conserva el activo. Si los bytes de la versión activa están dañados, el siguiente arranque recupera la anterior verificada y registra la revisión rechazada para no reactivarla automáticamente. Si ambos paquetes están dañados, no se declara operación offline disponible. Esta recuperación detecta integridad de archivos; un error funcional de una versión cuyos hashes son válidos sigue requiriendo el proceso de rollback de una publicación.

El directorio de origen viene del propio instalador (`electron-app/ui-bundle`). Sólo en desarrollo se acepta `FULLSITE_UI_BUNDLE_DIR`, para laboratorio. No hay descarga autónoma de JavaScript desde un endpoint nuevo; el mecanismo existente de actualización de Electron sigue siendo el responsable de distribuir el instalador.

## Origen y red

`protocol.js` sirve código del disco conservando `https://app.fullsite.mx`. Eso mantiene el mismo origen, localStorage e IndexedDB del POS instalado. Las rutas `/api/` y otros orígenes se reenvían mediante la sesión de Electron con su petición original. Este mecanismo está soportado por [`protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol/) y [`net.fetch` con bypass de protocolos](https://www.electronjs.org/docs/latest/api/net).

Las navegaciones con query y las peticiones RSC resuelven a los archivos correspondientes del export. Un chunk o ruta ausente da error; nunca toma código de otra versión cloud. El CSP de la respuesta autoriza explícitamente el puerto real del Pedro instalado: las respuestas de protocolo no dependen de que Chromium dispare `onHeadersReceived`. Las llamadas operativas siguen usando Pedro y sus credenciales normales.

Antes de abrir la ventana se eliminan sólo registros de Service Worker y Cache Storage de ese origen. No se borran cookies, localStorage ni IndexedDB. El preload escribe `FULLSITE_UI_PACKAGE` antes del primer script; la gestión del SW lo respeta sin cambiar el interruptor de rollback del operador. Main elimina el marcador al abrir una interfaz sin paquete. El KDS dedicado conserva su HTML local HTTP `/kds`.

## Construcción

`node electron-app/scripts/build-offline-ui.cjs [directorio-destino]` construye en un directorio temporal aislado; no mueve rutas del checkout ni copia `.env`. Exige `NEXT_PUBLIC_SUPABASE_URL` HTTPS y `NEXT_PUBLIC_SUPABASE_ANON_KEY` del entorno de build, porque son configuración pública inlined por Next y no se pueden reparar después de instalar.

El export incluye las rutas `/pos`, el layout real y los contratos compartidos. Excluye API, proxy e instrumentación de servidor. Ejecuta compilación optimizada y TypeScript; verifica el resultado y conserva el build anterior bajo `output/closure/ui-build-previous` al regenerar el destino. No se usan excepciones a TypeScript para producir el paquete.

`npm run build:win` y `npm run build:mac` en Electron construyen primero la UI. Los tres builders llaman a `scripts/verify-offline-ui.cjs` antes de empaquetar; invocar electron-builder directamente sin paquete íntegro falla. Los archivos generados del bundle no se versionan en Git.

## Evidencia y límites

Build real inicial: 453 archivos y 33 rutas POS. El bundle del laboratorio utiliza únicamente configuración pública sintética; debe regenerarse con el código final integrado y la configuración pública de la publicación antes de producir el instalador.

`electron-app/lab/laboratorio-arranque-frio.cjs` ejecuta el binario real Electron, con perfiles separados y sin servidor Next. Bloquea WAN en renderer y llamadas fetch del proceso main; deja LAN disponible. La preparación previa de credenciales y catálogo usa respuestas sintéticas explícitas. No inyecta sesión de empleado ni caché de navegador para entrar.

Cinco recorridos comprobados: PIN visible desde perfil Chromium vacío; PIN realmente pulsado y validado offline por Caja; navegación RSC a la pantalla que exige abrir turno; POS secundario sin caché obtiene catálogo de Caja y entra con PIN; SIGKILL del binario real y reinicio conserva paquete y vuelve a exigir PIN. En los recorridos observados no se capturaron errores JavaScript no manejados. La prueba de arranque termina en el gate de turno: no certifica el servicio completo, enrolamiento cloud real, huella, impresoras o cobro desde botones.

Pruebas del almacén/protocolo cubren reinicios, activación fallida, corrupción activa, recuperación anterior, symlinks y traversal, queries/RSC, conservación de peticiones API, CSP del puerto instalado y rechazo del empaquetado sin UI. Pruebas DOM verifican que el paquete no puede activar un SW antiguo. Evidencia regenerable en `output/closure/cold-boot`, `offline-ui-tests.log`, `offline-ui-sw-tests.log` y `offline-ui-build-lab.log`.

La prueba se ejecutó en macOS. Instalador Windows, permisos y antivirus, apagado eléctrico físico, almacenamiento de los equipos de AMALAY y hardware siguen siendo aceptación de campo. Nada de este paquete escribe en AMALAY ni demuestra por sí solo cierre de producto.

### Integración posterior del servicio

La revisión `956010a8d72fb426125651b64e112e08c0c8c51c2c3a5245b09216cd2414e9fb` contiene 456 archivos y 33 rutas. Con ella se repitió el arranque frío 5/5 y se ejecutó `FULLSITE_LAB_OPERATIONAL=1 FULLSITE_LAB_UI_BUNDLE=output/closure/offline-ui-package-lab node electron-app/lab/laboratorio-ui-multiterminal.cjs`: **13/13** recorridos con interfaz instalada, sin servidor Next ni WAN. Incluye apertura, consumo compartido, rechazo de cobro antes de enviar, envío, cambio de mesa y anulación con PIN, split, efectivo parcial, SIGKILL/reinicio de Caja, preparación/entrega y cierre contado. Todas las mutaciones de ese recorrido se ejecutan desde botones; HTTP consulta los resultados.

Ese servicio utiliza sesiones previamente preparadas en un fixture; la entrada real con PIN desde perfil vacío se verifica en el laboratorio frío separado. No ejercita tarjeta, propinas, ajustes, movimientos de caja ni el resto de módulos bloqueados. El KDS ejecuta su HTML local real. Resultados en `output/closure/ui-paquete-operacion/results.json`, con la revisión del paquete y errores por terminal.
