# Client #2 — Synthetic Restaurant "La Costa Verde" (staging)

A fully isolated synthetic restaurant you can open and use like a real one, on hosted staging.
**Not production. Not AMALAY.** Staging Supabase `jkcnxfbbuyyfhwfjizgw` only.

## Open it

- **URL:** https://sandbox.app.fullsite.mx
- **Login (owner):** `owner@lacosta.sandbox` / `Costa#Verde2026`  *(synthetic demo credential)*
- **Staff PINs (inside the POS):** Dueño `1001` · Gerente `1002` · Cajero `1003` · Mesero `1004`
- **Tenant:** `lacosta` — "La Costa Verde — Cliente #2 (sintético)", Monterrey, IVA 16%, 6 mesas,
  7 platillos (Entradas / Platos Fuertes / Bebidas), 4 métodos de pago.

Access is safe: email/password for a synthetic tenant, no real secrets. The app build is guarded
with `SANDBOX_ENV=true` so it cannot point at AMALAY production.

## 5-minute walkthrough (reproducible)

1. Open https://sandbox.app.fullsite.mx and sign in with the owner credentials above. You land in
   **La Costa Verde** (sky theme). You only ever see this restaurant's data.
2. Go to **POS**. Enter a staff **PIN** (e.g. Mesero `1004`).
3. **Abrir turno** — set a fondo inicial (e.g. $1,000) and open the shift.
4. Pick **Mesa 3**, add **Ceviche de la casa** ×1 and **Limonada natural** ×2, **Enviar a Cocina**.
5. Open **/pos/kds** (KDS) in another tab — the order shows as sent to the kitchen.
6. Back in the order, **Cobrar** — pay **Efectivo**, add a **propina** ($30), print the receipt.
7. Go to **Corte** (CierreCajaWizard) and **cerrar el turno**. Totals reconcile
   (ventas $295.80, efectivo $295.80, propina $30, diferencia $0).
8. To prove isolation: there is no way to see or touch any other restaurant (`demo`, `vantara`,
   AMALAY). RLS denies cross-tenant reads and writes.

## Evidence — end-to-end flow (executed on hosted staging)

Driven through the **same `r1_save_order` RPC the app's `/api/pos/save-order` route uses** (order
revision reached 3 = three real saves), plus turno / print / cierre writes:

| Step | Result on `jkcnxfbbuyyfhwfjizgw` |
|---|---|
| Abrir turno | `pos_turnos` `lacosta-t1` — opened_by Ana Dueña, fondo_inicial $1,000 |
| Crear + enviar a KDS | `pos_orders` `lacosta-o1` mesa 3 → status **`enviada`**; comanda print job → `cocina` (done) |
| Cobrar | status **`cobrada`**, efectivo $295.80 + propina $30; receipt print job → `caja` (done) |
| Corte | order **`cerrada`** (revision 3); `pos_turnos` closed (fondo_final $1,325.80, efectivo_sistema $295.80, diferencia $0); `pos_cierres` `lacosta-c1` **sealed** (total_ventas $295.80, tickets 1) |

## Evidence — tenant isolation (real GoTrue JWT over PostgREST)

`scripts/client2/login_iso.mjs` signs in as the owner (real login) and queries with the authenticated JWT:

```
LOGIN ok — user=owner@lacosta.sandbox role=authenticated
menu_items visible: n=7 clientids=["lacosta"]
mesas visible: n=6 clientids=["lacosta"]
orders visible: n=1 clientids=["lacosta"]   turnos: n=1   cierres: n=1
CROSS vantara menu n=0 (want 0); CROSS demo orders n=0 (want 0)
CROSS-INSERT into demo: rows=0 err=new row violates row-level security policy  (blocked)
RESULT: login=true own_only=true isolated=true
```

The tenant sees and operates ONLY its own restaurant; every cross-tenant read is empty and every
cross-tenant write is blocked by RLS.

## Reproduce

Against staging `jkcnxfbbuyyfhwfjizgw` (via the `supabase-fullsite-staging` MCP or psql):
1. `scripts/client2/provision_lacosta.sql` — tenant, menu, mesas, staff, payment methods.
2. `scripts/client2/provision_lacosta_auth.sql` — owner GoTrue user + identity + membership.
3. `scripts/client2/flow_e2e.sql` — the turno→order→KDS→cobro→corte flow.
4. `node scripts/client2/login_iso.mjs` — real login + isolation checks (needs `@supabase/supabase-js`).

## What is CODE / TEST / FIELD VERIFIED

- **CODE VERIFIED** — the flow runs the real app code paths: `r1_save_order` (the RPC behind
  `/api/pos/save-order`), the BUG-019-C2 turno constraint, RLS tenant policies. Provisioning is
  scripted and idempotent.
- **TEST / HOSTED VERIFIED** — executed on the real hosted staging DB (`jkcnxfbbuyyfhwfjizgw`):
  turno→order→enviada(KDS)→cobrada→cerrada + sealed cierre (rows above); isolation via a **real
  GoTrue JWT** over PostgREST (login works; 0 cross reads; cross-insert RLS-blocked). Simulated
  printer = `pos_print_jobs` rows (`meta.simulated=true`); no physical Print Bridge needed.
- **FIELD VERIFIED (founder step)** — the ≤5-min UI walkthrough at https://sandbox.app.fullsite.mx.
  Login + tenant isolation are already field-proven above via the live GoTrue/PostgREST stack; the
  in-browser click-through of the POS screens is the remaining founder confirmation.

## Scope / boundaries

Staging only. AMALAY, production RLS, Bridge hardware, Offline, and `release/offline-field-2026-08-06`
are untouched. BUG-019 remains frozen (hosted-staging cert accepted; production decision pending).
