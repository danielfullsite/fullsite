# FULLSITE DOCS

> **STATUS: PROVISIONAL — PHYSICAL MIGRATION NOT YET EXECUTED**
>
> Esta estructura de carpetas es el destino propuesto. El inventario de documentos actuales,
> las rutas congeladas por workstreams activos, los conflictos pendientes de resolución y el
> plan de transición están en:
> [`DOCS-MIGRATION-MANIFEST.md`](./DOCS-MIGRATION-MANIFEST.md)
>
> No ejecutar movimientos físicos hasta autorización de Daniel Ramonfaur.

---

## Índice de lo que existe hoy

Documentos que **ya existen** en este repositorio, organizados por tema.
Las rutas propuestas están en el manifest. Las rutas aquí son las actuales.

---

### Constitución del sistema (NORMATIVE — fuentes de verdad permanentes)

| Documento | Ruta actual | Descripción |
|-----------|-------------|-------------|
| Principios del producto | `FULLSITE-PRINCIPLES.md` (raíz) | 17 principios operativos de Fullsite |
| Axiomas de ingeniería | `ENGINEERING-AXIOMS.md` (raíz) | 17 axiomas de ingeniería con origin stories |
| Modelo de concurrencia | `docs/constitution/CONCURRENCY.md` | OCC, `base_version`, STALE_WRITE_CONFLICT — FROZEN |
| Gate de clonabilidad | `docs/constitution/CLONABILITY.md` | 5 preguntas para PRs. Gate de multi-tenancy — FROZEN |
| ADR Concurrencia | `docs/architecture/adr/ADR-CONCURRENCY.md` | Decision record del modelo OCC — FROZEN |
| ADR Fiscal | `docs/architecture/adr/ADR-FISCAL-MODEL.md` | Decision record del modelo fiscal — FROZEN |
| ADR Turno lifecycle | `docs/architecture/adr/ADR-TURNO-LIFECYCLE.md` | Decision record de apertura/cierre de turno — FROZEN |

**Brechas confirmadas** (fichas de backlog en manifest §4):
`DATA_MODEL.md` · `NAMING.md` · `TENANT_ISOLATION.md` · `SYSTEM_ARCHITECTURE.md`

---

### Arquitectura Local-First (NORMATIVE)

| Documento | Ruta actual | Descripción |
|-----------|-------------|-------------|
| Arquitectura completa (15 secciones) | `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md` | **Fuente canónica.** Boot offline, IDB, sync queue, LAN, turno |
| Cola sync — especificación operacional | `docs/architecture/PERSISTENCE-LAYER.md` | Capas de persistencia, ciclo de vida de ítem, transportes — FROZEN |
| Offline master audit 2026-07-27 | `docs/architecture/OFFLINE-MASTER.md` | Audit matrix VERIFIED/PARTIAL/UNKNOWN por componente — FROZEN |
| RFC Local-First P0-4 | `docs/bibles/P0-4-LOCAL-FIRST-RFC.md` | RFC aprobado 2026-07-24 |
| Despliegue multi-restaurante | `FULLSITE DOCS/FULLSITE OFFLINE/22-MULTI-RESTAURANT-OFFLINE-DEPLOYMENT.md` | Guía normativa de instalación |
| Benchmark vs Wansoft | `FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` | Comparativa de capacidades offline |

---

### Estado operacional del sistema (NORMATIVE — se modifica continuamente)

> Todas estas rutas están **FROZEN-FOR-MOVE** mientras haya workstreams activos.

| Documento | Ruta actual | Descripción |
|-----------|-------------|-------------|
| Bug tracker | `docs/state/BUGS.md` | POS-XX y DASH-XX. 13 bugs "Pendiente de documentar" |
| Certificaciones | `docs/state/CERTIFICATIONS.md` | P0-1 a P0-4 y sus requisitos |
| Congelamientos activos | `docs/state/FREEZES.md` | POS V2 Architecture Freeze, R0/R0.5 HOLD |
| Iniciativas FSOS | `docs/state/INITIATIVES.md` | 9 iniciativas, todas en Backlog |
| Audit matrix offline | `FULLSITE DOCS/11-VALIDATION/LOCAL-FIRST-CODE-AUDIT.md` | PAY/ORD/KDS/CFG/PER series — FROZEN |
| Chaos tests | `docs/state/OFFLINE-CHAOS-TESTS.md` | Tests de escenarios adversariales — FROZEN |
| Test matrix | `docs/state/OFFLINE-TEST-MATRIX.md` | Matriz de cobertura de tests — FROZEN |
| Limitación inventario offline | `dashboard-app/docs/LIMITACION-OFF-INV-01.md` | Limitación conocida documentada |

---

### Migration Engine (NORMATIVE — Fase 0 completa 2026-07-25)

> Carpeta completa **FROZEN-FOR-MOVE**. 9 documentos, 1,775 líneas.

| Documento | Ruta actual |
|-----------|-------------|
| Auditoría estado actual | `docs/migrations/00-current-state-audit.md` |
| Flujo de datos actual | `docs/migrations/01-current-data-flow.md` |
| Matriz de cobertura de entidades | `docs/migrations/02-entity-coverage-matrix.md` |
| Registro de riesgos | `docs/migrations/03-risk-register.md` |
| Propuesta modelo canónico | `docs/migrations/04-canonical-model-proposal.md` |
| Contrato de conectores | `docs/migrations/05-connector-contract-proposal.md` |
| Roadmap de implementación | `docs/migrations/06-implementation-roadmap.md` |
| Decisiones de diseño | `docs/migrations/07-design-decisions.md` |
| Deploy de seguridad SEC-DEPLOY-01 | `docs/migrations/SEC-DEPLOY-01-security-deployment.md` |

---

### Runbooks (NORMATIVE)

| Documento | Ruta actual | Estado |
|-----------|-------------|--------|
| Certificación offline | `FULLSITE DOCS/12-RUNBOOKS/OFFLINE-CERTIFICATION-RUNBOOK.md` | **Fuente canónica** |
| Migraciones SQL | `docs/runbooks/SQL_MIGRATION.md` | Activo |
| Sesión de certificación 2026-07-27 | `docs/runbooks/CERTIFICATION-SESSION-2026-07-27.md` | FROZEN |
| BUG_FIX.md | — | **Falta — Ficha D7 en manifest** |
| RELEASE.md | — | **Falta — Ficha D5 en manifest** |
| NEW_RESTAURANT.md | — | **Falta — Ficha D6 en manifest** |

---

### Electron + Bridge + Event Store (NORMATIVE)

| Documento | Ruta actual |
|-----------|-------------|
| Bridge de impresión | `FULLSITE DOCS/09-ELECTRON/BRIDGE.md` |
| Event store | `FULLSITE DOCS/09-ELECTRON/EVENT-STORE.md` |

> Nota: ambos tienen copias idénticas en `docs/reference/`. Fuente canónica = `FULLSITE DOCS/`.

---

### Ejecución P0 (NORMATIVE)

| Documento | Ruta actual | Descripción |
|-----------|-------------|-------------|
| Plan de ejecución P0 | `docs/bibles/P0-EXECUTION-PLAN.md` | Fuente de verdad de P0s — referenciado desde CERTIFICATIONS y BUGS |

> **Conflicto activo:** `ROADMAP.md` (raíz, 2026-06-30) lista P0s que no coinciden con
> CERTIFICATIONS.md. Ver Conflicto A en el manifest antes de actualizar cualquier P0.

---

### Inteligencia competitiva — Wansoft (REFERENCE)

| Documento | Ruta actual |
|-----------|-------------|
| Arquitectura Wansoft | `docs/reference/wansoft/ARCHITECTURE.md` |
| Backoffice Wansoft | `docs/reference/wansoft/BACKOFFICE-KNOWLEDGE.md` |
| Spec Caja Wansoft | `docs/reference/wansoft/CAJA-SPEC.md` |
| Data Model Wansoft | `docs/reference/wansoft/DATA-MODEL.md` |
| Portal Map Wansoft | `docs/reference/wansoft/PORTAL-MAP.md` |

---

### Investigación de persistencia PER-02 (REFERENCE)

| Documento | Ruta actual | Descripción |
|-----------|-------------|-------------|
| Investigación PER-02 | `docs/reference/PERSISTENCE-LAYER.md` | "No crear event-store.ts" — diferente del operacional de architecture/ |

---

### Handoffs de sesión (HISTORICAL)

| Documento | Ruta actual |
|-----------|-------------|
| Handoff offline 2026-07-27 | `FULLSITE DOCS/18-HANDOFFS/2026-07-27-OFFLINE-LOCAL-FIRST-MASTER-HANDOFF.md` |

---

### Fuentes de verdad del código

| Qué | Ruta |
|-----|------|
| POS — lógica de negocio | `dashboard-app/src/app/pos/` |
| IDB / sync queue | `dashboard-app/src/lib/pos-offline-db.ts` |
| Lógica de órdenes | `dashboard-app/src/lib/pos-data.ts` |
| Settings del POS | `dashboard-app/src/lib/settings.ts` |
| Electron main | `electron-app/main.js` |
| Schema Supabase | MCP `supabase-amalay` (read-only) |
| Build actual | `electron-app/dist/Fullsite POS Setup 1.2.0.exe` |

---

### Estructura de carpetas propuesta (destino futuro)

Cuando la migración se autorice, estos directorios serán las ubicaciones canónicas.

| Carpeta | Contenido previsto |
|---------|-------------------|
| `00-README/` | Este índice + DOCS-MIGRATION-MANIFEST.md |
| `01-CONSTITUTION/` | FULLSITE-PRINCIPLES, ENGINEERING-AXIOMS, CONCURRENCY, CLONABILITY, DATA_MODEL, NAMING, TENANT_ISOLATION, SYSTEM_ARCHITECTURE |
| `02-ARCHITECTURE/` | ADRs |
| `03-LOCAL-FIRST/` | LOCAL_FIRST_ARCHITECTURE, OFFLINE-MASTER, MULTI-RESTAURANT-DEPLOYMENT, P0-4-RFC |
| `04-POS/` | POS-SPEC, flujos de cobro |
| `05-KDS/` | KDS V2 spec, backlog |
| `06-PRINTING/` | BRIDGE, specs de impresión |
| `07-INVENTORY/` | Inventario, recetas, food cost |
| `08-SYNC/` | EVENT-STORE, SYNC-QUEUE-ARCHITECTURE (ex-PERSISTENCE-LAYER), PER-02-RESEARCH |
| `09-ELECTRON/` | Configuración Electron, modos |
| `10-INSTALLATION/` | NEW_RESTAURANT runbook, hardware setup |
| `11-STATE/` | BUGS, CERTIFICATIONS, FREEZES, INITIATIVES, audit matrix, test matrices, limitaciones |
| `12-RUNBOOKS/` | OFFLINE-CERTIFICATION, SQL_MIGRATION, BUG_FIX, RELEASE, NEW_RESTAURANT, CERTIFICATION-SESSION |
| `13-MIGRATION-ENGINE/` | 9 documentos de Migration Engine |
| `14-SECURITY/` | SECURITY.md |
| `15-AMALAY/` | Docs específicos AMALAY, intel Wansoft, CFG-01 demo |
| `16-GUIDES/` | capacitacion-meseros, guías de equipo |
| `17-ROADMAP/` | KDS-V2-BACKLOG, roadmap de producto |
| `18-HANDOFFS/` | Handoffs de sesión, CERTIFICATION-SESSION |
| `19-ARCHIVE/` | Bibles históricas, preflight AMALAY, dashboard-app/docs histórico, MASTER-INDEX, ROADMAP |
| `20-STRATEGY/` | Estrategia y decisiones de producto |
| `21-OPERATIONS/` | Operaciones diarias, checklists |
| `22-GUIDES/` | Guías para el equipo |

---

*Fullsite Documentation Architecture*  
*Índice provisional — migración física pendiente de autorización*  
*Ver [`DOCS-MIGRATION-MANIFEST.md`](./DOCS-MIGRATION-MANIFEST.md) para decisiones pendientes*
