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

## CERRADOS

(ninguno aún en este registro; los P0 pre-RC — PRR-02, PRR-04, save-order 99cdf7a, /identity 29c4b0d — están cerrados en el registro PRR con sus tests de regresión y el ciclo upgrade-rehearsal como retest)

---

## Resumen vivo

| Severidad | Abiertos | Bloquean release |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 (BUG-001) | Sí — hasta reparar u ocultar |
| P2 | 10 | No (ninguno muestra datos incorrectos confirmados; BUG-003/007 pendientes de verificación runtime que podría subirlos) |
