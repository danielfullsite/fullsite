# FULLSITE READINESS CONTRACT v1.0

> **Documento fundacional del Agent OS. CONGELADO.**
>
> El Agent OS no puede agregar, quitar ni modificar estos gates sin una Founder Decision aprobada.
> Ningún score ponderado reemplaza un gate obligatorio. No existe "100% con reservas".
> Última modificación: 2026-08-04 (versión inicial)

---

## Principio de separación

Los bloqueadores externos (SAT, Uber, Rappi, PAC, terceros) no impiden que el Core Platform alcance 100% si el código y los controles internos ya están listos. Se marcan como `WAITING_EXTERNAL` y no bloquean el progreso interno.

---

## R1 — AMALAY Production Ready

**Definición:** AMALAY puede operar el POS en producción sin intervención técnica de Daniel durante un turno completo, incluyendo falla de conectividad.

| Gate | ID | Descripción | Tipo | Estado inicial |
|---|---|---|---|---|
| P0-1 CERTIFIED | R1-G01 | Cierre con órdenes abiertas (GUARD08) — OCS-P0-1 | CODE+FIELD | ✅ CERTIFIED |
| P0-4 FIELD VERIFIED | R1-G02 | Offline / Sync completo — OCS-P2.5.9 Fases A–D | FIELD | ⏳ PENDING |
| 7 días sin intervención | R1-G03 | 7 días consecutivos en AMALAY sin que Daniel intervenga técnicamente | OPERATIONAL | ⏳ PENDING |
| Cero pérdida de órdenes | R1-G04 | Cero órdenes perdidas en los 7 días | OPERATIONAL | ⏳ PENDING |
| Cero diferencias de arqueo | R1-G05 | Cero diferencias de caja no explicadas en los 7 días | OPERATIONAL | ⏳ PENDING |
| Cero fallas de impresión no recuperables | R1-G06 | Cero tickets perdidos sin queue visible durante los 7 días | OPERATIONAL | ⏳ PENDING |
| ORS ≥ 80 | R1-G07 | Offline Reliability Score igual o superior a 80/100 | CODE | ✅ 90/100 |
| Rollback documentado | R1-G08 | Runbook de rollback ejecutable por Eduardo sin Daniel | CODE | ✅ EXISTS |
| Facturación PAC | R1-G09 | CFDI 4.0 operando (≥1 CFDI/día) | WAITING_EXTERNAL | 🔴 SAT/CSD |
| Cero P0 abiertos | R1-G10 | Sin Runtime Gaps P0 activos al cierre de los 7 días | CODE | ✅ 0 open |

**Condición de R1 READY:** R1-G01 ✅, R1-G02 ✅, R1-G03 ✅, R1-G04 ✅, R1-G05 ✅, R1-G06 ✅, R1-G07 ✅, R1-G08 ✅, R1-G10 ✅.
R1-G09 (facturación) es WAITING_EXTERNAL y no bloquea si los demás están verdes.

---

## R2 — Client #2 Ready

**Definición:** Un cliente nuevo puede ser provisionado, entrenado y operar desde Día 0 sin que Daniel escriba código.

| Gate | ID | Descripción | Tipo | Estado inicial |
|---|---|---|---|---|
| Tenant isolation verificado | R2-G01 | RLS correcta en todas las tablas + adversarial test PASS | CODE | ⏳ PENDING |
| Onboarding automatizado | R2-G02 | `provision_client.sh` produce cliente en <20 min sin pasos manuales | CODE | ⏳ PARTIAL |
| Manifest validado | R2-G03 | manifest.json con schema strict + CI validation | CODE | ⏳ PENDING |
| Provisioning de terminales | R2-G04 | POS, KDS e impresora configurables desde manifest | CODE | ⏳ PENDING |
| Menú y staff importados | R2-G05 | menu_import.py + staff_import.py ejecutados y verificados | CODE | ⏳ PARTIAL |
| Smoke test automatizado | R2-G06 | smoke_test.py PASS en cliente nuevo sin DataAMALAY | CODE | ⏳ PARTIAL |
| Runbook instalación | R2-G07 | Runbook de instalación ejecutable por Eduardo sin Daniel | CODE | ⏳ PENDING |
| Shadow Day preparado | R2-G08 | Shadow Day protocol documentado y entrenamiento listo | FIELD | ⏳ PENDING |
| Cero hardcodes AMALAY | R2-G09 | check_hardcodes.sh PASS en todo el codebase | CODE | ⏳ PENDING |
| INV-05 gate en CI | R2-G10 | CI bloquea nuevos accesos directos no anotados a Supabase | CODE | ✅ ACTIVE |

**Condición de R2 READY:** R2-G01..R2-G10 todos ✅. R2 no puede iniciar hasta R1 ≥ 80%.

---

## R3 — Scale Ready (20+ clientes)

**Definición:** El sistema puede incorporar 20+ clientes sin que Daniel intervenga en el proceso técnico.

| Gate | ID | Descripción | Tipo | Estado inicial |
|---|---|---|---|---|
| HTTP contract tests | R3-G01 | Contract tests completos para Bridge WS + REST API | CODE | ⏳ PENDING |
| Logging persistente | R3-G02 | Electron logs sobreviven reinicios + rotación + diagnóstico remoto | CODE | ⏳ PARTIAL |
| Health + heartbeat | R3-G03 | /health endpoint completo + heartbeat cada 60s | CODE | ⏳ PARTIAL |
| Auto-update controlado | R3-G04 | Auto-update con rollback automático | CODE | ⏳ PENDING |
| Backup + DR | R3-G05 | RTO ≤ 4h, RPO ≤ 1h documentados y probados | CODE | ⏳ PENDING |
| Instalación sin Daniel | R3-G06 | Eduardo puede instalar en un terminal nuevo siguiendo el runbook | FIELD | ⏳ PENDING |
| Soporte tier-1 | R3-G07 | FAQ + runbook de soporte sin acceso técnico | CODE | ⏳ PENDING |
| Monitoreo multi-tenant | R3-G08 | Dashboard de salud por cliente en FEOS | CODE | ⏳ PENDING |
| Seguridad multi-tenant | R3-G09 | Penetration test entre tenants PASS | CODE | ⏳ PENDING |
| Deployment repetible | R3-G10 | CI/CD pipeline completo + staging gate antes de producción | CODE | ⏳ PENDING |
| Costo/tiempo de onboarding | R3-G11 | Tiempo medido end-to-end, objetivo: <4h sin Daniel | OPERATIONAL | ⏳ PENDING |

**Condición de R3 READY:** R3-G01..R3-G11 todos ✅. R3 no puede iniciar hasta R2 ≥ 80%.

---

## R4 — Operational Intelligence Ready

**Definición:** Los agentes producen decisiones confiables y accionables. El restaurante opera mejor gracias a la inteligencia, no a pesar de ella.

| Gate | ID | Descripción | Tipo | Estado inicial |
|---|---|---|---|---|
| Captura confiable de eventos | R4-G01 | 100% de ventas capturadas sin gaps por >24h | OPERATIONAL | ✅ MONITORING |
| Calidad de datos | R4-G02 | Trazabilidad completa: fuente, ts, método por cada dato | CODE | ⏳ PARTIAL |
| Detección de anomalías | R4-G03 | Anomaly detector con FP <20% medido en campo | OPERATIONAL | ⏳ MONITORING |
| Owner brief | R4-G04 | Briefing matutino accionable cada día a las 7am | OPERATIONAL | ✅ ACTIVE |
| Recomendaciones accionables | R4-G05 | ≥1 recomendación implementada por semana basada en agente | OPERATIONAL | ⏳ PENDING |
| Medición de impacto | R4-G06 | estimated_value + outcome tracked en agent_events | CODE | ✅ ACTIVE |
| Falsos positivos documentados | R4-G07 | FP rate <20% en anomaly + antifraud agentes | OPERATIONAL | ⏳ MONITORING |

**Condición de R4 READY:** R4-G01..R4-G07 todos ✅. R4 puede avanzar en paralelo con R1/R2/R3.

---

## WAITING_EXTERNAL

Bloqueadores en terceros que no impiden el avance del core:

| Item | Depende de | Estado |
|---|---|---|
| CFDI 4.0 / PAC (R1-G09) | SAT CSD + Facturapi + Andy | 🔴 WAITING |
| Uber Eats integration | Uber partner API access | 🔴 WAITING |
| Rappi integration | Rappi partner program | 🔴 WAITING |
| Field execution OCS-P2.5.9 | Presencia física en AMALAY | 🟡 READY_TO_EXECUTE |
| 7-day operation gate | Operación real en AMALAY | 🟡 PENDING_FIELD |
| Shadow Day Client #2 | Cliente #2 identificado y disponible | 🔴 PENDING_FOUNDER |

---

## Score de Readiness

El Agent OS calcula el score como: `gates_verdes / gates_totales_no_waiting_external`.

Un gate en WAITING_EXTERNAL no reduce el score del nivel al que pertenece.

**Score mínimo para declarar nivel como READY: 100% de los gates internos.**

---

## Reglas de modificación

1. Ningún gate puede modificarse sin una Founder Decision aprobada (tipo `READINESS_CONTRACT_CHANGE`).
2. Nuevos gates requieren ADR explícito.
3. El Agent OS puede proponer cambios pero no puede ejecutarlos solo.
4. Esta versión es v1.0. Incrementar versión en cada modificación aprobada.
