# 07 — Decisiones de Diseño — Fase 0

> Registradas: 2026-07-27  
> Autoridad: Daniel Ramonfaur (fundador)  
> Alcance: Decisiones que superseden o corrigen la propuesta inicial del roadmap (06-implementation-roadmap.md)  
> Estado: VIGENTES — aplican a todos los commits futuros del Migration Engine

---

## D-01 — Pipeline: TypeScript como base futura

**Decisión:** Promover el pipeline TypeScript (`scripts/migration-pipeline/`) como base del WansoftConnector.  
Congelar `scripts/migrate-wansoft-to-supabase.py` como evidencia legacy — no borrarlo, no ampliarlo como arquitectura.

**Transición aprobada:**
```
maps + validators actuales
→ WansoftConnector
→ raw snapshot
→ canonical mapping
→ validation
→ preview
→ commit engine
```

**Lo que no está aprobado:** Conectar el dry-run directamente a producción en ninguna fase actual.

**Impacto sobre 06-implementation-roadmap.md:**  
La Fase 2 que proponía "mover lógica de `wansoft_backfill.py` y `migrate-wansoft-to-supabase.py` al conector" queda restringida: el Python se congela, solo el TypeScript avanza.

---

## D-02 — Rechazo del 65%: diagnóstico determinista primero

**Decisión:** No usar fuzzy matching automático.

**Diagnóstico requerido:** Clasificar cada orphan reference en una de estas categorías:

| Categoría | Descripción |
|---|---|
| `exact_match` | El `ingredient_id` existe literalmente en el catálogo |
| `normalized_exact` | Match después de `toLowerCase().trim()` |
| `accent_insensitive` | Match después de normalizar diacríticos (ñ→n, é→e) |
| `punctuation_insensitive` | Match después de quitar `.`, `-`, `/` |
| `known_alias` | Alias registrado explícitamente en `maps/names.ts` |
| `single_fuzzy_candidate` | Un solo candidato con distancia de edición < umbral |
| `ambiguous_candidates` | Múltiples candidatos posibles |
| `no_candidate` | Ningún candidato encontrado |

**Regla de oro:** Fuzzy puede *sugerir*, nunca *aprobar* ni *modificar* automáticamente.

**Aclaración de cardinalidad pendiente (antes de avanzar):**  
El `dry-run-report.json` reporta `1,456/2,225 records rechazados`, pero datos externos indican 615 recetas y ~1,456 ingredientes. Antes del diagnóstico, documentar exactamente:
- ¿Qué es cada "record" en el denominador 2,225?
- ¿Es el numerador 1,456 ingredientes huérfanos o 1,456 recetas con al menos un ingrediente huérfano?
- ¿Cuántas recetas únicas están afectadas por al menos un orphan?

**Impacto sobre 06-implementation-roadmap.md:**  
La tarea T-05 queda reescrita: el entregable es el diagnóstico determinista con esta clasificación, no solo "analizar la causa".

---

## D-03 — Provenance: tablas externas, no columnas en tablas operativas

**Decisión:** No agregar `source_id`, `source_system` ni `migrated_at` directamente a:
- `pos_suppliers`
- `pos_inventory_products`
- `pos_recipes_old`
- ninguna otra tabla operativa

**Arquitectura aprobada — tablas independientes de provenance:**

```sql
migration_sessions          -- Una sesión por corrida del engine
migration_source_instances  -- Una fila por sistema fuente (Wansoft AMALAY, Wansoft Atope, etc.)
migration_source_bindings   -- Binding persistente source ↔ fullsite
migration_entity_events     -- Historial de eventos (extract, validate, map, write, rollback)
migration_raw_records       -- Snapshot raw preservado por entity + session
migration_write_journal     -- Registro de cada write a tabla productiva
```

**Binding mínimo requerido en `migration_source_bindings`:**
```
client_id
source_instance_id
source_entity        (e.g. "supplier", "recipe", "product")
source_id            (ID en el sistema origen)
fullsite_table       (e.g. "pos_suppliers")
fullsite_id          (UUID en Fullsite)
```

**Destino futuro de recetas:**  
`pos_recipes_old` **no** es el destino de recetas del Migration Engine.  
El modelo canónico de recetas apunta a `pos_recipe_versions` y `pos_recipe_lines`.

**Impacto sobre 06-implementation-roadmap.md:**  
La tarea T-01 ("ALTER TABLE pos_suppliers ADD COLUMN source_system...") queda cancelada y reemplazada por: "Diseñar y documentar las 6 tablas de provenance — primero documento y migration revisable, no deploy".

---

## D-04 — Multi-tenant: desde el primer commit del engine

**Decisión:** No "AMALAY primero, multi-tenant después". El engine es multi-tenant desde su primer commit.

**AMALAY puede usarse como:**
- Evidencia de comportamiento esperado
- Fixture anonimizado para tests
- Shadow comparison en staging

**AMALAY no puede usarse como:**
- Default hardcodeado en ningún parámetro
- Justificación para un branch o comportamiento AMALAY-específico
- Target de re-migración

**Orden aprobado:**
```
contratos multi-tenant
→ fixture AMALAY anonimizado
→ restaurante ficticio en local/staging
→ Generic CSV connector
→ shadow comparison de AMALAY
→ primer restaurante externo
```

**Impacto sobre 06-implementation-roadmap.md:**  
La Fase 1 que decía "hacer que el flujo de AMALAY sea correcto" queda reemplazada por el orden anterior. No existe una "Fase AMALAY" — existe la Fase de contratos multi-tenant.

---

## D-05 — Workstream de seguridad separado: SEC-DEPLOY-01

**Decisión:** El hallazgo R-15 (194 RLS policies ausentes del migration set) abre un workstream independiente.

Ver: `docs/migrations/SEC-DEPLOY-01-security-deployment.md`

**Restricción:** SEC-DEPLOY-01 no mezcla con el Migration Engine. No copiar ciegamente las policies actuales. No avanzar SEC-DEPLOY-01 en paralelo con cambios al engine — son workstreams aislados.

---

## Tareas pequeñas aprobadas (commits separados, sin cambios productivos)

| ID | Tarea | Restricción |
|---|---|---|
| MT-01 | `.env.example` para scripts de migración | Solo documentación |
| MT-02 | Parametrizar `client_id`, `branch_id`, `source_instance_id`, input/output y `dry_run` en el script Python | Solo script, no toca BD |
| MT-03 | Diagnóstico determinista del 65% de rejects con clasificación D-02 | Read-only sobre JSONs existentes |
| MT-04 | Corregir timezone: configuración del cliente vía `client_config.get_tz()`, no "Timezone MX" hardcoded | Solo script `.github/scripts/wansoft_backfill.py` |

**Próximo entregable aprobado:** MT-03 — diagnóstico del rechazo.  
No ejecutar cambios productivos hasta que MT-03 esté completo y revisado.
