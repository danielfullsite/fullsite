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

## Blocker de URL navegable (acción mínima)

No hay frontend desplegado apuntando a staging: `staging.app.fullsite.mx` no responde y
`sandbox.app.fullsite.mx` + el `next dev` local resuelven Supabase a **producción AMALAY**
(`qjiomlvudfmzuvqvhwpk`) por un target hardcodeado/proxy server-side (`proxy.ts`), ignorando
`NEXT_PUBLIC_SUPABASE_URL`. No se operó el producto contra prod.
**Acción mínima para URL navegable:** desplegar un preview de `dashboard-app` (Vercel) con
env de staging efectivo en el proxy server-side (o parametrizar `proxy.ts` por entorno) —
requiere acceso a `dashboard-app`/Vercel (restringido en esta sesión).
