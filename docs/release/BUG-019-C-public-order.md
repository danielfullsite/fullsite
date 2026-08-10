# BUG-019-C — Secure token-based public QR order creation

Customer scans a secure token QR → server resolves tenant → reprices everything → creates
one `abierta` order with **no kitchen side effects**. Staff review + the existing canonical
send do the rest. App only, no schema change, no Bridge, no PROD/DB/RLS change.

## Flow
`public_token → server resolves client_id + location_id + mesa → validate/reprice → INSERT
pos_orders status='abierta'`. The browser is authoritative for nothing trusted.

## What shipped
- `src/lib/public-order.ts` (server-only): `priceSubmission` (pure — validates items belong
  to the tenant, modifiers valid for the item, quantity bounds, reprices from
  `pos_menu_items.price` + `pos_modifiers.price`, IVA from the tenant's canonical
  `clients.iva_rate` resolved server-side; browser price/total never read); `createPublicOrder`
  (resolves token via Batch A/B `resolveTableByToken`, service_role reads, INSERT `abierta`).
- `src/app/api/public/qr-order/route.ts`: `POST` — rate-limit, 32KB body cap, generic errors,
  503 fail-closed if no service key, token never echoed.
- `src/__tests__/bug019-public-order.test.ts`.

## Idempotency (no new schema)
Order id is deterministic: `qr-<normalized submission_id>` (validated 32–64 hex). The `qr-`
prefix cannot collide with `gen_random_uuid()` order ids. INSERT uses PostgREST
`resolution=ignore-duplicates` (ON CONFLICT DO NOTHING) → a lost-response retry never creates
a second order and never overwrites a staff-edited/sent order; the existing order is returned.
Genuinely new submission → new id → new order. Does NOT reuse print/comanda idempotency.

## Zero side effects before staff send (certified)
The endpoint only INSERTs `pos_orders`. It does NOT call `r1_reconcile_order`, create
`comanda_batches` (stored `{}`), enqueue `pos_print_jobs`, POST Bridge `/events`, or mark
KDS-sent. `turno_id=NULL`; `mesero='QR'` is a review marker (the canonical staff send sets the
real waiter/turno). `order_revision=0`.

## Staff discovery / send
No new POS subsystem. An `abierta` order appears when staff opens the mesa (existing
hydration at pos/page.tsx: `status=in.(abierta,…)`), with `mesero='QR'` + `customer_name`
identifying it as a customer submission. Because status is `abierta`, items load as
un-sent → staff review/edit/reject via existing POS semantics, then the existing "Enviar a
Cocina" runs the canonical R1 → inventory → comanda_batch → printByStation (Batch E) → Bridge
ORDER_SENT → KDS. No second kitchen-send path was created. A floor-level QR badge is an
optional minimal follow-up (not required for visibility).

## Legacy numeric QR
Unchanged from Batch B: `/menu/[mesa]` is server-mediated **read-only menu**, no ordering, no
token exposure. Numeric table number never authorizes ordering.

## Certification
- Isolated PG16 DB cases (6): created `abierta`, turno NULL, revision 0, comanda_batches empty,
  zero print jobs; exact replay → one order + staff edit preserved; new submission → distinct
  order; replay after staff send → still one order, send state intact.
- Vitest 11/11 (repricing ignores injected price; canonical price wins; foreign modifier
  rejected; qty bounds; notes truncation; submission-id validation; abierta + no-side-effect
  writes only to pos_orders; idempotent replay returns existing; invalid token → generic 404).
- Full suite 46/46, tsc 0, eslint 0 errors, `next build` exit 0 (route emitted).

## Claim boundary
- **SECURE TOKEN-BASED PUBLIC ORDER CREATION: IMPLEMENTATION CERTIFIED.**
- NOT claimed: physical customer QR ordering live (needs secure token QRs generated/deployed/
  scanned + field cert); strict tenant RLS certified in prod (later gate).
