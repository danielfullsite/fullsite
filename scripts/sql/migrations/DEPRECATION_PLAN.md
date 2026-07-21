# Plan de Deprecación — 19 Tablas a Eliminar

**Status:** Plan documentado. NO ejecutar DROP sin aprobación explícita.

## Criterios de Borrado

Antes de eliminar cualquier tabla:
1. Verificar 0 referencias en código (src/ + .github/scripts/)
2. Verificar 0 queries en logs de Supabase (últimos 7 días)
3. Backup de datos si hay filas
4. DROP en staging primero, validar que nada rompe
5. DROP en producción

## Tablas a Eliminar

### Legacy (6)

| Tabla | Rows | Refs | Razón | Respaldo |
|---|---|---|---|---|
| pos_clients | 12,195 | 0 | Duplica crm_clients. 0 refs en todo el código. | Export JSON antes de DROP |
| agent_messages | 0 | 0 | Inter-agent messaging nunca implementado. | No necesario (0 filas) |
| pos_promos | 0 | 0 | Duplica pos_promotions. 0 filas, 0 refs. | No necesario |
| pos_bridge_logs | 0 | 0 | Print bridge logs nunca usados. | No necesario |
| pos_recipe_details | 51 | 1 | Reemplazada por pos_recipes_old + cost engine. | Export JSON |
| agent_insights | 102 | 1 py | Solo escrita por 1 agente, nunca leída en dashboard. | Export JSON |

### Experimental (8)

| Tabla | Rows | Refs | Razón | Respaldo |
|---|---|---|---|---|
| pos_price_types | 0 | 0 | Schema vacío, nunca implementado. | No necesario |
| pos_retail_groups | 0 | 0 | Retail module no existe. | No necesario |
| pos_retail_promotions | 0 | 0 | Retail module no existe. | No necesario |
| pos_survey | 0 | 0 | Encuestas nunca implementadas. | No necesario |
| pos_fingerprint_templates | 1 | 0 | WebAuthn lo reemplazó. | Export JSON |
| parity_reports | 22 | 0 | One-time parity check. | Export JSON |
| content | 258 | 0 | CMS social media abandonado (abril 2026). | Export JSON |
| tasks | 505 | 0 | Task manager abandonado (503/505 pending). | Export JSON |

### Temporal (3)

| Tabla | Rows | Refs | Razón | Respaldo |
|---|---|---|---|---|
| r1_observation_baseline | 1 | 0 | R1 pre-cutover one-time. | No necesario |
| r1_observation_final | 1 | 0 | R1 final comparison one-time. | No necesario |
| r1_observation_log | 49 | 0 | R1 observation logs. | No necesario |

### Legacy con datos (export antes de DROP)

| Tabla | Rows | Export path |
|---|---|---|
| pos_clients | 12,195 | `scripts/sql/backups/pos_clients_backup.json` |
| pos_recipe_details | 51 | `scripts/sql/backups/pos_recipe_details_backup.json` |
| agent_insights | 102 | `scripts/sql/backups/agent_insights_backup.json` |
| content | 258 | `scripts/sql/backups/content_backup.json` |
| tasks | 505 | `scripts/sql/backups/tasks_backup.json` |
| parity_reports | 22 | `scripts/sql/backups/parity_reports_backup.json` |
| pos_fingerprint_templates | 1 | `scripts/sql/backups/pos_fingerprint_templates_backup.json` |

## Ejecución (cuando se apruebe)

```sql
-- Step 1: Backup (run export script first)
-- Step 2: DROP tables with 0 filas (no backup needed)
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS pos_promos;
DROP TABLE IF EXISTS pos_bridge_logs;
DROP TABLE IF EXISTS pos_price_types;
DROP TABLE IF EXISTS pos_retail_groups;
DROP TABLE IF EXISTS pos_retail_promotions;
DROP TABLE IF EXISTS pos_survey;
DROP TABLE IF EXISTS r1_observation_baseline;
DROP TABLE IF EXISTS r1_observation_final;
DROP TABLE IF EXISTS r1_observation_log;

-- Step 3: DROP tables with datos (after backup export)
DROP TABLE IF EXISTS pos_clients;
DROP TABLE IF EXISTS pos_recipe_details;
DROP TABLE IF EXISTS agent_insights;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS parity_reports;
DROP TABLE IF EXISTS pos_fingerprint_templates;
```
