> ⚠️ **DOCUMENTO HISTÓRICO / DESACTUALIZADO** (snapshot de julio 2026 — verificar antes de citar).
> Estado real vigente: docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md (readiness 52/100 y "0/23 certificados" son de julio; offline ya se probó en campo).

# OFFLINE-100 — Resumen Ejecutivo

> Fecha: 2026-07-27 | OFFLINE-100 | Versión 2

---

## Estado de Certificación

```
OFFLINE-100 = NOT CERTIFIED
```

| Dimensión | Estado |
|---|---|
| **Phase 1 Offline** — el restaurante opera sin Internet | **PASS** |
| **Phase 2 Offline** — arquitectura local-first certificada | **FAIL** |

**"Phase 1 PASS"** significa que el restaurante puede tomar órdenes, enviarlas a cocina, cobrar e imprimir sin Internet. Los datos se guardan localmente y se sincronizan cuando vuelve la conexión. Esto funciona hoy.

**"Phase 2 FAIL"** significa que el sistema no cumple los requisitos de una arquitectura local-first certificada: el Local Server no tiene outbox sync implementado, STATE_SYNC puede clobberear estado local, y 0/23 escenarios de la Test Matrix han sido ejecutados.

**La distinción es importante**: "operación offline" y "arquitectura offline certificada" son cosas distintas. Hoy tenemos la primera. La segunda requiere cerrar los gaps documentados.

---

## Readiness Score Ponderado

**Readiness score ponderado: 52 / 100**

Los scores son juicio técnico aplicado sobre una rúbrica fija — no son estimaciones, pero tampoco son mediciones objetivas puras. La rúbrica determina qué evidencia corresponde a cada nivel. Un dominio solo alcanza 1.00 cuando las tres condiciones se cumplen simultáneamente.

### Rúbrica de Scoring

| Score | Nivel | Condición requerida |
|---|---|---|
| 0.00 | No implementado | No existe código para este dominio |
| 0.20 | Esqueleto | Infraestructura mínima, lógica principal ausente |
| 0.40 | Código parcial | Flujo principal con gaps significativos o dependencias no implementadas |
| 0.60 | Código completo | Flujo principal completo y coherente, sin tests automatizados del escenario end-to-end |
| 0.70 | Código + tests unitarios | Tests unitarios que verifican comportamiento del componente, sin validación end-to-end |
| 0.85 | Código + tests + dev | Tests pasan y el escenario fue ejecutado manualmente en entorno local |
| 1.00 | Certificado | Código + tests + ejecución documentada en staging con resultado PASS explícito |

### Tabla de Dominios

| # | Dominio | Peso | Score | Contribución | Evidencia | Por qué no sube |
|---|---|---|---|---|---|---|
| 1 | Operación offline (órdenes, cobro, cocina) | 25% | **0.60** | **15.0** | IDB completo, WS LAN, syncAll, print queue — flujo coherente | Sin tests e2e del flujo completo; 0 escenarios ejecutados en staging |
| 2 | Durabilidad de datos | 20% | **0.45** | **9.0** | events.ndjson, IDB, processed-commands.ndjson — persist verificado | Outbox sync NO implementado (P0-01); print queue sin test de restart |
| 3 | Pago y reconciliación | 15% | **0.70** | **10.5** | APP_API replay, STALE_WRITE_CONFLICT, payload preservado, tests unitarios | UI de resolución de conflictos no auditada; sin test e2e |
| 4 | Consistencia multi-terminal | 15% | **0.50** | **7.5** | MESA_LOCK, WS broadcast, SNAPSHOT + catch-up — units verificados | STATE_SYNC clobber (P0-02); re-discovery en cambio de IP: CONFIRMADO NO IMPLEMENTADO (T-09, auditado 2026-07-27) |
| 5 | Recovery automático | 10% | **0.50** | **5.0** | replay startup, drainLS→IDB, setupOfflineRetry — código existe | Sin test end-to-end de ningún escenario de recovery |
| 6 | Observabilidad | 10% | **0.40** | **4.0** | /health, heartbeat, print-queue events | Faltan: last_ack, conflict_count, printer_health/estación |
| 7 | Cobertura de tests | 5% | **0.20** | **1.0** | event-store.test.js, ws-hub.test.js, state.test.js — 7/23 escenarios con test | 23 escenarios = 0 ejecutados en staging |

**Total: 52.0 / 100**

> Dominio 1 bajó de 1.00 a 0.60. El código existe y el flujo es plausible, pero no hay tests e2e ni ejecución documentada — condiciones requeridas para 1.00 según la rúbrica. El score refleja lo que la evidencia soporta, no lo que se espera que funcione.

---

## P0 Abiertos (bloquean certificación)

### P0-01 — Outbox Sync (ver OFFLINE-GAP-001)

El Local Server no tiene outbox sync implementado. Los eventos en `events.ndjson` nunca llegan a Supabase directamente. En Phase 1 esto es una omisión planificada (el browser browser hace su propio sync). En Phase 2 (cuando el Local Server sea autoridad), es pérdida de datos garantizada.

**Impacto en la matriz**: Dominio 2 (Durabilidad) tiene score 0.45 principalmente por este gap.

### P0-02 — STATE_SYNC Clobber (ver OFFLINE-GAP-002)

El Supabase poll cada 5s reemplaza completamente el estado de mesas/kds/turno. Esto es correcto en Phase 1 pero incompatible con Phase 2. El modelo de merge esperado no está definido.

**Impacto en la matriz**: Dominio 4 (Consistencia multi-terminal) tiene score 0.50 por este gap.

### P0-03 — Test Matrix 0/23 ejecutados

Sin ejecución, no hay certificación. Los PASS de la matriz de dominios se basan en revisión de código, no en evidencia de ejecución.

**Impacto en la matriz**: Dominio 7 (Test coverage) tiene score 0.20.

---

## Gaps de Alta Prioridad

| Gap | Dominio afectado | Impacto |
|---|---|---|
| KDS standalone con credenciales hardcodeadas | Seguridad | Riesgo de credenciales expuestas en código fuente |
| WS reconnect en cambio de IP: UNKNOWN | Consistencia | Operador debe reiniciar terminales manualmente |
| UI de resolución de conflictos: no auditada | Pago y reconciliación | Conflictos STALE_WRITE no tienen UI de resolución visible |
| Print queue restart: sin test | Durabilidad | No hay evidencia de que los print jobs sobrevivan reinicios |

---

## Criterios de OFFLINE CERTIFIED

El sistema es **OFFLINE CERTIFIED** cuando se cumple todo lo siguiente:

- [ ] P0-01 cerrado: outbox sync implementado y probado con idempotencia
- [ ] P0-02 cerrado: modelo de merge documentado e implementado, STATE_SYNC deprecated o controlado
- [ ] P0-03 cerrado: 23/23 escenarios de Test Matrix en estado **Certificado**
- [ ] Chaos testing: 12 escenarios completos sin pérdida de datos
- [ ] Matriz de dominios: score ≥ 0.90 en todos los dominios con peso ≥ 15%
- [ ] Total ponderado: ≥ 90 / 100

No se declara OFFLINE CERTIFIED por autoridad editorial. Se declara cuando la matriz lo dice.

---

## Archivos de Este Audit

| Archivo | Propósito |
|---|---|
| `docs/architecture/OFFLINE-MASTER.md` | Arquitectura completa, status por componente |
| `docs/testing/OFFLINE-TEST-MATRIX.md` | 23 escenarios con columnas: Implementado / Testado / Certificado |
| `docs/testing/OFFLINE-CHAOS-TESTS.md` | 12 escenarios de chaos — diseño, no código |
| `docs/testing/OFFLINE-RECOVERY.md` | Protocolo de recovery: qué pasa cuando vuelve internet |
| `docs/testing/OFFLINE-OBSERVABILITY.md` | 13 métricas con status |
| `docs/architecture/OFFLINE-GAP-001.md` | Contrato completo del Outbox (P0-01) |
| `docs/architecture/OFFLINE-GAP-002.md` | Modelo de State Sync, análisis del clobber, arquitectura propuesta (P0-02) |
| `docs/testing/OFFLINE-EXECUTIVE-SUMMARY.md` | Este documento |
