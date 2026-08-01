# DOCS MIGRATION MANIFEST

**Estado:** EN PROGRESO — Ventana 1 y 2 completadas; Ventana 3 parcialmente desbloqueada (1/3 deps ✅)  
**Propósito:** Registrar la decisión de destino de cada documento antes de ejecutar la migración.  
**Fecha de auditoría:** 2026-07-27  
**Última actualización:** 2026-07-27  
**Autorización requerida antes de ejecutar:** Daniel Ramonfaur

> **INSTRUCCIÓN DE USO:** Este documento NO ejecuta ningún movimiento. Es la fuente de verdad
> para la ventana controlada de reorganización. Ningún archivo se mueve, elimina ni renombra
> hasta que exista una autorización explícita por sección.

---

## Estado de ventanas de migración

| Ventana | Contenido | Estado | Commit | Prerequisito |
|---------|-----------|--------|--------|--------------|
| Ventana 1 | 19 bibles → archive, wansoft → AMALAY, dashboard-app/docs histórico, stubs, ROADMAP banner | ✅ COMPLETADA | `96be218` (merge `20b3bde`) | — |
| Ventana 2 | Constitution/ raíz, Security, SQL_MIGRATION runbook, duplicados reference/ eliminados | ✅ COMPLETADA | `394f60c` (merge) | Ventana 1 ✅ |
| Ventana 3 | `docs/constitution/`, `docs/state/`, `docs/migrations/`, `docs/architecture/`, `docs/runbooks/` | 🔴 BLOQUEADA | — | MT-03 + OFFLINE-100 + CFG-01 Production Acceptance mergeados a main |
| Ventana 4 | Eliminación de stubs wansoft/, stubs pendientes | 🔴 BLOQUEADA | — | Ventana 3 ✅ |

### Condiciones de desbloqueo para Ventana 3

- [x] Workstream **MT-03** (orphan references) — CERRADO en main `4fed28e` / `b86a5d3` (2026-07-27)
- [ ] Workstream **OFFLINE-100** (offline certification) — pendiente
- [ ] Workstream **CFG-01** (Production Acceptance) — pendiente

### Conflicto A — Legacy P0s — Resuelto 2026-07-27

| P0 Legacy | Estado final | Decisión Daniel |
|-----------|--------------|-----------------|
| Huella digital (DP4500) | CLOSED (código) / NEEDS HARDWARE VERIFICATION | No bloqueante para siguiente cliente si existe flujo sin biometría |
| Cajón RJ-11 | CLOSED (código) / NEEDS HARDWARE VERIFICATION | Probar físicamente antes de siguiente go-live |
| Shadow Day | STILL OPEN — gate operacional | No cerrar hasta ejecutar turno completo |
| IEPS fiscal | DEFERRED — bloqueado por XML CFDI Wansoft | No implementar hasta contar con XML real |

### Conflicto B — POS-04 vs P0-4 — Resuelto 2026-07-27

Documentado en `docs/state/CERTIFICATIONS.md` y `docs/state/BUGS.md`:
- **POS-04**: sub-componente CLOSED (commit `447a777`) — boot offline del app shell
- **P0-4**: certificación amplia OPEN — requiere OFFLINE-100 CERTIFIED

### Conflicto C — Sistemas de tracking de bugs — Resuelto 2026-07-27

Modelo adoptado: auditoría detecta → BUGS.md controla el ciclo de vida.
- `docs/state/BUGS.md`: registro canónico, bug_id, estado, owner
- `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md`: evidencia de auditoría; cuando un hallazgo se confirma recibe bug_id y entrada en BUGS.md

---

## Índice

1. [Workstreams activos — rutas congeladas](#1-workstreams-activos--rutas-congeladas)
2. [Archivos nuevos descubiertos post-auditoría](#2-archivos-nuevos-descubiertos-post-auditoría)
3. [Conflictos que requieren decisión humana](#3-conflictos-que-requieren-decisión-humana)
4. [Inventario de bugs sin documentar](#4-inventario-de-bugs-sin-documentar)
5. [Mapa de inbound links](#5-mapa-de-inbound-links)
6. [Manifest completo — una fila por archivo](#6-manifest-completo--una-fila-por-archivo)
7. [Plan de transición y rollback](#7-plan-de-transición-y-rollback)
8. [Diff propuesto — sin ejecutar](#8-diff-propuesto--sin-ejecutar)

---

## 1. Workstreams activos — rutas congeladas

Las siguientes rutas están siendo modificadas por workstreams activos. **No mover hasta
ventana controlada.**

| Ruta | Workstream activo | Commits recientes | Estado freeze | Condición de descongelamiento |
|------|-------------------|-------------------|---------------|-------------------------------|
| `docs/migrations/` | Migration Engine (mt-03) | `4fed28e`, `b86a5d3` (2026-07-27) | 🟡 FROZEN-PENDING-V3 | MT-03 ✅ mergeado. Descongelado cuando OFFLINE-100 + CFG-01 también en main |
| `docs/state/` | Multiple (mt-03, offline, CFG) | `ad13889` modifica state/ indirectamente | 🔴 FROZEN-FOR-MOVE | Todos los workstreams activos mergeados |
| `docs/architecture/` | Offline (OFFLINE-MASTER, PER series) | `a8385f5`, `f5147d9` | 🔴 FROZEN-FOR-MOVE | Offline hardening completado |
| `docs/architecture/adr/` | Architecture (ADR-CONCURRENCY, otros) | En uso por migration docs | 🔴 FROZEN-FOR-MOVE | Con docs/architecture/ |
| `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md` | Offline audit (PAY, ORD, KDS, CFG, PER series) | `4ed3c16`, `9783d58` | 🔴 FROZEN-FOR-MOVE | Audit matrix finalizado |
| `docs/runbooks/CERTIFICATION-SESSION-2026-07-27.md` | Offline certification | Creado 2026-07-27 | 🔴 FROZEN-FOR-MOVE | Sesión de certificación completada |

> **Nota sobre docs/testing/:** La ruta `docs/testing/` no existe como directorio independiente.
> Los archivos de testing viven en `docs/state/` (OFFLINE-CHAOS-TESTS.md, OFFLINE-TEST-MATRIX.md)
> y en `docs/architecture/` (OFFLINE-MASTER.md). Ambas rutas están congeladas.

---

## 2. Archivos nuevos descubiertos post-auditoría

Archivos que aparecieron en `docs/state/` y `docs/architecture/` entre la auditoría inicial
y este manifest. Confirman que estas rutas están activamente evolucionando.

| Archivo | Ubicación | Workstream probable | Acción en manifest |
|---------|-----------|---------------------|--------------------|
| `CFG-01-restaurante-norte-demo.md` | `docs/state/` | CFG-01 | FROZEN, clasificar después |
| `OFFLINE-CHAOS-TESTS.md` | `docs/state/` | Offline testing | FROZEN |
| `OFFLINE-TEST-MATRIX.md` | `docs/state/` | Offline testing | FROZEN |
| `OFFLINE-MASTER.md` | `docs/architecture/` | Offline architecture | FROZEN |
| `ROOT-CAUSE-001-recipe-identifier-mismatch.md` | `docs/architecture/` | Recipe/inventory | FROZEN |

---

## 3. Conflictos que requieren decisión humana

### Conflicto A — ROADMAP.md (raíz) vs docs/state/CERTIFICATIONS.md

**Naturaleza:** El `ROADMAP.md` (raíz, 2026-06-30) lista P0s que no corresponden con los
P0s de `CERTIFICATIONS.md` (2026-07-24). No es posible determinar qué P0s del ROADMAP fueron
resueltos, descartados o renombrados sin confirmación del owner.

| P0 en ROADMAP.md (2026-06-30) | Estado en ROADMAP | Equivalente en CERTIFICATIONS.md | Evidencia en commits | Recomendación | Decisión requerida |
|-------------------------------|-------------------|----------------------------------|----------------------|---------------|--------------------|
| Concurrencia: updated_at en handlePayment | ✅ done 2026-06-30 | — (no aparece) | `docs/constitution/CONCURRENCY.md` confirma implementación | Considerar CLOSED | ¿Confirmar como cerrado? |
| Concurrencia: fix 409 en sync offline | ✅ done 2026-06-30 | — (no aparece) | ADR-CONCURRENCY.md existe | Considerar CLOSED | ¿Confirmar como cerrado? |
| Concurrencia: separar KDS writes | ✅ done 2026-06-30 | — (no aparece) | Idem | Considerar CLOSED | ¿Confirmar como cerrado? |
| INV-1: Deduccion idempotente | ✅ done 2026-06-30 | — (no aparece) | Sin commit explícito encontrado | UNKNOWN | ¿Se cerró con qué commit? |
| IEPS modelo fiscal | OPEN (bloqueado: XML Wansoft) | — (no aparece en CERTIFICATIONS) | `54eb11e` ADR fiscal; `6f37280` CFDI partial | UNKNOWN | ¿Sigue abierto o fue descartado? |
| Facturama produccion | OPEN (bloqueado: pago $1,650) | P0-3 CSD Facturama (deadline 2026-08-03) | Sin commit de cierre | LIKELY SAME P0, renombrado | ¿Confirmar equivalencia? |
| XML CFDI validado contra Wansoft | OPEN | — (no aparece) | `6f37280` parcial | UNKNOWN | ¿Subsumido en P0-3 o independiente? |
| Huella digital (DP4500) | OPEN | — (no aparece) | Sin commits | OPEN o DEFERRED | ¿Sigue en scope o descartado? |
| Cajon (fix EC TICKET o mover RJ-11) | OPEN | — (no aparece) | Sin commits | OPEN o DEFERRED | ¿Sigue en scope o descartado? |
| Shadow Day | OPEN | — (no aparece) | `1d694b7` lo menciona en checklist | OPEN o DEFERRED | ¿Sigue siendo requisito de go-live? |

**Impacto documental:** Hasta resolver este conflicto, `ROADMAP.md` no puede ser marcado
como obsoleto — podría contener P0s activos que no aparecen en CERTIFICATIONS.md.

**Acción bloqueada:** Clasificación de `ROADMAP.md` como OBSOLETE o HISTORICAL.

---

### Conflicto B — POS-04 en BUGS.md vs P0-4 en CERTIFICATIONS.md

**Estado:** NEEDS_OWNER_CONFIRMATION

| Dimensión | POS-04 (docs/state/BUGS.md) | P0-4 (docs/state/CERTIFICATIONS.md) |
|-----------|----------------------------|--------------------------------------|
| Descripción documentada | "Electron cargaba desde URL de Vercel; sin internet al arrancar, la app no cargaba" | "Local-First / Boot Offline — RFC aprobado 2026-07-24, pendiente implementación" |
| Estado | **CLOSED** — commit `447a777` (2026-07-24) | **ABIERTO** |
| Commit asociado | `447a777`: "wire IDB menu cache + localStorage staff cache for offline boot" | RFC: `docs/bibles/P0-4-LOCAL-FIRST-RFC.md` |
| Scope probable | SW/IDB boot gap específico (menú + staff cacheados) | Arquitectura local-first completa (turno, queue, sync, LAN) |
| Implementación posterior | Commits `cba779a`, `9cd2d78`, `7e17828`, `a3a47f4`, `a3a47f4` implementan el scope ampliado | Handoff 2026-07-27 reporta turno offline IMPLEMENTADO |

**Hipótesis (no confirmada):** POS-04 = fix puntual del boot. P0-4 = RFC de arquitectura más
amplia que incluye POS-04 como subítem. El estado de P0-4 en CERTIFICATIONS puede estar
desactualizado dado el volumen de implementación ocurrida 2026-07-24 a 2026-07-27.

**Acción bloqueada:** No actualizar ni BUGS.md ni CERTIFICATIONS.md sin confirmación de Daniel.

---

### Conflicto C — Dos sistemas de tracking de bugs

**Problema descubierto post-auditoría:** Existen dos sistemas de tracking paralelos:

| Sistema | Archivo | IDs de bug | Scope |
|---------|---------|------------|-------|
| Bug tracker de producto | `docs/state/BUGS.md` | POS-XX, DASH-XX | Bugs del producto general |
| Audit matrix offline | `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md` | PAY-XX, ORD-XX, KDS-XX, CFG-XX, PER-XX | Gaps del sistema offline |

No está claro si estos sistemas deben converger o mantenerse separados.

**Pregunta para Daniel:** ¿El audit matrix offline (PAY/ORD/KDS series) debe integrarse en
`docs/state/BUGS.md` o son dos sistemas con ciclos de vida distintos?

---

## 4. Inventario de bugs sin documentar

Bugs registrados en `docs/state/BUGS.md` con estado "Pendiente de documentar". Se presenta
toda la evidencia disponible del historial de commits. No se infiere contenido que no tenga
evidencia directa.

### Metodología

Para cada bug se buscó:
1. Commits con el ID del bug en el mensaje
2. Commits con el ID del bug en el cuerpo
3. Commits cercanos en la secuencia numérica que dan contexto
4. Referencias en cualquier .md del repo

**Resultado de la búsqueda:** Ninguno de los 13 bugs "Pendiente de documentar" tiene commits
que los referencien por ID. Los IDs con commits existentes son:
`POS-02, POS-03, POS-04, POS-05, POS-13, POS-18, POS-19, POS-22` y
`DASH-01 a DASH-05, DASH-07, DASH-08, DASH-10, DASH-11, DASH-14, DASH-15, DASH-17, DASH-19, DASH-22`.

---

| Bug ID | Prioridad | Estado en BUGS.md | Commits con este ID | Archivos probables | Evidencia disponible | Descripción confirmada | Pregunta para Daniel |
|--------|-----------|-------------------|--------------------|--------------------|---------------------|----------------------|---------------------|
| POS-07 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna en git log | UNKNOWN | ¿Qué es POS-07? ¿En qué módulo? |
| POS-09 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es POS-09? |
| POS-11 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es POS-11? |
| DASH-09 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-09? |
| DASH-12 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-12? |
| DASH-13 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-13? |
| DASH-20 | P1 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-20? |
| POS-14 | P2 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es POS-14? |
| POS-15 | P2 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es POS-15? |
| POS-17 | P2 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es POS-17? |
| DASH-16 | P2 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-16? |
| DASH-21 | P2 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-21? |
| DASH-18 | P3 | ABIERTO | Ninguno | UNKNOWN | Ninguna | UNKNOWN | ¿Qué es DASH-18? |

**Criterio para completar estas fichas:** Descripción de síntoma, condición de reproducción,
archivo/función afectado, y criterio de aceptación para cierre. No rellenar sin evidencia directa.

---

## 5. Mapa de inbound links

Qué documentos referencian a cada archivo objetivo de migración. Crítico para no crear
links rotos al mover.

### LOCAL_FIRST_ARCHITECTURE.md (dos copias idénticas)

Rutas actuales:
- `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md`
- `docs/reference/LOCAL_FIRST_ARCHITECTURE.md`

Documentos que lo referencian:

| Documento que referencia | Ruta citada | Requiere actualización |
|--------------------------|-------------|------------------------|
| `FULLSITE DOCS/00-README/README.md` | `../03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md` | Solo si se renombra ruta |
| `FULLSITE DOCS/18-HANDOFFS/2026-07-27-OFFLINE-LOCAL-FIRST-MASTER-HANDOFF.md` | Referencia relativa | Solo si se mueve |
| `FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` | `docs/reference/LOCAL_FIRST_ARCHITECTURE.md` | Sí — apunta a docs/reference/ |
| `FULLSITE DOCS/FULLSITE OFFLINE/22-MULTI-RESTAURANT-OFFLINE-DEPLOYMENT.md` | `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md` | Solo si se mueve |

**Ruta canónica propuesta:** `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md`  
**Copia a eliminar (post-verificación):** `docs/reference/LOCAL_FIRST_ARCHITECTURE.md`

---

### BRIDGE.md (dos copias idénticas)

Rutas actuales:
- `FULLSITE DOCS/09-ELECTRON/BRIDGE.md`
- `docs/reference/BRIDGE.md`

Documentos que lo referencian:

| Documento que referencia | Ruta citada | Requiere actualización |
|--------------------------|-------------|------------------------|
| `docs/bibles/FULLSITE-ENGINEERING-BIBLE.md` | `docs/reference/BRIDGE.md` | Sí |
| `docs/bibles/FULLSITE-GAP-TRACKER.md` | `docs/reference/BRIDGE.md` | Sí |
| `docs/bibles/FULLSITE-MASTER-BIBLE.md` | `docs/reference/BRIDGE.md` | Sí |
| `docs/bibles/QA-REPORT.md` | `docs/reference/BRIDGE.md` | Sí |
| `docs/postmortems/TEMPLATE.md` | `docs/reference/BRIDGE.md` | Sí |
| `MASTER-INDEX.md` | `docs/reference/BRIDGE.md` | Sí |

**Ruta canónica propuesta:** `FULLSITE DOCS/06-PRINTING/BRIDGE.md` (no es específico de Electron)  
**Copia a eliminar (post-verificación):** `docs/reference/BRIDGE.md`  
**Nota:** 6 consumidores apuntan a la copia en `docs/reference/`. Todos deben actualizarse
antes de eliminar.

---

### EVENT-STORE.md (dos copias idénticas)

Rutas actuales:
- `FULLSITE DOCS/09-ELECTRON/EVENT-STORE.md`
- `docs/reference/EVENT-STORE.md`

Documentos que lo referencian:

| Documento que referencia | Ruta citada | Requiere actualización |
|--------------------------|-------------|------------------------|
| `docs/bibles/FULLSITE-ENGINEERING-BIBLE.md` | `docs/reference/EVENT-STORE.md` | Sí |
| `docs/bibles/FULLSITE-GAP-TRACKER.md` | `docs/reference/EVENT-STORE.md` | Sí |
| `docs/bibles/FULLSITE-MASTER-BIBLE.md` | `docs/reference/EVENT-STORE.md` | Sí |
| `docs/bibles/QA-REPORT.md` | `docs/reference/EVENT-STORE.md` | Sí |
| `docs/postmortems/TEMPLATE.md` | `docs/reference/EVENT-STORE.md` | Sí |
| `MASTER-INDEX.md` | `docs/reference/EVENT-STORE.md` | Sí |

**Ruta canónica propuesta:** `FULLSITE DOCS/08-SYNC/EVENT-STORE.md`  
**Copia a eliminar (post-verificación):** `docs/reference/EVENT-STORE.md`

---

### OFFLINE-CERTIFICATION-RUNBOOK.md (dos copias idénticas)

Rutas actuales:
- `FULLSITE DOCS/12-RUNBOOKS/OFFLINE-CERTIFICATION-RUNBOOK.md`
- `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md`

Documentos que lo referencian:

| Documento que referencia | Ruta citada | Requiere actualización |
|--------------------------|-------------|------------------------|
| `docs/INDEX.md` | `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md` | Sí |
| `docs/runbooks/CERTIFICATION-SESSION-2026-07-27.md` | `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md` | Sí |
| `FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` | `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md` | Sí |
| `FULLSITE DOCS/FULLSITE OFFLINE/22-MULTI-RESTAURANT-OFFLINE-DEPLOYMENT.md` | Referencia interna | Verificar |

**Ruta canónica propuesta:** `FULLSITE DOCS/12-RUNBOOKS/OFFLINE-CERTIFICATION-RUNBOOK.md`  
**Copia a eliminar (post-verificación):** `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md`

---

### PERSISTENCE-LAYER.md (mismo nombre, documentos distintos)

| Archivo | Ruta | Contenido real | Consumidores |
|---------|------|----------------|--------------|
| Operacional | `docs/architecture/PERSISTENCE-LAYER.md` | Cola IDB sync_queue, ciclo de vida, transportes | `dashboard-app/AGENTS.md`, `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md` |
| Investigación PER-02 | `docs/reference/PERSISTENCE-LAYER.md` | Decisión de no crear event-store.ts, análisis de los 3 sistemas | Solo referenciado desde `LOCAL-FIRST-CODE-AUDIT.md` |

**Acción propuesta:** Renombrar antes de mover para eliminar la ambigüedad.  
**Nombres propuestos:** `SYNC-QUEUE-ARCHITECTURE.md` y `PER-02-RESEARCH.md`  
**Requiere aprobación:** Sí — implica cambiar nombre de documentos normativos.

---

### Documentos con referencias a docs/state/ docs/constitution/ docs/runbooks/ (rutas congeladas)

31 archivos referencian estas rutas. En orden de criticidad para actualizar
cuando ocurra la migración:

| Consumidor de alto impacto | Cuántas rutas activas referencia |
|----------------------------|----------------------------------|
| `docs/bibles/P0-EXECUTION-PLAN.md` | docs/state/ (BUGS, CERTIFICATIONS), docs/bibles/ |
| `docs/state/BUGS.md` | docs/state/CERTIFICATIONS.md, docs/bibles/ |
| `docs/state/CERTIFICATIONS.md` | docs/bibles/P0-EXECUTION-PLAN.md, docs/state/BUGS.md |
| `docs/state/INITIATIVES.md` | docs/constitution/CLONABILITY.md |
| `docs/constitution/CLONABILITY.md` | docs/state/INITIATIVES.md |
| `dashboard-app/AGENTS.md` | docs/state/, docs/reference/, docs/architecture/ |
| `docs/migrations/00-current-state-audit.md` | docs/state/, docs/migrations/ otros |
| `dashboard-app/src/lib/settings.ts` | `docs/state/` (referencia en comentario inline) |

---

## 6. Manifest completo — una fila por archivo

### Clave de clasificaciones

- **NORMATIVE** — fuente oficial de verdad, se mantiene al día
- **REFERENCE** — documentación de consulta, no necesariamente al día
- **HISTORICAL** — registro de decisiones o eventos pasados, no se modifica
- **OBSOLETE** — información superada, candidato a archivo
- **UNKNOWN** — requiere revisión humana para clasificar

### Clave de acciones

- **KEEP** — permanece donde está, sin cambio
- **MOVE** — mover a nueva ruta (requiere actualizar todos los inbound links)
- **COPY** — copiar y mantener ambas temporalmente (fase de transición)
- **RENAME** — cambiar nombre en la misma ubicación
- **ARCHIVE** — mover a `19-ARCHIVE/`
- **DELETE_AFTER_VERIFICATION** — eliminar solo después de confirmar cero consumidores
- **FROZEN** — no tocar hasta que el workstream activo cierre

---

### Raíz del repositorio

| current_path | proposed_path | clasificación | acción | razón | inbound links | owner | riesgo | conflicto | ¿Aprobación Daniel? |
|---|---|---|---|---|---|---|---|---|---|
| `FULLSITE-PRINCIPLES.md` | `FULLSITE DOCS/01-CONSTITUTION/FULLSITE-PRINCIPLES.md` | NORMATIVE | MOVE | Constitución del producto — debe vivir en la sección normativa | MASTER-INDEX.md, docs/COMPANY_BRAIN.md | Daniel | BAJO — pocos consumidores directos | Ninguno | Sí |
| `ENGINEERING-AXIOMS.md` | `FULLSITE DOCS/01-CONSTITUTION/ENGINEERING-AXIOMS.md` | NORMATIVE | MOVE | Axiomas de ingeniería — pertenecen a constitución | `docs/bibles/FULLSITE-ENGINEERING-BIBLE.md` | Daniel | BAJO | Ninguno | Sí |
| `MASTER-INDEX.md` | `FULLSITE DOCS/19-ARCHIVE/MASTER-INDEX-2026-07-02.md` | OBSOLETE | ARCHIVE | Índice de negocio desactualizado (2026-07-02). Reemplazado por nuevo README.md provisional | CLAUDE.md lo menciona, varios bibles | Daniel | MEDIO — es el punto de entrada actual para muchos | Conflicto C (dos índices) | Sí |
| `ROADMAP.md` | `FULLSITE DOCS/19-ARCHIVE/ROADMAP-2026-06-30.md` | OBSOLETE | ARCHIVE | P0s del 30 jun no corresponden con CERTIFICATIONS.md actual | Algunos bibles | Daniel | ALTO — puede contener P0s activos no resueltos | Conflicto A activo | **SÍ — bloquea hasta resolver Conflicto A** |
| `AGENTS.md` | `FULLSITE DOCS/22-GUIDES/AGENTS.md` | REFERENCE | MOVE | Config de Claude para el repo. No es ingeniería pero es referencia útil | Claude internamente | Daniel | BAJO | Ninguno | No |
| `CLAUDE.md` | KEEP en raíz | REFERENCE | KEEP | Requerido en raíz por Claude Code para funcionar. Contiene conocimiento tribal → candidato a que su sección de tablas migre a DATA_MODEL.md | Claude Code (requrido) | Daniel | ALTO si se mueve — Claude Code lo busca en raíz | Ninguno | No mover |
| `SECURITY.md` | `FULLSITE DOCS/14-SECURITY/SECURITY.md` | REFERENCE | MOVE | Política de seguridad — pertenece en sección de seguridad | Ninguno conocido | Daniel | BAJO | Ninguno | No |
| `FULLSITE-PRINCIPLES.md` | Ver arriba | — | — | — | — | — | — | — | — |

---

### FULLSITE DOCS/ — archivos actuales

| current_path | proposed_path | clasificación | acción | razón | inbound links | owner | riesgo | conflicto | ¿Aprobación Daniel? |
|---|---|---|---|---|---|---|---|---|---|
| `FULLSITE DOCS/00-README/README.md` | KEEP, actualizar a provisional | REFERENCE | KEEP + UPDATE | Convertir en índice maestro provisional (ver doc separado) | — | Docs Architect | BAJO | Ninguno | No |
| `FULLSITE DOCS/00-README/DOCS-MIGRATION-MANIFEST.md` | KEEP | NORMATIVE | KEEP | Este documento | — | Docs Architect | — | — | — |
| `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md` | KEEP | NORMATIVE | KEEP | Fuente canónica — 15 secciones, doc de clase mundial | README.md, handoff, FULLSITE OFFLINE docs | Docs Architect | BAJO | Ninguno | No |
| `FULLSITE DOCS/09-ELECTRON/BRIDGE.md` | `FULLSITE DOCS/06-PRINTING/BRIDGE.md` | NORMATIVE | MOVE | BRIDGE.md no es específico de Electron; es el bridge del sistema de impresión | 6 consumidores en docs/bibles/ y MASTER-INDEX | Docs Architect | MEDIO — requiere actualizar 6 refs | Ninguno | No |
| `FULLSITE DOCS/09-ELECTRON/EVENT-STORE.md` | `FULLSITE DOCS/08-SYNC/EVENT-STORE.md` | NORMATIVE | MOVE | EVENT-STORE.md no es específico de Electron; es arquitectura de sync | 6 consumidores en docs/bibles/ y MASTER-INDEX | Docs Architect | MEDIO | Ninguno | No |
| `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md` | FROZEN → `FULLSITE DOCS/11-STATE/` después | NORMATIVE | FROZEN | Workstream offline activo. Audit matrix PAY/ORD/KDS series en uso | LOCAL-FIRST-CODE-AUDIT referencia PERSISTENCE-LAYER.md | Offline workstream | ALTO — activamente modificado | Conflicto C (dos sistemas de bugs) | **SÍ — después de resolver Conflicto C** |
| `FULLSITE DOCS/12-RUNBOOKS/OFFLINE-CERTIFICATION-RUNBOOK.md` | KEEP | NORMATIVE | KEEP | Fuente canónica del runbook | docs/INDEX.md, CERTIFICATION-SESSION, benchmark docs | Docs Architect | BAJO | Ninguno | No |
| `FULLSITE DOCS/18-HANDOFFS/2026-07-27-OFFLINE-LOCAL-FIRST-MASTER-HANDOFF.md` | KEEP | HISTORICAL | KEEP | Handoff de sesión — registro histórico válido | — | Daniel | BAJO | Ninguno | No |
| `FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` | `FULLSITE DOCS/15-AMALAY/WANSOFT-OFFLINE-BENCHMARK.md` | REFERENCE | MOVE | No sigue el esquema numerado de FULLSITE DOCS; es referencia competitiva sobre Wansoft | — | Docs Architect | BAJO | Ninguno | No |
| `FULLSITE DOCS/FULLSITE OFFLINE/22-MULTI-RESTAURANT-OFFLINE-DEPLOYMENT.md` | `FULLSITE DOCS/03-LOCAL-FIRST/MULTI-RESTAURANT-DEPLOYMENT.md` | NORMATIVE | MOVE | Doc normativo de despliegue multi-restaurante — pertenece en Local-First | — | Docs Architect | BAJO | Ninguno | No |

---

### docs/constitution/ — FROZEN-FOR-MOVE

| current_path | proposed_path | clasificación | acción | razón | riesgo | conflicto |
|---|---|---|---|---|---|---|
| `docs/constitution/CONCURRENCY.md` | `FULLSITE DOCS/01-CONSTITUTION/CONCURRENCY.md` | NORMATIVE | FROZEN → MOVE | Permanente, gate de RPCs | ALTO — referenciado por docs/state/ y migrations/ | Ninguno |
| `docs/constitution/CLONABILITY.md` | `FULLSITE DOCS/01-CONSTITUTION/CLONABILITY.md` | NORMATIVE | FROZEN → MOVE | Gate de PRs | ALTO — referenciado por docs/state/INITIATIVES.md | Ninguno |
| `[DATA_MODEL.md]` | `FULLSITE DOCS/01-CONSTITUTION/DATA_MODEL.md` | — | CREATE_PLACEHOLDER | No existe — ver Ficha de Backlog D1 | — | — |
| `[NAMING.md]` | `FULLSITE DOCS/01-CONSTITUTION/NAMING.md` | — | CREATE_PLACEHOLDER | No existe — ver Ficha D2 | — | — |
| `[TENANT_ISOLATION.md]` | `FULLSITE DOCS/01-CONSTITUTION/TENANT_ISOLATION.md` | — | CREATE_PLACEHOLDER | No existe — ver Ficha D3 | — | — |
| `[SYSTEM_ARCHITECTURE.md]` | `FULLSITE DOCS/01-CONSTITUTION/SYSTEM_ARCHITECTURE.md` | — | CREATE_PLACEHOLDER | No existe — ver Ficha D4 | — | — |

---

### docs/state/ — FROZEN-FOR-MOVE

| current_path | proposed_path | clasificación | acción | razón | riesgo | conflicto |
|---|---|---|---|---|---|---|
| `docs/state/BUGS.md` | `FULLSITE DOCS/11-STATE/BUGS.md` | NORMATIVE | FROZEN → MOVE | Fuente de verdad de bugs; 13+ bugs sin documentar | ALTO — activamente modificado, cross-ref con CERTIFICATIONS | Conflicto B, C |
| `docs/state/CERTIFICATIONS.md` | `FULLSITE DOCS/11-STATE/CERTIFICATIONS.md` | NORMATIVE | FROZEN → MOVE | Fuente de verdad de certificaciones | ALTO — P0-4 puede estar desactualizado | Conflicto B |
| `docs/state/FREEZES.md` | `FULLSITE DOCS/11-STATE/FREEZES.md` | NORMATIVE | FROZEN → MOVE | Fuente de verdad de congelamientos | MEDIO | Ninguno |
| `docs/state/INITIATIVES.md` | `FULLSITE DOCS/11-STATE/INITIATIVES.md` | NORMATIVE | FROZEN → MOVE | FSOS backlog | MEDIO | Ninguno |
| `docs/state/CFG-01-restaurante-norte-demo.md` | `FULLSITE DOCS/15-AMALAY/CFG-01-restaurante-norte-demo.md` | REFERENCE | FROZEN → MOVE | Config específica de demo/cliente | BAJO | Ninguno |
| `docs/state/OFFLINE-CHAOS-TESTS.md` | `FULLSITE DOCS/11-STATE/OFFLINE-CHAOS-TESTS.md` | NORMATIVE | FROZEN | Testing activo | ALTO | Ninguno |
| `docs/state/OFFLINE-TEST-MATRIX.md` | `FULLSITE DOCS/11-STATE/OFFLINE-TEST-MATRIX.md` | NORMATIVE | FROZEN | Testing activo | ALTO | Ninguno |

---

### docs/architecture/ — FROZEN-FOR-MOVE

| current_path | proposed_path | clasificación | acción | razón | riesgo | conflicto |
|---|---|---|---|---|---|---|
| `docs/architecture/adr/ADR-CONCURRENCY.md` | `FULLSITE DOCS/02-ARCHITECTURE/adr/ADR-CONCURRENCY.md` | NORMATIVE | FROZEN → MOVE | ADR permanente | ALTO — refs desde migrations/ | Ninguno |
| `docs/architecture/adr/ADR-FISCAL-MODEL.md` | `FULLSITE DOCS/02-ARCHITECTURE/adr/ADR-FISCAL-MODEL.md` | NORMATIVE | FROZEN → MOVE | ADR permanente | MEDIO | Ninguno |
| `docs/architecture/adr/ADR-TURNO-LIFECYCLE.md` | `FULLSITE DOCS/02-ARCHITECTURE/adr/ADR-TURNO-LIFECYCLE.md` | NORMATIVE | FROZEN → MOVE | ADR permanente | MEDIO | Ninguno |
| `docs/architecture/PERSISTENCE-LAYER.md` | `FULLSITE DOCS/08-SYNC/SYNC-QUEUE-ARCHITECTURE.md` | NORMATIVE | FROZEN → RENAME+MOVE | Renombrar para eliminar ambigüedad con docs/reference/PERSISTENCE-LAYER.md | ALTO — refs desde AGENTS.md y audit matrix | Requiere aprobación nombre |
| `docs/architecture/OFFLINE-MASTER.md` | `FULLSITE DOCS/03-LOCAL-FIRST/OFFLINE-MASTER.md` | NORMATIVE | FROZEN | Workstream offline activo | ALTO | Ninguno |
| `docs/architecture/ROOT-CAUSE-001-recipe-identifier-mismatch.md` | `FULLSITE DOCS/19-ARCHIVE/` o `docs/postmortems/` | HISTORICAL | FROZEN → ARCHIVE | Root cause de incidente — va en postmortems | BAJO | Ninguno |

---

### docs/migrations/ — FROZEN-FOR-MOVE

| current_path | proposed_path | clasificación | acción | razón |
|---|---|---|---|---|
| `docs/migrations/00-current-state-audit.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/00-current-state-audit.md` | NORMATIVE | FROZEN → MOVE | Migration Engine, Fase 0 completada |
| `docs/migrations/01-current-data-flow.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/02-entity-coverage-matrix.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/03-risk-register.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/04-canonical-model-proposal.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/05-connector-contract-proposal.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/06-implementation-roadmap.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/07-design-decisions.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |
| `docs/migrations/SEC-DEPLOY-01-security-deployment.md` | `FULLSITE DOCS/13-MIGRATION-ENGINE/` | NORMATIVE | FROZEN → MOVE | — |

---

### docs/runbooks/ — FROZEN-FOR-MOVE (parcialmente)

| current_path | proposed_path | clasificación | acción | razón |
|---|---|---|---|---|
| `docs/runbooks/SQL_MIGRATION.md` | `FULLSITE DOCS/12-RUNBOOKS/SQL_MIGRATION.md` | NORMATIVE | MOVE (no frozen) | No está bajo workstream activo | 
| `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md` | DELETE_AFTER_VERIFICATION | — | DELETE_AFTER_VERIFICATION | Copia idéntica ya existe en FULLSITE DOCS/12-RUNBOOKS/ |
| `docs/runbooks/CERTIFICATION-SESSION-2026-07-27.md` | `FULLSITE DOCS/12-RUNBOOKS/` o `18-HANDOFFS/` | HISTORICAL | FROZEN → MOVE | Sesión activa | 

---

### docs/reference/ — Acción inmediata posible (post-verificación de links)

| current_path | proposed_path | clasificación | acción | razón | inbound links críticos |
|---|---|---|---|---|---|
| `docs/reference/LOCAL_FIRST_ARCHITECTURE.md` | DELETE_AFTER_VERIFICATION | — | DELETE_AFTER_VERIFICATION | Idéntico a FULLSITE DOCS/03-LOCAL-FIRST/ | `FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` apunta aquí |
| `docs/reference/BRIDGE.md` | DELETE_AFTER_VERIFICATION | — | DELETE_AFTER_VERIFICATION | Idéntico a FULLSITE DOCS/09-ELECTRON/BRIDGE.md | 6 consumidores — actualizar antes de eliminar |
| `docs/reference/EVENT-STORE.md` | DELETE_AFTER_VERIFICATION | — | DELETE_AFTER_VERIFICATION | Idéntico a FULLSITE DOCS/09-ELECTRON/EVENT-STORE.md | 6 consumidores — actualizar antes de eliminar |
| `docs/reference/PERSISTENCE-LAYER.md` | `FULLSITE DOCS/08-SYNC/PER-02-RESEARCH.md` | REFERENCE | RENAME+MOVE | Investigación PER-02, diferente del PERSISTENCE-LAYER.md operacional | LOCAL-FIRST-CODE-AUDIT.md |
| `docs/reference/wansoft/ARCHITECTURE.md` | `FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md` | REFERENCE | MOVE | Inteligencia competitiva de Wansoft | Varios bibles |
| `docs/reference/wansoft/BACKOFFICE-KNOWLEDGE.md` | `FULLSITE DOCS/15-AMALAY/wansoft/` | REFERENCE | MOVE | — | MASTER-INDEX.md |
| `docs/reference/wansoft/CAJA-SPEC.md` | `FULLSITE DOCS/15-AMALAY/wansoft/` | REFERENCE | MOVE | — | MASTER-INDEX.md |
| `docs/reference/wansoft/DATA-MODEL.md` | `FULLSITE DOCS/15-AMALAY/wansoft/` | REFERENCE | MOVE | — | Varios |
| `docs/reference/wansoft/PORTAL-MAP.md` | `FULLSITE DOCS/15-AMALAY/wansoft/` | REFERENCE | MOVE | — | — |

---

### docs/bibles/ — Clasificación completa

| current_path | clasificación | acción | razón |
|---|---|---|---|
| `docs/bibles/P0-EXECUTION-PLAN.md` | NORMATIVE | FROZEN → MOVE a `11-STATE/` | Referenciado activamente desde CERTIFICATIONS y BUGS |
| `docs/bibles/P0-4-LOCAL-FIRST-RFC.md` | NORMATIVE | MOVE a `03-LOCAL-FIRST/` | RFC aprobado — referencia permanente |
| `docs/bibles/R1-AMALAY-VALIDATION.md` | HISTORICAL | MOVE a `19-ARCHIVE/` | Evidencia de R1 field cert — no se modifica |
| `docs/bibles/R1-INVENTORY-CUTOVER.md` | HISTORICAL | MOVE a `19-ARCHIVE/` | Cutover completado |
| `docs/bibles/R1-REVERSAL-STRATEGY.md` | HISTORICAL | MOVE a `19-ARCHIVE/` | Post-cutover |
| `docs/bibles/FULLSITE-RUNTIME-SPECIFICATION.md` | UNKNOWN | REVIEW NEEDED | 795 líneas — puede contener contenido normativo no documentado en otro lugar |
| `docs/bibles/FULLSITE-SETTINGS-BIBLE.md` | REFERENCE | ARCHIVE (mantener accesible) | 2,369 líneas — el más completo sobre settings. Complementa CFG workstream |
| `docs/bibles/POS-V2-SPEC.md` | REFERENCE | ARCHIVE | 1,344 líneas — spec de POS V2. Referencia para escribir `04-POS/POS-SPEC.md` |
| `docs/bibles/CONFIGURABILITY-BIBLE.md` | REFERENCE | ARCHIVE | Insumo para CFG workstream |
| `docs/bibles/FULLSITE-DASHBOARD-*.md` (6 archivos) | HISTORICAL | ARCHIVE | Proliferación — una vez el Dashboard sea normativo en FULLSITE DOCS, estos son histórico |
| `docs/bibles/FULLSITE-POS-*.md` (3 archivos) | HISTORICAL | ARCHIVE | Solapan con POS-V2-SPEC.md y futuro `04-POS/POS-SPEC.md` |
| `docs/bibles/FULLSITE-MASTER-BIBLE.md` | HISTORICAL | ARCHIVE | Superado por FULLSITE-PRINCIPLES.md y ENGINEERING-AXIOMS.md |
| `docs/bibles/FULLSITE-DOMAIN-BIBLE.md` | HISTORICAL | ARCHIVE | Superado por constitution/ |
| `docs/bibles/FULLSITE-ENGINEERING-BIBLE.md` | HISTORICAL | ARCHIVE | Superado por ENGINEERING-AXIOMS.md |
| `docs/bibles/FULLSITE-OPERATIONS-BIBLE.md` | HISTORICAL | ARCHIVE | Superado por operations/ docs actuales |
| `docs/bibles/SETTINGS-*.md` (3 archivos) | HISTORICAL | ARCHIVE | Insumo para CFG-01 |
| `docs/bibles/QA-REPORT.md` | HISTORICAL | ARCHIVE | Auditoría de QA pasada |
| Resto de bibles | HISTORICAL | ARCHIVE | — |

---

### docs/operations/, docs/design/, docs/analysis/ — Sin workstream activo

| current_path | clasificación | acción | razón |
|---|---|---|---|
| `docs/operations/MANUAL-OPERATIVO.md` | NORMATIVE | MOVE a `FULLSITE DOCS/15-AMALAY/` | Guía operativa de AMALAY |
| `docs/operations/GO-LIVE-CHECKLIST.md` | HISTORICAL | ARCHIVE | Checklist del go-live — ya completado |
| `docs/operations/AMALAY-LOG.md` | HISTORICAL | KEEP en docs/operations/ | Diario operacional — no es ingeniería técnica |
| `docs/operations/PLAYBOOK.md` | REFERENCE | KEEP en docs/operations/ | GTM playbook — no es ingeniería |
| `docs/operations/*` (resto ~16 archivos) | HISTORICAL | ARCHIVE o KEEP | Evaluación individual necesaria |
| `docs/design/INVENTARIO-ARQUITECTURA-CANONICA.md` | REFERENCE | ARCHIVE | Diseño pre-implementación |
| `docs/design/*` (resto) | HISTORICAL | ARCHIVE | Diseño pre-R1 |
| `docs/analysis/*` (5 archivos) | REFERENCE | KEEP en docs/analysis/ | Análisis técnico útil para referencia |

---

### dashboard-app/docs/

| current_path | proposed_path | clasificación | acción | razón |
|---|---|---|---|---|
| `dashboard-app/docs/capacitacion-meseros.md` | `FULLSITE DOCS/16-GUIDES/capacitacion-meseros.md` | REFERENCE | MOVE | Guía operativa — debe estar en GUIDES |
| `dashboard-app/docs/KDS-V2-BACKLOG.md` | `FULLSITE DOCS/17-ROADMAP/KDS-V2-BACKLOG.md` | REFERENCE | MOVE | Backlog de producto |
| `dashboard-app/docs/LIMITACION-OFF-INV-01.md` | `FULLSITE DOCS/11-STATE/LIMITACION-OFF-INV-01.md` | NORMATIVE | MOVE | Limitación conocida documentada — pertenece en state/ |
| `dashboard-app/docs/CUTOVER-CHECKLIST.md` | `FULLSITE DOCS/19-ARCHIVE/` | HISTORICAL | ARCHIVE | Cutover AMALAY completado |
| `dashboard-app/docs/INVENTORY-MIGRATION.md` | `FULLSITE DOCS/19-ARCHIVE/` | HISTORICAL | ARCHIVE | Pre-R1 |
| `dashboard-app/docs/PREFLIGHT-AMALAY.md` | `FULLSITE DOCS/19-ARCHIVE/` | HISTORICAL | ARCHIVE | Preflight completado |
| `dashboard-app/docs/VISIT-PLAYBOOK-AMALAY.md` | `FULLSITE DOCS/19-ARCHIVE/` | HISTORICAL | ARCHIVE | Playbook de visita pasada |
| `dashboard-app/docs/WANSOFT-EXIT-CHECKLIST.md` | `FULLSITE DOCS/19-ARCHIVE/` | HISTORICAL | ARCHIVE | Exit de Wansoft completado |

---

### Fichas de backlog documental (documentos que faltan)

Estos documentos no existen. Se crean como fichas de backlog, no como documentos normativos.

#### Ficha D1 — DATA_MODEL.md

- **Propósito:** Tablas core, invariantes de datos, `turno_id`, `client_id`, relaciones canónicas
- **Owner propuesto:** Siguiente ingeniero que haga un cambio de schema + Daniel para validar
- **Fuentes existentes:** CLAUDE.md (tablas de Supabase), docs/reference/wansoft/DATA-MODEL.md (Wansoft), bibles de dominio
- **Información verificada:** Tablas principales están en CLAUDE.md. Las RPCs existen en Supabase.
- **Información desconocida:** Modelo completo de relaciones, invariantes formales del schema, reglas de RLS por tabla
- **Criterio de completitud:** Toda tabla core documentada con columnas, tipos, invariantes y relaciones. Revisado por el primer CTO/ingeniero senior contratado.

#### Ficha D2 — NAMING.md

- **Propósito:** Convenciones de nombres: r1/r2d/, rutas API, SQL functions, React state, tipos TypeScript
- **Owner propuesto:** Primer ingeniero senior que haga un PR con naming no convencional
- **Fuentes existentes:** Convenciones implícitas en el código, algunos patrones en AGENTS.md y ADRs
- **Información verificada:** Patrón `r1_` para funciones de inventario existe en código. Rutas `/api/pos/` existen.
- **Información desconocida:** Convenciones completas para todos los dominios
- **Criterio de completitud:** Al menos 5 dominios cubiertos con ejemplos reales del código

#### Ficha D3 — TENANT_ISOLATION.md

- **Propósito:** Modelo de multi-tenancy: RLS, SECURITY DEFINER, jerarquía de keys, qué datos ve cada rol
- **Owner propuesto:** Daniel (conoce el modelo de RLS) + security reviewer
- **Fuentes existentes:** SECURITY.md (política), mentions en CLONABILITY.md, commits de RLS de mayo-junio 2026
- **Información verificada:** RLS existe en producción. CLONABILITY.md menciona `client_id` como filtro obligatorio.
- **Información desconocida:** Roles exactos en Supabase, qué políticas RLS están activas, cómo se provisiona un nuevo tenant
- **Criterio de completitud:** Diagrama de roles, lista de políticas RLS activas, flujo de provisioning de tenant nuevo

#### Ficha D4 — SYSTEM_ARCHITECTURE.md

- **Propósito:** Vista de pájaro del sistema completo: browser, Electron, Local Server, Supabase, agentes
- **Owner propuesto:** Daniel
- **Fuentes existentes:** LOCAL_FIRST_ARCHITECTURE.md (cubre el stack offline), CLAUDE.md (stack y tablas), OFFLINE-MASTER.md (arquitectura offline)
- **Información verificada:** Arquitectura offline documentada en 15 secciones en LOCAL_FIRST_ARCHITECTURE.md. Stack general en CLAUDE.md.
- **Información desconocida:** Diagrama formal de todos los componentes, flujos de datos entre sistemas, SLAs
- **Criterio de completitud:** Un diagrama de componentes que un CTO pueda leer en 5 minutos y entender toda la arquitectura

#### Ficha D5 — RELEASE.md

- **Propósito:** Cómo hacer un release del Electron app + dashboard. Versioning, build, distribución.
- **Owner propuesto:** Daniel (único que ha hecho releases hasta ahora)
- **Fuentes existentes:** Package.json, electron-app/package.json (tiene scripts de build)
- **Información verificada:** `electron-app/dist/Fullsite POS Setup 1.2.0.exe` es el artefacto actual. Versión 1.2.0.
- **Información desconocida:** Proceso completo de build, firma del .exe, canal de distribución, versioning policy
- **Criterio de completitud:** Cualquier ingeniero puede hacer un release sin hablar con Daniel

#### Ficha D6 — NEW_RESTAURANT.md

- **Propósito:** Guía completa de instalación de Fullsite en un restaurante nuevo, de cero a go-live
- **Owner propuesto:** Daniel + primer implementador (operación)
- **Fuentes existentes:** deployment/ONBOARDING.md (parcial), guías operativas, scripts SQL dispersos, CLONABILITY.md para criterios
- **Información verificada:** Proceso actual requiere ~6 scripts SQL y configuración manual de clients table
- **Información desconocida:** Lista completa de pasos, scripts exactos, configuración de Electron, HID setup
- **Criterio de completitud:** Las 5 preguntas de CLONABILITY.md respondidas con "sí" para el proceso de instalación

#### Ficha D7 — BUG_FIX.md

- **Propósito:** Ciclo de bug fix: reproducir → diagnosticar → fix → commit → certificar
- **Owner propuesto:** Docs Architect + primer ingeniero que cierre un P1
- **Fuentes existentes:** Patrones implícitos en commits cerrados (POS-02, POS-03, POS-04)
- **Información verificada:** El ciclo informal ya existe: estado en BUGS.md → commit con ID → cerrar en BUGS.md
- **Información desconocida:** Proceso de certificación post-fix, cuándo un fix requiere CERTIFICATIONS.md update
- **Criterio de completitud:** El primer ingeniero externo puede cerrar un bug de principio a fin sin preguntar

---

## 7. Plan de transición y rollback

### Principio

La migración ocurre en dos pasos para evitar romper referencias durante el proceso.

### Paso 1 — Copiar con stub de compatibilidad

Para cada archivo que se mueve:

```
# Paso 1: copiar al destino
cp SOURCE DESTINATION

# Paso 1b: dejar stub en la ruta original
cat > SOURCE << 'EOF'
> This document moved to: DESTINATION
> 
> Redirect stub — será eliminado en Paso 2 cuando todas las referencias estén actualizadas.
> Fecha de movimiento: [fecha]
EOF
```

Los stubs garantizan que:
- Lectores humanos que sigan un link antiguo encuentran el nuevo destino
- Referencias en bibles históricas no se rompen silenciosamente

### Paso 2 — Actualizar referencias y eliminar stubs

Solo después de:
1. Actualizar todos los inbound links conocidos (ver sección 5)
2. Verificar con `grep -r "OLD_PATH" .` que no quedan consumidores activos
3. Eliminar el stub de compatibilidad

### Rollback

Si algo sale mal:
```bash
git revert [commit-hash-del-paso-1]
```

La migración se hace en un commit aislado por fase. No mezclar con código.

### Ventanas controladas

| Ventana | Contenido | Prerequisito |
|---------|-----------|--------------|
| Ventana 1 | Docs sin workstream activo: bibles→archive, reference/ duplicados, dashboard-app/docs | Sin prerequisitos |
| Ventana 2 | Constitution/, runbooks/, reference/ no-frozen | Ventana 1 completada |
| Ventana 3 | State/, migrations/, architecture/ (congelados) | Workstreams mt-03, CFG, offline cerrados |
| Ventana 4 | Stubs eliminados | Ventana 3 completada + grep confirma cero refs antiguas |

---

## 8. Diff propuesto — sin ejecutar

Lista exacta de operaciones de filesystem para la Ventana 1 (la única autorizada actualmente).
No ejecutar hasta autorización explícita.

```
# VENTANA 1 — No ejecutar sin autorización
# Solo archivos sin workstream activo

# ── Raíz → FULLSITE DOCS ──────────────────────────────────────
mv SECURITY.md "FULLSITE DOCS/14-SECURITY/SECURITY.md"

# ── FULLSITE DOCS internos (reubicaciones) ────────────────────
mv "FULLSITE DOCS/09-ELECTRON/BRIDGE.md"      "FULLSITE DOCS/06-PRINTING/BRIDGE.md"
mv "FULLSITE DOCS/09-ELECTRON/EVENT-STORE.md" "FULLSITE DOCS/08-SYNC/EVENT-STORE.md"
mv "FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md" \
   "FULLSITE DOCS/15-AMALAY/WANSOFT-OFFLINE-BENCHMARK.md"
mv "FULLSITE DOCS/FULLSITE OFFLINE/22-MULTI-RESTAURANT-OFFLINE-DEPLOYMENT.md" \
   "FULLSITE DOCS/03-LOCAL-FIRST/MULTI-RESTAURANT-DEPLOYMENT.md"

# ── docs/reference/ → DELETE_AFTER_VERIFICATION ──────────────
# (Requiere verificar inbound links antes de ejecutar)
# rm "docs/reference/LOCAL_FIRST_ARCHITECTURE.md"   # 1 consumidor en benchmark doc
# rm "docs/reference/BRIDGE.md"                      # 6 consumidores — actualizar primero
# rm "docs/reference/EVENT-STORE.md"                 # 6 consumidores — actualizar primero

# ── docs/reference/PERSISTENCE-LAYER.md → renombrar ──────────
# (Requiere aprobación de nombre)
# mv "docs/reference/PERSISTENCE-LAYER.md" \
#    "FULLSITE DOCS/08-SYNC/PER-02-RESEARCH.md"

# ── docs/reference/wansoft/ → FULLSITE DOCS ──────────────────
mv "docs/reference/wansoft" "FULLSITE DOCS/15-AMALAY/wansoft"

# ── docs/runbooks/SQL_MIGRATION.md → FULLSITE DOCS ───────────
mv "docs/runbooks/SQL_MIGRATION.md" "FULLSITE DOCS/12-RUNBOOKS/SQL_MIGRATION.md"

# ── dashboard-app/docs/ → FULLSITE DOCS ──────────────────────
mv "dashboard-app/docs/capacitacion-meseros.md"    "FULLSITE DOCS/16-GUIDES/capacitacion-meseros.md"
mv "dashboard-app/docs/KDS-V2-BACKLOG.md"          "FULLSITE DOCS/17-ROADMAP/KDS-V2-BACKLOG.md"
mv "dashboard-app/docs/LIMITACION-OFF-INV-01.md"   "FULLSITE DOCS/11-STATE/LIMITACION-OFF-INV-01.md"

# ── dashboard-app/docs/ → ARCHIVE ─────────────────────────────
mkdir -p "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs"
mv "dashboard-app/docs/CUTOVER-CHECKLIST.md"       "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs/"
mv "dashboard-app/docs/INVENTORY-MIGRATION.md"     "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs/"
mv "dashboard-app/docs/PREFLIGHT-AMALAY.md"        "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs/"
mv "dashboard-app/docs/VISIT-PLAYBOOK-AMALAY.md"   "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs/"
mv "dashboard-app/docs/WANSOFT-EXIT-CHECKLIST.md"  "FULLSITE DOCS/19-ARCHIVE/dashboard-app-docs/"

# ── docs/bibles/ → ARCHIVE ────────────────────────────────────
# (Excepto: P0-EXECUTION-PLAN.md y P0-4-LOCAL-FIRST-RFC.md — esperar Ventana 3)
mkdir -p "FULLSITE DOCS/19-ARCHIVE/bibles"
# mv docs/bibles/*.md → "FULLSITE DOCS/19-ARCHIVE/bibles/"
# (Excluir: P0-EXECUTION-PLAN.md, P0-4-LOCAL-FIRST-RFC.md, R1-AMALAY-VALIDATION.md,
#           FULLSITE-SETTINGS-BIBLE.md, POS-V2-SPEC.md — estos requieren review individual)

# ── ACCIONES BLOQUEADAS (no en Ventana 1) ─────────────────────
# BLOQUEADO: mv ROADMAP.md → hasta resolver Conflicto A
# BLOQUEADO: mv FULLSITE-PRINCIPLES.md → hasta ventana con constitution/ disponible
# BLOQUEADO: mv ENGINEERING-AXIOMS.md → idem
# BLOQUEADO: mv MASTER-INDEX.md → hasta resolver Conflicto C (dos índices)
# BLOQUEADO: docs/constitution/, docs/state/, docs/migrations/, docs/architecture/ → FROZEN
```

---

*Fullsite Documentation Architecture*  
*Status: PREPARATION PHASE — awaiting authorization for physical migration*  
*Next step: Daniel reviews and authorizes Ventana 1 or requests adjustments*
