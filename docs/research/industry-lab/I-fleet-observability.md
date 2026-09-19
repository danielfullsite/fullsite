> ⚠️ **ADVERTENCIA DE FIABILIDAD (añadida 2026-09-18).** Este documento lo produjo un agente del
> intento de research en paralelo del 2026-09-17, que **terminó abortado por límite de uso**; varios
> de esos agentes agotaron el presupuesto de búsqueda y degradaron sus fuentes a mitad del trabajo.
> Además, **toda referencia a código de este repo se leyó del working tree `feat/pos-ui-kit`, que
> está 663 commits atrás de `origin/main`** — el mismo error que invalidó un hallazgo del Track A
> (ver `P0B-COMMAND-RECEIPTS.md`). **No fue revisado.** Úsalo como pista, no como fuente. Antes de
> citar cualquier cosa de aquí: verifica la URL, y verifica el código con `git show origin/main:<ruta>`.

# Track I — Fleet, observabilidad y soporte remoto

> Sprint de investigación (solo lectura). Fecha: 2026-09-17. Sin código, sin commits.
> Pregunta: ¿cómo operan 1,000 restaurantes con un equipo de soporte mínimo, y qué de eso ya
> está resuelto por la industria?
> Etiquetas: **FACT** (fuente citada) · **INFERENCE** (deducción propia) · **RECOMMENDATION**.
> Precios: sólo los públicos, con URL y fecha de consulta (2026-09-17). Donde no hay precio
> público, se dice.

## 0. Punto de partida (lo que ya existe en el repo, verificado hoy)

| Hecho | Fuente |
|---|---|
| Pedro manda un heartbeat cada 5 min a `local_server_heartbeats` con `sync_queue_size`, `last_sync_at`, `print_jobs_failed`, `disk_free_mb`, `version`, `health_status` (`degraded` si cola > 100). Backoff exponencial hasta 30 min. | `electron-app/local-server/telemetry/heartbeat.js:1-130` |
| El heartbeat **sí está cableado** en `origin/main` (`heartbeat.start({...})`) y existe `tests/heartbeat-credenciales.test.js`. | `git show origin/main:electron-app/local-server/index.js` líneas 44, 1036 |
| La tabla ha tenido **0 filas desde que existe**; PR #401 agregó `fleet-heartbeat.yml` que alerta por ausencia a las 14:00 y 20:00 MX. | memoria `project_guardian_mudo_patron.md` (verificada 2026-09-13) |
| Existe un `update/manager.js` con canales `development → pilot → stable`, lista de versiones bloqueadas en Supabase, e instalación sólo sin turno activo — pero "Phase 1": sólo consulta GitHub Releases; electron-updater **no está cableado**. Apunta al repo `ramonfaurdaniel-png/fullsite`, que según memoria `project_remote_real_fullsite.md` da 404. | `electron-app/local-server/update/manager.js:1-25` |
| Installer: electron-builder, target NSIS, `oneClick: true`, `perMachine: true`. Sin `publish`, sin firma configurada. | `electron-app/electron-builder-pos.json` |
| Sentry: cero referencias en `electron-app/`. | `rg -n sentry electron-app` → sin resultados |
| Métricas deseadas ya inventariadas (queue depth, pending sync, last ACK…). | `docs/offline/OBSERVABILITY.md` |

**INFERENCE.** El problema de Fullsite no es falta de diseño (la mitad del plano de control ya
está escrita en comentarios de `heartbeat.js` y `manager.js`); es que nada lo **ejecuta de
punta a punta ni lo vigila por ausencia**. Este track se enfoca en cerrar ese hueco con lo
que la industria ya tiene probado.

---

## 1. Diseño conceptual: FULLSITE FLEET CONTROL PLANE

### 1.1 Entidades

```
tenant (client_id)
 └─ site (sucursal; timezone, horario de servicio, ventana de mantenimiento)
     └─ device (device_id estable, hardware fingerprint, cert/enrollment)
         ├─ role: caja | mesero | kds | pedro (servidor local) | impresora (virtual, reportada por Pedro)
         ├─ version: app_version, local_server_version, protocol_version, sw_version, os_build
         ├─ channel: stable | pilot | development   (ya definido en manager.js)
         └─ desired_config / reported_config (patrón "device twin")
release (semver, canal, stagingPercentage, allowlist/denylist de sites, blocked=bool)
job (acción remota: target set, rollout rate, abort threshold, timeout, ventana)
audit_event (quién, qué, a qué device, resultado, timestamp)
```

**FACT.** El modelo *desired/reported* con `$version` incremental y ETag es exactamente el
Device Twin de Azure IoT Hub: el backend escribe `desired`, el dispositivo escribe `reported`,
y al reconectar el dispositivo **debe** (1) suscribirse a cambios y (2) leer el documento
completo, ignorando notificaciones con `$version` menor
(https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-device-twins). Límites que
vale copiar: tags 8 KB, desired/reported 32 KB cada uno.

**RECOMMENDATION.** Implementar el twin como dos columnas JSONB en `fleet_devices`
(`desired_config`, `reported_config`) + `desired_version int` + `reported_version int`. Pedro
lee `desired` en cada heartbeat (pull, no push: cero puertos abiertos, funciona detrás de
cualquier NAT) y escribe `reported` en el mismo request. Un "push de config" es solamente
un UPDATE de `desired_config`; el dispositivo lo aplica en ≤ 5 min.

### 1.2 Identidad de dispositivo

**FACT.** AWS recomienda X.509 por dispositivo y, cuando no hay certificado de fábrica,
*Fleet Provisioning by claim*: un certificado de reclamo compartido **por lote**, que se
canjea por uno único en el primer arranque; nunca compartir llaves privadas entre
dispositivos, y planear renovación antes de expirar o hay outage de flota
(https://docs.aws.amazon.com/iot/latest/developerguide/iot-provision.html).

**RECOMMENDATION (versión mínima para Fullsite).**
1. **Enrollment token** de un solo uso, por site, con caducidad 24 h, generado desde el
   panel de plataforma (ya existe `provisionTenant()`; se agrega `provisionDevice()`).
2. El instalador lo pide una vez; Pedro lo canjea por un **device key** (JWT de larga vida
   firmado por Supabase o un secreto por device guardado en `fleet_devices.key_hash`).
3. `device_id` = UUID generado en el enrolamiento, **no** el hardware fingerprint.
   El fingerprint (`os.hostname` + serial de disco + MAC primaria) se reporta sólo para
   detectar clones/reimágenes y alertar "mismo device_id desde dos máquinas".
4. Cada request de flota lleva el device key; RLS filtra por `client_id` del device.
   Cumple §12 del protocolo (fallar cerrado sin mapping).
5. X.509 real + mTLS se deja para cuando exista Cliente #50; el JWT por device cubre 1→100.

### 1.3 Contrato de heartbeat

**FACT.** El patrón *dead man's switch* invierte el monitoreo: el proceso hace ping, el
monitor alerta si el ping **no llega** en `period + grace`
(https://healthchecks.io/docs/). Prometheus lo expresa como `absent()` /
`absent_over_time()`: devuelve 1 cuando el vector está vacío
(https://prometheus.io/docs/prometheus/latest/querying/functions/#absent).

**RECOMMENDATION — contrato v1 (aditivo al payload actual de `heartbeat.js`):**

| Campo | Tipo | Nota |
|---|---|---|
| `device_id`, `client_id`, `site_id`, `role` | text | del enrolamiento |
| `reported_at` | timestamptz | reloj del dispositivo; el servidor guarda además `received_at` para detectar drift |
| `seq` | bigint | monotónico por device; huecos = heartbeats perdidos |
| `versions` | jsonb | `{app, local_server, protocol, sw, os_build, printer_driver}` |
| `health` | jsonb | `{pedro_up, wan_up, lan_clients, sync_queue, last_sync_at, last_ack_at, print_failed_1h, printers:[{name,status,last_ok}], disk_free_mb, ram_free_mb, uptime_s, clock_drift_s, kds_connected}` |
| `reported_config_version` | int | eco del twin |
| `channel` | text | |

Cadencia: **60 s con jitter ±10 s** (no 5 min: a 5 min una caja caída pasa desapercibida un
cuarto de servicio). Persistir el último heartbeat no enviado en disco y **reenviar con el
mismo `seq`** al reconectar (idempotencia por `(device_id, seq)`).

**INFERENCE sobre "wan_up".** `navigator.onLine` no sirve (§11 del protocolo). Se mide como
"último 2xx de Supabase hace < 90 s" y, separado, "último ping LAN a Pedro < 10 s" para
distinguir *sin internet* de *sin Pedro*.

### 1.4 Modelo de salud por site (rojo / amarillo / verde)

| Señal | Verde | Amarillo | Rojo |
|---|---|---|---|
| Heartbeat de Pedro | < 3 min | 3–10 min **en horario de servicio** | > 10 min en horario de servicio |
| Heartbeat de cajas/KDS | todas las esperadas presentes | falta 1 de N | falta la caja principal o todos los KDS |
| `sync_queue` | < 20 | 20–100 o creciendo 15 min | > 100 (umbral ya en `heartbeat.js`) o creciendo 1 h |
| `last_ack_at` | < 5 min con WAN | 5–30 min | > 30 min con WAN up |
| Impresoras | todas `ok` | 1 con fallo < 1 h | impresora de caja o cocina caída |
| Disco | > 2 GB | 0.5–2 GB | < 500 MB |
| WAN | up | intermitente (≥ 3 caídas/h) | down > 15 min (informativo: offline es esperado) |
| Versión | en canal | 1 versión atrás | versión en lista `blocked` |
| Reloj | drift < 30 s | < 5 min | > 5 min (rompe cortes y business_day) |

El color del site es el **peor** color de sus señales críticas (heartbeat, cola, impresora
de caja). La ausencia de heartbeats de **todo un site** se evalúa sólo dentro de su horario
de servicio (hallazgo de PR #401: alertar cuando las cajas están apagadas entrena a ignorar).

### 1.5 Alertar por ausencia (el guardián mudo)

**RECOMMENDATION — tres capas, ninguna depende de la otra:**
1. **SQL en Supabase (pg_cron o workflow):** `select site_id from fleet_sites where
   in_service_now(site_id) and not exists (select 1 from fleet_heartbeats h where
   h.site_id = s.id and h.received_at > now() - interval '10 min')`. Esto ya es la lógica
   de `fleet-heartbeat.yml`; falta que corra cada 5 min, no dos veces al día.
2. **Dead man's switch externo del propio guardián:** el workflow que evalúa (1) hace ping a
   un check de Healthchecks.io (20 checks gratis, self-hosteable, BSD-3, 10.3k★ —
   https://healthchecks.io/pricing/ · https://github.com/healthchecks/healthchecks). Si el
   guardián deja de correr, Healthchecks avisa. Es el "caso 4" de la memoria (Telegram
   mudo ≥ 54 días) resuelto con una URL.
3. **Métrica de presencia en Grafana:** `absent_over_time(fullsite_heartbeat{site="x"}[10m])`
   como alerta; sirve cuando exista un backend OTel (§4).

### 1.6 Acciones remotas

| Acción | Mecanismo | Riesgo |
|---|---|---|
| Reiniciar Pedro | `desired_config.command = {id, type:'restart', not_before, expires}`; Pedro lo ejecuta fuera de turno o si `force` y confirma en `reported` | Pedro muere si muere Electron (regla dura); reiniciar Pedro = reiniciar la app |
| Traer logs | comando `upload_logs {since}`; Pedro sube tail comprimido a Supabase Storage bucket por tenant; nunca payloads de órdenes completos (§13) | tamaño; sanitizar PIN |
| Push config | UPDATE de `desired_config` | conflictos → `$version` |
| Update | `desired_config.release = {version, channel}`; ver §2 | instalar durante servicio |
| Rollback | `desired_config.release = versión anterior` + `allowDowngrade: true` en electron-updater | requiere que el instalador anterior siga publicado |
| Sesión remota | Tailscale SSH / RustDesk (§5) | acceso humano = auditado |

**FACT.** AWS IoT Jobs modela exactamente esto: rollout constante o exponencial
(`baseRatePerMinute`, `incrementFactor`, criterio de aumento por notificados o exitosos),
**abort** por porcentaje de `FAILED/REJECTED/TIMED_OUT` sobre un mínimo de ejecuciones,
timeout de 1 min a 7 días, reintentos hasta 10, y **ventanas de mantenimiento recurrentes**
en las que el job sólo avanza dentro de la ventana
(https://docs.aws.amazon.com/iot/latest/developerguide/jobs-configurations-details.html).
Precio: $0.0030 por acción remota las primeras 250k/mes; registro $0.10 por 1,000 things
(https://aws.amazon.com/iot-device-management/pricing/ vía búsqueda; verificar en la página
oficial antes de citar en un doc externo).

**RECOMMENDATION.** Copiar el **modelo** de Jobs (rollout rate, abort threshold, timeout,
ventana) en una tabla `fleet_jobs` + `fleet_job_executions` en Supabase. No adoptar AWS IoT:
Pedro ya habla con Supabase y agregar MQTT/AWS es una segunda nube.

### 1.7 Auditoría

Toda escritura a `desired_config`, `fleet_jobs` y toda sesión remota humana → `fleet_audit`
(actor, device, acción, payload hash, resultado, ts). Inmutable (sin UPDATE/DELETE por RLS).
Es la misma regla que ya existe para `evidence` y `agent_results`.

---

## 2. Auto-update

### 2.1 Hechos sobre el stack actual (electron-builder + NSIS)

- **FACT.** electron-updater soporta auto-update en Windows sólo con NSIS; Squirrel.Windows
  "is not supported" y está deprecado en electron-builder
  (https://www.electron.build/docs/features/auto-update/ ·
  https://github.com/electron-userland/electron-builder/issues/1256). Fullsite ya está en
  NSIS: no hay migración.
- **FACT.** *Staged rollout*: `stagingPercentage` 0–100 en `latest.yml`, editado **a mano**
  después del build; electron-updater compara el porcentaje contra un ID numérico de
  usuario (https://www.electron.build/docs/features/auto-update/).
- **FACT.** NSIS soporta paquetes diferenciales (`differentialPackage`)
  (https://www.electron.build/docs/api/electron-builder.interface.nsisoptions/).
- **FACT.** Providers: GitHub Releases, S3, Spaces, Cloudflare R2, Keygen y "generic HTTP"
  (en generic hay que subir `latest.yml` a mano). `allowDowngrade` existe pero está poco
  documentado.
- **FACT.** update.electronjs.org es gratis pero exige **repo público** en GitHub
  (https://www.electronjs.org/docs/latest/tutorial/updates). Descartado para Fullsite.
- **FACT.** Hazel (vercel/hazel, 3k★, MIT) lleva **sin commits desde 2024-06**; sirve
  releases de GitHub, no tiene staged rollout. Descartar.
- **INFERENCE.** Rollback "automático" no existe en electron-updater: rollback = publicar
  otra vez la versión anterior (o bajar `stagingPercentage` a 0 y apuntar `latest.yml` a
  ella). Un `latest.yml` **por canal y por site** generado desde Supabase (ver 2.3) da el
  control que falta.

### 2.2 Firma de código en Windows — contradicción importante

- **FACT.** Microsoft dice que **EV ya no salta SmartScreen desde 2024**; OV y Azure
  Artifact Signing (antes Trusted Signing, ~$9.99/mes) construyen reputación igual; EV
  "no longer recommended specifically for SmartScreen bypass"
  (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).
- **FACT.** Artifact Signing está disponible **sólo para organizaciones en USA, Canadá, UE y
  UK** (misma página) y no acepta suscripciones gratuitas/trial
  (https://learn.microsoft.com/en-us/azure/artifact-signing/faq).
- **Contradicción con el mercado de blogs:** varias guías de 2025-2026 siguen recomendando
  EV "para evitar SmartScreen" (p. ej. https://signmycode.com/azure-key-vault-ev-code-signing).
  La fuente primaria (Microsoft) pesa más.
- **RECOMMENDATION.** FULLSITE SAS es mexicana → **no elegible** para Artifact Signing.
  Camino: certificado **OV** de una CA (Microsoft cita $150–300/año; requiere llave en
  HSM/token USB desde jun-2023). Firmar **siempre con la misma identidad** para acumular
  reputación. Alternativa a evaluar: constituir entidad en USA (fuera de alcance de este
  track). Sin firma, cada instalador nuevo dispara SmartScreen en cada caja: no escala.

### 2.3 Diseño del rollout para Fullsite

**RECOMMENDATION.**
1. Publicar artefactos NSIS + `latest.yml` en **Cloudflare R2** (provider soportado, egress
   gratis) o Supabase Storage vía provider `generic`.
2. Un endpoint propio `GET /fleet/update/latest.yml?device=…` (Next.js o Edge Function) que
   **genera** `latest.yml` según: canal del device, `stagingPercentage` del release, lista
   `blocked`, y allowlist de sites. Así el rollout se controla desde una tabla, no editando
   YAML a mano. electron-updater sólo ve un `generic` provider.
3. Orden de canary **por rol y por site**: `development` (lab) → `pilot` (1 site amigo, KDS
   primero, caja después) → `stable` 10 % → 50 % → 100 %. KDS antes que caja porque un KDS
   caído no bloquea cobrar.
4. **Ventana**: instalar sólo sin turno activo y sin órdenes abiertas (ya en `manager.js`),
   **y** dentro de la ventana de mantenimiento del site (ej. 03:00–06:00 local, con
   `getActiveTimezone()`). Nunca durante servicio.
5. **Abort automático**: si > 10 % de devices actualizados a X no reportan heartbeat con
   `version = X` en 30 min, `stagingPercentage := 0` y alerta. Es el `AbortConfig` de AWS
   Jobs aplicado a heartbeats.
6. **Rollback**: mantener publicados los últimos 3 releases; `desired_config.release`
   + `allowDowngrade`.

**FACT — lo que hace la industria.** Clover publica ROM trimestral, primero en sandbox y
luego "production rollout lasting several weeks"
(https://docs.clover.com/dev/docs/clover-android-rom-updates-2025). CrowdStrike, tras el
19-jul-2024, comprometió *staged deployment* de contenido, validación en el intérprete y
control del cliente sobre la cadencia
(https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf).
Google SRE: el canary debe ser "sizeable and last long enough to be representative", con
~una docena de métricas atribuibles al cambio y granularidad de monitoreo ≤ duración del canary
(https://sre.google/workbook/canarying-releases/).

**INFERENCE.** Toast no publica su práctica de rollout de flota; su blog técnico habla de
compatibilidad de bibliotecas Android (Gummy Bears / Expediter,
https://technology.toasttab.com/entry/testing-android-compatibility/). Square publica
"Hardware at Square" pero no un post específico de staged rollout de readers. No inventar
que lo hacen "así"; lo verificable es Clover y CrowdStrike.

---

## 3. Crash reporting

- **FACT.** `@sentry/electron` (259★, MIT, activo hoy) captura errores de main y renderer y
  **minidumps nativos** vía Electron `crashReporter`; los sube "when the application restarts
  (or immediately after a renderer crash)"
  (https://docs.sentry.io/platforms/javascript/guides/electron/features/native-crash-reporting/).
- **FACT.** Tiene **transporte offline integrado**: `transportOptions.maxAgeDays`,
  `maxQueueSize`, `flushAtStartup`, `shouldSend/shouldStore`; y `autoSessionTracking`
  (default `true`) + `release` dan Release Health (crash-free sessions por versión)
  (https://docs.sentry.io/platforms/javascript/guides/electron/configuration/options/).
- **INFERENCE.** Release Health + `release = app_version` es el detector de canary más barato
  que existe: "crash-free sessions de v1.4.0 < v1.3.8" dispara abort del rollout sin
  construir nada.
- **RECOMMENDATION.** Sentry en main + renderer + Pedro (Node), con `beforeSend` que
  elimina PIN, nombres y montos (§13). Precio no verificado en esta sesión: no citar.
  Alternativa self-hosted: GlitchTip o Sentry self-hosted; sólo si el volumen lo justifica.

---

## 4. OpenTelemetry en el edge y backends

- **FACT.** OTel Collector: `sending_queue` en memoria + reintento con backoff y jitter (5 min
  default); con `file_storage` la cola es un WAL en disco que sobrevive reinicios; se pierde
  dato si el endpoint sigue caído más allá de `max_elapsed_time` o si la cola/disco se llena.
  "Guarantees might not be as strong as dedicated message queues"
  (https://opentelemetry.io/docs/collector/resiliency/).
- **INFERENCE.** Un Collector por caja es demasiado para un POS en Windows (binario Go,
  config YAML, otro proceso que vigilar). Pedro ya es el agregador del site: que Pedro
  emita OTLP/HTTP con el mismo patrón (cola en disco, backoff) y las cajas manden a Pedro por
  LAN. Un Collector opcional sólo en sites grandes.

### Costos públicos por backend (consultados 2026-09-17)

| Backend | Gratis | Pago | Estimación a 1,000 sites |
|---|---|---|---|
| Grafana Cloud | 10k series, 50 GB logs, 50 GB traces, 14 d | $19/mes + $6.50 por 1,000 series; logs $0.40/GB + $0.05 + $0.10 (https://grafana.com/pricing/ vía https://monitoringcost.com/grafana-cloud-pricing) | 1,000 sites × ~30 series = 30k series → ≈ $19 + 20×$6.50 ≈ **$150/mes** en métricas; logs aparte |
| Axiom | 500 GB/mes, 25 GB storage, 30 d | desde $25/mes, 1 TB incluido (https://axiom.co/pricing vía búsqueda) | logs de flota caben en gratis/$25 si se manda sólo eventos, no debug |
| SigNoz Cloud | — | desde $49/mes; logs/traces $0.30/GB, métricas $0.10/M samples (https://signoz.io/pricing/) | self-hosted gratis (32k★) si hay quien lo opere |
| Honeycomb | 20M eventos/mes | Pro desde $150/mes (https://www.honeycomb.io/pricing) | 1,000 sites × 1 heartbeat/min = 43M eventos/mes → excede gratis |
| Better Stack | no verificado | no verificado | — |
| Highlight.io | 500 sesiones/mes (legacy) | **ahora es parte de LaunchDarkly** (https://cubeapm.com/blog/highlight-io-pricing-and-review/); repo sin commits desde 2026-08 | no apostar |

**RECOMMENDATION.** Fase 1 (10 sites): heartbeats y salud en **Supabase** (ya está), tablero
en el panel de plataforma. Fase 2 (100): Grafana Cloud free para métricas de flota con
`absent_over_time`, Sentry para crashes. Fase 3 (1,000): revisar Grafana Pro (~$150–300/mes
métricas) vs SigNoz self-hosted. No es un problema de costo; es de quién lo opera.

---

## 5. Acceso remoto y soporte

| Opción | Hechos | Costo público | Encaje |
|---|---|---|---|
| **Tailscale** (actual) | Planes 2026: Personal gratis 6 usuarios; Standard $8/usuario/mes; Premium $18. Dispositivos de usuario ilimitados; **tagged devices** (servidores, sin usuario) 50 incluidos en Personal, +$1/mes c/u; ACL groups 3/10/300; Tailscale SSH avanzado sólo Premium (https://tailscale.com/pricing · https://tailscale.com/kb/1068/tags) | 1,000 Pedros como tagged devices ≈ 950 × $1 = **~$950/mes** más asientos (INFERENCE sobre el precio unitario; confirmar con ventas) | Ya funciona; subnet routers permiten llegar a impresoras sin cliente (https://tailscale.com/kb/1019/subnets) |
| Headscale | 43.9k★, BSD-3, Go; servidor de control compatible con clientes Tailscale | $0 + operarlo | Salida si el costo por tagged device crece |
| Cloudflare Tunnel / Zero Trust | gratis hasta 50 usuarios, túneles ilimitados; PAYG $7/usuario (https://controld.com/blog/cloudflare-zero-trust-pricing/) | ~$0 para el equipo de soporte | Túnel outbound por Pedro para exponer `/state` a soporte sin abrir puertos |
| RustDesk | 124k★, **AGPL-3.0**, servidor OSS gratis + Pro de pago (https://github.com/rustdesk/rustdesk) | $0 self-hosted | Escritorio remoto para "ver la caja"; AGPL exige publicar cambios si se modifica |
| MeshCentral | 7.2k★, Apache-2.0; escritorio, terminal, archivos, consola web, agente Windows (https://github.com/Ylianst/MeshCentral) | $0 self-hosted | Licencia más cómoda; un agente en cada caja |
| Splashtop Remote Support | $22/mes por técnico concurrente; 10 o 300 endpoints por licencia, máx 1,200; Enterprise para > 1,200 (https://www.splashtop.com/pricing/remote-support) | 4 licencias ≈ $1,600/año para 1,200 endpoints | Barato y sin operar servidor |
| TeamViewer / AnyDesk | precios por técnico; búsqueda sin cifra clara a 1,000 endpoints | no verificado | Ya se usa TeamViewer en SERVER1 (memoria) |
| Intune kiosk (Assigned Access) | single-app kiosk para Win32 vía AUMID/XML (https://learn.microsoft.com/en-us/windows/configuration/assigned-access/configure-single-app-kiosk) | licencia Intune por device, no verificada | Bloquear la caja a Fullsite POS; útil desde ~50 sites |
| Fleet (fleetdm) | 6.9k★, Go, free self-hosted; Premium $7/host/mes (https://fleetdm.com/pricing) | 1,000 × $7 = $7,000/mes Premium; free sin soporte | osquery en cada caja da inventario de OS/disco/procesos "gratis"; Fullsite no debe reinventar el inventario de máquina |
| balenaCloud | 10 devices gratis; Production $1,439/mes por 110, $2/device extra (https://www.balena.io/pricing) | 1,000 devices ≈ $1,439 + 890×$2 ≈ **$3,200/mes** | Sólo aplica si Pedro corriera en Linux (balenaOS); hoy es Electron en Windows: **no aplica** |
| Mender | OSS gratis; Basic $34/50 devices; Professional $291/250 con delta y scheduling; phased rollouts sólo Enterprise (https://mender.io/pricing/plans) | Enterprise sin precio público | Linux/embedded; **no aplica** a Windows |

**RECOMMENDATION.** Mantener Tailscale como transporte (tagged devices por Pedro, ACL por
tenant), agregar **MeshCentral self-hosted** (Apache-2.0) para escritorio remoto cuando haga
falta ver la pantalla, y Fleet/osquery free para inventario. Evitar RustDesk si se planea
modificarlo (AGPL). Toda sesión humana → `fleet_audit`.

---

## 6. Postmortems que sí enseñan

| Incidente | Causa | Lo que cambiaron | Lección para Fullsite |
|---|---|---|---|
| Square 2023-09-07, ~15 h | cambio de firewall host + upgrade de DNS → DNS interno cayó; "many services used for troubleshooting and recovery were also impacted" (https://developer.squareup.com/blog/incident-summary-2023-09-07/) | DNS aislado; monitoreo de red crítica; desacoplar deploy de plataforma; **expandir Offline Mode** | El plano de control **no** debe depender de la misma ruta que el POS. Si Supabase cae, Tailscale + `/state` de Pedro deben seguir sirviendo |
| CrowdStrike 2024-07-19 | contenido sin staged rollout + validador con bug (RCA arriba) | staged deployment, canary, control del cliente | `stagingPercentage` obligatorio; nunca 100 % de un golpe |
| Clover sep-2024, Shopify may-2024 (Cloudflare), Shopify Cyber Monday 2025 (auth) | dependencias externas y login (https://koronapos.com/blog/clover-pos-outage/ · https://statusgator.com/blog/shopify-outage-history/) | (no hay RCA público) | El login no puede ser dependencia de cobrar: ya es la postura de Fullsite (PIN offline) |
| Toast durante AWS 2025-10-20 | AWS us-east-1 (https://www.nrn.com/restaurant-technology/the-aws-outage-left-many-restaurants-scrambling) | (sin RCA público de Toast) | Offline-first es el diferenciador; el fleet plane debe **degradar a solo-lectura**, no bloquear |

**INFERENCE.** Ningún POS grande publica postmortems de flota de terminales (Toast, Clover
no tienen RCA público). Lo publicable y reutilizable viene de Square (una vez), CrowdStrike,
y Google SRE.

---

## 7. Feature flags y kill switches en el edge

- **FACT.** Unleash (13.8k★, **AGPL-3.0**), Flagsmith (6.6k★, BSD-3, proveedor OpenFeature),
  GrowthBook (8.4k★, licencia propia "NOASSERTION" en GitHub) son self-hosteables;
  OpenFeature (`open-feature/js-sdk`, Apache-2.0) abstrae el proveedor
  (https://www.getunleash.io/blog/11-open-source-feature-flag-tools · repos citados).
- **INFERENCE.** Para un POS offline, el flag debe evaluarse **local** con snapshot en disco
  y `default` seguro. Eso es lo que Fullsite ya hace con `desired_config`: un flag es una
  llave más del twin. Introducir Unleash/Flagsmith añade un servidor y un SDK para lo que
  cabe en un JSONB de 32 KB.
- **RECOMMENDATION.** Flags como `desired_config.flags{}` con snapshot local; kill switch =
  flag + `blocked_versions` (ya existe en `manager.js`). Adoptar OpenFeature sólo en el
  dashboard web, donde sí hay muchos flags de producto.

---

## 8. Build / Buy / Partner / Open source por componente

| Componente | Decisión | Por qué | Costo a 1,000 nodos |
|---|---|---|---|
| Registro de devices, twin, jobs, salud, auditoría | **BUILD** sobre Supabase | Ya hay tablas y RLS por tenant; es el IP | ~$0 marginal (filas) |
| Alerta por ausencia | **BUILD** (SQL) + **OSS** Healthchecks como dead man del guardián | 3 casos de guardián mudo | $0–$20/mes |
| Auto-update | **OSS** electron-updater + **BUILD** `latest.yml` dinámico | Sin migración; control desde tabla | R2 ≈ $0 egress |
| Firma Windows | **BUY** OV cert | Artifact Signing no elegible en MX | $150–300/año |
| Crash reporting | **BUY** Sentry (o self-host) | Offline transport + Release Health listos | precio no verificado |
| Métricas/logs | **BUY** Grafana Cloud free → Pro | absent() y dashboards | ≈ $150–300/mes métricas |
| Transporte remoto | **BUY** Tailscale (ya) · **OSS** Headscale como plan B | tagged devices $1/mes | ≈ $950/mes + asientos (INFERENCE) |
| Escritorio remoto | **OSS** MeshCentral | Apache-2.0, agente Windows | $0 + VPS |
| Inventario de máquina | **OSS** Fleet/osquery free | no reinventar | $0 |
| Kiosk Windows | **BUY** Intune (desde ~50 sites) | Assigned Access | no verificado |
| Feature flags edge | **BUILD** en twin | offline | $0 |
| IoT platforms (AWS/Azure/balena/Mender) | **NO** | Segunda nube, o Linux-only | — |

---

## 9. Repos relevantes (verificados con `gh api` el 2026-09-17)

Formato: REPO / STARS / LAST_ACTIVE / LICENSE / LANG / QUÉ RESUELVE / CALIDAD / QUÉ APRENDER / REUSO / RIESGOS

- **electron-userland/electron-builder** / 14,662 / 2026-09-17 / MIT / TS / build + auto-update NSIS con staged rollout y diffs / producción / `stagingPercentage`, providers generic/R2 / **reusar tal cual** / `latest.yml` manual; mantenedor único histórico.
- **getsentry/sentry-electron** / 259 / 2026-09-17 / MIT / TS / errores main+renderer, minidumps, offline queue, release health / producción / `transportOptions` offline / **reusar** / pocas estrellas pero es SDK oficial.
- **healthchecks/healthchecks** / 10,337 / 2026-09-14 / BSD-3 / Python / dead man's switch con period+grace / producción / modelo period/grace/start-ping / **reusar SaaS o self-host** / ninguno relevante.
- **open-telemetry/opentelemetry-collector-contrib** / 4,971 / 2026-09-17 / Apache-2.0 / Go / `file_storage` + cola persistente / producción / diseño de cola WAL con backoff+jitter / **aprender, no instalar en cajas** / pesado para Windows POS.
- **fleetdm/fleet** / 6,871 / 2026-09-17 / licencia mixta (NOASSERTION en GitHub; free = MIT según sitio) / Go / visibilidad de devices vía osquery / producción / tablas de inventario, "live query" / **reusar free** / dos licencias en un repo.
- **SigNoz/signoz** / 32,116 / 2026-09-17 / mixta (NOASSERTION) / TS+Go / backend OTel completo self-host / producción / — / plan B a Grafana / requiere ClickHouse, operación.
- **rustdesk/rustdesk** / 124,042 / 2026-09-17 / AGPL-3.0 / Rust / escritorio remoto self-host / producción / modelo ID+relay / reusar sin modificar / AGPL; servidor Pro de pago.
- **Ylianst/MeshCentral** / 7,242 / 2026-09-17 / Apache-2.0 / JS / escritorio, terminal, archivos, agente Windows / producción (Intel) / agente que se auto-actualiza desde el servidor / **reusar** / bus factor 1.
- **juanfont/headscale** / 43,920 / 2026-09-15 / BSD-3 / Go / control server compatible Tailscale / producción comunitaria / — / plan B / no oficial de Tailscale.
- **Unleash/unleash** / 13,811 / 2026-09-17 / AGPL-3.0 / TS / flags con Edge proxy / producción / modelo de "Unleash Edge" (snapshot local) / aprender / AGPL, servidor extra.
- **Flagsmith/flagsmith** / 6,558 / 2026-09-17 / BSD-3 / Python / flags + remote config, OpenFeature / producción / remote config = twin / aprender / servidor extra.
- **growthbook/growthbook** / 8,376 / 2026-09-17 / NOASSERTION / TS / flags + experimentos / producción / — / no ahora / licencia a revisar.
- **open-feature/js-sdk** / 281 / 2026-09-17 / Apache-2.0 / TS / API neutral de flags / producción (CNCF) / interfaz `getBooleanValue(default)` / reusar en dashboard / —.
- **balena-io/open-balena** / 1,271 / 2026-09-16 / AGPL-3.0 / Shell / control plane de flota Linux / producción / acciones: restart services, reboot, purge, shutdown (https://docs.balena.io/learn/manage/actions/) / **aprender el catálogo de acciones** / Linux-only.
- **mendersoftware/mender** / 1,227 / 2026-09-15 / mixta / C++ / OTA Linux con rollback A/B / producción / rollback A/B por partición como ideal / aprender / Linux-only.
- **highlight/highlight** / 9,375 / 2026-08-20 / NOASSERTION / TS / monitoreo full-stack / **adquirido por LaunchDarkly**, sin commits en 4 semanas / — / no / riesgo de abandono.
- **vercel/hazel** / 3,021 / 2024-06-10 / MIT / JS / servidor de updates sobre GitHub Releases / **abandonado** / — / no / sin staged rollout.

---

## 10. Lo que la industria ya sabe (no redescubrir)

1. **Silencio ≠ salud.** Dead man's switch con `period + grace`; `absent_over_time`.
2. **Desired/Reported con versión monótona** y lectura completa al reconectar (Azure twin).
3. **Rollout = tasa + abort + timeout + ventana** (AWS Jobs). Nunca 100 % de golpe (CrowdStrike).
4. **Canary con métricas atribuibles**, ~12, y monitoreo con granularidad ≤ duración del canary (Google SRE).
5. **El plano de control cae con el plano de datos** si comparten dependencias (Square 2023): Tailscale + `/state` deben vivir aparte de Supabase.
6. **Crash-free sessions por release** es el detector de regresión más barato (Sentry Release Health).
7. **Cola persistente en disco con backoff+jitter** para telemetría (OTel `file_storage`).
8. **Identidad por device desde el enrolamiento**, no por hardware ni por usuario (AWS Fleet Provisioning; Tailscale tags).
9. **EV ya no compra confianza en SmartScreen**; la reputación se acumula por identidad constante (Microsoft, 2026-08).
10. **Rollouts trimestrales con sandbox previo y semanas de producción** son normales en POS (Clover).

## 11. Qué construir como IP propio

- **El modelo de salud del restaurante** (§1.4): impresora de caja, cola de sync, KDS, reloj,
  horario de servicio por site. Ningún vendor genérico sabe que "impresora de cocina caída
  a las 14:00" es rojo y "caja apagada a las 03:00" es verde.
- **Rollout por rol** (KDS antes que caja) y **ventana por turno** (sin turno activo, sin
  órdenes abiertas, en ventana local). Es la unión del dominio POS con el patrón Jobs.
- **`latest.yml` dinámico por device** desde Supabase: convierte electron-updater en un
  sistema de rollout controlado por tabla sin cambiar el cliente.
- **Abort por heartbeat**: el heartbeat reporta `version`; si la versión nueva deja de
  reportar, el rollout se detiene solo.
- **Auditoría de soporte por tenant** integrada al mismo `client_id` que los datos.

## 12. Fastest wins (días, con lo que ya existe)

1. **Descubrir por qué hay 0 filas** en `local_server_heartbeats`: está cableado en main
   con backoff; el fallo es credenciales, tabla inexistente o RLS. Una prueba de
   `heartbeat-credenciales.test.js` contra staging y leer el `console.warn` en una caja
   real lo resuelve. (Regla de la cita: no afirmo cuál de las tres; hay que ir a ver.)
2. **`fleet-heartbeat.yml` cada 5 min en horario de servicio** en vez de 14:00/20:00, y su
   ping a Healthchecks.io (gratis, 20 checks) como dead man del guardián.
3. **Sentry Electron** en main + renderer + Pedro con `release = app_version` y transporte
   offline: un `npm install` y 20 líneas; da Release Health desde el primer instalador.
4. **Subir cadencia a 60 s con jitter** y agregar `seq`, `printers[]`, `clock_drift_s` al
   payload (aditivo; no rompe la tabla).
5. **Cotizar certificado OV** hoy: el lead time de validación es de días y bloquea todo
   auto-update.
6. **Corregir `GITHUB_REPO` en `manager.js`** (`ramonfaurdaniel-png/fullsite` → remoto real)
   o, mejor, apuntar al `latest.yml` dinámico.
7. **Tagged devices en Tailscale** para cada Pedro con ACL por tenant: quita la dependencia
   de la cuenta de usuario y deja key expiry deshabilitado por default.

## 13. Top 5 URLs

1. https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-device-twins — el modelo desired/reported que hay que copiar.
2. https://docs.aws.amazon.com/iot/latest/developerguide/jobs-configurations-details.html — rollout rate, abort, timeout, ventanas.
3. https://www.electron.build/docs/features/auto-update/ — `stagingPercentage`, providers, NSIS.
4. https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options — EV ya no salta SmartScreen; Artifact Signing no disponible en MX.
5. https://developer.squareup.com/blog/incident-summary-2023-09-07/ — por qué el plano de control no puede compartir dependencias con el POS.

## 14. Contradicciones y huecos registrados

- EV vs SmartScreen: blogs comerciales vs Microsoft (§2.2). Gana Microsoft.
- Tailscale: el pricing público habla de "tagged resources" a $1/mes en Personal; si aplica
  igual en Standard/Premium no está claro en la página. **Pendiente** confirmar antes de
  presupuestar 1,000 Pedros.
- Sentry, Intune, TeamViewer, Better Stack: precios **no verificados** en esta sesión.
- Toast/Square: no hay fuente primaria de su rollout de terminales; no se afirma nada.
- Highlight.io: el repo dice open source; el mercado dice "ahora LaunchDarkly". No apostar.
- balena/Mender: excelentes, pero Linux-only; sólo relevantes si Pedro migra a un edge box
  Linux (Track B decide eso, no este).
