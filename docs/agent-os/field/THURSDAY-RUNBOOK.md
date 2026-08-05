# THURSDAY-RUNBOOK — Certificación de campo Fullsite POS

**Máquinas:** PDV3 (terminal POS) y SERVER1 (Bridge / Local Server)
**App:** Fullsite POS v1.3.3 (Electron kiosk, NSIS). El Bridge corre **dentro** del proceso Electron en el puerto **7717** (HTTP + WS `/ws`); el servicio de huella corre en **7718**.
**Kits en USB:** `FULLSITE-DIAGNOSTIC\` (diagnóstico previo) y `FULLSITE-FIELD-KIT\` (captura de evidencia de certificación).

Datos clave (grounded en código):

| Cosa | Valor | Fuente |
|---|---|---|
| Puerto Bridge (HTTP+WS) | `7717`, bind `0.0.0.0` | `local-server/index.js` |
| Puerto huella | `7718` (127.0.0.1) | `main.js` |
| Endpoints lectura | `GET /health`, `/state`, `/identity`, `/events?since=N` | `local-server/index.js` |
| Protocolo WS | SUBSCRIBE/COMMAND/PING → SNAPSHOT/DELTA/ACK/REJECT/PONG (v1.0) | `local-server/protocol.js` |
| Event store | `%APPDATA%\Fullsite POS\events.ndjson` + `processed-commands.ndjson` | `adapters/process.js` + `main.js` (userData) |
| Cola impresión | `%APPDATA%\Fullsite POS\print-queue.json` (estados: pending/printing/printed/retrying/failed/recoverable/cancelled, MAX_ATTEMPTS=3) | `adapters/print-queue.js` |
| Logs rotativos | `%APPDATA%\Fullsite POS\logs\server.log` (+ `server.1..5.log`, 5MB c/u) | `local-server/logger.js` |
| Config terminal | `%APPDATA%\Fullsite POS\config.json` (legacy: `C:\fullsite\config.json`) | `main.js` |
| Eventos | ORDER_UPSERTED/SENT/CLOSED/CANCELLED, KDS_ITEM_STATUS, MESA_LOCK/UNLOCK, TURNO_OPENED/CLOSED, PRINT_COMMAND, STATE_SYNC | `protocol.js` |
| Auto-arranque | login item de Windows (`app.setLoginItemSettings`) | `main.js` |
| Salir del kiosco | `Ctrl+Shift+Q` (cierra la app) | `main.js` |

> Nota (Fase 1): la web app escribe directo a Supabase; el Bridge observa vía poll de 5 s (`STATE_SYNC` → `last_supabase_sync` en `/state`). `sync_queue_size` de `/health` cuenta eventos locales `synced:false` y **no** baja a 0 en Fase 1 (no hay caller de `markSynced` en producción) — es telemetría, no criterio de FAIL.

Comandos rápidos (solo lectura):

```powershell
# Salud del Bridge local
powershell -Command "Invoke-RestMethod http://127.0.0.1:7717/health | ConvertTo-Json -Depth 5"
# Estado (mesas, kds, turno, locks, sequence)
powershell -Command "Invoke-RestMethod http://127.0.0.1:7717/state | ConvertTo-Json -Depth 6"
# Desde PDV3 hacia SERVER1 (sustituir IP)
powershell -Command "Invoke-RestMethod http://IP_SERVER1:7717/health | ConvertTo-Json -Depth 5"
```

Captura de evidencia (desde la carpeta `FULLSITE-FIELD-KIT` en el Escritorio):

```bat
RUN-CERT-CAPTURE.cmd pasoNN-nombre
```

---

## PASO 1 — Diagnóstico previo (obligatorio antes de todo)

Orden: **PDV3 primero, SERVER1 segundo.**

En cada máquina, desde el USB → Escritorio, carpeta `FULLSITE-DIAGNOSTIC\`:

```bat
RUN-DIAGNOSTIC.cmd
```

(o directo: `powershell -NoProfile -ExecutionPolicy Bypass -File .\DIAGNOSTIC-ONLY.ps1`)

Fotografiar el bloque final de cada máquina y copiar el ZIP al USB. El bloque muestra: TERMINAL, DEPLOYMENT TYPE, EXECUTABLE, VERSION, PORT 7717/7718 OWNER, AUTO-START, USER DATA PATHS, ROLLBACK INPUTS CAPTURED, ZIP + SHA.

## DECISION GATE — no continuar si algo falla

| Gate | Criterio | ¿Pasa? |
|---|---|---|
| BACKUP | ZIP de diagnóstico generado + SHA anotado + copiado a USB en AMBAS máquinas (ROLLBACK INPUTS CAPTURED = YES) | PASS / FAIL |
| ROLLBACK | Uninstaller NSIS presente (registro Uninstall) o instalador anterior en USB; config.json y printers.json hasheados en el ZIP | PASS / FAIL |
| DEPLOYMENT TYPE | El diagnóstico reporta NSIS / LEGACY / MIXED — **KNOWN** (no UNKNOWN) | KNOWN / UNKNOWN |
| NO P0 BLOCKER | Sin proceso desconocido dueño del 7717, sin corrupción visible, versión esperada 1.3.3 | TRUE / FALSE |

**Si los 4 gates pasan → continuar. Si cualquiera falla → detener y escalar (no instalar, no certificar).**

---

## Plantilla P0 (usar ante cualquier FAIL)

Copiar y llenar. Un P0 detiene la certificación del paso; los pasos independientes pueden continuar solo si el responsable técnico lo autoriza.

```
P0-<PASO-NN>-<fecha>
ROOT CAUSE   : (hipótesis con evidencia; "desconocida" si aún no se sabe)
REPRODUCTION : (pasos exactos 1,2,3 para reproducir)
EXPECTED     : (lo que el runbook dice que debía pasar)
ACTUAL       : (lo que pasó; adjuntar foto de pantalla)
LOGS         : evidence\<maquina>-<ts>-pasoNN\ (SUMMARY.txt, 16-log-errors.txt,
               17-server-log-tail.txt, 03-health.json, 15-duplicates.txt)
FIX          : (cambio propuesto / aplicado)
RETEST       : (cómo se re-verificó; nueva captura con label pasoNN-retest)
```

En cada paso, "**Si falla**" = crear P0 con el ID indicado y correr `RUN-CERT-CAPTURE.cmd pasoNN-fail` ANTES de tocar nada.

---

## Los 29 pasos de certificación

Convención por paso: **Acción → Esperado → Evidencia → Si falla**.
Salvo indicación, la evidencia se captura **en la máquina donde ocurre la acción**.

### Fase A — Arranque offline

**PASO 01 — Arranque en frío offline (SERVER1)**
- Acción: desconectar el internet del local (cable WAN del módem/router; la LAN local queda viva). Apagar por completo la app en SERVER1 (`Ctrl+Shift+Q`) y volver a abrirla desde el ícono.
- Esperado: la app abre (offline.html o POS desde caché del service worker); Bridge arriba: `/health` responde `ok:true` en `http://127.0.0.1:7717`; log muestra `Replaying N events to rebuild state`.
- Evidencia (SERVER1): `RUN-CERT-CAPTURE.cmd paso01-coldstart-server1`
- Si falla: P0-PASO-01. Revisar `17-server-log-tail.txt` (¿`NOT_PROVISIONED`? ¿`EADDRINUSE`?).

**PASO 02 — Arranque en frío offline (PDV3)**
- Acción: con internet aún cortado, cerrar y abrir la app en PDV3.
- Esperado: POS carga desde caché SW (no pantalla blanca); `/health` local responde; PDV3 alcanza a SERVER1: `Invoke-RestMethod http://IP_SERVER1:7717/health`.
- Evidencia (PDV3): `powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso02-coldstart-pdv3 -RemoteBridge IP_SERVER1`
- Si falla: P0-PASO-02.

**PASO 03 — Login local (sin internet)**
- Acción: en PDV3, iniciar sesión de empleado (PIN o huella).
- Esperado: login exitoso sin internet. Si es huella: puerto 7718 activo (proxy `/fp/*` del Bridge).
- Evidencia: `RUN-CERT-CAPTURE.cmd paso03-login`
- Si falla: P0-PASO-03. (Mecanismo exacto de login offline vive en la web app — TODO-VERIFY.)

### Fase B — Flujo operativo básico

**PASO 04 — Apertura de turno**
- Acción: abrir turno en PDV3 con fondo de caja.
- Esperado: turno visible en UI; `/state` muestra `turno` no nulo; evento `TURNO_OPENED` (si el flujo pasa por el Bridge — ver nota Fase 1).
- Evidencia: `RUN-CERT-CAPTURE.cmd paso04-turno`
- Si falla: P0-PASO-04.

**PASO 05 — Abrir mesa**
- Acción: abrir una mesa (ej. mesa 5).
- Esperado: mesa `ocupada` en UI; en `/state` `mesas` refleja la mesa con `status` y `order_id`; sin REJECT por lock (locks expiran ~30 s, GC c/30 s).
- Evidencia: `RUN-CERT-CAPTURE.cmd paso05-mesa`
- Si falla: P0-PASO-05.

**PASO 06 — Productos con modificadores**
- Acción: agregar 3+ productos, al menos uno con modificadores (ej. sin cebolla, término de carne) y una nota libre.
- Esperado: UI refleja modificadores y nota; totales correctos.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso06-modificadores`
- Si falla: P0-PASO-06.

**PASO 07 — Crear y guardar orden**
- Acción: guardar la orden de la mesa.
- Esperado: `events.ndjson` crece (evento `ORDER_UPSERTED` con `id` = `command_id`); `09-order-events.ndjson` de la captura contiene la orden.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso07-orden`
- Si falla: P0-PASO-07.

**PASO 08 — Enviar a cocina (KDS recibe)**
- Acción: enviar la orden a cocina.
- Esperado: evento `ORDER_SENT`; la orden aparece en el KDS en <2 s (DELTA por WS); `/state` muestra `kds_orders`/`kds_queue` con la orden.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso08-kds`
- Si falla: P0-PASO-08.

**PASO 09 — Impresión por estación**
- Acción: verificar que la comanda salió en la(s) impresora(s) de estación correctas (cocina/caja/barra según `printers.json`) y el ticket de cliente donde corresponda.
- Esperado: papel físico correcto por estación; en `print-queue.json` los jobs quedan `printed`; `/health` `print_jobs_failed` = 0; `stations` lista las estaciones configuradas.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso09-impresion`
- Si falla: P0-PASO-09.

**PASO 10 — Persistencia de la orden**
- Acción: ninguna (verificación).
- Esperado: `12-persistence.csv` muestra `events.ndjson` y `processed-commands.ndjson` con tamaño > 0 y LastWriteTime de hoy; SHA-256 anotado como baseline.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso10-persistencia`
- Si falla: P0-PASO-10.

**PASO 11 — Cancelación**
- Acción: cancelar un artículo de una orden y luego una orden completa (con motivo).
- Esperado: evento `ORDER_CANCELLED`; mesa vuelve a `libre` en `/state`; KDS retira la orden.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso11-cancelacion`
- Si falla: P0-PASO-11.

**PASO 12 — Split de cuenta**
- Acción: dividir la cuenta de una mesa (por partes iguales y por artículo).
- Esperado: totales cuadran al centavo; sin eventos duplicados en la captura.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso12-split`
- Si falla: P0-PASO-12. (Mapeo exacto de eventos de split — TODO-VERIFY, flujo de web app.)

**PASO 13 — Transferencia de mesa**
- Acción: transferir una orden de mesa A a mesa B.
- Esperado: mesa A `libre`, mesa B `ocupada` con el mismo `order_id` en `/state`; KDS conserva la orden (no se duplica).
- Evidencia: `RUN-CERT-CAPTURE.cmd paso13-transferencia`
- Si falla: P0-PASO-13.

**PASO 14 — Pago local (efectivo)**
- Acción: cobrar una mesa en efectivo, sin internet.
- Esperado: evento `ORDER_CLOSED`; mesa `libre`; ticket impreso; cajón abre si está configurado.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso14-pago`
- Si falla: P0-PASO-14.

**PASO 15 — Propina**
- Acción: registrar propina (monto fijo y %) en un cobro.
- Esperado: propina en el ticket y en el resumen del turno; totales correctos.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso15-propina`
- Si falla: P0-PASO-15. (Persistencia de propina es de la web app/Supabase — TODO-VERIFY.)

**PASO 16 — Retiro / depósito de caja**
- Acción: registrar un retiro de efectivo y un depósito con motivo.
- Esperado: movimientos visibles en el detalle del turno; afectan el corte esperado.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso16-retiro-deposito`
- Si falla: P0-PASO-16. (Flujo de web app — TODO-VERIFY eventos locales.)

### Fase C — Resiliencia de impresión

**PASO 17 — Impresora offline**
- Acción: desconectar el cable de red/corriente de la impresora de cocina. Enviar una orden nueva a cocina.
- Esperado: la app NO se congela; el job queda `recoverable` (o `retrying`→`recoverable`) en `print-queue.json`; `/health` `print_jobs_failed` > 0; el resto de estaciones sigue imprimiendo.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso17-impresora-offline` (WARN de PRINT_QUEUE_CLEAN es esperado aquí)
- Si falla: P0-PASO-17.

**PASO 18 — Cola y retry al reconectar**
- Acción: reconectar la impresora. Esperar la recuperación (o disparar una reimpresión desde la UI).
- Esperado: jobs `recoverable` se reviven a `pending` y terminan `printed` (log: `Revived N recoverable job(s)`); el ticket pendiente sale físicamente; cada retry conserva el mismo `job_id` (sin tickets duplicados).
- Evidencia: `RUN-CERT-CAPTURE.cmd paso18-queue-retry`
- Si falla: P0-PASO-18.

### Fase D — Reinicios y recuperación

**PASO 19 — Reinicio de Electron (PDV3)**
- Acción: anotar `sequence` de `/state`. Cerrar la app en PDV3 (`Ctrl+Shift+Q`) y volver a abrirla.
- Esperado: la app regresa al POS; mesas abiertas y turno intactos; `sequence` local ≥ al anotado; log muestra replay de eventos.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso19-restart-electron`
- Si falla: P0-PASO-19.

**PASO 20 — Reinicio del Bridge (SERVER1)**
- Acción: anotar `sequence` de SERVER1. Cerrar y abrir la app en SERVER1 (el Bridge vive dentro del proceso Electron — no hay servicio separado).
- Esperado: `/health` vuelve con `uptime_s` pequeño y `last_sequence` igual al anotado; las terminales se re-suscriben por WS y reciben SNAPSHOT; `clients_connected` se recupera.
- Evidencia (SERVER1): `RUN-CERT-CAPTURE.cmd paso20-restart-bridge`
- Si falla: P0-PASO-20.

**PASO 21 — Reboot completo de Windows (SERVER1)**
- Acción: `shutdown /r /t 0` en SERVER1.
- Esperado: al volver el login de Windows, la app auto-arranca (login item); Bridge en 7717 sin intervención manual.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso21-reboot-windows`
- Si falla: P0-PASO-21.

**PASO 22 — Recuperación post-reboot**
- Acción: comparar contra la captura del paso 20/21.
- Esperado: `last_sequence` no retrocedió; `events.ndjson` sin líneas corruptas (log SIN `corrupt line(s) skipped`); turno y mesas restaurados; `ZERO_DUPLICATES` = PASS.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso22-recuperacion`
- Si falla: P0-PASO-22.

### Fase E — Multi-terminal y red

**PASO 23 — Multi-terminal simultáneo**
- Acción: con PDV3 y otra terminal (u otra instancia) conectadas a SERVER1, abrir mesas distintas simultáneamente; intentar abrir LA MISMA mesa desde ambas.
- Esperado: `/health` de SERVER1 muestra `clients_connected` ≥ 2 con lista `clients`; la misma mesa en simultáneo produce REJECT/aviso en la segunda terminal (MESA_LOCK), nunca dos órdenes.
- Evidencia (PDV3): `powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso23-multiterminal -RemoteBridge IP_SERVER1`
- Si falla: P0-PASO-23.

**PASO 24 — Reconexión tras corte de red LAN**
- Acción: desconectar el cable de red de PDV3 30–60 s con órdenes activas; reconectar.
- Esperado: al reconectar, la terminal re-suscribe por WS y recibe SNAPSHOT completo; el estado en PDV3 converge con SERVER1 (mismo `sequence` en `/state` local vs remoto); nada se pierde ni duplica.
- Evidencia: `powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso24-reconexion -RemoteBridge IP_SERVER1`
- Si falla: P0-PASO-24.

**PASO 25 — Sync al volver internet**
- Acción: reconectar el WAN del local. Esperar 2–3 min.
- Esperado: las órdenes/cobros hechos offline aparecen en Supabase/backoffice (web app sube su cola); `/state` `last_supabase_sync` cambia a timestamp reciente (poll de 5 s reanudado); heartbeat de flota reanudado. Recordatorio: `sync_queue_size` NO baja a 0 en Fase 1 (ver nota) — no es FAIL.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso25-sync`
- Si falla: P0-PASO-25.

**PASO 26 — Cero duplicados (auditoría del event store)**
- Acción: ninguna (auditoría). Correr captura en SERVER1 y en PDV3.
- Esperado: `ZERO_DUPLICATES` = PASS en ambas: 0 `id` de evento repetidos, 0 `sequence` repetidos, 0 `command_id` repetidos en `processed-commands.ndjson`; verificar también en backoffice que no hay órdenes/cobros dobles del día.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso26-cero-duplicados` (en ambas máquinas)
- Si falla: **P0 crítico** P0-PASO-26 — bloquea la certificación completa.

### Fase F — Cierre

**PASO 27 — Corte X (parcial)**
- Acción: generar corte X desde la UI del POS.
- Esperado: totales del corte = suma de cobros del día de prueba (efectivo, propinas, retiros/depósitos); ticket de corte impreso.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso27-corte-x`
- Si falla: P0-PASO-27. (Flujo de corte vive en la web app — TODO-VERIFY nombre exacto del menú.)

**PASO 28 — Corte Z / cierre de turno**
- Acción: cerrar el turno con arqueo.
- Esperado: evento `TURNO_CLOSED`; `/state` `turno` = null; diferencia de arqueo reportada correctamente; ticket Z impreso.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso28-corte-z`
- Si falla: P0-PASO-28.

**PASO 29 — Soak 4 horas**
- Acción: dejar el sistema operando (o simulando operación ligera) 4 horas. Capturar evidencia al inicio, a las 2 h y a las 4 h en SERVER1.
- Esperado en la captura final: `/health` `uptime_s` ≥ 14400 (sin reinicios espontáneos); `LOG_ERRORS` sin errores nuevos vs captura inicial; `ZERO_DUPLICATES` = PASS; memoria/CPU del proceso estables (ver `02-processes.csv`); `print_jobs_failed` sin crecer.
- Evidencia: `RUN-CERT-CAPTURE.cmd paso29-soak-0h` / `paso29-soak-2h` / `paso29-soak-4h`
- Si falla: P0-PASO-29.

---

## Cierre del día

1. En ambas máquinas: `RUN-CERT-CAPTURE.cmd cierre-final`.
2. Copiar las carpetas `evidence\` completas (PDV3 y SERVER1) al USB.
3. Checklist: 29 pasos con PASS (o P0 documentado + retest PASS), diagnóstico inicial archivado, fotos de tickets físicos (pasos 9, 18, 27, 28).

## TODO-VERIFY (no grounded en código de este repo)

- **IP de SERVER1**: el diagnóstico prueba candidatos `192.168.1.71 / 192.168.0.71 / 192.168.1.1`; confirmar la IP real en sitio (sale en `/health.lan_ip`).
- **Flujos de UI de la web app** (app.fullsite.mx, no está en este repo): login offline, split, transferencia, propina, retiro/depósito, corte X/Z — las acciones son correctas a nivel operación, pero los nombres exactos de menú y qué eventos locales emiten (vs escritura directa a Supabase en Fase 1) deben confirmarse en sitio.
- **Auto-relanzamiento tras crash del main process**: el código maneja crash del renderer (`render-process-gone` → reload), pero no hay watchdog del proceso principal; si el soak revela crash del main, el arranque depende del siguiente login de Windows.
