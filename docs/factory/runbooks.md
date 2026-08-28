# Runbooks — operación de Fullsite Factory

> Procedimientos de operación. Regla dura: **sin merge/deploy/migración remota sin aprobación
> explícita**; producción y AMALAY intocables; staging `<STAGING_PROJECT_REF>` sólo lectura hasta
> autorización.

## Runbook 1 — Promoción staging → piloto → producción

**Precondición.** El PR está en `Probado localmente` (tsc·lint·suite·build verdes en clon limpio).

1. **Staging (con aprobación).** Aplica la migración aditiva en staging. Corre la prueba de
   aislamiento (2 tenants × 2 sucursales) y la suite. Enciende el feature flag **sólo para un
   tenant de sandbox**. Estado → `Validado en staging`.
2. **Piloto.** Merge del PR con CI verde. Enciende el flag para el tenant piloto. Observa 24–48h
   (heartbeats, audit log, métricas). Estado → `Desplegado`.
3. **Producción.** Enciende el flag por tenant, de a uno. Estado → `Verificado en campo` sólo tras
   una validación física sobre el mismo commit/instalador.

> Orden de dependencia: **#197 → #195 → #198 → #199**. Nunca mergees un stacked antes que su base.
> Los paralelos (#200, #201, #202, #203, #204, #205) sólo dependen de #197.

## Runbook 2 — Incidente: KDS muestra comandas de otra sucursal/turno

1. Confirma el flag: si `factory.kds_location_scope` está **apagado**, el KDS opera tenant-wide
   (comportamiento legacy esperado). Enciéndelo y asegúrate de que el KDS **envía** `location_id`
   y `shift_id`.
2. Inspecciona la URL real a `/api/pos/kitchen`: debe incluir `location_id=eq` y `turno_id=eq`.
3. Si aún cruza, **apaga el flag** (rollback inmediato, vuelve a legacy) y abre incidente contra
   #199. No hay pérdida de datos: es un filtro de lectura.

## Runbook 3 — Incidente: una terminal no puede enrolarse

1. Causa común: código **vencido/reusado** → falla cerrado por diseño. Re-emite
   (`POST /api/platform/terminals`) y canjea dentro de la ventana de expiración.
2. Verifica que la sucursal exista y esté activa para ese tenant (`GET …/locations`).
3. **Nunca** pidas ni pegues el código en un canal compartido; se muestra una vez a propósito.

## Runbook 4 — Rollback de una capacidad

- **Vía flag (preferida, sin deploy):** apaga el `factory.*` correspondiente. El sistema vuelve
  a legacy al instante. Cero cambios de datos.
- **Vía código:** `git revert` del PR. Como los flags nacen apagados, revertir no cambia
  producción.
- **Vía migración:** aditiva → el down documentado hace `DROP` de lo agregado. **Sólo si ya se
  aplicó** en algún entorno; hoy ninguna está aplicada, así que "rollback" = cerrar el PR.

## Runbook 5 — Recuperación de turno/corte bloqueado

1. Órdenes abiertas al cerrar: GUARD-08 exige nota + escalación (PIN gerente). No fuerces sin eso.
2. Cierre irrecuperable: marca el turno `status='forzado'` con aprobación de admin, registrando
   el motivo. **No borres historial ni reinicies folios fiscales** (política dura, ADR/§5).
3. El índice único parcial impide un segundo turno `abierto` por sucursal: si aparece un choque,
   hay un turno sin cerrar — ciérralo o fórzalo antes de abrir el nuevo.

## Runbook 6 — Métricas de latencia offline

1. Con `FACTORY_OFFLINE_METRICS=1` y el hot path instrumentado **[requiere wiring Electron]**, la
   caja escribe un JSONL de muestras.
2. `node …/telemetry/latency-harness.js muestras.jsonl reporte.json` → p50/p95 por tramo +
   desconexiones/reconexiones. Reproducible. Sin muestras → `null` (no se inventan números).
3. Compara contra el objetivo del piloto; si p95 se degrada, correlaciona con `sync_queue_size`
   y `print_jobs_failed` del heartbeat.
