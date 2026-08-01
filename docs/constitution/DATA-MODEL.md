# Data Model — Modelo de datos canónico

> Tablas core, invariantes de datos y relaciones. Fuente de verdad para el modelo de datos de Fullsite.
> Para el aislamiento multi-tenant (RLS, client_id), ver [`platform/TENANT-ISOLATION.md`](../platform/TENANT-ISOLATION.md).

---

## Invariantes absolutos

1. Toda tabla con datos de tenant tiene `client_id TEXT NOT NULL` con FK a `clients.id`.
2. Los IDs de órdenes son generados por el cliente (UUID v4) antes de llegar a la DB — nunca dependen de un sequence de la DB.
3. Las deducciones de inventario son idempotentes: enviar la misma orden dos veces no genera una segunda deducción.
4. `pos_turnos` es el contenedor de toda la operación del día. Nada existe fuera de un turno.
5. `pos_cierres` es inmutable una vez creado. El cierre es la verdad del día.

---

## Tablas core

### clients
Registro de cada restaurante/tenant.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | Slug del cliente: `amalay`, `vantara`, etc. |
| `name` | TEXT | Nombre del restaurante |
| `data_source` | TEXT | `wansoft` o `fullsite` — nunca los dos a la vez |
| `features` | JSONB | Features habilitadas por cliente |
| `config` | JSONB | Configuración por cliente |

### client_users
Source of truth para qué usuario pertenece a qué tenant.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | UUID FK auth.users | Usuario de Supabase Auth |
| `client_id` | TEXT FK clients | Tenant al que pertenece |
| `role` | TEXT | `owner`, `manager`, `cashier`, `waiter`, `kitchen` |

### pos_turnos
Contenedor de la operación. Un turno = un período de operación con apertura y cierre.

| Columna clave | Descripción |
|---|---|
| `id` | UUID generado por cliente |
| `client_id` | Tenant |
| `opened_at` | Timestamp de apertura |
| `closed_at` | Timestamp de cierre (NULL si abierto) |
| `opening_cash` | Efectivo declarado en apertura |
| `status` | `open`, `closed` |

### pos_orders
Una orden = lo que pidió una mesa. Cada ítem es un `pos_order_items`.

| Columna clave | Descripción |
|---|---|
| `id` | UUID generado por cliente |
| `turno_id` | FK pos_turnos |
| `table_number` | Número de mesa |
| `status` | `draft`, `sent`, `paid`, `cancelled` |
| `total_amount` | Total calculado |

### pos_cierres
Cierre formal del turno. Inmutable.

| Columna clave | Descripción |
|---|---|
| `turno_id` | FK pos_turnos (1:1) |
| `cash_declared` | Efectivo contado físicamente |
| `cash_expected` | Efectivo esperado por el sistema |
| `cash_difference` | Diferencia (puede ser negativa) |
| `authorized_by` | staff_id del gerente que autorizó |

### pos_inventory
Existencias por ingrediente/producto.

| Columna clave | Descripción |
|---|---|
| `product_id` | FK pos_recipes o producto directo |
| `quantity` | Existencias actuales |
| `unit` | Unidad de medida |

---

## Relaciones clave

```
clients
  └── client_users (N usuarios por cliente)
  └── pos_turnos (N turnos por cliente)
        └── pos_orders (N órdenes por turno)
              └── pos_order_items (N ítems por orden)
        └── pos_cierres (1 cierre por turno)
        └── pos_cash_movements (N movimientos de efectivo)
```

---

## Schema de migrations

El schema completo se aplica en orden desde `scripts/sql/sandbox/migrations/`:

1. `000_extensions_sandbox.sql` — pg extensions
2. `010_consolidated_core_sandbox.sql` — 75 tablas con client_id FKs
3. `003_rls_policies_sandbox.sql` — scaffold inicial de RLS
4. `004_functions_sandbox.sql` — 13 funciones POS (r1_save_order, activate_recipe_version, etc.)
5. `008_realtime_sandbox.sql` — Realtime en pos_inventory, pos_orders, pos_staff_shifts
6. `SKEL-04` (via apply_migration) — auth_client_id() + 13 políticas auth_tenant

---

## Tablas de agentes IA

| Tabla | Descripción |
|---|---|
| `agent_runs` | Log de ejecuciones (agent_id, status, duration_ms, tokens, tentacle) |
| `agent_messages` | Mensajería inter-agente (from_agent, to_agent, payload, read) |
| `agent_events` | Eventos detectados con estimated_value + outcome |

## Tablas de AMALAY (reservaciones y datos operativos)

| Tabla | Descripción |
|---|---|
| `amalay_reservaciones` | Reservaciones de eventos |
| `wansoft_daily` | Histórico diario de ventas (fuente para reportes históricos) |
| `wansoft_kpis` | Estado en tiempo real (fila única, actualizada continuamente) |
