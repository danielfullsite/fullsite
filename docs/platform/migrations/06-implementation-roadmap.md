# 06 — Roadmap de Implementación

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Propósito: plan para convertir el estado actual en un Migration Engine reutilizable.

---

## 1. Estado de developer onboarding hoy

| Item | Estado | Notas |
|---|---|---|
| README de migración | ❌ falta | No existe `docs/migrations/README.md` ni instrucciones en `scripts/migration-pipeline/` |
| Setup local para desarrollo | ❌ falta | No hay script `setup.sh` ni documentación de env vars para correr los scripts localmente |
| Fixtures / datos demo | ⚠️ parcial | `scripts/migration-pipeline/fixtures/recipes.json` y `ingredients.json` existen, pero son de AMALAY, no datos neutros para demos |
| Documentación de Wansoft disponible | ✅ existe | `docs/knowledge/wansoft/` tiene 5 archivos: ARCHITECTURE.md, DATA-MODEL.md, BACKOFFICE-KNOWLEDGE.md, PORTAL-MAP.md, CAJA-SPEC.md |
| Diagramas de flujo | ⚠️ parcial | CLAUDE.md tiene diagrama ASCII del sistema general. No hay diagrama del flujo de migración específicamente. Este documento (01-current-data-flow.md) lo suple. |
| Tests de migración | ❌ falta | No se encontraron tests para los scripts de migración. El dry-run es el único mecanismo de validación, pero no es un test automatizado. |
| Scripts reproducibles end-to-end | ⚠️ parcial | `dry-run.ts` es reproducible. `migrate-wansoft-to-supabase.py` requiere los JSONs de input que no están en git. |
| Variables de entorno documentadas | ⚠️ parcial | CLAUDE.md documenta los secrets de GH Actions. No hay `.env.example` para desarrollo local de los scripts de migración. |
| Glosario del dominio | ❌ falta | No hay glosario formal (Wansoft habla de "platillos", Fullsite de "products", "menu_items" — no documentado). |
| ADRs (Architecture Decision Records) | ❌ falta | No hay carpeta `docs/decisions/`. Las decisiones están dispersas en CLAUDE.md y archivos de memoria. |
| Runbooks | ⚠️ parcial | `docs/archive/manual-migracion-wansoft.md` (archivado). Referencia a `deployment/CUTOVER-PLAYBOOK.md` que no fue encontrado. |
| Changelog de schema | ❌ falta | No hay log de qué cambió en el schema entre versiones. `MANIFEST.json` documenta el estado actual, no el historial. |

---

## 2. Tareas pequeñas y aisladas (para un ingeniero nuevo)

Lista priorizada de tareas que no rompen nada y tienen resultado claro.

| # | Tarea | Descripción | Estimado | Prerequisito | Archivo/módulo |
|---|---|---|---|---|---|
| T-01 | Agregar columnas de provenance | `ALTER TABLE pos_suppliers ADD COLUMN source_system TEXT, source_id TEXT, migrated_at TIMESTAMPTZ;` — idem para pos_recipes_old, pos_inventory_products. | 1h | Acceso a Supabase SQL Editor | `scripts/sql/migrations/` — crear `012_add_provenance.sql` |
| T-02 | Crear `.env.example` para scripts de migración | Documentar las variables requeridas para correr `migrate-wansoft-to-supabase.py` y `dry-run.ts` localmente. | 30min | Saber qué vars usan los scripts | `scripts/.env.example` |
| T-03 | Corregir `CLIENT_ID` hardcoded | Cambiar `CLIENT_ID = "amalay"` en `migrate-wansoft-to-supabase.py:22` por `CLIENT_ID = os.environ.get("CLIENT_ID", "amalay")`. | 30min | Ninguno | `scripts/migrate-wansoft-to-supabase.py` |
| T-04 | Crear fixtures neutros | Crear `scripts/migration-pipeline/fixtures/demo_ingredients.json` y `demo_recipes.json` con 10-15 productos de un restaurante ficticio (no AMALAY). | 1h | Entender el schema esperado | `scripts/migration-pipeline/fixtures/` |
| T-05 | Investigar causa del 65% de rechazo | Correr `npx tsx scripts/migration-pipeline/dry-run.ts --real` y analizar el `dry-run-report.json` para identificar la causa exacta de los orphan references. | 2h | JSONs en `agents/wansoft/` (en el repo principal) | `scripts/migration-pipeline/dry-run.ts` |
| T-06 | Documentar schema de `wansoft_data` | Leer `wansoft_inventory_sync.py` completamente y documentar las keys usadas y su estructura JSON esperada. | 1h | Ninguno | `docs/knowledge/wansoft/WANSOFT-DATA-SCHEMA.md` (nuevo) |
| T-07 | Agregar README a `scripts/migration-pipeline/` | Instrucciones para: instalar dependencias, correr dry-run con fixtures, correr dry-run con datos reales, interpretar el reporte. | 1h | T-02 | `scripts/migration-pipeline/README.md` |
| T-08 | Extractar RLS policies del esquema | Conectar a Supabase con `pg_get_functiondef()` para obtener los 194 RLS policies y agregarlos a `scripts/sql/migrations/003_rls_policies.sql`. | 3h | Acceso a Supabase | `scripts/sql/migrations/003_rls_policies.sql` |
| T-09 | Crear glosario Wansoft → Fullsite | Tabla markdown: término Wansoft → término Fullsite → tabla SQL → notas. Ej: Platillo → Product → `pos_menu_items`. | 2h | Ninguno (ya está en DATA-MODEL.md parcialmente) | `docs/migrations/GLOSSARY.md` |
| T-10 | Corregir timezone en backfill | Cambiar `datetime.now(timezone.utc)` por cálculo en timezone MX en `wansoft_backfill.py:36`. | 30min | Entender `get_tz()` de `client_config.py` | `.github/scripts/wansoft_backfill.py` |

---

## 3. Orden de implementación recomendado

### Fase 0 — Esta auditoría (COMPLETA)
**Entregables:** 7 documentos en `docs/migrations/`  
**Criterio de éxito:** Un ingeniero nuevo puede leer estos docs y entender el estado del sistema en < 2 horas.

---

### Fase 1 — Consolidar lo que existe (2-3 semanas)

**Objetivo:** Hacer que el flujo existente de AMALAY sea correcto, documentado y multi-tenant.

Tareas en orden:
1. T-03: Parametrizar `CLIENT_ID`
2. T-10: Corregir timezone
3. T-01: Agregar columnas de provenance
4. T-05: Resolver causa del 65% de rechazo en dry-run
5. T-07: README para `scripts/migration-pipeline/`
6. T-04: Fixtures neutros para demos

**Criterio de éxito:**
- El script de migración de catálogo funciona con `--client=atope` sin cambios de código.
- El dry-run pasa sin errores con los fixtures neutros.
- El dry-run pasa con > 80% de acceptance con datos reales de AMALAY.

---

### Fase 2 — Formalizar el conector Wansoft (3-4 semanas)

**Objetivo:** Convertir los scripts actuales en un `WansoftConnector` que implemente el contrato de `05-connector-contract-proposal.md`.

Tareas:
1. Crear `src/connectors/wansoft/index.ts` con la clase `WansoftConnector implements MigrationConnector`
2. Mover la lógica de `wansoft_backfill.py` y `migrate-wansoft-to-supabase.py` al conector
3. Implementar `testConnection()` usando el flow de login actual
4. Implementar `discover()` que lista las entidades disponibles
5. Implementar `extract()` como AsyncIterable con checkpoint support para cada entidad
6. Implementar `mapToCanonical()` usando los maps existentes de `scripts/migration-pipeline/maps/`
7. Agregar tabla `migration_sessions` y `migration_raw_records` al schema
8. Crear tests automatizados con los fixtures neutros

**Criterio de éxito:**
- `WansoftConnector.testConnection()` puede verificar credenciales sin side effects
- `WansoftConnector.extract('suppliers')` retorna todos los proveedores con `source_id` = código Wansoft
- Todos los tests de `scripts/migration-pipeline/` pasan en CI

---

### Fase 3 — CSV Connector (1-2 semanas)

**Objetivo:** Segundo conector que permite onboardear cualquier restaurante con datos en CSV/Excel.

Tareas:
1. Crear `src/connectors/csv/index.ts` con `CsvConnector implements MigrationConnector`
2. Definir template de columnas esperadas para cada entidad (menu, recipes, suppliers)
3. Implementar parser que lee el template y devuelve `RawRecord[]`
4. Crear UI en dashboard para subir el CSV (o usar CLI)
5. Tests con múltiples formatos de CSV reales

**Criterio de éxito:**
- Un restaurante sin POS puede importar su menú en < 30 minutos usando el template CSV
- La demo del Migration Engine no requiere credenciales activas de Wansoft

---

### Fase 4 — Core de migración (4-6 semanas)

**Objetivo:** El "core" del Motor de Migración que orquesta los conectores, valida, escribe y permite rollback.

Tareas:
1. Crear `src/migration-engine/core.ts` con la clase `MigrationEngine`
2. Implementar orchestración: `discover() → extract() → validateSource() → mapToCanonical() → [core validates] → write`
3. Implementar resolución de orphan references con fuzzy matching
4. Implementar rollback por `session_id`
5. Crear UI en dashboard para iniciar/monitorear/rollback de migraciones
6. Logging completo en `migration_sessions`

**Criterio de éxito:**
- Onboardear a Atope (3 sucursales) usando solo la UI de migración, sin necesidad de intervención de ingeniería
- Si la migración falla a mitad, el rollback restaura el estado anterior en < 5 minutos
- Un nuevo ingeniero puede seguir el log de `migration_sessions` para diagnosticar cualquier fallo

---

## 4. Criterios de éxito por fase

| Fase | Criterio de éxito cuantificable |
|---|---|
| Fase 0 | 7 documentos creados, commit en main, ningún archivo existente modificado |
| Fase 1 | dry-run con datos reales: < 20% de rechazo (vs 65% actual); CLIENT_ID parametrizado |
| Fase 2 | WansoftConnector tiene 100% de cobertura de tests con fixtures; tarda < 5 min en extraer catálogo completo de AMALAY |
| Fase 3 | CSV connector importa menú de prueba de 100 items en < 2 minutos; onboarding sin credenciales Wansoft |
| Fase 4 | Onboarding de Atope completo en < 4 horas por sucursal; 0 intervenciones de ingeniería durante el proceso |

---

## 5. Lo que debe ser verdad antes de migrar el primer restaurante nuevo

Antes de usar el Migration Engine con un cliente diferente a AMALAY, debe ser cierto que:

1. **CLIENT_ID es parámetro, no constante** — todos los scripts de migración deben aceptar `--client=xxx`. (T-03)

2. **Los datos del nuevo cliente están separados de los de AMALAY** — cada tabla de destino debe tener `client_id` y el nuevo restaurante no puede leer datos de AMALAY. Verificar que RLS policies existen y funcionan.

3. **El conector Wansoft puede autenticarse con credenciales del nuevo cliente** — probado con `testConnection()`. Las credenciales del nuevo cliente deben estar en GH Secrets bajo un nombre por cliente.

4. **Hay un dry-run exitoso antes del write real** — el `ValidationReport` muestra < 5% de rechazo. Orphan references resueltas o documentadas.

5. **Las columnas de provenance existen** — `source_system`, `source_id`, `migrated_at` en todas las tablas de destino. (T-01)

6. **Hay un rollback plan documentado** — antes de ejecutar el write, existe un script de rollback específico para este cliente + sesión.

7. **El nuevo cliente tiene sus datos en los JSONs correctos** — equivalente a `agents/wansoft/` pero para el nuevo restaurante, no mezclado con los de AMALAY.

8. **Se ejecutó el cutover playbook** — la migración de datos de catálogo es parte de un proceso más amplio que incluye hardware (impresoras), staff (PINs) y capacitación. Ver `docs/archive/manual-migracion-wansoft.md`.
