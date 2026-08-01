# 00 — Estado Actual: Auditoría Completa

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Auditor: Claude Sonnet 4.6 (read-only, sin modificaciones)

---

## 1. Resumen ejecutivo

Fullsite tiene una infraestructura de migración parcialmente construida, orientada exclusivamente al cliente AMALAY (Wansoft). Existen tres capas distintas: (a) un **extractor operacional** de datos históricos de ventas via HTTP scraping al portal `wansoft.net`, que escribe directamente a Supabase y está activo en producción; (b) un **pipeline de catálogo/recetas** con validadores TypeScript, mapas de normalización y fixtures, que existe en `scripts/migration-pipeline/` y opera en modo dry-run sin escribir a producción; y (c) un **script SQL ad-hoc** que genera INSERT masivos desde JSONs scrapeados para proveedores, recetas y existencias. Los tres coexisten sin coordinarse. No existe un conector genérico, no hay provenance tracking (`source_id` / `source_hash`), y la única tabla con `client_slug` consistente es `wansoft_daily`. Para escalar a un segundo cliente se necesitaría refactorizar los tres componentes desde cero.

---

## 2. Inventario de componentes

| Componente | Ruta | Responsabilidad | Origen | Destino | Entidades | Reutilizable | Riesgo | Estado | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| Backfill de ventas diarias | `.github/scripts/wansoft_backfill.py` | Scrape HTTP de 7 endpoints Wansoft, upsert wansoft_daily | wansoft.net (HTTP POST + HTML parse) | `wansoft_daily` | ventas, meseros, grupos, pagos, platillos | INFERENCIA: requiere client_config | ALTO: fields corridos en proveedores, float para dinero | ACTIVO | `get_wansoft_creds()`, `sb_headers`, upsert a `/rest/v1/wansoft_daily` |
| Inventario sync | `.github/scripts/wansoft_inventory_sync.py` | GET a endpoints JSON Wansoft, save a wansoft_data | wansoft.net (JSON endpoints) | `wansoft_data` | warehouses, inventory_state, reorder_points, products | INFERENCIA: multi-tenant vía client_config | MEDIO: tabla wansoft_data sin schema publicado | POSIBLE | `Inventory/GetInventoryStatementBySubsidiary` |
| Menu sync | `.github/scripts/wansoft_menu_sync.py` | Fetch grupos/platillos/modificadores/precios de Wansoft | wansoft.net (HTML parse + JSON) | `wansoft_menu_config` | categorías, productos, modificadores, precios | INFERENCIA: multi-tenant vía client_config | MEDIO: depende de estructura HTML Wansoft | ACTIVO | workflow `wansoft-menu-sync.yml` |
| Inventory scrape | `.github/scripts/wansoft_inventory_scrape.py` | Navega pantallas de inventario, extrae entradas/salidas/auditoría | wansoft.net (HTML parse) | `wansoft_data` | inventory, production, purchase_orders, facturas | No (hard-coded URLs) | ALTO: no idempotente, basado en HTML frágil | POSIBLE | `Inventory/InputOutput`, `Inventory/InventoryControl` |
| Pipeline dry-run | `scripts/migration-pipeline/dry-run.ts` | Normaliza ingredientes + recetas desde JSONs, valida, reporta | JSONs en `agents/wansoft/` | Ninguna (dry-run only) | ingredientes, recetas | HECHO: tiene maps y validators propios | BAJO: no escribe a producción | POSIBLE | `dry-run-report.json` con 2225 records, 1456 rechazados |
| SQL generator (migrate-wansoft) | `scripts/migrate-wansoft-to-supabase.py` | Lee JSONs Wansoft, genera SQL con INSERT masivo | JSONs en `agents/wansoft/` | `pos_suppliers`, `pos_recipes_old`, `pos_inventory_products` | proveedores, recetas, existencias | No (hardcoded `CLIENT_ID = 'amalay'`) | CRÍTICO: fields corridos en proveedores, `CLIENT_ID` hardcoded | HISTÓRICO | line 22 `CLIENT_ID = "amalay"`, columnas invertidas (rfc↔nombre) |
| Wansoft Explorer | `agents/wansoft-explorer/` | Login + crawl portal Wansoft + UPSERT wansoft_catalog | wansoft.net (Playwright) | `wansoft_catalog` | metadatos del portal | INFERENCIA: multi-tenant posible | MEDIO: requiere credenciales activas | HISTÓRICO | `CLAUDE.md` en carpeta, specs de platillos en `specs/` |
| Schema migrations (consolidado) | `scripts/sql/migrations/` | DDL de producción para redeployment en otro tenant | N/A | Supabase (manual) | 45 tablas nuevas, 29 core, 16 wansoft_pipeline | HECHO: `MANIFEST.json` documenta todo | MEDIO: RLS/functions/triggers no incluidos (194 policies faltantes) | POSIBLE | `MANIFEST.json` line 84: `"rlsPolicies": 194` |
| Wansoft JSON extracts | `agents/wansoft/*.json` | Datos capturados del portal Wansoft para AMALAY | wansoft.net (scrapeado manualmente/automáticamente) | Input para scripts de migración | productos, recetas, existencias, proveedores, modificadores, etc. | No (datos de un restaurante específico) | MEDIO: snapshot estático, no versionado | HISTÓRICO | 30+ archivos JSON en `agents/wansoft/` |
| Normalization maps | `scripts/migration-pipeline/maps/` | Mapeo Wansoft → Fullsite para categorías, unidades, nombres | Static config | Código TypeScript | categorías (ABARROTE, PROTEINA, etc.), unidades (kg, lt, pz) | HECHO: bien diseñado | BAJO | POSIBLE | `categories.ts`, `units.ts`, `names.ts` |
| Validators | `scripts/migration-pipeline/validators/index.ts` | Valida ingredientes, recetas, proveedores antes de import | N/A | N/A | ValidationReport, ValidationIssue | HECHO | BAJO | POSIBLE | `validateIngredient()`, `validateRecipe()`, `validateSupplier()` |
| Cutover playbook | `docs/archive/manual-migracion-wansoft.md` | Plan operativo para reemplazar Wansoft con Fullsite POS | N/A | N/A | POS cutover steps | No (proceso, no código) | BAJO | HISTÓRICO (ARCHIVED) | Note: "Replaced by deployment/CUTOVER-PLAYBOOK.md" |

---

## 3. Archivos inspeccionados

- `/scripts/migrate-wansoft-to-supabase.py`
- `/scripts/migration-pipeline/dry-run.ts`
- `/scripts/migration-pipeline/dry-run-report.json`
- `/scripts/migration-pipeline/maps/categories.ts`
- `/scripts/migration-pipeline/maps/units.ts`
- `/scripts/migration-pipeline/validators/index.ts`
- `/scripts/migration-pipeline/fixtures/recipes.json` (existencia confirmada, no leído)
- `/scripts/migration-pipeline/fixtures/ingredients.json` (existencia confirmada, no leído)
- `/scripts/sql/migrations/001_core_schema.sql`
- `/scripts/sql/migrations/002_wansoft_pipeline.sql`
- `/scripts/sql/migrations/MANIFEST.json`
- `/scripts/sql/migrations/CONSOLIDATION_MAP.md`
- `/scripts/sql/migrations/DEPRECATION_PLAN.md` (existencia confirmada, no leído)
- `/scripts/wansoft-daily-upsert-jun24-jul10.sql` (existencia confirmada, no leído)
- `/.github/scripts/wansoft_backfill.py`
- `/.github/scripts/wansoft_inventory_sync.py`
- `/.github/scripts/wansoft_inventory_scrape.py`
- `/.github/scripts/wansoft_menu_sync.py`
- `/.github/scripts/client_config.py` (existencia confirmada, no leído completamente)
- `/agents/wansoft-explorer/CLAUDE.md`
- `/agents/wansoft-explorer/src/` (estructura confirmada, no leídos individualmente)
- `/agents/wansoft/*.json` — muestras de: `wansoft_products.json`, `wansoft_recetas.json`, `wansoft_existencias.json`, `wansoft_existencias_20260707.json`, `wansoft_proveedores.json`, `wansoft_platillos.json`, `wansoft_modificadores.json`, `wansoft_costos.json`
- `/docs/archive/manual-migracion-wansoft.md`
- `/docs/reference/wansoft/DATA-MODEL.md`
- `/docs/reference/wansoft/ARCHITECTURE.md`
- `/.github/workflows/` — listado completo (48 workflows)
- `/dashboard-app/migrations/` — 5 archivos SQL (existencia confirmada)
- `/dashboard-app/sql/` — archivos clave confirmados
- `/CLAUDE.md` — referencia de arquitectura general

---

## 4. Tablas identificadas (Supabase) tocadas por procesos de migración/sync

### Tablas destino de migración/sync activos

| Tabla | Escritas por | Grupo |
|---|---|---|
| `wansoft_daily` | `wansoft_backfill.py`, `wansoft-daily-mesero.yml` (scraper Playwright) | Wansoft Pipeline |
| `wansoft_kpis` | scraper intraday (inferencia) | Wansoft Pipeline |
| `wansoft_data` | `wansoft_inventory_sync.py`, `wansoft_inventory_scrape.py` | Wansoft Pipeline |
| `wansoft_menu_config` | `wansoft_menu_sync.py` | Wansoft Pipeline |
| `wansoft_catalog` | `agents/wansoft-explorer/src/supabase_client.py` | Wansoft Pipeline |
| `pos_suppliers` | `scripts/migrate-wansoft-to-supabase.py` (genera SQL) | Core POS |
| `pos_recipes_old` | `scripts/migrate-wansoft-to-supabase.py` (genera SQL) | Core POS |
| `pos_inventory_products` | `scripts/migrate-wansoft-to-supabase.py` (genera SQL) | Core POS |

### Tablas del DDL consolidado (no actualmente escritas por migración, pero en scope)

- `pos_ingredients`, `pos_recipe_lines`, `pos_sub_recipes`, `pos_sub_recipe_ingredients`
- `pos_menu_items`, `pos_menu_categories`
- `pos_unit_conversions`, `pos_presentations`, `pos_ingredient_presentations`
- `wansoft_recipes`, `wansoft_suppliers`, `wansoft_inventory`, `wansoft_food_cost`

---

## 5. Scripts y comandos encontrados

| Script | Tipo | Trigger | Notas |
|---|---|---|---|
| `scripts/migrate-wansoft-to-supabase.py` | MANUAL | `python3 script.py` | Genera SQL a `/scripts/sql/01-proveedores.sql`, `02-recetas.sql`, `03-existencias.sql` |
| `scripts/migration-pipeline/dry-run.ts` | MANUAL | `npx tsx dry-run.ts [--real]` | Solo valida, no escribe. Report en `dry-run-report.json` |
| `.github/scripts/wansoft_backfill.py` | GH ACTION | `wansoft-backfill.yml` con `start_date`/`end_date` | UPSERT directo a `wansoft_daily` |
| `.github/scripts/wansoft_inventory_sync.py` | GH ACTION | `wansoft-inventory.yml` (inferido) | UPSERT a `wansoft_data` |
| `.github/scripts/wansoft_inventory_scrape.py` | GH ACTION | `wansoft-inv-scrape.yml` | UPSERT a `wansoft_data` |
| `.github/scripts/wansoft_menu_sync.py` | GH ACTION | `wansoft-menu-sync.yml` | UPSERT a `wansoft_menu_config` |
| `agents/wansoft-explorer/run.py` | MANUAL | `python run.py` | Playwright crawl del portal |
| `agents/wansoft-explorer/gen_import_sql.py` | MANUAL | `python gen_import_sql.py` | Genera SQL desde specs/ |
| `agents/wansoft-explorer/backfill.py` | MANUAL | `python backfill.py` | Backfill de recetas |
| `agents/wansoft-explorer/reconcile_recipes.py` | MANUAL | manual | Reconcilia recetas con Wansoft |

---

## 6. Preguntas abiertas

1. ¿Qué escribe realmente el scraper Playwright (`wansoft-daily-mesero.yml`) a Supabase? No fue leído completamente — solo sabemos que hace scraping y parseo, no el destino exacto.
2. ¿La tabla `wansoft_data` tiene un schema formal? No aparece en `MANIFEST.json` como tabla independiente con estructura documentada.
3. ¿El campo `source_id` existe en alguna tabla productiva (`pos_suppliers`, `pos_recipes_old`, `pos_inventory_products`)? No encontrado en el DDL inspeccionado.
4. ¿Existe `deployment/CUTOVER-PLAYBOOK.md` (referenciado en el documento archivado)? No verificado.
5. ¿El pipeline dry-run fue ejecutado contra datos reales alguna vez? El `dry-run-report.json` muestra 2225 records, 1456 rechazados (65% de rechazo), lo que sugiere un problema de schema mismatch entre `wansoft_products.json` y lo que el validator espera. No está claro si fue resuelto.
6. ¿Cuántos registros hay actualmente en `wansoft_daily` (producción)? DESCONOCIDO sin acceso a la BD.
7. ¿Existe algún mecanismo para detectar datos de AMALAY vs otro cliente en las tablas `wansoft_*`? En `wansoft_daily` hay `client_slug`, pero no está claro en otras tablas del pipeline.
8. ¿La carpeta `scripts/sql/` contiene los SQL generados por `migrate-wansoft-to-supabase.py`? Los archivos `01-proveedores.sql`, `02-recetas.sql`, `03-existencias.sql` no están en git (gitignore o no generados).

---

## 7. Decisiones que requieren aprobación de Daniel

1. **¿Promover el pipeline TypeScript a productor real?** El pipeline `scripts/migration-pipeline/` está bien diseñado con validators y maps, pero solo corre en dry-run. Promoverlo requeriría agregar el writer (Supabase client). Decisión: ¿es este el motor principal o se descarta en favor del script SQL ad-hoc?
2. **¿Qué pasa con los 1456 records rechazados en el dry-run?** El 65% de rechazo indica que `wansoft_products.json` tiene un schema diferente al que los validators esperan. Antes de correr cualquier migración real, esto necesita resolverse.
3. **¿Agregar `source_id` a las tablas existentes?** Para tener provenance tracking se necesita agregar columnas a `pos_suppliers`, `pos_recipes_old`, `pos_inventory_products`. Esto requiere una migration SQL productiva.
4. **¿Multi-tenant desde el inicio?** El SQL generator tiene `CLIENT_ID = "amalay"` hardcoded (line 22). Antes de onboardear el segundo cliente, se necesita parámetrico.

---

## 8. Confirmación explícita: archivos CFG-01 no modificados

Los siguientes archivos no fueron modificados ni inspeccionados en detalle:
- `setup.html`
- `main.js`
- `bridge.js`
- `print-queue.js`
- `printer-config-schema.js`
- Cualquier módulo de routing o configuración de impresoras

Esta auditoría fue estrictamente read-only. No se modificó ningún archivo existente.

---

## 9. Estado Git antes y después

**Branch:** `worktree-agent-af68b5d917b66ff58`  
**Commit HEAD al inicio:** `cba779a` — `fix(offline): 4 CRITICAL gaps from audit — PIN timeout, turnoId cache, KDS idempotency, cash queue`  
**Archivos nuevos creados por esta auditoría:** Solo en `docs/migrations/` (7 documentos `.md`)  
**Archivos existentes modificados:** Ninguno  
**Archivos eliminados:** Ninguno
