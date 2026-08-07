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

### BUG-019 · Aislamiento de tenant es solo capa-app, no DB (RLS permisiva anon) · **P1 cloneability** · OPEN
- **Clasificación:** el usuario pidió reclasificar a P1 "si puede provocar que un tenant nuevo quede con permisos distintos a los esperados o afectar tenant isolation". Este SÍ afecta isolation → P1. Requiere verificación contra la RLS real de producción antes de client #2.
- **Hallazgo (verificado en staging 2026-08-06):** con la sesión scoped a `demo` y la anon key (que el navegador expone), una lectura REST directa `pos_staff?client_id=eq.vantara` devolvió **200 con 4 filas de otro tenant**. El POS hace lecturas anon directas (`pos_orders`, `pos_turnos`, `pos_staff`, menú) filtrando por `_cid()` que sale de `localStorage['fullsite_client_id']` — **editable por el usuario**. Con RLS `using(true)`/anon-read permisiva, un usuario puede leer datos de OTRO tenant cambiando el client_id.
- **¿Introducido por mí o pre-existente en prod?** El comentario de `api/pos/pin/route.ts` ("pos_staff has anon_read policy → anon key is sufficient for PIN lookup") indica que **producción tiene una política anon-read permisiva** en pos_staff (si no, el login PIN por anon no funcionaría). Es decir, el modelo permisivo es de PRODUCCIÓN, no sólo de mi staging. La escritura server-side sí usa service key + `withPOSAuth` (clientId resuelto en servidor, no falsificable) — pero las LECTURAS directas del navegador no pasan por ese guard.
- **Impacto:** un operador/atacante autenticado en un tenant podría leer menú, staff, órdenes y métricas de otro tenant editando su `localStorage`. La escritura cruzada está protegida (withPOSAuth); la LECTURA cruzada no. Bloquea onboarding seguro de client #2 (multi-tenant real).
- **Acción requerida (NO ejecutable sin acceso a prod / decisión de fundador):** verificar la RLS real de `pos_staff`/`pos_orders`/`pos_turnos`/`pos_menu_*` en producción. Si son `using(true)`/anon-permisivas → implementar RLS tenant-scoped (policy que ate `client_id` al claim del JWT del usuario) o enrutar TODAS las lecturas por un endpoint con `withPOSAuth`. + test de isolation que intente lectura cruzada y espere 0 filas / 403.
- **Relación:** distinto de BUG-013 (paridad de grants en staging). Este es el modelo de isolation en sí.
- **Estado:** OPEN — P1 cloneability. NO verificable end-to-end sin acceso a producción (prohibido). Requiere decisión del fundador.

### BUG-013 · Staging tenant `demo` sin paridad de grants vs producción · P2 (infra) · OPEN
- **Reclasificación (2026-08-06):** se mantiene **P2**. Las migraciones que apliqué (grants + policies `using(true)`) son a nivel de TABLA (compartidas por todos los tenants), sólo en staging, y NO se despliegan a producción. Un tenant nuevo en prod hereda las policies de prod, no las mías. No provoca que un tenant nuevo quede con permisos "distintos" — todos comparten el mismo modelo. El riesgo de ISOLATION en sí está escalado por separado como **BUG-019 (P1)**.
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

### BUG-016 · POS: ítem cancelado RESUCITA como activo y cobrable al reabrir la orden · **P1** · OPEN
- **Clasificación:** FAIL real de PRODUCTO con impacto financiero (sobrecobro al cliente). Visible/recuperable (no pérdida silenciosa) → P1, no P0. Verificado deterministamente desde la fuente de verdad, no solo UI.
- **Origen:** E2E-02/03 ejecución UI 2026-08-06 (navegador real + Bridge real + staging tenant demo).
- **Repro (100%, determinista):**
  1. POS: abrir mesa, capturar 2 ítems (horchata $55 + café $60), Enviar → orden `enviada`, subtotal $115.
  2. Cancelar la horchata (admin Ana, motivo, PIN gerente, "Cancelar — No se preparó"). `cancel-item` → 200; DB persiste `items[horchata].cancelled=true`; audit log correcto (actor mesero, approved_by gerente, reason). UI muestra Sub $60. **Hasta aquí correcto.**
  3. Navegar fuera (a `/pos/mesas`) y regresar a la mesa (o recargar) → **la orden reabre mostrando AMBOS ítems como activos, Sub $115**. La horchata cancelada reaparece sin marca de cancelada.
  4. Cobrar → el total a cobrar es **$133.40** (acepta efectivo exacto $133.40 → Cambio $0.00), en vez de $69.60. **El cliente paga $63.80 de más por un producto cancelado.**
- **Evidencia (fuente de verdad, no UI):** orden `06dec11a` cerrada en `pos_orders` con `subtotal=115, total=133.4, pagos=[{Efectivo 40},{Tarjeta 93.40}]` tras cancelar la horchata; orden `7d987c2e` (mesa 3) reabierta desde BD reproduce el Sub $115 con ambos ítems y acepta pago exacto de $133.40.
- **Causa raíz (código, dashboard-app — NO es el electron-app congelado):** `src/app/pos/page.tsx:2000-2010`. El load hace `loadedItems2 = items.filter(i => !i.cancelled)` (correcto), pero el merge re-agrega ítems cancelados: `const localUnsent = prev.filter(i => !dbIds.has(i.id) && !sentItemIds.has(i.id)); return [...loadedItems2, ...localUnsent]`. `prev` viene del cache stale (`pos_order_${mesa}`) que incluye la horchata cancelada; `dbIds` sólo tiene los NO-cancelados; y `sentItemIds` aún no está poblado en ese punto async → la horchata cancelada cae en `localUnsent` y se RE-AGREGA como activa. `activeItems` (2736) la incluye, y el pago (3264) la cobra. El cache `pos_order_${mesa}` tampoco se actualiza al cancelar (queda con el ítem activo).
- **Impacto:** cobro incorrecto (de más) cada vez que una orden con ítem cancelado se reabre/recarga antes de cobrar — escenario común (cancelar, bloquear pantalla o cambiar de mesa, volver a cobrar). Multi-terminal lo agrava.
- **Fix propuesto (dashboard-app, NO aplicado aún — pendiente decisión de secuencia):** en el merge, excluir de `localUnsent` los ids que existen en el pedido de BD pero fueron filtrados por `cancelled` (trackear `cancelledDbIds` del array sin filtrar y restarlos), y/o poblar `cancelledItems`/`voidedItems` Set desde los flags de BD al cargar, y/o invalidar el cache `pos_order_${mesa}` al cancelar. + test de regresión: enviar 2 ítems → cancelar 1 → recargar → subtotal excluye el cancelado → pago cobra sólo el activo.
- **Repro/estado:** 100% · OPEN · P1 (bloquea gate `P1 BLOCKING = 0`).

### BUG-017 · POS: cancel-item escribe DOBLE entrada en audit log (formato legacy + nuevo) · P2 · OPEN
- **Observado:** una sola cancelación genera 2 filas en `pos_audit_log` para el mismo `operation_id`: una con `details` como JSON-string legacy (mesa+reason+approved_by poblados) y otra con `details` JSON nuevo (mesa null). Ambas veraces; no es pérdida.
- **Causa:** cliente (write directo legacy) + ruta API `cancel-item` (línea 92) escriben cada uno su audit.
- **Impacto:** conteo inflado de cancelaciones en reportes de auditoría/anti-fraude si cuentan filas.
- **Estado:** OPEN — dedup por operation_id o eliminar uno de los dos writes.

### BUG-018 · POS: header `subtotal`/`total` de la orden no se recalcula al cancelar un ítem · P2 · OPEN
- **Observado:** `cancel-item` sólo marca `items[i].cancelled=true` (route línea 60-61); no actualiza las columnas `subtotal`/`total` de `pos_orders`. Quedan stale (p.ej. 115/133.40 con un ítem de $55 cancelado) hasta el próximo save.
- **Relación:** contribuye a BUG-016. Aislado es P2 (el cierre normal recalcula desde ítems activos, salvo el path de reopen roto de BUG-016).
- **Estado:** OPEN.

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
### BUG-016 · Ítem cancelado resucita cobrable al reabrir · P1 · **CERRADO** (fix `7435188`) — getActiveItems + activeItems honran flag persistido; merge usa dbKnownIds; cache invalidado al cancelar; +2 regresiones; suite 2150/2150

Los P0 pre-RC — PRR-02, PRR-04, save-order 99cdf7a, /identity 29c4b0d — están cerrados en el registro PRR con tests de regresión + el ciclo upgrade-rehearsal como retest.

---

## Resumen vivo (2026-08-06, tras ejecución UI)

| Severidad | Abiertos | Bloquean release |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 — **BUG-015** (print retry no self-drena, twin), **BUG-019** (tenant isolation capa-app, necesita verificar RLS prod) | **Sí** — gate `P1 BLOCKING = 0` NO se cumple |
| P2 | 12 — BUG-004..014, 017, 018 (BUG-002/003 cerrados) | No (ninguno muestra información incorrecta confirmada al operador) |

**Cerrados esta sesión:** BUG-001 (P1, ocultar), BUG-016 (P1, sobrecobro). **Nuevos:** BUG-016/017/018/019.
