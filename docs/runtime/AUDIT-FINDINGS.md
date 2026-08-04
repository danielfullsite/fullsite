# Audit Findings

Hipótesis generadas por la auditoría del 2026-07-31 (40 agentes). **Ninguna entrada aquí es un Runtime Gap oficial hasta que Runtime Verification la confirme.**

Referencia: auditoría completa en artifact `3af76294-c0a7-4bd7-b595-dba93490ec06`.

**Flujo:**
```
Audit Finding → Runtime Verification → confirma → Runtime Gap Register
                                    → refuta   → Resolved Audit Findings
                                    → reclasifica → categoría apropiada (Phase 2, Tech Debt, etc.)
```

---

## Pendientes de verificación

### AF-001 — NdjsonEventStore: durabilidad de escritura en crash mid-append
- **Origen:** Auditoría 2026-07-31
- **Status:** **CONFIRMADO — P2 LOW RISK**
- **Verificado por:** RUNTIME_VERIFICATION — TSK-001 — 2026-08-04
- **Evidencia:**
  - `load()` y `readAfter()` tienen try/catch por línea → líneas truncadas son detectadas y saltadas. Corrupción no pasa silenciosa.
  - `markSynced()` usa `writeFileSync(tmp)` + `renameSync()` — atómico, no vulnerable.
  - `append()` usa `fs.appendFileSync(lines.join('\n') + '\n')` — un solo syscall. Para eventos pequeños (restaurant scale), la probabilidad de truncamiento es muy baja.
  - Escenario real de riesgo: crash post-`append` pre-`saveProcessedCommand` (ventana de nanosegundos entre dos async ops). Resultado: evento en disco, idempotency key NO guardada → retry añade evento duplicado. Impacto: state.apply() ejecutado dos veces. Para ORDER_UPSERTED esto es idempotente; para KDS_ITEM_STATUS puede causar doble-toggle.
- **Clasificación:** P2 — no bloquea P0-4. Fix en Phase 2 con SQLite transactions.
- **Acción requerida:** Ninguna antes de Field Batch #2. Documentar como limitación conocida.

### AF-005 — Re-auditoría general post-verificación
- **Origen:** Limitación reconocida de la auditoría 2026-07-31
- **Status:** PENDIENTE
- **Hipótesis:** Gaps en capas no cubiertas: PAE, fingerprint service (7718), update/manager.js, telemetry/heartbeat.js.
- **Acción:** Segunda pasada de verificación sobre estos módulos antes de declarar Runtime v1.0 certificado.

---

## Reclasificados (no son Runtime Gaps)

### AF-R01 — OutboxWorker ausente
- **Hipótesis original:** El Bridge no tiene un OutboxWorker que empuje eventos de `events.ndjson` a Supabase cuando hay conectividad.
- **Reclasificación:** **Phase 2 / Design Only**
- **Evidencia:** Comentario en `electron-app/local-server/index.js:17`: *"Supabase is still primary write authority (Phase 2 will change this)"*. En Phase 1, todos los writes van directo de browser a Supabase. El Bridge event log es para LAN-sync, no para sync upstream. Decisión arquitectural documentada, no un gap.
- **Condición de revisión:** Cuando Phase 2 empiece, AF-R01 debe convertirse en GAP-004.

### AF-R02 — turno-active.json ausente en Bridge
- **Hipótesis original:** El Bridge no persiste el turno activo en un archivo separado; si el proceso muere, el estado de turno se pierde.
- **Reclasificación:** **Resilience Enhancement (P2)**
- **Evidencia:** El Bridge replaya el event log completo al arrancar (`for (const ev of events) state.apply(ev)`), incluyendo eventos TURNO_OPENED/TURNO_CLOSED. El turno se reconstruye correctamente. Un archivo separado sería más rápido pero no cubre un escenario que no esté ya cubierto. La pérdida requeriría corrupción de `events.ndjson`, que también destruiría el estado de todas las órdenes activas — el turno no es el único dato en riesgo.
- **Acción opcional:** Añadir snapshot de turno en Phase 2 junto con snapshots de estado general.
