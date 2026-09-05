# Laboratorio de pantallas y cuenta compartida

Ejecutar desde la raíz: `node electron-app/lab/laboratorio-ui-multiterminal.cjs`.

El laboratorio arranca el POS real con Next local y cuatro procesos Electron independientes: Caja, POS 2, POS 3 y cocina. Cada proceso tiene perfil, puerto y Pedro propios. Catálogo, personal y turno usan datos sintéticos; las órdenes, credenciales LAN, retransmisión y snapshots pasan por los servidores reales. El corte WAN aborta peticiones de API/REST mientras conserva la red local y `navigator.onLine=true`.

Resultado verificado: **10/10**.

1. Comanda enviada desde POS 2 aparece en cocina.
2. POS 3 abre la misma cuenta sin WAN: mismo ID, dos cafés y total de $116.00.
3. Un comando WS del secundario se confirma en Caja.
4. Sin WAN, dividir $116 en dos cuentas y cobrar $29 desde POS 2 deja saldo $87 visible en POS 3.
5. Matar el binario real de Caja y reiniciarlo con el mismo perfil recupera las dos cuentas, el pago de $29, el saldo de $87 y la preparación pendiente.
6. Liquidar desde POS 3 por los comandos financieros durables conserva la preparación pendiente en cocina.
7. Pulsar «Todo listo» en cocina confirma preparación en Caja sin cambiar los $116 cobrados.
8. Apagar el binario real de Caja provoca el aviso de sólo borradores en POS 2.
9. El recorrido no deja errores de JavaScript sin manejar y ningún componente registra un Service Worker mientras está deshabilitado para este laboratorio.
10. POS 3 sin caché de menú consulta el catálogo de Caja sin WAN: navega Bebidas, abre el café y sólo habilita Agregar después de elegir su opción obligatoria. Se cancela la selección; no se afirma envío de esa nueva ronda.

> **Nota 2026-09-05.** Esta lista quedó escrita antes de `a01087e5`. Desde ese commit el modo Next corre **9** pruebas: las de dividir/cobrar (4) y liquidar desde POS 3 (6) se movieron, en otra forma, al recorrido operacional (`FULLSITE_LAB_OPERATIONAL=1`, 13 pruebas en `recorrido-operacional-ui.js`), y en su lugar el modo Next verifica que una instalación sin transición rechaza `FINANCIAL_OPEN` (`LOCAL_AUTHORITY_DISABLED`). Corrida de referencia en el worktree del PIN: `PASS: 9 · FAIL: 0` sin bandera; `14/14` con `FULLSITE_LAB_PIN=1`.

Encontró dos defectos de integración: CSP permitía sólo el puerto 7717, bloqueando instalaciones con otro puerto; la carga opcional de recetas rechazaba todo el arranque cuando la LAN estaba viva pero no había WAN. Ambos corregidos. La consulta de recetas para inventario conserva su error; únicamente su uso como sugerencia de pantalla degrada.

La ampliación encontró otros defectos: cocina añadía metadatos legítimos que el bloqueo financiero rechazaba; HTTP 200 podía contener un rechazo que la pantalla interpretaba como confirmación; el aviso de instalar PWA ignoraba la bandera de desactivación del SW y provocaba cargas/recargas; AppShell esperaba al login cloud antes de montar el gate de PIN del POS. Las correcciones verifican recibos por ID, respetan una única gestión del SW y permiten montar el POS mientras la autenticación cloud sigue pendiente. El PIN conserva su validación propia.

Verificación del candidato local tras estas correcciones: Pedro **369/369**, frontend Node **2,982/2,982**, componentes DOM **200/200**, dominio financiero/acceso sobre Electron Node 20 **31/31**, TypeScript **0 errores**. Las dependencias de prueba ausentes se completaron en un runtime temporal aislado, sin modificar las del checkout principal.

La evidencia se guarda en `output/closure/ui/`: resultados, capturas en el momento de la comprobación, texto de pantallas y logs. Datos y credenciales de laboratorio son temporales. La suite no acepta origen remoto ni hereda credenciales de nube del entorno.

## Alcance preciso

La sesión está preparada: no prueba PIN, enrolamiento ni permisos. Assets servidos por Next: no certifica arranque frío sin internet, Service Worker ni paquete offline. No pulsa un cobro ni prueba proveedor bancario; envía los comandos financieros por HTTP real y verifica el saldo en la pantalla. La semántica financiera durable tiene además su suite separada. No certifica Windows, huella ni impresoras físicas.

La cuenta del fixture tiene una revisión explícita; los comandos financieros usan sesiones firmadas preparadas en la Caja sintética antes de arrancar. No se acepta un rol enviado por el body. El catálogo se prepara una sola vez en el perfil de Caja; POS 3 lo obtiene por el [contrato compartido](CATALOGO-COMPARTIDO-2026-09-05.md). Todavía se debe verificar crear/modificar/enviar rondas, cobrar desde sus controles, cerrar turno y conciliar contra nube. Este laboratorio no equivale al cierre del turno completo.

## PIN tecleado desde la pantalla (`FULLSITE_LAB_PIN=1`)

Con esta bandera, POS 3 arranca **sin sesión sembrada** y el recorrido teclea el PIN en el teclado real (botones `1`–`9`, `0` y «Entrar», `pos/layout.tsx:905-940`). Cubre la limitación «no prueba PIN» de arriba; el enrolamiento de terminal y la huella siguen sin probar.

### El camino real, y por qué el fixture del renderer no lo ve

Bajo Electron `requiereCaja()` (`pedro-cliente.ts:23`) es verdadero, así que `pos/layout.tsx:531` no llama a `/api/pos/pin` desde el navegador: manda el PIN a `POST /auth/pin` del Pedro local (`pedro-actor.ts:24`). Un POS secundario lo reenvía a Caja (`local-server/index.js:401`) y Caja lo valida en `ActorAuthority._login` (`core/actor-authority.js`):

- **Con nube:** `fetch` desde el proceso Node de Caja a `https://app.fullsite.mx/api/pos/pin` (`cloudOrigin` por defecto; `index.js:799` no pasa otro). 401 → «PIN rechazado por la autoridad». 200 → sesión firmada, verificador scrypt en `actor-credentials.json` para esa persona **y esa terminal**, y refresco de catálogo con el `shiftToken` recibido.
- **Sin nube:** el `fetch` falla y Caja compara contra el verificador guardado. Sin verificador para ese PIN y esa terminal → «Usuario o terminal sin preparar…» (`OFFLINE_USER_NOT_PREPARED`). Con él → entra con `offline: true`.

Ni `verifyPinOffline`, ni `pos_manager_credentials_v2`, ni `pos_staff_cache` participan en Electron. Una versión anterior de esta sección afirmaba lo contrario y estaba equivocada.

**Hallazgo del 2026-09-05.** Ese `fetch` sale del proceso Node, no del renderer, y la ruta de Playwright (`context.route`) no lo intercepta. El bootstrap que este laboratorio usaba sólo en modo paquete bloqueaba hosts no locales; en modo Next no había bootstrap. Resultado: la primera corrida con PIN mandó un intento (PIN incorrecto, tenant `closure-lab`) al `app.fullsite.mx` real. La frase de arriba «la suite no acepta origen remoto ni hereda credenciales» era cierta para el renderer y falsa para Pedro. Corregido: **todo** Electron del laboratorio arranca por `lab-bootstrap.cjs`, que envuelve `global.fetch` del proceso main antes del código de producto, redirige `https://app.fullsite.mx` a una nube local del laboratorio, rechaza cualquier otro host y deja bitácora en `<userData>/lab-egress.log` (método y ruta; nunca cuerpo ni cabeceras).

### La nube del laboratorio

Un servidor HTTP en loopback dentro del proceso del laboratorio. Sirve `POST /api/pos/pin` (valida contra el PIN del laboratorio; 401 con el texto de `api/pos/pin/route.ts:155`) y `GET /api/pos/menu` (el mismo catálogo que se prepara en Caja). Con `wan = false` cierra la conexión sin responder — lo que ve Caja cuando el módem pierde WAN. Registra cada petición sin el PIN.

La nube devuelve **otra persona** («Cajera de laboratorio») que el operador sembrado: si devolviera el mismo `staff.id`, `ActorAuthority` reemplazaría la credencial y revocaría las sesiones preparadas de Caja, POS 2 y Cocina a media corrida.

### Cinco comprobaciones

1. Sin sesión, POS 3 arranca en el escondite; no hay `pos_actor_session` y la nube no ha visto ningún PIN.
2. Con nube, el PIN incorrecto se rechaza con «PIN rechazado por la autoridad», la pantalla no cambia, y la nube recibió 401 con `device_id` = terminal de POS 3 (no la de Caja) y `client_id` = tenant.
3. Con nube, el PIN correcto entra: `pos_staff` y `pos_actor_session` son de la persona confirmada, `offline: false`; `pos_shift_token` es el token que emitió la nube (`pos/layout.tsx:534`); Caja refrescó el catálogo con ese token; y `actor-credentials.json` de Caja tiene el verificador preparado para la terminal de POS 3, sin el PIN en claro.
4. Sin nube (sesión vaciada y recarga, WAN cortada): el PIN incorrecto se rechaza con «sin preparar / valida PIN con internet»; el correcto entra con `offline: true`. La nube registró dos conexiones cortadas y ninguna respondida.
5. Al final del recorrido, la bitácora de egreso de cada Electron muestra que todo `/api/pos/pin` salió **de Caja** y fue **redirigido a la nube del laboratorio**; ninguna otra terminal intentó mandarlo.

Después de la prueba 4 se restaura la sesión firmada preparada: las pruebas originales verifican comandos financieros por HTTP con `actor_token`, y el recorrido de PIN sólo prueba la **entrada**.

### Cómo correrlo

    FULLSITE_LAB_PIN=1 FULLSITE_LAB_PIN_VALUE=<pin> node electron-app/lab/laboratorio-ui-multiterminal.cjs

Sin `FULLSITE_LAB_PIN_VALUE` se usa un PIN sintético. El PIN real de una instalación **no se escribe en el repo** ni en la evidencia (`results.json` guarda `nube` y `egreso` sin PIN).

### Límites

- El bootstrap sólo cubre `global.fetch`. `https.request`/`net.request` no pasan por él (`local-server/update/manager.js` usa `https`); la bitácora no los vería.
- TLS hacia la nube no se prueba: la redirección es a HTTP en loopback. El constructor de `ActorAuthority` y `CatalogStore` sigue exigiendo `https:` en el origen configurado.
- Sin probar: enrolamiento de terminal (`terminal_not_enrolled`), huella, el límite de 10 intentos en 10 minutos y la vigencia de 7 días de la credencial (exigirían manipular el reloj).
