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
