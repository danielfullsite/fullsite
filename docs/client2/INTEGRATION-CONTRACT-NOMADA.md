# Integration contract — Café Nómada live demo (for Claude 1 / public app)

Owner of the live data source: the canonical 24/7 generator. This is the minimal contract to read it.

## Tenant + demo access
- **client_id:** `nomada`
- **Project (Supabase):** `jkcnxfbbuyyfhwfjizgw` (dedicated demo project — NOT AMALAY `qjiomlvudfmzuvqvhwpk`).
- **Demo owner login:** `owner@nomada.staging` / `CafeNomada#2026` (GoTrue email/password; JWT-verified).
- Tenant resolved server-side from `client_users` (membership) + `auth.users.app_metadata.client_id='nomada'`. Never from a browser value.

## Config for the public app to read Nómada
- `NEXT_PUBLIC_SUPABASE_URL = https://jkcnxfbbuyyfhwfjizgw.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY254ZmJidXl5Zmh3Zmppemd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTM4NDUsImV4cCI6MjEwMDc4OTg0NX0.knHVqpjSG_IY0aqrYp7mU-FQD6frWn5xpSlzH5xOjws` (public anon key)
- **Auth model:** Supabase session (email/password) → user JWT → PostgREST `authenticated` RLS scopes every read/write to `nomada` via `private.user_has_client_access(client_id)`. **No service key in the browser/bundle/localStorage** — reads run under the JWT.

## Dashboard / business date / timezone — exact source
- **Data source:** `pos_orders` (live turno) + `pos_cierres` (closed business days). Both `client_id`-scoped by RLS. Do NOT read any parallel/aggregate table — none exists.
- **Timezone:** `clients.timezone = 'America/Monterrey'`.
- **Business date boundary:** `clients.business_day_start_local = '05:00:00'`.
- **Business date formula (canonical, used by generator AND must be used by UI):**
  `((created_at AT TIME ZONE 'America/Monterrey') - INTERVAL '5 hours')::date`

## Canonical figures (single source — reconciliation contract with Claude 3)
For business date `D` and `client_id='nomada'`, the ONE canonical definition each surface must use:
| Figure | Definition |
|---|---|
| **Ventas** | `sum(total)` where `status IN ('cobrada','cerrada')` and `business_date=D` |
| **Órdenes (completadas)** | `count(*)` where `status IN ('cobrada','cerrada')` and `business_date=D` |
| **Propinas** | `sum(propina)` where `status IN ('cobrada','cerrada')` and `business_date=D` |
| **En KDS (en curso, NO es venta)** | `count(*)` where `status='enviada'` — excluida de ventas |
| **Canceladas** | `status='cancelada'` — excluidas de ventas |
| **Corte por business date** | `pos_cierres.total_ventas` para `D` una vez sellado; **debe igualar** las Ventas del turno al cierre |

Rules: `enviada` is in-progress (not revenue). `cancelada` never counts. `cobrada`+`cerrada` = completed sale. There is no separate "generator number" — the generator only writes `pos_orders`/`pos_cierres`; the UI reads the same rows.

### Explicación del $510
$510 = **2 órdenes `cerrada`** del E2E inicial de Nómada (misma tabla `pos_orders`, mismo business date 08-09). Es un **subconjunto** de Ventas (cobrada+cerrada), no una cifra competidora. Si una UI muestra $510 sola, está filtrando a `status='cerrada'` únicamente; la cifra canónica de Ventas incluye `cobrada`+`cerrada`.

## Heartbeat + verificar que los datos nacen del mismo flujo
- **Heartbeat:** `select * from demo_generator_state where client_id='nomada'` → `status`, `runs`, `last_success_at`, `last_run_at`, `kill_switch`, `last_error`.
- **Scheduler:** pg_cron `nomada-generator` (`*/5`), `cron.job_run_details` muestra ciclos `succeeded`.
- **Provenance (canónico, no inyectado):**
  - todo `pos_orders.order_revision` no es null → pasó por `r1_save_order` (0 sin revision);
  - todo `pos_print_jobs.meta.simulated = true` (impresora simulada, sin hardware real);
  - `pos_cierres.snapshot->>'source' = 'demo-generator'`;
  - inventario: `r1_reconcile_order` canónico — **PARTIAL** (Nómada sin recetas → sin food cost fingido).
