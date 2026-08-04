# Runtime Health Report

**Fotografía oficial del estado del Runtime de Fullsite.**
Actualizar en cada PR que toque capacidades offline, Bridge, auth, sync o printing.

---

## Estado actual

| Campo | Valor |
|---|---|
| Última actualización | 2026-08-04 |
| Último PR | INV-05 baseline + CI gate — 4 exceptions anotadas, gate activo en test-dashboard.yml |
| Runtime version | v1.0-rc (Phase 1) |
| ORS | **89 / 100 — PASS** |

---

## Offline Reliability Score (ORS)

> PASS ≥ 80. FAIL si < 80 **o** si cualquier P0 está activo.

| Dimensión | Peso | Score | Notas |
|---|---|---|---|
| Integridad de datos | 40 | 35 | -5: durabilidad NdjsonEventStore en crash mid-append (AF-001, sin verificar) |
| Continuidad operativa | 30 | 28 | -2: retryRecoverableJobs no tiene caller automático (AF-004, sin verificar) |
| Velocidad de recuperación | 20 | 19 | -1: Staff Login offline usa SHA-256 (deuda de seguridad separada, no bloquea ORS) |
| Paridad multi-terminal | 10 | 10 | Lock reconciliation corregido (GAP-003) |
| **TOTAL** | **100** | **90** | **PASS** |

*Score conservador: gaps sin verificar se descuentan parcialmente hasta confirmar.*

---

## Estado por módulo

| Módulo | Status | Evidencia | Última verificación |
|---|---|---|---|
| Sync Queue (IDB) | ✅ PASS | markSynced implementado y llamado — RAF-001 | 2026-08-03 |
| Bridge WS (LAN sync) | ✅ PASS | last_sequence en SUBSCRIBE — RAF-004 | 2026-08-03 |
| KDS → Bridge | ✅ PASS | useBridgeClient('kds') en /pos/cocina — RAF-002 | 2026-08-03 |
| Print Queue | ✅ PASS | atomic write JSON, 24h TTL — RAF-003 | 2026-08-03 |
| command_id | ✅ PASS | crypto.randomUUID() — GAP-002 cerrado | 2026-08-03 |
| Manager PIN offline (PBKDF2) | ✅ PASS | PBKDF2 activo — provisionManagerCredential + verifyPinOffline. btoa fallback DEPRECATED con telemetría | 2026-08-04 |
| Staff Login offline (SHA-256) | ⚠️ DEUDA | SHA-256(pin:staffId) en layout.tsx — deuda de seguridad separada, fuera de scope OC-09 | 2026-08-04 |
| Mesa state (Bridge) | ✅ PASS | Lock reconciliation en STATE_SYNC — GAP-003 cerrado | 2026-08-03 |
| Print recovery | ⚠️ UNVERIFIED | retryRecoverableJobs: ¿tiene caller automático? (AF-004) | pendiente |
| Event log durability | ⚠️ UNVERIFIED | Crash mid-append en NdjsonEventStore (AF-001) | pendiente |
| Turno persistence | ✅ PASS | Event log replay cubre recuperación — AF-R02 reclasificado | 2026-08-03 |
| OutboxWorker | ✅ BY DESIGN | Phase 1: Supabase es autoridad primaria — AF-R01 | 2026-08-03 |

**Leyenda:** ✅ PASS — ⚠️ DEGRADED / UNVERIFIED — ❌ FAIL — 🔒 Phase 2

---

## Gap Register

| Registro | Abiertos | Cerrados |
|---|---|---|
| Runtime Gap Register | **0** | 3 (GAP-001, 002, 003) |
| Audit Findings (pendientes) | **5** (AF-001..005) | 2 reclasificados (AF-R01, AF-R02) |
| Resolved Audit Findings | — | 5 (RAF-001..005) |

---

## Architecture Governance

| Control | Status | Notas |
|---|---|---|
| INV-05 (write boundary) | ✅ ACTIVE | `scripts/check-inv05.py` — baseline 4 excepciones anotadas, CI gate en `test-dashboard.yml` |
| Runtime API contract | ⚠️ NO ENFORCEMENT | Sin lint rule ni CI check todavía |
| pos-manager-auth.ts | ⚠️ ARCHIVED/LEGACY | PBKDF2 no activo — decisión pendiente de Daniel |

---

## Issues adicionales (no son Runtime Gaps)

| Issue | Severidad | Descripción |
|---|---|---|
| OCS-P2.5.9 inconsistente | HIGH | Certifica "PBKDF2 PASS" para módulo nunca conectado |
| 3 implementaciones de hashPin | MEDIUM | pos-manager-auth, pos/layout.tsx, api/pos/staff-cache — confusión de responsabilidad |
| 72 accesos directos a Supabase en POS pages | INFO | La mayoría son reads; el subconjunto de writes a Runtime tables se cuantificará cuando corra INV-05 design |

---

## Cómo actualizar este reporte

En cada PR que modifique capacidades offline, auth, sync, printing, o Bridge:

```
¿Qué capacidad cambia?      → actualizar tabla "Estado por módulo"
¿Qué evidencia nueva?       → actualizar notas del módulo afectado
¿Cambia ORS?                → recalcular score, actualizar tabla ORS
¿Se abrió algún Runtime Gap? → crear entrada en RUNTIME-GAP-REGISTER.md
¿Se cerró algún Runtime Gap? → mover a CLOSED en RUNTIME-GAP-REGISTER.md
¿Falso positivo de auditoría? → mover de AUDIT-FINDINGS a RESOLVED-AUDIT-FINDINGS
```

---

## Historial de PRs con impacto en Runtime

| Fecha | PR / Commit | Capacidad | Delta ORS | Gaps |
|---|---|---|---|---|
| 2026-08-03 | GAP-001: PIN cache TTL | Auth offline | +1 Continuidad | GAP-001 closed |
| 2026-08-03 | GAP-002: command_id UUID v4 | Sync idempotencia | +1 Integridad | GAP-002 closed |
| 2026-08-03 | GAP-003: STATE_SYNC locks | Mesa state LAN | +2 Paridad | GAP-003 closed |
| 2026-08-04 | OCS-P2.5.9 invalidada | Certificación | 0 (corrección) | PBKDF2 PASS → PARTIAL/DEGRADED |
| 2026-08-04 | INV-05 baseline + CI gate | Architecture governance | 0 (prevención) | 4 excepciones anotadas, gate activo |
| 2026-08-04 | Offline Auth PBKDF2 | Manager PIN auth | +1 VelocidadRecuperación | PBKDF2 activo, KEY COLLISION fix, 31 tests |
