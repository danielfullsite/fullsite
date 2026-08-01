# Clasificación de 62 Tablas sin Migration SQL

**Fecha:** 2026-07-21
**Objetivo:** Determinar qué conservar, consolidar, o eliminar antes de generar migrations.

---

## Resumen

| Clasificación | Count | Acción |
|---|---|---|
| **Core** — activamente usada, necesaria para operar | 22 | Generar migration |
| **Pipeline** — datos de Wansoft, no necesaria para cliente sin Wansoft | 14 | Generar migration con flag `source=wansoft` |
| **Legacy** — reemplazada o duplicada | 6 | Eliminar o consolidar |
| **Experimental** — schema existe pero sin uso real | 8 | Revisar, probablemente eliminar |
| **Temporal** — R1 observation, one-time use | 3 | Eliminar |
| **Infraestructura** — multi-tenant, auth, config | 4 | Generar migration (crítico) |
| **CRM/WhatsApp** — módulo independiente | 5 | Generar migration si se vende el módulo |

---

## Detalle por Tabla

### CORE — Generar migration (22 tablas)

| Tabla | Rows | SRC | PY | Estado | Necesaria cliente #2 | Nota |
|---|---|---|---|---|---|---|
| `pos_staff` | 41 | 24 | 4 | Core | ✅ Sí | Staff, PINs, roles. Altamente usada. |
| `pos_turnos` | 11 | 5 | 0 | Core | ✅ Sí | Turnos de caja. POS no opera sin esto. |
| `pos_cash_movements` | 0 | 4 | 0 | Core | ✅ Sí | Retiros/depósitos durante turno. |
| `pos_cfdi_requests` | 1 | 6 | 0 | Core | ✅ Sí | Solicitudes de factura. |
| `pos_attendance` | 7 | 6 | 0 | Core | ✅ Sí | Registro de asistencia staff. |
| `pos_staff_audit` | 0 | 1 | 0 | Core | ✅ Sí | Auditoría de cambios a staff. |
| `pos_gastos` | 0 | 1 | 0 | Core | ✅ Sí | Registro de gastos operativos. |
| `pos_item_modifier_groups` | ? | 1 | 0 | Core | ✅ Sí | Asignación modificador → platillo. |
| `pos_inventory_alerts` | 18 | 1 | 0 | Core | ✅ Sí | Alertas de stock bajo. |
| `agent_runs` | 5,127 | 10 | 41 | Core | ✅ Sí | Log de ejecución de todos los agentes. |
| `agent_results` | 772 | 19 | 21 | Core | ✅ Sí | Resultados de agentes (anomalías, costos). |
| `chat_logs` | 10 | 3 | 0 | Core | ✅ Sí | Historial de conversaciones Chat IA. |
| `delivery_orders` | 1 | 5 | 0 | Core | ⚠️ Si tiene delivery | Órdenes de Rappi/Uber. |
| `push_subscriptions` | 0 | 1 | 0 | Core | ✅ Sí | Notificaciones push. |
| `events` | 169 | 30 | 3 | Core | ✅ Sí | Event store (append-only). |
| `ops_daily` | 917 | 0 | 14 | Core | ✅ Sí | Métricas diarias operativas (agentes). |
| `credentials_vault` | 27 | 2 | 0 | Core | ✅ Sí | Credenciales encriptadas. |
| `reviews` | 5 | 2 | 0 | Core | ⚠️ Si tiene reseñas | Google reviews. |
| `pos_recipes` | 117 | 17 | 5 | Core | ✅ Sí | Vista flat de recetas (Wansoft import). Usada por chat y food cost. |
| `pos_insumos` | 400 | 1 | 2 | Core | ⚠️ Deprecar cuando cost engine sea canónico | Vista flat de insumos. Usada por chat. |
| `wansoft_daily` | 887+ | 22 | 26 | Core | ⚠️ Solo si viene de Wansoft | Histórico de ventas. Dashboard principal. |
| `wansoft_waiter_categories` | ? | 6 | 7 | Core | ⚠️ Solo Wansoft | Ventas por categoría por mesero. |

### INFRAESTRUCTURA — Generar migration, CRÍTICO (4 tablas)

| Tabla | Rows | SRC | PY | Necesaria cliente #2 | Nota |
|---|---|---|---|---|---|
| `clients` | 3 | 9 | 8 | ✅ CRÍTICO | Tabla maestra de clientes. 38 columnas. |
| `client_users` | 2 | 3 | 0 | ✅ CRÍTICO | Auth: user → client mapping. |
| `client_locations` | 1 | 3 | 1 | ✅ Sí | Sucursales por cliente. |
| `prospects` | 0 | 1 | 1 | ⚠️ Sales CRM | Pipeline de ventas. |

### PIPELINE WANSOFT — Generar migration con flag (14 tablas)

Solo necesarias para clientes que vienen de Wansoft. Cliente #2 sin Wansoft no las necesita.

| Tabla | Rows | PY | Nota |
|---|---|---|---|
| `wansoft_food_cost` | 1 | 7 | Food cost desde Wansoft scraper |
| `wansoft_hourly` | ? | 4 | Snapshots por hora |
| `wansoft_inventory` | 10 | 4 | Inventario snapshot |
| `wansoft_kpis` | 1 | 8 | KPIs en tiempo real |
| `wansoft_labor` | 10 | 2 | Horas trabajadas |
| `wansoft_persons_hourly` | 42 | 2 | Personas por hora |
| `wansoft_pnl` | 1 | 2 | Estado de resultados |
| `wansoft_recipes` | 574 | 2 | Recetas Wansoft (raw) |
| `wansoft_shrinkage` | 0 | 4 | Merma Wansoft |
| `wansoft_suppliers` | 42 | 6 | Proveedores Wansoft |
| `wansoft_tips` | 31 | 5 | Propinas Wansoft |
| `wansoft_catalog` | 212 | 0 | Catálogo Wansoft |
| `delivery_platform_payments` | 36 | 2 | Pagos de plataformas delivery |
| `calendar_sync_log` | 5,442 | 0 | Sync Google Calendar (legacy?) |

### LEGACY — Eliminar o consolidar (6 tablas)

| Tabla | Rows | Refs | Razón | Recomendación |
|---|---|---|---|---|
| `pos_clients` | 12,195 | 0 src, 0 py | Duplica `crm_clients` + `whatsapp_conversations`. Nadie la referencia en código. | **ELIMINAR** — 0 referencias |
| `agent_messages` | 0 | 0 src, 0 py | Inter-agent messaging. Nunca se usó. 0 filas. | **ELIMINAR** |
| `pos_promos` | 0 | 0 src, 0 py | Duplica `pos_promotions` (que SÍ tiene migration). 0 filas. | **ELIMINAR** |
| `pos_bridge_logs` | 0 | 0 src, 0 py | Print bridge logs. Nunca se usó. | **ELIMINAR** |
| `pos_recipe_details` | 51 | 1 src | Legacy recipe view. Reemplazada por `pos_recipes_old` + cost engine. | **DEPRECAR** — revisar el 1 archivo que la usa |
| `agent_insights` | 102 | 0 src, 1 py | Solo escrita por 1 agent. Nunca leída en dashboard. | **CONSOLIDAR** en `agent_results` |

### EXPERIMENTAL — Sin uso real (8 tablas)

| Tabla | Rows | Refs | Razón | Recomendación |
|---|---|---|---|---|
| `pos_price_types` | 0 | 0 | Schema vacío, nunca implementado. | **ELIMINAR** |
| `pos_retail_groups` | 0 | 0 | Retail module no existe. | **ELIMINAR** |
| `pos_retail_promotions` | 0 | 0 | Retail module no existe. | **ELIMINAR** |
| `pos_survey` | 0 | 0 | Encuestas nunca implementadas. | **ELIMINAR** |
| `pos_mutation_authority` | ? | 0 | R1 system internal. No referenced. | **REVISAR** — puede ser necesaria para R1 |
| `pos_fingerprint_templates` | 1 | 0 | Legacy fingerprint. WebAuthn lo reemplazó. | **ELIMINAR** si WebAuthn es suficiente |
| `parity_reports` | 22 | 0 | One-time parity check. No referenced. | **ELIMINAR** |
| `content` | 258 | 33 | CMS content. Altamente referenciada pero ¿se usa activamente? | **REVISAR** — 33 refs sugieren uso activo |

### TEMPORAL — One-time use, eliminar (3 tablas)

| Tabla | Rows | Nota | Recomendación |
|---|---|---|---|
| `r1_observation_baseline` | 1 | R1 pre-cutover baseline (Jul 2026). | **ELIMINAR** |
| `r1_observation_final` | 1 | R1 final comparison. | **ELIMINAR** |
| `r1_observation_log` | 49 | R1 observation period logs. | **ELIMINAR** |

### CRM / WHATSAPP — Módulo independiente (5 tablas)

| Tabla | Rows | Refs | Necesaria cliente #2 | Recomendación |
|---|---|---|---|---|
| `whatsapp_conversations` | 0 | 0 | Solo si tiene WhatsApp bot | **MANTENER** — schema listo |
| `whatsapp_messages_log` | 0 | 0 | Solo si tiene WhatsApp bot | **MANTENER** |
| `whatsapp_whitelist` | 2 | 0 | Solo si tiene WhatsApp bot | **MANTENER** |
| `memories` | 1,042 | 0 | IA memories (bot context) | **MANTENER** |
| `tasks` | 505 | 0 | Internal task tracking | **REVISAR** — ¿se usa? |

---

## Resumen de Acciones

| Acción | Tablas | Resultado |
|---|---|---|
| **Generar migration** | 22 Core + 4 Infra + 5 CRM = 31 | Base reproducible para cliente #2 |
| **Generar migration con flag Wansoft** | 14 Pipeline | Solo instalar si cliente viene de Wansoft |
| **Eliminar** | 6 Legacy + 8 Experimental + 3 Temporal + 2 Revisados = 19 | Base limpia, sin dead weight |
| **Mantener temporal** | pos_mutation_authority = 1 | Necesaria por SQL functions R1, eliminar cuando se deprecen |
| **Total** | 62 → 31 migrations + 14 opcionales + 1 temporal + 19 eliminar | |

---

## Revisión Completada (3 tablas pendientes → resueltas)

### `content` → **ELIMINAR**
- 258 filas, todas de abril 2026 (3 meses sin actividad)
- Contenido: posts de Instagram generados por IA, todos en `status=draft`
- Los "33 refs en src/" eran falsos positivos (la palabra "content" en `msg.content`, `Content-Type`, etc.)
- **0 queries reales** al tabla Supabase en todo el código
- Prototipo de CMS social media abandonado

### `pos_mutation_authority` → **MANTENER TEMPORALMENTE**
- 1 fila: `{client_id: 'amalay', sale_authority: 'r1'}`
- **2 funciones SQL** la referencian: `r1_reconcile_order`, `r1_legacy_sale_deduction`
- Estas funciones controlan el path de deducción de inventario en runtime
- Eliminarla rompe el POS (SELECT a tabla inexistente en cada orden)
- No afecta cliente #2 (las funciones R1 son específicas de transición Wansoft)
- Se elimina cuando se deprecen las funciones R1

### `tasks` → **ELIMINAR**
- 505 filas, todas de abril 2026, 503/505 en `status=pending`
- Tareas de marketing generadas por IA, nunca ejecutadas
- 0 referencias en código TypeScript o Python
- Mismo patrón que `content`: prototipo abandonado

### `tasks` (505 filas, 0 refs)
Internal task tracking. Si nadie la lee en código, probablemente es legacy de un sistema de tareas anterior. Revisar si las filas son históricas o activas.

### `wansoft_daily` — Inconsistencia `client_slug`
Esta tabla usa `client_slug` en vez de `client_id`. Es la tabla más referenciada (22 src + 26 py = 48 refs). Renombrar la columna es riesgoso sin actualizar todos los queries. Recomendación: crear un alias/view o agregar columna `client_id` como mirror.
