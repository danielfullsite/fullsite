# FULLSITE RC BUG REGISTER

Registro canónico de bugs del Release Candidate. Regla: ningún bug se cierra
sin re-ejecutar el journey completo relacionado. P0/P1 corregido ⇒ test de
regresión obligatorio.

Formato por bug: ID · módulo · severidad · pasos · esperado · observado ·
evidencia · repro · causa · fix · tests · retest · estado.

---

## ABIERTOS

### BUG-001 · Dashboard `/lealtad` · **P1** · OPEN
- **Pasos:** login dashboard → `/lealtad`
- **Esperado:** programa de lealtad funcional o ruta no visible
- **Observado:** rewards con datos placeholder/mock visibles ("Ej: Cafe gratis…"); sin integración efectiva con órdenes
- **Evidencia:** `dashboard-app/src/app/lealtad/page.tsx` (placeholders en UI)
- **Repro:** 100%
- **Causa:** feature incompleta visible
- **Decisión requerida:** REPARAR si es parte del release crítico; si no, **OCULTAR** (recomendado para CONTROLLED release)
- **Estado:** OPEN — bloquea gate `P1 BLOCKING = 0` hasta reparar u ocultar

### BUG-002 · Dashboard `/encuestas` · P2 · OPEN
- **Pasos:** crear encuesta → esperar respuestas → buscar resultados
- **Esperado:** ver respuestas recolectadas
- **Observado:** el builder crea encuestas pero no hay vista de respuestas/procesamiento
- **Evidencia:** `dashboard-app/src/app/encuestas/page.tsx`
- **Decisión:** ocultar o completar; no representa datos incorrectos (P2)
- **Estado:** OPEN

### BUG-003 · Dashboard `/admin/usuarios` · P2 · OPEN
- **Observado:** CRUD de usuarios parcialmente renderizado / con datos de ejemplo
- **Evidencia:** `dashboard-app/src/app/admin/usuarios/page.tsx`
- **Estado:** OPEN — verificar en runtime; si gestiona usuarios reales a medias, subir a P1

### BUG-004 · Dashboard núcleo · P2 (documentado, no fix para RC) · OPEN
- **Observado:** `/`, `/ventas`, `/meseros` sin selector de sucursal (asumen single-location)
- **Impacto:** aceptable para CONTROLLED release con clientes de 1 sucursal; bloquea multi-sucursal
- **Estado:** OPEN — registrar en limitaciones del release

### BUG-005 · Dashboard `/agentes` · P2 · OPEN
- **Observado:** "Cargando datos de agentes…" sin timeout ni estado de error
- **Evidencia:** `dashboard-app/src/app/agentes/page.tsx:763`
- **Estado:** OPEN

### BUG-006 · Dashboard `/` (freshness) · P2 · OPEN
- **Observado:** alerta "Sin sincronización de hoy" sin acción de retry
- **Evidencia:** `dashboard-app/src/app/page.tsx:516-539`
- **Estado:** OPEN

### BUG-007 · Dashboard `/food-cost` · P2 · OPEN
- **Observado:** tamaños de porción hardcoded; solo lectura
- **Impacto:** posible costo inexacto mostrado — verificar que no sea "información incorrecta" (regla P2); si el número es engañoso, subir a P1
- **Estado:** OPEN — pendiente verificación runtime

### BUG-008 · Dashboard `/inventario-real` · P2 · OPEN
- **Observado:** solo snapshot "latest"; sin histórico
- **Estado:** OPEN — documentar como limitación

### BUG-009 · Bridge `/health.sync_queue_size` · P2 (pre-existente, registro PRR) · OPEN
- **Observado:** contador nunca drena (markSynced sin caller); WARN permanente en monitoreo
- **Evidencia:** verificado en rehearsal (idéntico pre/post upgrade; no es pérdida de datos)
- **Estado:** OPEN — ruido de monitoreo, no operativo

### BUG-010 · Test infra (local mac) · P2 · OPEN
- **Observado:** `identity-route.test.js` cuelga en macOS **también en aislamiento** (verificado 2026-08-06: el proceso queda vivo sin emitir summary; deja zombies que bloquean corridas posteriores de toda la suite). En CI Windows el endpoint `/identity` está verificado vivo (dry-run 31066343422 + rehearsal 31120621675).
- **Pasos:** `cd electron-app && node --test local-server/tests/identity-route.test.js` en macOS
- **Impacto:** solo infraestructura de tests local — el producto no está afectado. Los otros 170 tests pasan excluyéndolo.
- **Causa probable:** recurso que no cierra en darwin (mdns/bonjour UDP 5353 o server sin close en teardown)
- **Estado:** OPEN — mitigación: excluirlo del run local y matar strays (`pkill -f "node --test"`) antes de correr

### BUG-011 · Test infra (root sweep) · P2 · OPEN (comportamiento conocido)
- **Observado:** `npx vitest run tests/` desde raíz barre también specs de Playwright y tests node:test de otros paquetes → "14 files failed" falsos; los tests reales del scope (142) pasan
- **Estado:** OPEN — ajustar include del vitest.config raíz o documentar comando exacto de release

### BUG-012 · POS pagos (MP crash window) · P2 · OPEN
- **Origen:** PAY-GAP-02 (OCS-P2.5.8, campo/lab jul-31): crash de Mercado Pago entre save y clearMpRecovery puede duplicar ticket impreso (no el cobro)
- **Cobertura:** comportamiento documentado inline; **sin test durable** — pendiente agregar regresión de crash simulado
- **Retest:** E2E-03 (doble clic / reintento) + física lunes
- **Estado:** OPEN

### BUG-013 · Staging tenant `demo` sin paridad de grants vs producción · P2 (infra) · OPEN
- **Origen:** ejecución UI RC 2026-08-06 — el POS daba 401 en login PIN y en cada escritura contra el tenant `demo` de staging
- **Causa:** staging no tenía los grants/policies que producción aplica: anon read en `pos_staff` y `client_users`, grants+RLS en tablas POS operativas, `execute` en `r1_save_order`/`r1_save_order_idempotent`. Producción los cubre porque las rutas usan `SUPABASE_SERVICE_KEY` (bypassa RLS)
- **Acción tomada:** espejados en staging vía migraciones (`pos_staff_anon_read_mirror_prod`, `pos_operational_anon_grants_mirror_prod`, `grant_pos_save_rpcs_e2e`, `client_users_anon_read_e2e`, `events_anon_rw_e2e`) para poder ejecutar E2E. NO es cambio de producto ni de producción
- **Impacto real:** el paquete demo/clonability depende de que el tenant demo opere; esta deuda debe cerrarse en el provisioning del tenant demo, no en la app
- **Estado:** OPEN — mitigado en staging; documentar en el runbook de alta de tenant demo

### BUG-015 · Bridge print-queue: jobs `retrying` no se reintentan hasta el próximo restart del Bridge · **P1** · OPEN
- **Clasificación (verificada antes de asignar severidad):** FAIL **real de PRODUCTO** en el pipeline de impresión del Bridge, NO límite de capa/harness. `PRINT_COMMAND` es comando de protocolo soportado (`protocol.js:36` → `command-handler.js:79` → `printer.printToStation`); la sonda ejercita exactamente ese path con un documento tipo corte. (Lo que sí es capa web-UI es el CÓMPUTO del corte — cubierto aparte como `corte-x` NOT-EXERCISABLE.) **No** es pérdida silenciosa: el job queda persistido y visible en `print-queue.json`/`/print-queue` con status `retrying` — por eso P1 y no P0.
- **Origen:** AMALAY Digital Twin (5 printers / 3 POS), sonda `corte-print-outage`, 2026-08-06
- **Pasos (repro exacto, spawn mode) con estado de `print-queue.json` en cada paso:**
  1. Bridge arriba con printers v2 (twin: `node tests/twin/twin-harness.js --phase smoke --spawn`)
  2. Apagar la impresora de una estación (twin: close del listener TCP → ECONNREFUSED real a nivel socket) — queue: sin el job aún
  3. Enviar `PRINT_COMMAND` a esa estación (corte a `tickets-caja`) — ACK correcto; queue: job `pending` → `printing` (attempts=1) → intento falla ECONNREFUSED → **`retrying` (attempts=1)**
  4. Encender la impresora — queue: job sigue **`retrying` (attempts=1)**, sin cambio
  5. Esperar >75s (cubre el intervalo de recovery de 60s) — queue: job sigue **`retrying`**; 0 bytes en la impresora
  6. Restart graceful del Bridge — boot: `_retryPendingJobs()` recoge pending+retrying → attempts=2 → imprime; queue: `printed`; bytes `pn=` capturados en la impresora fake
- **Esperado:** el job sale a papel al recuperar la impresora sin intervención (benchmark Wansoft: reintenta cada 15s indefinidamente — comentario en `printer.js:66`; intención inline del propio código: "ensures printer-unavailable jobs are retried without manual intervention", `printer.js:67`)
- **Observado (twin):** `self-drain=false` tras 75s con la impresora ya arriba; `printed on startup replay after graceful restart=true`
- **¿`_recoverCrashedJobs` lo revive?** NO aplica: esa rutina (`print-queue.js:55-71`) solo toca jobs en status `printing` (crash mid-print, caso PRR-04). Este job está en `retrying`; en boot lo recoge `_retryPendingJobs` (`printer.js:264-296`, vía `getPendingJobs()` = pending+retrying). Mientras el Bridge siga vivo, NADIE bombea `retrying`.
- **Causa (código, sin tocar — release frozen):** `electron-app/local-server/adapters/printer.js:69-74` — el intervalo de 60s solo llama `retryRecoverableJobs()` (revive `recoverable`) y únicamente si revivió alguno ejecuta `_retryPendingJobs()`. Un job que falla su primer intento va a `retrying` porque `canRetry` (attempts<3) gana sobre la clasificación recoverable (`printer.js:167-179`); con un solo intento por PRINT_COMMAND, nunca llega a `recoverable` sin restarts, y ningún loop periódico bombea `pending`/`retrying` — solo el boot.
- **Impacto:** en campo, una impresora que se apaga/desconecta durante servicio deja comandas/tickets/cortes sin imprimir (visibles solo en `/print-queue`) hasta reiniciar el Bridge, incluso ya recuperada la impresora. Sin pérdida de datos (job persistido, imprime en boot) — gap de self-healing vs el benchmark offline (Wansoft).
- **Gate que bloquea:** founder gate 6 (0 print jobs varados) en su lectura de recuperación sin intervención; el twin marca `corte-print-outage` FAIL (y por tanto `no_failed_scenarios`) hasta fix + retest.
- **Evidencia:** `tests/twin/twin-evidence/twin-report.json` escenario `corte-print-outage` (runs smoke/shift 2026-08-06); log del run: `job status=retrying attempts=1` durante toda la ventana
- **Repro:** 100% (determinista)
- **Fix propuesto (post-freeze, NO aplicado — electron-app congelado):** que el intervalo de recovery ejecute `_retryPendingJobs()` siempre (no solo cuando revive recoverables), o clasificar errores de infraestructura (ECONNREFUSED et al.) directo a `recoverable` en el primer fallo. + test de regresión: impresora TCP caída→PRINT_COMMAND→recuperada, sin restart.
- **Estado:** OPEN — P1

### BUG-014 · shadow-mode `events` insert falla (sequence NOT NULL) · P2 · OPEN
- **Observado:** al cobrar, `POST /rest/v1/events` → 400 `null value in column "sequence"`. Es una escritura **shadow** secundaria (no bloquea la operación: el cobro cerró 200)
- **Evidencia:** consola navegador 2026-08-06
- **Estado:** OPEN — verificar si el shadow-write debe omitir `sequence` o tomarlo del Bridge; no afecta el path operativo

## CERRADOS

### BUG-001 · `/lealtad` rewards mock visible · P1 · **CERRADO** (fix `8010d9a`)
- **Fix:** `RELEASE_HIDDEN_PAGES` en `roles.ts` bloquea `/lealtad` (+ `/encuestas`, `/admin/usuarios`, `/internal`) para todos los roles vía `canAccessPage`, aplicado en el middleware `proxy.ts` (edge) y heredado por el Sidebar
- **Test:** 44 regresiones nuevas en `auth-roles.test.ts` (todos los roles × rutas ocultas → deny; admin/menu y promociones siguen accesibles). Suite dashboard-app 2148/2148 PASS
- **Retest journey:** enforcement de rutas/permisos re-ejecutado (213 tests auth) PASS

### BUG-002 · `/encuestas` sin vista de respuestas · P2 · **CERRADO** (fix `8010d9a`) — oculta del release
### BUG-003 · `/admin/usuarios` CRUD parcial · P2 · **CERRADO** (fix `8010d9a`) — oculta del release

(ninguno aún en este registro; los P0 pre-RC — PRR-02, PRR-04, save-order 99cdf7a, /identity 29c4b0d — están cerrados en el registro PRR con sus tests de regresión y el ciclo upgrade-rehearsal como retest)

---

## Resumen vivo

| Severidad | Abiertos | Bloquean release |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 (BUG-001) | Sí — hasta reparar u ocultar |
| P2 | 10 | No (ninguno muestra datos incorrectos confirmados; BUG-003/007 pendientes de verificación runtime que podría subirlos) |
