# Runtime Health Report

**Fotografía oficial del estado del Runtime de Fullsite.**
Actualizar en cada PR que toque capacidades offline, Bridge, auth, sync o printing.

---

## Estado actual

| Campo | Valor |
|---|---|
| Última actualización | 2026-08-04 |
| Último PR | TSK-001 — AF-001 CONFIRMED P2; AF-002, AF-003, AF-004 REFUTED → ORS 94/100 |
| Runtime version | v1.0-rc (Phase 1) |
| ORS | **94 / 100 — PASS** |

---

## Offline Reliability Score (ORS)

> PASS ≥ 80. FAIL si < 80 **o** si cualquier P0 está activo.

| Dimensión | Peso | Score | Notas |
|---|---|---|---|
| Integridad de datos | 40 | 35 | -5: AF-001 CONFIRMADO P2 — crash mid-append puede duplicar evento en escenario extremo (probabilidad muy baja, estado idempotente) |
| Continuidad operativa | 30 | 30 | AF-004 REFUTADO — setInterval(retryRecoverableJobs, 60s) activo en printer.init(). Score restaurado a 30 |
| Velocidad de recuperación | 20 | 19 | -1: Staff Login offline usa SHA-256 (deuda de seguridad separada, no bloquea ORS) |
| Paridad multi-terminal | 10 | 10 | Lock reconciliation corregido (GAP-003) |
| **TOTAL** | **100** | **94** | **PASS** |

*AF-002 y AF-003 REFUTADOS (ver RAF-006, RAF-007 en RESOLVED-AUDIT-FINDINGS.md). AF-001 confirmado P2 no bloquea. AF-004 refutado recupera +2.*

---

## Estado por módulo

| Módulo | Status | Evidencia | Última verificación |
|---|---|---|---|
| Sync Queue (IDB) | ✅ PASS | markSynced implementado y llamado — RAF-001 | 2026-08-03 |
| Bridge WS (LAN sync) | ✅ PASS | last_sequence en SUBSCRIBE — RAF-004 | 2026-08-03 |
| KDS → Bridge | ✅ PASS | useBridgeClient('kds') en /pos/cocina — RAF-002 | 2026-08-03 |
| Print Queue | ✅ PASS | atomic write JSON, 24h TTL — RAF-003 | 2026-08-03 |
| command_id | ✅ PASS | crypto.randomUUID() — GAP-002 cerrado | 2026-08-03 |
| Manager PIN offline (PBKDF2) | ✅ PASS | PBKDF2 activo + `meetsMinRole` enforcement (GAP-A cerrado) — autenticación ✅ · jerarquía roles offline ✅ · fail-closed ✅. 54 tests PASS | 2026-08-04 |
| Staff Login offline (SHA-256) | ⚠️ DEUDA | SHA-256(pin:staffId) en layout.tsx — deuda de seguridad separada, fuera de scope OC-09 | 2026-08-04 |
| Mesa state (Bridge) | ✅ PASS | Lock reconciliation en STATE_SYNC — GAP-003 cerrado | 2026-08-03 |
| Print recovery | ✅ PASS | retryRecoverableJobs: setInterval 60s activo + startup retry — AF-004 REFUTADO (RAF-008) | 2026-08-04 |
| Event log durability | ⚠️ P2 KNOWN | Crash mid-append: líneas truncadas detectadas y saltadas. Ventana post-append pre-saveProcessedCommand puede duplicar evento — AF-001 CONFIRMED P2 LOW RISK | 2026-08-04 |
| Turno persistence | ✅ PASS | Event log replay cubre recuperación — AF-R02 reclasificado | 2026-08-03 |
| OutboxWorker | ✅ BY DESIGN | Phase 1: Supabase es autoridad primaria — AF-R01 | 2026-08-03 |

**Leyenda:** ✅ PASS — ⚠️ DEGRADED / UNVERIFIED — ❌ FAIL — 🔒 Phase 2

---

## Gap Register

| Registro | Abiertos | Cerrados |
|---|---|---|
| Runtime Gap Register | **0** | 3 (GAP-001, 002, 003) |
| Audit Findings (pendientes) | **2** (AF-001 P2, AF-005) | 5 reclasificados (AF-R01, AF-R02 + AF-002→RAF-006, AF-003→RAF-007, AF-004→RAF-008) |
| Resolved Audit Findings | — | 5 (RAF-001..005) |
| Security Issues (GAP-A..D) | **0** | 4 cerrados — GAP-A (role hierarchy offline), GAP-B (btoa default), GAP-C (paridad), GAP-D (SSOT) |

---

## Architecture Governance

| Control | Status | Notas |
|---|---|---|
| INV-05 (write boundary) | ✅ ACTIVE | `scripts/check-inv05.py` — baseline 4 excepciones anotadas, CI gate en `test-dashboard.yml` |
| Runtime API contract | ⚠️ NO ENFORCEMENT | Sin lint rule ni CI check todavía |
| pos-manager-auth.ts | ✅ ACTIVE | PBKDF2 conectado — `provisionManagerCredential` + `verifyPinOffline` vía `pos-data.ts` (commit fc5ffb1) |

---

## Issues adicionales (no son Runtime Gaps)

| Issue | Severidad | Descripción |
|---|---|---|
| ~~OCS-P2.5.9 inconsistente~~ | ~~HIGH~~ | RESUELTO — PBKDF2 conectado en commit fc5ffb1; OC-09 CODE VERIFIED |
| Staff Login offline (SHA-256) | MEDIUM | `layout.tsx` usa SHA-256(pin:staffId) + `pos_staff_cache`. Deuda de seguridad separada, fuera de scope OC-09. Fix como workstream independiente. |
| ~~`verifyPinWithMinRole` — jerarquía no aplicada offline~~ | ~~MEDIUM~~ | RESUELTO — GAP-A cerrado. `meetsMinRole()` exportado de `pos-manager-auth.ts` como SSOT; aplicado en ambas rutas offline (PBKDF2 y btoa). 9 tests integration + 7 tests unit cubren la jerarquía completa. Detectado audit fc5ffb1, corregido en el commit siguiente. |
| GAP-B: `_legacyBtoaFallback` defaulted role ausente a 'gerente' | INFO | Privilege default eliminado — role vacío ahora retorna `''`, rechazado por `meetsMinRole`. Detectado como sub-bug durante GAP-A. Corregido en el mismo commit. |
| GAP-C: Paridad online/offline de `verifyPinWithMinRole` | INFO | Verificada. Online: API retorna role real. Offline PBKDF2: role del credential. Offline btoa: role del cache (sin defaulting). `meetsMinRole` aplica en todas las rutas. |
| GAP-D: SSOT jerarquía de roles | INFO | Antes: `ROLE_HIERARCHY` solo definido en `/api/pos/pin/route.ts` (server-side). Ahora exportado también de `pos-manager-auth.ts`. Sin duplicación — server-side no fue copiado, fue replicado en el módulo de auth cliente con comentario de sincronización. |
| 72 accesos directos a Supabase en POS pages | INFO | La mayoría son reads; writes a Runtime tables cubiertos por INV-05 gate (4 excepciones anotadas) |

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
| 2026-08-04 | Audit fc5ffb1 | Verificación PR | 0 | GAP-A abierto (minRole no aplicado offline); OCS-P2.5.9 → PARTIAL |
| 2026-08-04 | GAP-A fix | Offline role enforcement | 0 | GAP-A/B/C/D cerrados; meetsMinRole SSOT; 2082 tests green |
| 2026-08-04 | TSK-001 AF verification | AF-002/003/004 REFUTED; AF-001 P2 CONFIRMED | +4 Continuidad (AF-004 falso) | RAF-006, RAF-007, RAF-008 creados |
