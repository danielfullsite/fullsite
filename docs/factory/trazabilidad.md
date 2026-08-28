# Trazabilidad — requisito → código → test → PR → estado

> Cada requisito del programa apunta a su código, su prueba y su PR. **Estado** usa el
> vocabulario de [`README.md`](README.md). Hoy todo está en `Impl · Probado local`; ninguna
> columna llega a `Validado en staging`/`Desplegado`/`Verificado en campo`.

## Contratos transversales

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Evento porta tenant+location+device+shift, falla cerrado | `lib/events/envelope.ts` `buildEnvelope` | `event-envelope.test.ts` (10) | #197 | Impl · Probado local |
| Feature flags `factory.*` apagados por default | `lib/platform-config.ts` (existente) + convención | (evaluación existente) | #197 | Impl · Probado local |

## Programa 1 — KDS/estaciones/routing por sucursal (crítico)

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Estaciones ligadas a `location_id` | `20260827140000_pos_location_stations.sql` | `pos-location-stations-migration.test.ts` | #198 | Impl · Probado local |
| Routing por categoría/rol/**location**, determinista | `lib/station-routing-location.ts` `resolveStationForLocation` | `station-routing-location.test.ts` (17) | #198 | Impl · Probado local |
| Compat legacy (sin config = getStationForItem) | idem | idem (batería de items) | #198 | Impl · Probado local |
| Aislamiento 2 sucursales, sin comandas cruzadas | `api/pos/kitchen/route.ts` (filtro `location_id`) | `kds-location-shift-aislamiento.test.ts` (9) | #199 | Impl · Probado local |
| Histórico no reaparece como activo | idem (status excluye cerrada; candado de turno) | idem | #199 | Impl · Probado local |

## Programa 2 — Autoconfiguración

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Adapters por capacidad + confidence topado (<1.0) | `lib/hardware-capabilities.ts` `scoreConfidence` | `hardware-capabilities.test.ts` (10) | #204 | Impl · Probado local |
| Confirmar antes de guardar; fallback manual | idem `buildProposal` + `api/platform/hardware/propose` | idem | #204 | Impl · Probado local |
| Escaneo real LAN/USB/HID | **[requiere wiring Electron]** | — | (PR instalador) | Diseñado |

## Programa 3 — Wizard clonable

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Reanudable + idempotente | `lib/onboarding-wizard.ts` `nextStep`/`applyStep` | `onboarding-wizard.test.ts` (12) | #202 | Impl · Probado local |
| Nunca exporta secretos | idem `sanitizeForPersistence`/`isSecretFree` + `api/platform/onboarding-progress` | idem (mutación) | #202 | Impl · Probado local |
| Operación básica < 60 min | [`tutorial-instalacion.md`](tutorial-instalacion.md) | (procedimiento) | #202 | Diseñado |

## Programa 4 — Offline inmediato

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| p50/p95 POS→KDS→impresión, sin inventar números | `telemetry/latency-metrics.js` | `latency-metrics.test.js` (9, `node --test`) | #201 | Impl · Probado local |
| Reproducible + desconexión/reconexión | `telemetry/latency-harness.js` | idem | #201 | Impl · Probado local |
| Instrumentar el hot path | **[requiere wiring Electron]** | — | (PR instalador) | Diseñado |

## Programa 5 — Turnos / corte Z

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Una caja/turno activo por regla | `20260827150000_pos_turnos_por_sucursal.sql` (índice único parcial) | `pos-turnos-migration.test.ts` (10) | #200 | Impl · Probado local |
| No borrar historial ni reiniciar folios | idem (sin delete/drop; no toca CFDI/secuencias) | idem (assert de operaciones) | #200 | Impl · Probado local |
| Corte Z endpoint + recuperación admin | (reusa `CierreCajaWizard`/`pos-arqueo`) | (existentes) | #200 | Diseñado |

## Programa 6 — Soporte

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Diagnóstico con consentimiento/RBAC/audit, sin shell | `lib/support-actions.ts` + `api/platform/support/action` | `support-actions.test.ts` (8) | #203 | Impl · Probado local |

## Programa 7 — Skeleton multisucursal

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Selector global, provenance/freshness/real-vs-demo | (reusa `AuthContext`/`sucursales`/`data_source`) | — | **PR-14 no abierto** | Diseñado |

> **Nota honesta:** el Programa 7 quedó **Diseñado** en el plan ([`FULLSITE-FACTORY.md`](FULLSITE-FACTORY.md))
> pero **no tiene PR** en este lote. No lo llames implementado.

## Programa 8 — Fullsite IQ

| Requisito | Código | Test | PR | Estado |
|---|---|---|---|---|
| Read-only + propuesta, allowlist, preview/diff, confirmación, audit | `lib/iq-proposals.ts` + `api/platform/iq/propose` | `iq-proposals.test.ts` (9) | #205 | Impl · Probado local |
| Nada autónomo de alto riesgo (`autonomous:false`) | idem | idem | #205 | Impl · Probado local |
| Ejecución confirmada de una propuesta | (endpoint separado) | — | (fuera del lote) | Diseñado |
