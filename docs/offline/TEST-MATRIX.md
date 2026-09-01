# OFFLINE-TEST-MATRIX — Matriz de Certificación Offline

> Versión 2: 2026-07-27 | OFFLINE-100
> Columnas: Implementado | Testado | Certificado | Pendiente

---

## Convenciones

| Columna | Significado |
|---|---|
| **Implementado** | El código que soporta el escenario existe en el repositorio |
| **Testado** | Hay un test automatizado que corre este escenario (unit, integration, o e2e) |
| **Certificado** | El escenario fue ejecutado manualmente en staging con resultado PASS documentado |
| **Pendiente** | La columna no está marcada |

Un escenario es **CERTIFIED** solo cuando las 3 columnas están marcadas: Impl ✓ + Test ✓ + Cert ✓.

---

> ## Evidencia de campo — AMALAY, 2026-08-24
>
> Cuatro escenarios tienen **validación física parcial** de la madrugada del 24-ago en AMALAY
> (caja, WiFi apagado, Daniel presente por TeamViewer). Estaba encerrada en un rollout de Codex
> de 116 MB; se extrajo a [`EVIDENCIA-CAMPO-AMALAY-2026-08-24.md`](EVIDENCIA-CAMPO-AMALAY-2026-08-24.md)
> con cita textual y hora.
>
> **Sigue siendo 0 certificados, y con razón:** una sola terminal, con supervisión en vivo,
> por el camino feliz, y los 3 P0 se encontraron *después*. Camino controlado ≠ certificado.
>
> Lo que cambia es que el 0 ya no significa "no sabemos". Significa **4 con evidencia parcial
> y 17 sin tocar**.

## Grupo 1: Caída de Internet

### T-01: Internet cae durante una venta activa

**Preconditions**: POS cargado, turno abierto, mesa abierta con 2 ítems, internet activo.

**Steps**:
1. Desconectar cable Ethernet o deshabilitar Wi-Fi en el router.
2. Agregar un ítem a la orden.
3. Enviar a cocina.
4. Cobrar la mesa.

**Expected Result**:
- Mesa se agrega normalmente (IndexedDB).
- "Enviar a cocina" dispara WS LOCAL → KDS recibe la orden.
- Cobro se guarda en IDB sync_queue.
- UI muestra banner "Sin conexión — datos guardados localmente".
- No hay error visible para el operador.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (`offline-t01-venta-activa.test.ts`, 10 casos) | ✗ (campo parcial) | **Validado en campo 2026-08-24 04:03-04:07** — mesa abre, envía, imprime, KDS recibe, sin red. La capa de escritura offline ya corre en CI. Falta: SW sirviendo el shell, WS al KDS por LAN, impresora física, y repetir en entrada/escondite |

---

### T-02: Internet cae a mitad de una transacción de pago

**Preconditions**: Mesa abierta, orden enviada, listo para cobrar.

**Steps**:
1. Seleccionar método de pago.
2. Desconectar internet exactamente al presionar "Cobrar".

**Expected Result**:
- Operación de pago encolada en IDB sync_queue.
- La mesa queda marcada como "pagando" en estado local.
- Al volver internet, syncAll() completa la operación.
- NO se genera cobro duplicado.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Timing exacto difícil de automatizar; ejecutar manualmente |

---

### T-03: Internet cae, operación 2+ horas, vuelve

**Preconditions**: POS activo, internet desconectado.

**Steps**:
1. Operar el restaurante completo durante 2 horas (10 mesas, 30 órdenes, cobros, caja).
2. Reconectar internet.
3. Esperar sync.

**Expected Result**:
- Todas las órdenes en IDB sync_queue.
- Al reconectar: `window.online` → `syncAll()`.
- 0 ítems duplicados en Supabase.
- getPendingCount() = 0 al final.
- Items con STALE_WRITE_CONFLICT marcados (no perdidos).

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Test requiere seed de 30 órdenes en IDB; ejecutar manualmente primero |

---

## Grupo 2: Reinicios de Componentes

### T-04: POS reinicia (Electron — Task Manager kill)

**Preconditions**: Mesa abierta con ítems, pendientes en IDB sync_queue.

**Steps**:
1. Forzar cierre del proceso Electron (End Task).
2. Reabrir Fullsite POS.

**Expected Result**:
- Electron arranca. Local Server inicia, replay events.ndjson.
- POS carga desde Service Worker.
- drainLocalStorageToIdb() drena buffer.
- recoverFromIDB() restaura print jobs pendientes.
- La mesa abierta aparece en el estado local.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (`offline-t04-t07-recovery.test.ts`, 9 casos) | ✗ | Mecanismos de recuperación cubiertos en CI: `drainLocalStorageToIdb` (buffer de emergencia → cola canónica, idempotente) y supervivencia de print jobs en IDB. Falta con caja física: arranque del proceso Electron, SW sirviendo el shell, replay de `events.ndjson` |

---

### T-05: Local Server reinicia

**Preconditions**: 3 mesas abiertas, KDS conectado vía WS.

**Steps**:
1. Reiniciar Electron (contiene el Local Server).
2. Observar reconexión del KDS.

**Expected Result**:
- events.ndjson se replaya → state reconstruido con 3 mesas.
- KDS reconecta → SUBSCRIBE → SNAPSHOT con las 3 mesas.
- Print jobs pendientes: `_retryPendingJobs()` reintenta.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (parcial — event-store.test.js cubre el replay) | ✗ | Falta test e2e de WS reconnect post-restart |

---

### T-06: Windows reinicia

**Preconditions**: Fullsite POS instalado con openAtLogin: true.

**Steps**:
1. Reiniciar Windows.
2. Esperar arranque completo.

**Expected Result**:
- Fullsite POS arranca automáticamente.
- Local Server en puerto 7717.
- KDS abre si config.kds = true.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Requiere acceso físico o VM con snapshot |

---

### T-07: KDS reinicia

**Preconditions**: KDS activo con 3 órdenes en pantalla.

**Steps**:
1. Cerrar ventana KDS o matar `electron-kds`.
2. Reabrir.

**Expected Result**:
- KDS carga /pos/cocina.
- WS SUBSCRIBE + last_sequence → SNAPSHOT → 3 órdenes en pantalla.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (`offline-t04-t07-recovery.test.ts`, 5 casos) | ✗ | Contrato de catch-up cubierto en CI: SUBSCRIBE lleva `last_sequence`, la secuencia sólo avanza, frames corruptos no la mueven. Falta con caja física: relanzar `electron-kds` y confirmar el SNAPSHOT real por LAN |

---

## Grupo 3: Fallos de Red LAN

### T-08: LAN se cae (cable del servidor desconectado)

**Preconditions**: Tablet secundaria conectada vía WS.

**Steps**:
1. Desconectar cable de red del servidor.
2. Operar desde tablet secundaria y desde POS local.

**Expected Result**:
- Tablet secundaria: WS cierra, UI muestra "Sin conexión al servidor".
- POS local (mismo Electron): sigue operando (localhost no depende de LAN).
- Print jobs TCP: ALL_PRINTERS_FAILED → bridge_unavailable.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ (parcial — LAN failure no es un caso específico, pero los mecanismos existen) | ✗ | ✗ | Separar test de POS local vs tablet remota |

---

### T-09: Wi-Fi cambia de IP (DHCP renewal)

**Preconditions**: Servidor en Wi-Fi, tablets conectadas vía WS.

**Steps**:
1. Forzar renovación DHCP del servidor (nueva IP asignada).
2. Observar si las tablets reconectan automáticamente.

**Expected Result**:
- mDNS reanuncia con nueva IP.
- Tablets reconectan en <60s sin intervención manual.

**Actual Result (auditado 2026-07-27)**:

`BridgeClient.connect()` implementa reconexión automática con backoff (1s → 30s), pero reconecta siempre a la URL baked en construcción (`this._wsUrl` readonly, fijada desde el resultado de discovery).

`useBridgeClient` corre `ServerDiscovery` una sola vez al montar el componente. Si la IP del servidor cambia mid-session y el WS cae, el cliente reintenta a la IP obsoleta indefinidamente (hasta 30s entre intentos) sin re-correr discovery.

El subnet scan existe en `server-discovery.ts` (`_subnetScan`) pero `permitSubnetScan = false` en todos los callers de producción — nunca se activa.

**Resolución actual**: el operador debe recargar la página. Eso remonta `useBridgeClient`, re-corre `ServerDiscovery` desde cero, y si el registry tiene algún candidato reciente, reconecta.

**Gap**: no existe re-discovery automático en el ciclo de vida de la conexión WS.

**Implementación requerida para PASS**:
- Después de N reconexiones fallidas consecutivas (sugerido: 5 intentos = ~30s con backoff maxed), `BridgeClient` debe emitir un evento `connection_exhausted`
- `useBridgeClient` escucha ese evento y re-corre `ServerDiscovery`
- Si discovery encuentra una nueva IP, crea un nuevo `BridgeClient` con la IP actualizada

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✗ | ✗ | ✗ | Implementar re-discovery automático; ver descripción arriba |

---

## Grupo 4: Escenarios de Volumen

### T-10: Cola con 1000 eventos en events.ndjson

**Preconditions**: Local Server activo.

**Steps**:
1. Enviar 1000 comandos via POST /events.
2. Medir readAfter(0) y carga en startup.

**Expected Result**:
- readAfter(0) < 500ms.
- Startup replay < 2s.
- Servidor estable, sin OOM.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ (NDJSON soporta; no hay límite hard) | ✗ | ✗ | Script de carga: 1000 POST /events |

---

### T-11: IDB sync_queue con 200 operaciones pendientes

**Preconditions**: POS offline por período largo.

**Steps**:
1. Poblar IDB sync_queue con 200 ítems.
2. Reconectar internet.
3. Medir tiempo hasta getPendingCount() = 0.

**Expected Result**:
- syncAll() procesa en FIFO.
- 0 pérdida de datos.
- Total < 3 minutos (throttle 400ms entre syncs APP_API).

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Test con seed de 200 ítems en IDB |

---

## Grupo 5: Idempotencia y Duplicados

### T-12: Evento duplicado (mismo command_id dos veces vía HTTP)

**Preconditions**: Local Server activo.

**Steps**:
1. POST /events con command_id: "test-123", command_type: "ORDER_SENT".
2. POST /events con el mismo payload.

**Expected Result**:
- Primera: `{ results: [{ event: {...} }] }`.
- Segunda: `{ results: [{ duplicate: true }] }`.
- Solo 1 línea en events.ndjson.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (event-store + `idempotencia-transporte.test.js`, 5 casos a nivel HTTP) | ✗ | Cubierto el camino de `POST /events`: segundo POST devuelve `duplicate`, una sola línea en `events.ndjson`, lotes con id repetido, y rechazo sin `command_id`. Falta ejecución contra el proceso real |

---

### T-13: Idempotencia sobrevive restart del servidor

**Preconditions**: Local Server con comando procesado.

**Steps**:
1. Procesar comando con command_id: "persist-cmd".
2. Reiniciar el Local Server.
3. Enviar el mismo comando.

**Expected Result**:
- Después del restart: processed-commands.ndjson se recarga.
- El segundo envío devuelve `duplicate: true`.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (event-store + `idempotencia-transporte.test.js`, 4 casos de reinicio) | ✗ | Cubierto: tras reiniciar sobre los mismos archivos el comando sigue siendo duplicado, el estado se reconstruye, la secuencia no se reinicia, y 4 arranques seguidos no acumulan. Falta relanzar el proceso Electron real |

---

### T-14: ACK perdido — cliente reenvía comando

**Preconditions**: POS conectado vía WS.

**Steps**:
1. Enviar COMMAND via WS.
2. Interceptar el ACK antes de que llegue al cliente.
3. El cliente reenvía el mismo COMMAND (mismo command_id).

**Expected Result**:
- Servidor detecta duplicate → ACK con `duplicate: true`.
- No se crea un segundo evento.
- Estado no cambia.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (`idempotencia-transporte.test.js`, 4 casos con canal WS simulado) | ✗ | Cubierto: ACK tragado + reenvío devuelve `duplicate` sin segundo evento, el estado no cambia, el reenvío desde otra terminal tampoco duplica. **Destapó una carrera real de idempotencia — ver abajo.** Falta LAN real |

---

## Grupo 6: Timeout y Retry

### T-15: Timeout WS — cliente desaparece sin cerrar

**Preconditions**: Terminal conectada vía WS.

**Steps**:
1. Desconectar cable de red de la tablet sin cerrar el WS.
2. Esperar 25s (15s ping + 10s pong timeout).

**Expected Result**:
- Local Server: `client.ws.terminate()`.
- Log: `[ws-hub] Client timed out: [clientId]`.
- Cliente eliminado del hub.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (ws-hub.test.js cubre ping/pong) | ✗ | Ejecutar con cliente real (tablet o script) |

---

### T-16: Reconexión automática del WS

**Preconditions**: Terminal conectada, luego red interrumpida.

**Steps**:
1. Interrumpir red.
2. Restaurar red.
3. Observar si el cliente reconecta sin intervención manual.

**Expected Result**:
- Cliente reconecta con backoff.
- SUBSCRIBE + last_sequence → SNAPSHOT + deltas.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ (servidor soporta; reconexión del cliente no auditada) | ✗ | ✗ | Auditar lógica de reconexión del cliente WS primero |

---

## Grupo 7: Impresora

### T-17: Impresora desconectada durante venta

**Preconditions**: Impresora TCP configurada, bridge activo.

**Steps**:
1. Apagar la impresora.
2. Enviar una orden a cocina.

**Expected Result**:
- TCP connect timeout en 5s.
- Job: retrying → (5 intentos) → comanda: needs_attention, ticket: failed.
- UI muestra alerta. Print queue muestra el job.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (printer-queue.test.ts, multi-printer.test.ts) | ✗ | Ejecutar con impresora real desconectada |

---

### T-18: Impresora vuelve después de 3 minutos

**Preconditions**: Jobs en needs_attention por impresora caída.

**Steps**:
1. Reconectar la impresora.
2. Esperar ciclo de retry (15s).

**Expected Result**:
- isBridgeHealthy() detecta bridge UP.
- Jobs needs_attention → pending → printed.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (printer-queue.test.ts cubre recovery) | ✗ | Ejecutar con impresora real |

---

## Grupo 8: Múltiples Terminales

### T-19: Tres POS — misma mesa simultáneamente

**Preconditions**: 3 tablets conectadas al mismo Local Server.

**Steps**:
1. Tablet A envía MESA_LOCK para mesa 5.
2. Tablets B y C envían MESA_LOCK para mesa 5 simultáneamente.

**Expected Result**:
- A: ACK con lock.
- B y C: REJECT "Mesa 5 locked by another terminal".
- Solo 1 evento MESA_LOCK en events.ndjson.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Script con 3 WS clients concurrentes |

---

### T-20: Tres POS — mesas distintas simultáneamente

**Preconditions**: 3 tablets conectadas.

**Steps**:
1. Cada tablet abre una mesa distinta simultáneamente y envía órdenes.

**Expected Result**:
- Sin conflictos. Todas las órdenes llegan al KDS. Estado del plano correcto.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Script con 3 WS clients |

---

### T-21: Consistencia de estado entre terminales

**Preconditions**: 2 terminales conectadas.

**Steps**:
1. Terminal A cambia estado de mesa 3.
2. Verificar estado en Terminal B inmediatamente.

**Expected Result**:
- Terminal B recibe DELTA en <200ms.
- Estado de mesa 3 idéntico en ambas.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (ws-hub.test.js cubre broadcast) | ✗ | Ejecutar con 2 terminales reales |

---

## Grupo 9: Recovery de Datos

### T-22: Internet vuelve — sin duplicados en Supabase

**Preconditions**: 10 órdenes operadas offline, en IDB sync_queue.

**Steps**:
1. Reconectar internet.
2. Esperar syncAll().
3. Contar filas en pos_orders en Supabase.

**Expected Result**:
- Exactamente 10 nuevas filas (no 20, no 0).
- syncAll() devuelve `{ synced: 10, failed: 0 }`.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Requiere Supabase staging con rollback |

---

### T-23: Conflicto STALE_WRITE — datos preservados

**Preconditions**: Orden A en IDB sync_queue; Supabase tiene versión más nueva de la misma orden.

**Steps**:
1. Modificar la orden directamente en Supabase antes del sync.
2. Ejecutar syncAll().

**Expected Result**:
- Item marcado `conflict: true`, `error_class: 'STALE_WRITE_CONFLICT'`.
- Payload local preservado en IDB.
- Supabase no es sobreescrita con datos obsoletos.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✗ | ✗ | Requiere seed de conflicto en Supabase staging |

---

## Grupo 10: Arranque y sesión — escenarios que faltaban

> Estos dos no estaban en la matriz original. No es que se hayan olvidado: son huecos que
> sólo se ven cuando el restaurante **abre** un día sin internet, no cuando el internet se
> cae a media operación. La prueba de campo del 24-ago duró unas horas y no los alcanzó.

### T-24: Login sin red al abrir el restaurante

**Preconditions**: terminal apagada desde el cierre de anoche. Sin WAN al encender.

**Steps**:
1. Encender la terminal sin internet.
2. Un mesero teclea su PIN.
3. Un segundo empleado, distinto, teclea el suyo.

**Expected Result**:
- Ambos entran. La operación arranca sin depender de la nube.

**Estado real (auditado en código 2026-08-26)** — dos límites que lo impedían:

- **Ventana de 8 h.** `pos_staff_cache` guardaba `exp: Date.now() + 28_800_000` en cada login
  *online*. Un restaurante que cierra a la 1am y abre a la 1pm son **12 horas**: el caché ya
  había expirado y **nadie entraba**.
- **Una sola credencial por terminal.** `pos_staff_cache` guardaba un objeto, no una lista, y se
  sobrescribía en cada login. Offline sólo entraba **la última persona que se logueó con
  internet**. En una terminal compartida entre meseros, cajero y gerente, eso falla el primer día.

Validado en campo el 2026-08-24 06:49 (*"si jala! que chulada!"*) — pero con caché fresco, una
sola persona, y a las pocas horas del último login online. Ninguna de las dos condiciones se
parece a abrir el restaurante.

**Los dos límites están cerrados en `main` desde el 2026-08-26 (PR #133):**

| Era | Es |
|---|---|
| TTL de 8 h, fijo | **16 h**, configurable por `NEXT_PUBLIC_POS_OFFLINE_CREDENTIAL_TTL_HOURS` |
| `pos_staff_cache`: un objeto que se sobrescribía | `pos_manager_credentials_v2`: **lista de `ManagerCredential[]`**, indexada por `staff_id` |

El compromiso de alargar el TTL está escrito en el propio módulo: la credencial de alguien dado
de baja sigue sirviendo más tiempo *en esa terminal y sin red*. Se mitiga con `disabled`
—revocación honrada al reconectar— y con la bitácora `pos_offline_auth_log`. Es el mismo
compromiso que hace el POS legado.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ (PR #133) | ✓ | ✗ | **Sólo falta campo.** Apagar la terminal al cierre, encenderla al día siguiente sin WAN, y que entren **dos personas distintas**. El test cubre el cableado; que la ventana de 16 h cubra el ciclo real de AMALAY sólo se comprueba abriendo |

---

### T-25: Arranque en frío sin WAN — el plano de mesas

**Preconditions**: terminal apagada, sin WAN al encender, restaurante que NO es AMALAY.

**Steps**:
1. Encender sin internet.
2. Entrar al mapa de mesas.

**Expected Result**:
- Aparece el plano real del restaurante, con sus mesas y su distribución.

**Por qué existe este escenario** (hallazgo 2026-08-26, PR #128): el plano de salón **no se
cacheaba en ningún lado**. `pos-offline-db.ts` cachea menú, órdenes, inventario, modificadores,
métodos de pago, staff, turnos y movimientos de caja — **mesas no**.

AMALAY sobrevivía el arranque en frío **sólo porque su plano de 33 mesas venía compilado en el
bundle** (`MESAS_CONFIG` en `lib/pos-data.ts`, devuelto únicamente si el slug era literalmente
`'amalay'`). Cualquier otro restaurante arrancaba con **16 mesas genéricas**.

Es el ejemplo más claro de por qué el 0 certificados importaba: **el hueco se veía como
configuración, no como falla de offline**, y por eso nadie lo contó como escenario.

Corregido en PR #128 — `fetchPosMesas()` cachea en `localStorage` (`pos_plano_<clientId>`) y
`getMesasConfig()` lo recupera. localStorage y no IDB a propósito: `getMesasConfig()` es
síncrona y se llama dentro del inicializador de un `useState`.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ (PR #128) | ✗ | ✗ | Validación física: encender una terminal sin WAN y confirmar que sale el plano real. Probar con un tenant que NO sea AMALAY, que es donde estaba roto |

---

### T-26: Arranque en frío sin WAN — el ESTADO de las mesas

**Preconditions**: terminal con el storage recién limpiado (reinstalación o "clear site data"). Sin WAN al entrar.

**Steps**:
1. Entrar al POS sin internet.
2. Abrir el mapa de mesas, con órdenes abiertas en la nube.

**Expected Result**:
- Las mesas ocupadas salen ocupadas, con su mesero y su total.

**Hallazgo de campo 2026-08-31, terminal Entrada (AMALAY):** el plano salió **perfecto** —33 mesas,
distribución correcta, T-25 cumplido— y las **15 mesas ocupadas aparecieron como "Disponible"**, con
$6,172.36 abiertos en Supabase. Al volver el internet, aparecieron las 15 correctas.

Este escenario es distinto de los dos anteriores y por eso faltaba:

| | Pregunta que responde |
|---|---|
| T-24 | ¿puede el mesero **entrar**? |
| T-25 | ¿aparece el **plano**? |
| **T-26** | ¿ese plano dice la **verdad**? |

**Por qué es peor que T-25:** un plano ausente se ve roto y alguien lo reporta. Un plano que dice
"todo libre" **se ve bien y miente** — el mesero sienta gente en una mesa que debe $713, o le abre
segunda cuenta a una que ya tenía.

**Causa raíz:** `getCachedActiveOrders()` lee de IndexedDB, y a IndexedDB sólo lo llenaba
`reconcileCachedActiveOrders()` cuando alguien abría el mapa **estando online**. Tras limpiar el
storage nadie lo volvía a llenar hasta que por casualidad se entraba con red. El mapa offline valía
lo que valiera el último calentamiento, y nadie sabía cuándo se enfrió.

**No se resuelve en el Service Worker a propósito:** `sw.js` tiene `/rest/v1/pos_orders` en
`NEVER_CACHE_PATTERNS` porque servir esa respuesta vieja ya rompió el phantom-check y la comanda no
llegaba al KDS. El calentamiento va por IndexedDB, que es el fallback que el propio SW espera.

**Corregido**: `warmActiveOrdersCache()` en `pos-offline-db.ts`, invocada al hacer login **con red**.
Preserva los IDs que siguen en la cola local — sin eso, calentar borraría una venta encolada y la
mesa se vería libre.

| Impl | Test | Cert | Pendiente |
|---|---|---|---|
| ✓ | ✓ (8 casos, rama de falla incluida) | ✗ | Validación física: limpiar storage, entrar **con** red, apagar la WAN y confirmar que las mesas ocupadas siguen ocupadas |

**Evidencia de campo 2026-08-31 (AMALAY, terminal Entrada) — el síntoma se reprodujo CON internet.**
Daniel observó, ya restablecida la WAN, que la caja mostraba las mesas 1-5 y 7 abiertas mientras
Entrada mostraba sólo 1-5. La base confirmó 6 órdenes abiertas: la caja tenía razón. El plano de
Entrada refresca cada 3 s, así que "no había refrescado" no lo explica.

Causa: Entrada iba lenta (reportado por Daniel el mismo día). El `fetch` a Supabase se pasó del
límite de `fetchWithTimeout`, cayó al `catch` de la página y sirvió IndexedDB viejo — la misma
rama de T-26, pero disparada por latencia en vez de por falta de red.

> **Corrección de registro.** Al diagnosticarlo se afirmó que el Service Worker había servido
> mesas viejas. **Es falso:** `pos_orders` y `pos_mesas` están en `NEVER_CACHE_PATTERNS` y el SW
> ni siquiera intercepta esa consulta. La afirmación se hizo leyendo `sw.js` sin leer este
> documento, que ya lo decía. Queda como prueba en `mesas-cache-marcada.test.ts`.

Mitigación entregada (PR #280): ante una lectura no confiable el plano **avisa en ámbar**
("confirma en la caja antes de sentar") y **no reconcilia** el caché. No cura la latencia —
la vuelve visible en vez de silenciosa. La latencia de Entrada sigue **sin medir**.

---

## Resumen de la Matriz

| Grupo | Escenarios | Impl ✓ | Test ✓ | Cert ✓ | Blocker |
|---|---|---|---|---|---|
| 1 — Caída de Internet | 3 | 3 | 1 | 0 | T-01 con test; T-02/T-03 sin e2e |
| 2 — Reinicios | 4 | 4 | 3 | 0 | T-04 y T-07 con test de recuperación; falta lanzar Electron real |
| 3 — LAN | 2 | 1 | 0 | 0 | T-09: rediscovery de IP no confirmado |
| 4 — Volumen | 2 | 2 | 0 | 0 | Sin scripts de carga |
| 5 — Idempotencia | 3 | 3 | 3 | 0 | Ampliado a HTTP y WS el 2026-08-26. Destapó una carrera real (corregida) |
| 6 — Timeout/Retry | 2 | 2 | 1 | 0 | Reconexión cliente WS auditada: reconecta a IP fija, sin re-discovery |
| 7 — Impresora | 2 | 2 | 2 | 0 | Sin test con hardware real |
| 8 — Multi-terminal | 3 | 3 | 1 | 0 | Sin test concurrente real |
| 9 — Recovery | 2 | 2 | 0 | 0 | Requiere Supabase staging |
| 10 — Arranque y sesión | 3 | 3 | 2 | 0 | T-24 cerrado en #133 (TTL 16 h + varias credenciales); T-25 corregido en #128, falta validar; T-26 corregido y con test, falta validar |
| **Total** | **26** | **25** | **15** | **0** | |

**Escenarios Implementados**: 25/26 (96%) — +1 el 2026-08-26 (T-24, PR #133), +1 el 2026-08-31 (T-26)
**Escenarios con Test Automatizado**: 15/26 (58%) — +7 el 2026-08-26 (T-01, T-04, T-07 en el navegador; T-12, T-13, T-14 a nivel de transporte; T-24 el cableado del login); +1 el 2026-08-31 (T-26)
**Escenarios Certificados**: 0/26 (0%)

> **El cuello de botella ya no es código.** 24 de 25 implementados, 14 con prueba automatizada,
> y **cero certificados** — porque certificar quiere decir ejecutarlo físicamente, y eso no lo
> hace un test. De aquí en adelante lo que mueve el número es un turno en el restaurante, no un
> PR.

**Escenarios con evidencia de campo parcial**: 4/25 — T-01, T-17, T-22, T-23
(AMALAY 2026-08-24, caja únicamente. Ver [`EVIDENCIA-CAMPO-AMALAY-2026-08-24.md`](EVIDENCIA-CAMPO-AMALAY-2026-08-24.md))
**Escenarios sin tocar**: 17/25

> **La matriz creció de 23 a 25 el 2026-08-26, y eso es una mejora, no un retroceso.** Los dos
> nuevos (T-24 login sin red, T-25 plano de mesas en arranque en frío) son huecos que existían
> desde siempre y no se veían: uno porque parecía un tema de sesión y el otro porque parecía
> configuración. Un denominador honesto vale más que un porcentaje bonito.


> T-09: auditado 2026-07-27. Re-discovery automático en cambio de IP NO implementado (`BridgeClient` reconecta a URL fija; `useBridgeClient` corre discovery una sola vez al montar; subnet scan existe pero desactivado). Requiere nueva funcionalidad antes de poder ejecutar o certificar.

---

## Hallazgo: la dedup tenía una carrera bajo concurrencia (corregida 2026-08-26)

Al llevar T-14 a nivel de transporte salió algo que el test de `event-store` no podía ver:
`processCommand` hacía **check-then-act cruzando dos `await`**. Entre consultar
`hasProcessedCommand` y escribir `saveProcessedCommand` hay una ventana, y **todo reintento
que caiga ahí pasa el chequeo y escribe su propio evento**.

No es teórico: es el escenario T-14 exacto. Si el ACK viene *lento* en vez de perderse, el
reenvío del POS se traslapa con el original. Reproducido con 5 reintentos concurrentes del
mismo `command_id`: **5 eventos en vez de 1**. En un `ORDER_CLOSED` eso es un cobro duplicado.

Corregido coalescendo comandos en vuelo por `command_id`. Prueba mutante: al quitar el fix,
`reintentos en ráfaga` se pone en rojo.

**Lección para el resto de la matriz:** que un escenario esté "cubierto" en la capa de abajo
no dice nada de la capa que usa la terminal. T-12, T-13 y T-14 estaban marcados con test desde
antes; el bug vivía en el pedazo que nadie probaba.

---

## Hueco conocido: la matriz no cubre el login offline

Los 23 escenarios **no incluyen autenticación sin red**, y es de lo más crítico: si nadie puede
entrar al POS, lo demás da igual. Se validó en campo el 2026-08-24 06:49 (*"si jala! que
chulada!"*), pero no tiene casilla.

Dos límites del código que una prueba de una noche no alcanza a tocar:

- **Ventana de 8 h** — `pos_staff_cache` expira 8 h tras el último login *online*. Un restaurante
  que cierra a la 1am y abre a la 1pm son 12 h: si el internet está caído al abrir, **nadie entra**.
- **Una sola credencial por terminal** — `pos_staff_cache` guarda un objeto, no una lista, y se
  sobrescribe en cada login. Offline sólo entra **la última persona que se logueó con internet**.

**Levantado como [T-24](#t-24-login-sin-red-al-abrir-el-restaurante)** el 2026-08-26, con esos dos límites como criterios de aceptación.

---

## Ruta Crítica hacia 23/23 Certificados

1. **T-09 requiere implementación nueva**: detectar reconexiones fallidas consecutivas → re-correr `ServerDiscovery` → crear nuevo `BridgeClient` con nueva IP. No es solo un test — es un gap funcional.
2. **Ejecutar T-12, T-13, T-14** primero: son los más simples, los tests unitarios ya existen, solo falta ejecución a nivel de proceso real.
3. **Montar entorno staging**: Supabase staging con rollback para T-22, T-23.
4. **Tests e2e con Playwright Electron**: T-01, T-04, T-07 son automatizables con bajo esfuerzo.
5. **Tests con hardware real**: T-17, T-18 requieren impresora física.
