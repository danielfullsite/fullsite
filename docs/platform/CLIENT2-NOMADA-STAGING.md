# Client #2 — Café Nómada (staging) · deployment + evidencia E2E

Segundo restaurante sintético, **aislado de AMALAY**, provisionado con el flujo real del
producto sobre la BD de **staging** (no producción, no AMALAY).

## Acceso (sin secretos)

- **Staging Supabase:** `https://jkcnxfbbuyyfhwfjizgw.supabase.co` (proyecto `supabase-fullsite-staging`).
- **Tenant:** `client_id = nomada` ("Café Nómada", Monterrey, branding genérico Fullsite, accent `emerald`).
- **Login dashboard (staging-only, ficticio):** usuario `owner@nomada.staging`, rol `dueño`
  (`app_metadata.client_id=nomada` + fila en `client_users`). La contraseña es un credencial
  de prueba fijado durante el provisioning (no se commitea; disponible en el registro de provisioning).
- **PINs POS (staging-only, del seed):** Ana García 9001 (admin) · Carlos 1001 · Diana 1002 · Eduardo 1003.

## Provisionado con el flujo real (evidencia verificada 2026-08-10)

| Componente | Resultado |
|---|---|
| clients | Café Nómada (mesas=15, iva=0.16, features pos/kds/dashboard/staff/recipes/inventory) |
| Staff + roles + PINs | 4 (`pos_staff`) |
| Formas de pago | 4 (`pos_payment_methods`) |
| Menú (flujo import real) | 10 categorías + 40 ítems (`pos_menu_categories`/`pos_menu_items`) |
| Ingredientes | 20 (`pos_ingredients`) |
| Mesas (desde DB) | 15 (`pos_mesas`, zonas Salón/Terraza) |
| Usuario login | `owner@nomada.staging` |

Seeds canónicos: `scripts/seed/nomada/v1_*.sql` (client, staff, payment_methods, menu, ingredients).
Recetas (`v1_recipes.sql`) diferidas: FK a `pos_inventory` en staging (solo afecta food-cost, no el flujo POS).

## Recorrido E2E ejecutado (tablas reales del producto)

1. **Apertura de turno** — `pos_turnos`, abierto por Ana García, fondo inicial **$1,500**.
2. **Orden 1** (mesa 5, Carlos Méndez): 2 Cappuccino + Chilaquiles + Jugo Verde = **$290**.
3. **Envío a cocina / KDS** — `kds_item_status`: 6 ítems marcados `listo`.
4. **Orden 2** (mesa 9, Diana Torres): Latte + Tostada Aguacate + Cold Brew = **$220**.
5. **Cobro** — Orden 1 efectivo ($290, propina $30), Orden 2 tarjeta ($220, propina $25); ambas `cobrada`.
6. **Corte** — efectivo esperado = fondo 1500 + ventas efectivo 290 + propina efectivo 30 = **$1,820**; declarado 1820 → **diferencia $0.00**. Cerrado por Ana García.

Ventas del turno: **$510** (efectivo $290 + tarjeta $220).

## Aislamiento comprobado

- `amalay` en staging: **0** (AMALAY ni existe en esta BD).
- Fuga de órdenes nómada: **0** · Meseros AMALAY en staging: **0**.
- Otros 6 tenants en staging (vantara, stg_a, …) con sus propios datos, sin cruce.

## Reproducción (5 min, read-only)

Correr contra staging (MCP `supabase-fullsite-staging` o psql con service key de staging) el
bloque de verificación `scripts/onboarding/verify_nomada_e2e.sql` → confirma provisioning +
E2E + aislamiento en una sola consulta JSON.

## URL navegable + $510 visible en UI (2026-08-10) — RESUELTO

- **URL:** `http://localhost:3939` corriendo `dashboard-app` real vía
  `scripts/onboarding/run_dashboard_staging.sh` (fuerza staging jkcnxf, `.next` limpio,
  neutraliza service key de prod). Red verificada: **36 req a jkcnxf, 0 a qjiom**.
- **Login:** `owner@nomada.staging` → dashboard "Café Nómada — DEMO / DATOS SINTÉTICOS":
  **Ventas del día $510 · 2 órdenes · Carlos Méndez $290 · Diana Torres $220 · Propinas $55**.
  Captura: `scratchpad/nomada-14-final.png`. **0 "amalay" en toda la UI.**
- **RLS NO necesitó reparación:** jkcnxf ya tenía RLS correcta scoped por JWT/membresía
  (`private.user_has_client_access(client_id)` + `client_users`). Verificado: nómada autenticado
  lee sus 2 órdenes/$510, **cross-read=0**, cross-write bloqueado, anon denegado (403).
  Evidencia: `scripts/onboarding/verify_tenant_rls_nomada.sql`.
- **Causa raíz del $0 (app-layer, no RLS), corregida a nivel data/config reversible:**
  (1) `getDataSource()` default `wansoft` → el dashboard leía `wansoft_daily`; fix
  `localStorage.fullsite_data_source='fullsite'` (nómada es POS Fullsite). (2)
  `getDashboardFromPosOrders` filtra `status='cerrada'`; el E2E usó `'cobrada'` → fix data.
- **Gap de clonabilidad (follow-up, no bloquea):** AuthContext debería derivar
  `fullsite_data_source` de `clients.data_source` al login (nómada = `supabase`), para no
  depender de setear localStorage a mano. No se tocó código de producto en este sprint.

### Blocker histórico (resuelto arriba)

`staging.app.fullsite.mx` no responde y `sandbox.app.fullsite.mx` + `next dev` heredaban
`SUPABASE_URL/DATABASE_URL`=prod del shell (`~/.zshrc`), que preceden a `.env.local`, + `.next`
stale. El wrapper lo resuelve. **Acción para URL persistente:** preview de `dashboard-app` (Vercel) con
env de staging efectivo en el proxy server-side (o parametrizar `proxy.ts` por entorno) —
requiere acceso a `dashboard-app`/Vercel (restringido en esta sesión).
