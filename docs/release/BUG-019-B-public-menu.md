# BUG-019-B — Public menu, server-mediated

Replaces the browser-direct anon Supabase menu reads (and the insecure QR order INSERT)
on the public menu surface with a server-mediated path. No PROD/DB/RLS change here.

## What shipped
- `dashboard-app/src/lib/public-menu.ts` — server-only. Token resolver (`resolveTableByToken`,
  fail-closed), legacy resolver (`resolveLegacyTable`, tenant from deployment config + mesa
  number, isolated as LEGACY), `getPublicMenu` (service_role, tenant-scoped reads),
  `shapePublicMenu` (pure; returns only public fields).
- `dashboard-app/src/app/api/public/menu/route.ts` — `GET /api/public/menu?token=…`. Generic
  404 for any unresolved/malformed/inactive/location-less token; 503 fail-closed if service
  key missing; token never echoed to body/headers/logs; in-memory IP rate-limit (defense-in-depth).
- `dashboard-app/src/app/menu/[mesa]/page.tsx` — now a **server component** (LEGACY numeric QR,
  MENU READ ONLY). Resolves tenant server-side; no localStorage, no browser client_id, no token
  exposure, no redirect, no ordering.
- `dashboard-app/src/app/menu/[mesa]/MenuView.tsx` — read-only client view (menu data only).
- `docs/release/BUG-019-tenant-rls-fix.sql` — future RLS migration adjusted: `get_public_menu`
  is no longer granted to anon and is dropped (public menu is served server-side). Zero anon DB
  surface. **Not executed anywhere.**

## Security properties
- Browser cannot choose client_id/location_id (token- or config-resolved server-side).
- `SUPABASE_SERVICE_KEY` is server-only (never `NEXT_PUBLIC_*`, never in the client bundle).
- Response excludes recipe_ref/barcode/aplica_*/cost/margin/client_id (contract-tested).
- Legacy numeric route exposes menu only — no ordering authority, no token serialized.

## Legacy ordering after B
The prior browser-direct INSERT to `pos_orders` from `/menu/[mesa]` is **removed**. The legacy
numeric route is menu-read-only ("Para ordenar, pide a tu mesero"). Secure QR ordering is Batch C.

## Certification
- Isolated PostgreSQL 16, exact prod DDL for touched objects; the REAL Batch A migration+backfill
  introduce the token columns. 8/8 DB cases: token resolve, wrong/inactive/null-location →0,
  cross-tenant isolation, recipe_ref excluded, legacy resolve, modifier link.
- Vitest 13/13 (contract: no sensitive field leaks; token format guard; no-network on junk;
  503 fail-closed, no anon fallback). tsc 0, eslint clean, `next build` exit 0 (routes emitted).
