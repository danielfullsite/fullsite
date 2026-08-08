# WORLD-CLASS BACKLOG — 90 DÍAS
> Máximo 12 tareas. Cada tarea con DoD completo.
> **Fecha:** 2026-08-05
> **Versión:** 1.0 — Pendiente aprobación del Founder.
>
> **Clasificación de prioridad:**
> - P0 = reliability, security, data integrity, tenant isolation
> - P1 = agent accuracy, margin truth, onboarding
> - P2 = action workflows, multi-location intelligence
> - P3 = expansion features
>
> **Clasificación de dependencias:**
> - HARD = no puede iniciar hasta que el prerequisito esté CLOSED con evidencia
> - SOFT = puede iniciar antes, completa después
> - PARALLEL = independiente de otros gates

---

## T-01 — Diagnostic Session AMALAY

```
TASK ID:           T-01
TITLE:             Diagnostic Session AMALAY — determinar Branch A vs B
ENGINE:            Field Operations
PRIORITY:          P0
OWNER TYPE:        Founder (presencia física requerida)

DEPENDENCIES:      Ninguna (no tiene prerequisito operativo relevante)
DEPENDENCY TYPE:   N/A — primer gate

ENTRY GATE:
- Runbook de campo preparado y revisado
- ZIPs de rollback (v1.2.0) disponibles
- SHA-256 verificados

ACCEPTANCE CRITERIA:
- Branch A (NSIS) o Branch B (manual/legacy) determinado con evidencia
- ZIP de backup capturado del estado actual
- Hashes verificados y documentados
- Decisión: INSTALLATION AUTHORIZED / BLOCKED

TEST PLAN:
1. PDV3 primero: verificar registro HKLM o ausencia
2. SERVER1: verificar estado, versión, logs
3. Capturar ZIPs de backup
4. Determinar branch

EVIDENCE ARTIFACT:
- Foto de registro NSIS (o ausencia)
- Hash del EXE actual
- server.log snapshot
- DIAGNOSTIC-VISIT-[fecha].md con conclusión

ROLLBACK:
No aplica — esta sesión NO instala, NO modifica el sistema

TARGET WEEK:       1 (Ago 05-11)
CONFIDENCE:        High — solo requiere coordinar visita
SLIP TRIGGER:      Visita cancelada o acceso a SERVER1 bloqueado
DEFINITION OF DONE:
Branch A/B documentado con evidencia fotográfica.
INSTALLATION AUTHORIZED o BLOCKED con razón.
Runbook field batch #2 actualizado con branch correcto.
```

---

## T-02 — Field Batch #2 ETAPA 0

```
TASK ID:           T-02
TITLE:             Field Batch #2 ETAPA 0 — v1.3.3 en 1 terminal no crítica
ENGINE:            Field Operations
PRIORITY:          P0
OWNER TYPE:        Founder + Eduardo

DEPENDENCIES:      T-01 CLOSED (Branch A/B determinado, INSTALLATION AUTHORIZED)
DEPENDENCY TYPE:   HARD

ENTRY GATE:
- T-01 CLOSED con INSTALLATION AUTHORIZED
- Rollback ZIP disponible y hash verificado
- v1.3.3 EXE SHA-256: 5abfc10e27f03163d2f0ed3cd48a539df760caa95ddf8e3e0b387400ed47b429

ACCEPTANCE CRITERIA:
- v1.3.3 instalado en 1 terminal no crítica (PDV3)
- E0-01 a E0-11 completados y PASS
- Heartbeat confirmado en local_server_heartbeats (BLOCKER para ETAPA 1)
- KDS station filter operativo post-v1.3.3

TEST PLAN:
1. E0-01: Branch-appropriate install procedure
2. E0-02: Verify backup captured
3. E0-03 a E0-06: Service, health, version
4. E0-07: /health endpoint — 18 campos verificados
5. E0-08: LAN connectivity
6. E0-09: Fingerprint service (opcional si no hay binary)
7. E0-10: server.log pre y post restart — append mode
8. E0-11: local_server_heartbeats.reported_at actualizado (BLOCKER)

EVIDENCE ARTIFACT:
- ETAPA0-REPORT-[fecha].md con resultado de cada control
- Screenshot de /health response
- Supabase query mostrando heartbeat
- server.log con entradas pre y post restart

ROLLBACK:
Ejecutar rollback procedure de Branch A o B según determinado en T-01.
Target: restauración completa en <30 min.

TARGET WEEK:       1 (Ago 05-11)
CONFIDENCE:        Medium — depende de T-01 completado en misma semana
SLIP TRIGGER:      T-01 retrasado; heartbeat no aparece en Supabase; instalación falla
DEFINITION OF DONE:
E0-01 a E0-11 = PASS.
Heartbeat confirmado con timestamp en Supabase.
Terminal PDV3 operativa con v1.3.3 durante turno completo.
```

---

## T-03 — OCS P2.5.9 — Core Offline Suite

```
TASK ID:           T-03
TITLE:             OCS P2.5.9 — 12 criterios offline certificados en campo
ENGINE:            Field Operations
PRIORITY:          P0
OWNER TYPE:        Founder + Eduardo

DEPENDENCIES:      T-02 CLOSED; v1.3.3 en todas las terminales
DEPENDENCY TYPE:   HARD

ENTRY GATE:
- ETAPA 1 completada: v1.3.3 en todas las terminales
- KDS station filter FIELD VERIFIED
- Runbook OCS P2.5.9 preparado

ACCEPTANCE CRITERIA:
Los 12 criterios FIELD VERIFIED con evidencia por criterio:
- OC-01: Cold start sin WAN (<30s, sin error)
- OC-02: Orden completa sin WAN (ítem → KDS → print → IDB)
- OC-03: KDS LAN sin WAN (broadcast independiente de cloud)
- OC-04: Impresión offline (TCP/USB sin internet)
- OC-05: Restart durante turno (datos persistidos, sin pérdida)
- OC-06: Reboot completo (IDB sobrevive, sync al reconectar)
- OC-07: Conflicto multi-terminal offline (sin corrupción)
- OC-08: Reconexión sin duplicados (dedup verificado en Supabase)
- OC-09: Corte X sin internet (datos desde IDB)
- OC-10: Void con PIN sin internet (PBKDF2 offline)
- OC-11: Cancelación con PIN sin internet
- OC-12: Soak 4 horas sin WAN (operación continua, sin degradación)

TEST PLAN:
Para cada criterio: preparar, ejecutar, documentar resultado, tomar foto/video, registrar en Supabase.
OC-12 (soak 4h): planificar en día de operación real para evitar interrumpir servicio.

EVIDENCE ARTIFACT:
- OCS-P2.5.9-FIELD-CERTIFIED.md (nuevo) con resultado de cada criterio
- Fotos: server.log, IDB data, Supabase query post-sync, heartbeat
- Video del cold start (OC-01)

ROLLBACK:
Si algún criterio FALLA: detener suite, documentar falla, fix en código, repetir ese criterio.
No declarar ningún criterio PASS parcialmente.

TARGET WEEK:       2-3 (Ago 12-25)
CONFIDENCE:        Medium — OC-12 (soak 4h) requiere coordinación de horario
SLIP TRIGGER:      Falla en OC-05 (restart data loss), OC-08 (duplicados), OC-12 (degradación en soak)
DEFINITION OF DONE:
12/12 criterios OCS = FIELD VERIFIED.
OCS-P2.5.9-FIELD-CERTIFIED.md creado y firmado (Daniel + Eduardo).
PUBLIC-CLAIMS-REGISTER.md actualizado: "offline-first" = FIELD VERIFIED.
```

---

## T-04 — Agent Accuracy Infrastructure

```
TASK ID:           T-04
TITLE:             Infraestructura de accuracy — schema y shadow mode
ENGINE:            Agent OS
PRIORITY:          P1
OWNER TYPE:        Engineer

DEPENDENCIES:      Ninguna (paralelo a T-01/T-02/T-03)
DEPENDENCY TYPE:   PARALLEL

ENTRY GATE:
- Supabase acceso disponible
- agent_events tabla existente

ACCEPTANCE CRITERIA:
- agent_labels tabla creada con schema definido
- agent_certifications tabla creada con schema definido
- agent_events: columnas shadow_mode, sources_used, freshness_ok, abstained,
  abstention_reason, confidence_score añadidas
- check_freshness() enforced en ANO-001 y DOB-001
- Shadow mode flag activable sin cambiar la lógica de producción

TEST PLAN:
1. Crear agent_labels con insert de test — verificar que persiste
2. Crear agent_certifications con insert de test
3. Correr ANO-001 con shadow_mode=true — verificar que output queda en agent_events
   con shadow_mode=true y NO se envía a Telegram
4. Correr ANO-001 con datos stale — verificar abstención y abstention_reason

EVIDENCE ARTIFACT:
- Migration file con SQL de las 3 operaciones de schema
- Test output mostrando agent_events con shadow_mode=true
- Test output mostrando abstención cuando datos >2h

ROLLBACK:
Migration reversible. Ninguna columna añadida tiene NOT NULL sin default.

TARGET WEEK:       5 (Sep 02-08)
CONFIDENCE:        High — trabajo puramente de DB schema
SLIP TRIGGER:      Supabase acceso bloqueado; conflicto de schema existente
DEFINITION OF DONE:
Schema activo en producción.
check_freshness() enforced y verificado con test.
Shadow mode activo: ANO-001 corre sin enviar a Telegram, outputs en agent_events.
```

---

## T-05 — ANO-001 Backtest y Calibración

```
TASK ID:           T-05
TITLE:             ANO-001 — backtest 90 días + calibración de thresholds
ENGINE:            Agent OS / Certified Intelligence
PRIORITY:          P1
OWNER TYPE:        Engineer + Eduardo (labeling)

DEPENDENCIES:      T-04 CLOSED
DEPENDENCY TYPE:   HARD (necesita shadow_mode column)

ENTRY GATE:
- T-04 CLOSED: schema activo, shadow mode funcional
- 90 días de wansoft_daily disponibles (2026-05-01 a 2026-07-30)
- Eduardo disponible para 30 min de labeling retrospectivo

ACCEPTANCE CRITERIA:
- Backtest ejecutado en 90 días históricos con umbrales actuales
- Precision y recall INICIAL calculados (puede ser bajo — eso es esperado)
- Eduardo etiqueta ≥12 semanas históricas: "¿Hubo anomalía real esta semana?"
- Umbrales recalibrados usando 2σ por métrica por DOW
- Umbrales documentados con razón estadística (no arbitraria)

TEST PLAN:
1. Script de backtest: simular anomaly_detector en cada día de wansoft_daily
2. Comparar outputs con etiquetas de Eduardo
3. Calcular TP/FP/FN → precision/recall inicial
4. Calcular 2σ para ventas_dia, tickets_count, ticket_promedio por DOW
5. Reemplazar thresholds hardcoded con thresholds estadísticos
6. Re-correr backtest con nuevos thresholds — verificar mejora

EVIDENCE ARTIFACT:
- backtest-ANO-001-[fecha].csv: predicciones vs labels
- precision_recall_initial.md: números antes del ajuste
- threshold_calibration.md: razón estadística por threshold
- precision_recall_post_calibration.md: números después

ROLLBACK:
No aplica — backtest es análisis offline. Thresholds no van a producción
hasta Research Pass completado.

TARGET WEEK:       5 (Sep 02-08)
CONFIDENCE:        High — datos disponibles, metodología clara
SLIP TRIGGER:      Eduardo no disponible para labeling; wansoft_daily tiene gaps >14 días
DEFINITION OF DONE:
Precision y recall calculados con thresholds calibrados.
Thresholds documentados con razón estadística.
ANO-001 shadow mode iniciado con nuevos thresholds.
```

---

## T-06 — ANO-001 Research Pass → CERTIFIED

```
TASK ID:           T-06
TITLE:             ANO-001 — Research Pass → Production Certified
ENGINE:            Agent OS / Certified Intelligence
PRIORITY:          P1
OWNER TYPE:        Engineer + Eduardo

DEPENDENCIES:      T-05 CLOSED; T-04 CLOSED
DEPENDENCY TYPE:   HARD

ENTRY GATE:
- T-05 CLOSED: thresholds calibrados, shadow mode iniciado
- ≥14 días de shadow mode completados
- Eduardo ha revisado ≥30 outputs de shadow

ACCEPTANCE CRITERIA — RESEARCH PASS:
- F1 ≥ 0.78 en datos etiquetados
- ≥30 días de labels de Eduardo en agent_labels
- Backtest documentado
- Abstención funcionando (confidence <0.6 → no Telegram)

ACCEPTANCE CRITERIA — PRODUCTION CERTIFIED:
- Precision ≥ 90%
- Recall ≥ 75%
- False-positive rate ≤ 10%
- Operator acceptance ≥ 70% (Eduardo labels)
- Provenance: sources_used en 100% de runs
- Freshness: check_freshness enforced
- Calibration error medido

TEST PLAN:
Semana 7: calcular métricas de shadow mode con labels de Eduardo.
Si Research Pass: continuar shadow 1 semana más.
Si Production Certified: publicar en AGENT-ACCURACY-PROGRAM.md.

EVIDENCE ARTIFACT:
- ANO-001-certification-[fecha].md: TP/FP/FN, precision, recall, F1, FPR, acceptance
- Certification entry en agent_certifications table

ROLLBACK:
Si precision <70% post-calibración: SUSPEND ANO-001 production alerts.
Investar root cause. No re-certificar sin nueva ronda de labeling.

TARGET WEEK:       7 (Sep 16-22) Research Pass; 8-9 Production Certified si targets PASS
CONFIDENCE:        Medium (thresholds actuales no calibrados — resultado inicial incierto)
SLIP TRIGGER:      Precision inicial <60%; Eduardo no disponible para weekly review
DEFINITION OF DONE:
ANO-001 = PRODUCTION CERTIFIED.
Métricas publicadas en AGENT-ACCURACY-PROGRAM.md.
agent_certifications table actualizada.
Producción: alerts enviadas con confidence_score y sources_used.
```

---

## T-07 — DOB-001 Certification

```
TASK ID:           T-07
TITLE:             DOB-001 — Daily Operational Brief certificado
ENGINE:            Agent OS / Certified Intelligence
PRIORITY:          P1
OWNER TYPE:        Engineer + Eduardo (labeling diario)

DEPENDENCIES:      T-04 CLOSED (schema activo)
DEPENDENCY TYPE:   SOFT (puede iniciar labeling ahora; schema es soft dependency)

ENTRY GATE:
- agent_labels tabla activa
- Eduardo recibe instrucción de evaluar cada briefing diario

ACCEPTANCE CRITERIA:
- Eduardo evalúa cada briefing: accuracy (1-5) + "¿tomé alguna acción?" (sí/no)
- ≥30 evaluaciones acumuladas en agent_labels
- Factual accuracy: 100% (cero datos incorrectos en briefing)
- Utility: ≥60% de días generaron ≥1 acción por Eduardo

TEST PLAN:
Semana 5: Eduardo inicia evaluaciones diarias (proceso ~2 min/día).
Semana 6-7: recopilar evaluaciones. Verificar accuracy vs DB.
Semana 8: calcular accuracy y utility con ≥30 samples.

EVIDENCE ARTIFACT:
- agent_labels entries para DOB-001 con 30+ rows
- DOB-001-certification-[fecha].md con accuracy y utility calculados

ROLLBACK:
Si accuracy <100%: identificar fuente del dato incorrecto. Corregir. Resetear contador.

TARGET WEEK:       8 (Sep 23-30)
CONFIDENCE:        High — DOB-001 es factual, no predictivo. Accuracy debería ser 100%.
SLIP TRIGGER:      Eduardo no evalúa consistentemente; dato incorrecto en briefing
DEFINITION OF DONE:
DOB-001 = PRODUCTION CERTIFIED.
30+ evaluaciones de Eduardo en agent_labels.
Accuracy 100% verificado. Utility ≥60% documentado.
```

---

## T-08 — EXC-001 Shadow Mode (capacidades 1 y 2)

```
TASK ID:           T-08
TITLE:             EXC-001 — shadow mode de detección y exposición
ENGINE:            Agent OS / Certified Intelligence
PRIORITY:          P1
OWNER TYPE:        Engineer

DEPENDENCIES:      T-04 CLOSED
DEPENDENCY TYPE:   SOFT (puede correr en paralelo con T-05/T-06)

ENTRY GATE:
- agent_events con shadow_mode column activo
- pos_orders con cancellation_reason y staff_id poblados en ≥80% de cancelaciones

ACCEPTANCE CRITERIA:
- EXC-001 detecta cancelaciones y descuentos usando pos_orders
- Outputs generados con shadow_mode=true (no a Telegram)
- Abstención funcionando cuando cancellation_reason NULL en >20% de casos
- confidence_score calculado y documentado
- ≥14 días de shadow mode completados

NOTA SOBRE SCOPE:
Esta task cubre capacidades 1 y 2 de EXC-001:
1. Operational exception detection (cancelaciones, descuentos, cortesías)
2. Estimated transaction exposure (monto MXN afectado)
NO cubre capacidad 3 (full financial impact) — esa requiere Margin Engine de Fase 3.

TEST PLAN:
1. Correr EXC-001 en datos históricos de pos_orders (cancelaciones reales)
2. Eduardo + Daniel etiquetan: "¿Era esta alerta real?"
3. Calcular precision/recall inicial
4. Shadow mode ≥14 días

EVIDENCE ARTIFACT:
- agent_events entries con shadow_mode=true para EXC-001
- Backtest output con labels de Eduardo y Daniel

ROLLBACK:
Shadow mode no afecta producción. No hay rollback requerido.

TARGET WEEK:       6-8 (Sep 09-30) paralelo a T-06
CONFIDENCE:        Medium — calidad depende de completitud de cancellation_reason en pos_orders
SLIP TRIGGER:      cancellation_reason NULL en >50% de órdenes; datos insuficientes <30 días
DEFINITION OF DONE:
≥14 días de shadow mode con outputs en agent_events.
≥15 labels de Eduardo y Daniel.
Precision y recall inicial calculados para capacidades 1 y 2.
Listo para certifying sprint en semana 10.
```

---

## T-09 — Alert Lifecycle v1

```
TASK ID:           T-09
TITLE:             Alert lifecycle — tracking viewed/accepted/outcome
ENGINE:            Agent OS / Action Loop
PRIORITY:          P1
OWNER TYPE:        Engineer

DEPENDENCIES:      T-04 CLOSED (shadow mode activo)
DEPENDENCY TYPE:   SOFT

ENTRY GATE:
- agent_events tabla activa
- ANO-001 en producción (o shadow con outputs verificables)

ACCEPTANCE CRITERIA:
- alert_events table (o columnas en agent_events): shown_at, viewed_at, action_taken, outcome
- Cuando Eduardo actúa en una alerta: registrar qué acción tomó
- ≥3 alertas con lifecycle tracked (shown → viewed → action o dismissed)
- Dashboard básico: alertas activas sin resolver (puede ser Telegram o in-app)

TEST PLAN:
1. ANO-001 genera alerta → verificar que queda en alert_events
2. Marcar como viewed (via simple API o comando)
3. Eduardo registra acción tomada
4. Verificar que lifecycle completo queda en DB

EVIDENCE ARTIFACT:
- alert_events rows con lifecycle completo para ≥3 alertas
- Query mostrando alertas sin resolver

ROLLBACK:
No afecta datos existentes. Migration es additive.

TARGET WEEK:       6 (Sep 09-15)
CONFIDENCE:        High — trabajo de schema + simple tracking
SLIP TRIGGER:      ANO-001 no genera alertas durante shadow (datos muy estables)
DEFINITION OF DONE:
≥3 alertas con lifecycle completo en DB.
outcome registrado en ≥1 alerta (qué pasó después de la acción).
```

---

## T-10 — Yield Factor en Recetas

```
TASK ID:           T-10
TITLE:             Yield factor en pos_recipe_lines + food cost recalculado
ENGINE:            Margin Truth
PRIORITY:          P1
OWNER TYPE:        Engineer + Eduardo

DEPENDENCIES:      T-03 CLOSED (Core Offline CERTIFIED) — preferible pero no hard dependency
DEPENDENCY TYPE:   SOFT

ENTRY GATE:
- pos_recipe_lines tabla activa con data de 178 recetas
- Eduardo disponible para estimar yield de top-20 ingredientes (~30 min)

ACCEPTANCE CRITERIA:
- Campo yield_factor (numeric 0-1, default 1.0) añadido a pos_recipe_lines
- Eduardo estima yield para top-20 ingredientes por peso en food cost
  (ej. aguacate 0.75, pollo 0.65, jitomate 0.85)
- Food cost recalculado: unit_cost × (1 / yield_factor)
- Food cost total de AMALAY recalculado con yield — publicar con disclaimer "estimado con yield"
- Tests: receta con yield 0.75 → costo calculado es 33% mayor que sin yield

TEST PLAN:
1. Migration: ALTER TABLE pos_recipe_lines ADD COLUMN yield_factor numeric(4,3) DEFAULT 1.0
2. Eduardo completa spreadsheet con yield estimado por ingrediente
3. Actualizar pos_recipe_lines con yield_factor de Eduardo
4. Recalcular food cost en pos_recipes view
5. Verificar que cambio en yield_factor se refleja inmediatamente en food cost display

EVIDENCE ARTIFACT:
- Migration SQL con yield_factor column
- Eduardo-yield-estimates-[fecha].csv: ingrediente, yield estimado, razón
- food-cost-with-yield-[fecha].md: food cost antes y después de yield factor

ROLLBACK:
Yield_factor DEFAULT 1.0 → sin yield factor = comportamiento anterior.

TARGET WEEK:       9 (Oct 01-07)
CONFIDENCE:        High — schema simple, Eduardo tiene conocimiento del ingrediente
SLIP TRIGGER:      Eduardo no tiene estimados de yield; datos de receta incompletos
DEFINITION OF DONE:
yield_factor en pos_recipe_lines con data real de Eduardo.
Food cost con yield TEST VERIFIED (≥3 tests passing).
Food cost dashboard actualizado con disclaimer "estimado con yield factor".
Eduardo confirmó que números son razonables.
```

---

## T-11 — Contribution Margin con Cobertura Declarada

```
TASK ID:           T-11
TITLE:             Contribution margin diario con disclaimer de cobertura
ENGINE:            Margin Truth
PRIORITY:          P1
OWNER TYPE:        Engineer

DEPENDENCIES:      T-10 CLOSED; wansoft_asistencia disponible para labor estimate
DEPENDENCY TYPE:   HARD (T-10); SOFT (labor data)

ENTRY GATE:
- yield_factor activo en pos_recipe_lines
- pos_orders con costo_estimado siendo calculado al cerrar orden
- Eduardo ingresó hourly_rate básico para pos_staff (confidencial)

ACCEPTANCE CRITERIA:
contribution_margin = ventas_dia - costo_comida - labor_cost
- ventas_dia: de pos_daily_summary (datos propios) o wansoft_kpis (declarar fuente)
- costo_comida: de pos_orders + pos_recipe_lines + yield_factor
- labor_cost: horas_trabajadas × hourly_rate (fuente: wansoft_asistencia, declarar)
- Dashboard: disclaimer visible "cobertura: ventas ✓ food cost ✓ labor ✓ overhead ✗"
- contribution_margin ≠ profit — declarado explícitamente en UI

TEST PLAN:
1. Calcular contribution_margin para 7 días consecutivos
2. Verificar que cada componente tiene fuente declarada en DB
3. Comparar food cost calculado vs food cost de Wansoft para sanity check
4. Eduardo revisa número y confirma que parece razonable

EVIDENCE ARTIFACT:
- pos_daily_summary entries con contribution_margin y cobertura declarada
- Screenshot de dashboard con disclaimer visible
- Eduardo feedback en writing: "el número parece correcto"

ROLLBACK:
Columna contribution_margin es additive — no rompe datos existentes.

TARGET WEEK:       10 (Oct 08-14)
CONFIDENCE:        Medium — labor data de Wansoft puede tener gaps
SLIP TRIGGER:      wansoft_asistencia no tiene datos suficientes; overhead allocation requerida por cliente
DEFINITION OF DONE:
Contribution margin calculado para ≥30 días.
Disclaimer de cobertura visible en dashboard.
Sin claim de "P&L completo" — solo "contribution margin con cobertura declarada".
```

---

## T-12 — Manager Panel v1

```
TASK ID:           T-12
TITLE:             Manager Panel v1 — diagnóstico sin código
ENGINE:            Field Operations / Onboarding
PRIORITY:          P1
OWNER TYPE:        Engineer

DEPENDENCIES:      /health endpoint activo; heartbeat en Supabase; T-02 CLOSED
DEPENDENCY TYPE:   SOFT (puede diseñarse en paralelo)

ENTRY GATE:
- /health endpoint respondiendo con 18 campos
- heartbeat en local_server_heartbeats activo
- v1.3.3 instalado en AMALAY

ACCEPTANCE CRITERIA:
- UI simple (app.fullsite.mx/manager o panel dedicado):
  - Lista de terminales con: heartbeat status, versión, sync_queue_size, last_log_entry
  - Indicador visual: verde/amarillo/rojo basado en heartbeat y sync_queue
  - Último /health response visible sin abrir terminal ni código
- Eduardo puede diagnosticar "el sistema está ok o no" sin llamar a Daniel
- Playbook de los 5 errores más frecuentes enlazado desde el panel

TEST PLAN:
1. Eduardo abre Manager Panel sin asistencia
2. Se simula un problema (desconectar LAN de un terminal)
3. Eduardo identifica el terminal afectado y el estado en el panel
4. Eduardo consulta el playbook y toma acción sin llamar a Daniel

EVIDENCE ARTIFACT:
- Video de Eduardo usando el Manager Panel sin asistencia
- PRR-08 y PRR-09 cerrados con evidencia
- Playbook-TOP5.md creado

ROLLBACK:
Manager Panel es read-only — no modifica ningún dato.

TARGET WEEK:       11-12 (Oct 15-Nov 3)
CONFIDENCE:        Medium — requiere coordinación de visita para test con Eduardo
SLIP TRIGGER:      Eduardo no disponible para test; /health datos insuficientes para diagnóstico útil
DEFINITION OF DONE:
Eduardo diagnostica problema real o simulado sin llamar a Daniel.
PRR-08 y PRR-09 CLOSED con evidencia.
Playbook-TOP5.md activo y enlazado desde panel.
```

---

## PARALLEL WORKSTREAMS (no en backlog, sin gate de bloqueo)

Los siguientes workstreams pueden avanzar en paralelo a cualquier tarea del backlog:

| Workstream | Owner | Descripción | Gate que desbloquea |
|---|---|---|---|
| Agent labeling (Eduardo) | Daniel | Eduardo evalúa briefings diarios | T-07 certification |
| GTM / sales discovery | Daniel | Calificar prospectos, pricing research | No bloquea ningún gate técnico |
| Grupo Galería pilot params | Daniel | Definir location, timeline, success metrics | Prerrequisito LOI follow-up |
| Onboarding documentation | Engineer | MANUAL-OPERATIVO-TEMPLATE.md genérico | Segundo cliente real |
| Pricing WTP validation | Daniel | Entrevistas con prospectos | Antes de publicar precio |
| CFDI decision (Andy) | Daniel | CSD SAT tramitado | P0-3 |

---

## Resumen de gates críticos

| Target Week | Gate crítico | Confidence | Hard Dependency |
|---|---|---|---|
| 1 | T-01 Diagnostic CLOSED + Branch determinado | High | Ninguna |
| 1 | T-02 ETAPA 0 PASS + heartbeat | Medium | T-01 |
| 3 | T-03 OCS P2.5.9 12/12 FIELD VERIFIED | Medium | T-02 |
| 5 | T-04 Schema activo + shadow mode | High | Ninguna |
| 5 | T-05 ANO-001 backtest + thresholds calibrados | High | T-04 |
| 7 | T-06 ANO-001 Research Pass (F1 ≥ 0.78) | Medium | T-05 |
| 8 | T-06 ANO-001 PRODUCTION CERTIFIED | Medium | Research Pass |
| 8 | T-07 DOB-001 PRODUCTION CERTIFIED | High | T-04 (soft) |
| 9 | T-10 Yield factor TEST VERIFIED | High | T-10 entry |
| 10 | T-08 EXC-001 CERTIFIED (cap. 1+2) | Medium | T-08 shadow |
| 10 | T-11 Contribution margin con cobertura | Medium | T-10 |
| 12 | T-12 Manager Panel FIELD VERIFIED | Medium | T-02 |

**REGLA:** Ningún gate se marca CLOSED sin evidencia documental. Fechas = TARGET, no promesa.
