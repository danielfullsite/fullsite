# SOURCE OF TRUTH — qué versión de Fullsite existe realmente hoy

> **INTERNO.** Contiene deriva de migraciones, topología de un cliente con nombre y bloqueadores de
> release. No publicar sin decisión explícita — ver §4.
>
> **Fecha del corte:** 2026-09-18 · **`origin/main`:** `10017cf9` · **Base consultada:** AMALAY
> (`qjiomlvudfmzuvqvhwpk`), `SELECT` de sólo lectura.
> **Método:** código leído con `git show origin/main:<ruta>`, nunca del disco. Esquema leído por
> introspección de Postgres, nunca de los archivos de migración.
>
> Hermanos: [`SYSTEM-MAP.md`](SYSTEM-MAP.md) (qué camino usa cada dominio) ·
> [`RELEASE-BOARD.md`](RELEASE-BOARD.md) (qué candidato está bajo prueba).
> **Para saber cómo funciona cada componente**, no dupliques: usa `docs/COMO-FUNCIONA-TODO.md`
> (rama `docs/system-map`, PR #340, 459 líneas). Este documento contesta otra pregunta: *quién manda*.

---

## 1 · CATÁLOGO POR DOMINIO

`STATUS` ∈ `ACTIVE` · `PARTIAL` · `CANDIDATE` · `PENDING` · `LEGACY` · `UNKNOWN`.
`ACTIVE` exige **filas en producción**, no que exista el SQL.

| DOMINIO | AUTORIDAD DE NEGOCIO | AUTORIDAD DE ESCRITURA | READ MODEL | LOCAL | NUBE | TABLAS | RPC / API | STORE OFFLINE | STATUS | DERIVA CONOCIDA |
|---|---|---|---|---|---|---|---|---|---|---|
| **AUTH** | `pos_staff` (PIN) + Supabase Auth (dashboard) | `/api/pos/pin`, `withPOSAuth` | — | Pedro `actor-authority.js` emite permiso firmado | `pos_staff` (90 filas) | `pos_staff`, `pos_sessions` | `/api/pos/pin`, `platform-auth.ts` | credenciales preparadas en `localStorage` | **ACTIVE** | `pos_sessions` **0 filas**: el registro de terminal en la nube nunca se llenó. PIN sin hash: `PENDIENTE_20260914120000` sin aplicar (`pin_hash` no existe) |
| **ORDERS** | `pos_orders` (128,769) | `r1_save_order_idempotent` (SECURITY DEFINER, en prod) | `pos_orders`, vistas `ops_*` | NDJSON de Pedro + IndexedDB | `pos_orders` | `pos_orders`, `pos_save_operations` (984) | `/api/pos/save-order` | IndexedDB `fullsite_pos.orders` + `sync_queue` | **ACTIVE** | `pos_orders` está en `ALLOW` del proxy ⇒ existe camino REST que salta el RPC |
| **TABLES** | `pos_mesas` (101) | REST vía proxy | `pos_mesas` | Pedro: `MESA_LOCK` / `MESA_UNLOCK`, expiran a 30 s | `pos_mesas` | `pos_mesas` | proxy `/api/pos/db` | `localStorage` (el estado de mesa **no** vive en IndexedDB) | **ACTIVE** | El bloqueo de mesa es **sólo LAN**: dos terminales sin Pedro no se ven |
| **KDS** | Pedro (`operational-domain.js`) en LAN; `pos_orders.kitchen_*` en nube | Pedro por WS; nube por `/api/pos/kitchen` | proyección `state.js` | **autoritativa en LAN** | secundaria | `pos_orders` | `/api/pos/kitchen`, `kitchen-bridge.ts` | proyección en memoria de Pedro | **ACTIVE** | El KDS dedicado carga `kds-ui.html` local, no `/pos/cocina`: son dos UIs distintas |
| **CASH** | `pos_turnos` (897), `pos_cierres` (20), `pos_cash_movements` (12) | REST vía proxy, mínimo `cajero` | `ops_daily`, `ocm_daily` | Pedro `financial-domain.js` | `pos_turnos` / `pos_cierres` | idem + `client_op_id` (P0A) | proxy; **no hay RPC de recibo** | IndexedDB `turnos`, `cash_movements` | **PARTIAL** | `pos_turnos` **no tiene `location_id`** (2 migraciones sin aplicar). Sin índice de «un turno abierto por restaurante». El DDL de P0A está aplicado **sin registrar** |
| **INVENTORY** | `pos_inventory` (1,459), `pos_inventory_movements` (4,179) | `pos_record_inventory_movement` (en prod) **y** `PATCH` REST de gerente | `ops_consumo`, `pos_inventory` | — | nube | + `pos_inventory_movement_operations` (**0 filas**) | `/api/pos/inventory/movement` | IndexedDB `inventory` | **PARTIAL** | El RPC correcto existe y casi no se usa: **2 de 4,179** movimientos llevan `movement_operation_key`. La puerta REST sigue abierta |
| **PURCHASING** | `pos_purchase_orders` (**0**) | REST de gerente | — | — | nube | `pos_purchase_orders`, `pos_purchase_order_items` | proxy | — | **PENDING** | Cero filas en producción. La identidad determinista `po:<id>` sólo existe en la rama `p0a` |
| **SUPPLIERS** | `pos_suppliers` (241) | REST de gerente | catálogo | — | nube | `pos_suppliers` | proxy | — | **ACTIVE** | Sin contrato de recibo; es catálogo editado por humano |
| **PAYMENTS** | `pos_orders.pagos` jsonb | `r1_save_order_idempotent` | `ops_daily` | `financial-domain.js` en LAN | nube | `pos_orders`, `pos_cfdi_requests` (1) | `/api/mp-point`, `/api/clip-pinpad` | `recoverable-operation.ts` en `localStorage` | **PARTIAL** | `pos_payment_attempts` **no existe** (migración PENDIENTE). Un intento con resultado desconocido no tiene dónde vivir |
| **OFFLINE / SYNC** | la cola local | `pos-offline-db.ts` (IndexedDB v4) | — | **autoritativa** | — | — | replay por `APP_API` o `SUPABASE_REST` | `fullsite_pos.sync_queue` | **ACTIVE** | 4 clases de error ya tipadas. `AUTH_EXPIRED` sólo 401 |
| **PEDRO** | log NDJSON local (fsync + checksum) | `CoreEventStore.processCommand` | `state.js` | **autoritativa en LAN** | copia | `pos_local_events` (**0 filas**) | `:7717` HTTP + WS | NDJSON + `print-queue.json` | **PARTIAL** | El outbox a la nube **nunca ha subido un evento en producción** |
| **PRINTING** | cola durable local | `adapters/print-queue.js` | — | **autoritativa** | `pos_print_jobs` (385) | `pos_print_jobs` | bridge `:7717/print` | `print_jobs` en IndexedDB + `print-queue.json` | **ACTIVE** | `printed` significa que el spooler aceptó, **no** que salió papel. Estado `uncertain` sólo resoluble en LAN |
| **FLEET** | ninguna | `telemetry/heartbeat.js` | — | emite | `local_server_heartbeats` (**0 filas**) | `local_server_heartbeats` | POST REST | — | **PENDING** | Emisor escrito, receptor vacío. El `estado()` que lo vuelve diagnosticable está en `golden/candidate-20260914`, sin mergear. PR #406 abierto desde el 2026-09-14 |
| **EVENTS / AUDIT** | `pos_audit_log` (1,690) para lo vivo; `events` (231) para el contrato | escritores dispersos en `/api/pos/*` | — | NDJSON de Pedro | `events` (inmutable por trigger) | `events`, `pos_audit_log`, `platform_audit_log` (15) | `publishEvent()` | cola en `localStorage` | **PARTIAL** | El registro que se usa (`pos_audit_log`) **no es inmutable**; el inmutable (`events`) lleva **14 días sin escrituras** |
| **AI / AGENTS** | `agent_runs` (13,484), `agent_events` (292) | `lib/agents/engine.ts` + crons Python | vistas `ocm_*` + `analyst/contract.ts` | — | nube | `agent_runs`, `agent_events`, `agent_insights` (4,501) | `/api/agents/*`, `/api/analyst` | — | **ACTIVE** | Es el subsistema **más escrito** fuera de `pos_orders`. Las acciones de IA reusan endpoints humanos (patrón correcto) |
| **DELIVERY** | `delivery_orders` (23) | adaptadores Uber / Rappi | — | puente a KDS de Electron | nube | `delivery_orders`, `integration_webhook_events` (32), `integration_audit_log` (292) | `/api/integrations/*` | — | **PARTIAL** | Único dominio con `correlation_id` real. Rappi gated por credenciales |
| **SETTINGS** | `clients` (14), `client_locations` (25), `feature_flags` (3), `platform_settings` (2) | `/api/platform/*` + `platform-writes.auditLog` | `client-config.ts` | `config.json` de la terminal | nube | idem | `/api/platform/config`, `/flags` | `localStorage` | **PARTIAL** | **`client_locations` no tiene columna `timezone`** aunque el código la lee: §2, D-03 |
| **CERTIFICATION** | el acta (`run.json`) del rig | `e2e/paridad/cert/` | — | CDP + Pedro | tenant `fullsite-cert-lab-v2` | `pos_*` del tenant de laboratorio | `npm run certify:*` | — | **CANDIDATE** | Rig entero **sin mergear**: PR #418 (etapa 1) abierto, etapa 2 sólo en `cert/rig-v1-pr2` |

---

## 2 · REALIDAD DE LAS MIGRACIONES

Tres fuentes comparadas: **(1)** archivos en `supabase/migrations/` de `origin/main` · **(2)** filas de
`supabase_migrations.schema_migrations` · **(3)** objetos reales de Postgres.

**44 archivos** `.sql` en el repo · **54 filas** registradas · **y los dos conjuntos no se
corresponden.** Los nombres y los sellos de tiempo registrados no coinciden con los nombres de
archivo (`20260910050000_inventory_movement_atomic.sql` ↔ registrado como
`20260911220951 inventory_movement_atomic`). **Son dos espacios de nombres distintos**, no dos vistas
del mismo. Ésa es la deriva estructural de la que salen todas las demás.

### 2.1 Las derivas encontradas

| # | Migración | FILE_EXISTS | RECORDED | EFFECT_IN_DB | Clase | Consecuencia |
|---|---|:--:|:--:|:--:|---|---|
| **D-01** | `PENDIENTE_20260917200000_append_idempotency` (rama `p0a`, **no está en `main`**) | ✅ | ❌ | ✅ | **SOURCE_OF_TRUTH_DRIFT** | 3 columnas `client_op_id` + 3 índices únicos parciales viven en AMALAY sin registro. Escrituras sólo desde `fullsite-cert-lab-v2`, 2026-09-18 |
| **D-02** | `PENDIENTE_20260910030000_proxy_child_scope` | ✅ | ❌ | ✅ (`pos_scoped_child`) | **SOURCE_OF_TRUTH_DRIFT** | Una función marcada PENDIENTE está viva. Su hermana `scoped_proxy_upsert` **no** lo está: se aplicó media pareja |
| **D-03** | `20260902120000_client_locations_timezone` | ✅ | ❌ | ❌ | **CÓDIGO SIN ESQUEMA** | `client_locations` **no tiene** `timezone`. `terminal-config.ts` la emite y el POS la consume ⇒ toda terminal cae a la zona de la máquina |
| **D-04** | `20260827150000_pos_turnos_por_sucursal` + `20260829_turnos_por_sucursal` | ✅ | ❌ | ❌ | **CÓDIGO SIN ESQUEMA** | `pos_turnos` no tiene `location_id`. Es la causa raíz documentada del incidente del 2026-08-31 en `clasificar-fallo.ts` |
| **D-05** | `20260909030000_un_turno_abierto_por_restaurante` | ✅ | ❌ | ❌ | **INVARIANTE AUSENTE** | No existe índice que impida dos turnos abiertos. Los 11 turnos basura de AMALAY siguen siendo posibles |
| **D-06** | `20260827120000_pos_terminals_por_sucursal` + `..._enrollments` | ✅ | ❌ | ❌ | **CÓDIGO SIN ESQUEMA** | `pos_terminals` **no existe** — y está en el `ALLOW` del proxy. No hay registro de terminales en la nube |
| **D-07** | `PENDIENTE_20260910070000_tenant_provisioning_atomic` | ✅ | ✅ (`20260915181654`) | ✅ | **NOMBRE OBSOLETO** | Aplicada y registrada, pero el archivo sigue llamándose `PENDIENTE_`. Quien lea el repo concluirá lo contrario de lo que es |
| **D-08** | `PENDIENTE_20260914120000_pos_staff_pin_hash` | ✅ | ❌ | ❌ | correcto | `pin_hash` no existe. Los PIN siguen en claro |
| **D-09** | `PENDIENTE_20260904000000_cuentas_divididas` · `PENDIENTE_20260905010000_caja_materializer` | ✅ | ❌ | ❌ | correcto | `pos_order_accounts`, `pos_payment_attempts`, `pos_caja_streams`, `pos_caja_business_receipts` y `apply_pos_caja_event` **no existen**. Sigue siendo gate de campo |

**SOURCE_OF_TRUTH_DRIFTS = 7** (D-01 a D-07). D-08 y D-09 se listan porque se confunden con deriva y
no lo son: son pendientes correctamente pendientes.

### 2.2 La regla que se deriva

> **Un archivo de migración no dice nada sobre el estado de la base. Ni su nombre, ni su prefijo
> `PENDIENTE_`, ni su ausencia de la lista registrada.** Lo único que dice qué existe es la
> introspección de Postgres.

---

## 3 · REGLAS DE AUTORIDAD

### 3.1 Pregunta → fuente autoritativa

| Pregunta | Fuente | Cómo se consulta |
|---|---|---|
| ¿Qué código está en `main`? | GitHub `origin/main` | `git show origin/main:<ruta>` — **nunca el working tree** |
| ¿Qué candidato está bajo prueba? | [`RELEASE-BOARD.md`](RELEASE-BOARD.md) + el SHA exacto | `git rev-parse <rama>` |
| ¿Qué esquema existe? | **introspección de la base viva** | `information_schema`, `pg_class`, `pg_proc`, `pg_index` |
| ¿Qué migración *creemos* aplicada? | `supabase_migrations.schema_migrations` | es una **creencia**, no un hecho (§2) |
| ¿Qué migración dejó **efecto**? | los objetos reales de Postgres | §2 |
| ¿Qué build corre en una terminal? | `identidadDeBuild()` → `build-info.json` | y su etiqueta dice «sin sellar» cuando no puede saberlo |
| ¿Qué petición salió de Electron? | observador de runtime (CDP + inspector de MAIN) | el *renderer* no ve el tráfico de MAIN |
| ¿Qué efecto de negocio ocurrió? | el recibo, o relectura autoritativa | un `200` no es un recibo; un `409` tampoco |
| ¿Está viva la flota? | `local_server_heartbeats` | **hoy: 0 filas ⇒ la respuesta es «no se sabe», no «sí»** |

### 3.2 Jerarquía cuando dos fuentes se contradicen

```
EFECTO DE RUNTIME  >  BASE VIVA  >  BUILD DESPLEGADO  >  REPO main  >  DOCS
```

**Tres excepciones encontradas, y hay que respetarlas:**

1. **Un `NOT_OBSERVED` no gana nada.** Si el observador no pudo leer el oráculo, la capa de abajo
   **no** promueve a verdad: el resultado es «no observado», no «pasó». Ésta es la regla del rig
   (`CONTRATO-v1.md`) y domina sobre la jerarquía.
2. **La base viva no gana sobre el repo para la *intención*.** D-01 demuestra que el esquema puede
   adelantarse a `main` sin registro. La base dice qué **hay**; no dice qué **debe haber**.
3. **Un documento probado en campo gana sobre el repo para el comportamiento físico.** Si
   `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md` y el código difieren sobre cómo se comporta
   una impresora o una LAN, el campo describe la realidad y el código describe una intención que no
   se cumplió. Es la regla 4 de `DECISION-BRAIN.md`.

---

## 4 · CLASIFICACIÓN PÚBLICO / PRIVADO

`danielfullsite/fullsite` es **público**.

| Documento | PUBLIC_OK | PRIVATE_REQUIRED | Por qué |
|---|---|---|---|
| `SOURCE-OF-TRUTH.md` (éste) | no | **sí** | §2 es un mapa de invariantes ausentes y de esquema fuera de control. Publicado, es una lista de por dónde entrar |
| `SYSTEM-MAP.md` | no | **sí** | Nombra los caminos que saltan cada contrato, por dominio |
| `RELEASE-BOARD.md` | no | **sí** | Bloqueadores de release y estado de fallo vivo de un cliente con nombre |
| `docs/COMO-FUNCIONA-TODO.md` (PR #340) | **sí** | no | Describe cómo funciona, no qué está roto. Es el documento de entrada de un ingeniero nuevo |
| `docs/architecture/OPERATION-IDENTITY-AND-RECEIPTS.md` (PR #422) | **sí** | no | Contrato. Ya publicado a propósito |

**Recomendación:** los tres documentos de `docs/system/` viven en una rama **sin publicar** hasta que
exista un destino privado. No se abrió PR. La tensión es real y hay que nombrarla: **sin publicar
están a salvo de terceros y expuestos a un disco**. La solución correcta no es publicarlos: es un
repositorio privado o un `docs-private/` en un remoto aparte.

---

## 5 · PREGUNTAS ABIERTAS

| # | Pregunta | Quién la contesta |
|---|---|---|
| **S1** | ¿Quién aplicó el DDL de P0A a AMALAY y por qué fuera del mecanismo de migraciones? | Daniel / Fork |
| **S2** | ¿Los dos espacios de nombres de migración (archivos vs `schema_migrations`) se reconcilian, o se declara que el repo no gobierna el esquema? | Decisión de Daniel |
| **S3** | ¿La ausencia de `client_locations.timezone` (D-03) está causando cortes con el día equivocado en alguna sucursal? | Medición en campo |
| **S4** | ¿Qué es exactamente D0, D1 y D2_A..D2_E? | **No están definidos en el repo.** Ver `RELEASE-BOARD.md` §3 |
