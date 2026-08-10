# BUG-019-E — Print-intent DB exactly-once

Gives kitchen/bar print jobs a semantic identity so one legitimate send yields exactly
one canonical DB row per destination, while additions, courses, station fan-out, retries
and audited reprints all remain correct. App + DB only. **Bridge untouched.**

## Canonical print intent
`(order_id, station, comanda_batch_id, reprint_seq)` for `type='comanda'`.
- `client_id` is NOT in the key: `pos_orders.id` is the global PK (prod: 1974 ids / 1974
  rows, 0 shared across `client_id`), so `order_id` already pins one tenant → no
  cross-tenant collision. `comanda_batch_id` is a per-send UUID.
- `reprint_seq = 0` automatic send (technical retries reuse it); `> 0` audited operator reprint.

## What shipped
- `scripts/sql/migrations/BUG-019-E-print-intent-identity.sql` — add `comanda_batch_id`,
  `reprint_seq int not null default 0`; partial unique index
  `(order_id, station, comanda_batch_id, reprint_seq) where type='comanda' and comanda_batch_id is not null`.
  Legacy NULL-batch rows stay valid and exempt. No historical backfill.
- `BUG-019-E-ROLLBACK.sql` — drop index + columns.
- `src/lib/print-queue.ts` — `comandaJobId()` deterministic id (`pjc-<order>-<station>-<batch>-<seq>`,
  collision-free from UUIDs); `enqueue` reuses it and de-dups locally; `syncJobToCloud`
  carries the columns and treats HTTP 409 (unique violation) as idempotent success;
  `nextReprintSeq()` + `enqueueComandaReprint()` for the audited reprint path.
- `src/lib/printer.ts` — `printByStation` stamps each station job with the send's `comanda_batch_id`.

## Race behavior
Concurrent writers of the same intent → same deterministic id → PK upsert merges; a
different id for the same tuple → unique index rejects (409) → interpreted as ALREADY
EXISTS / idempotent success. DB uniqueness is the final boundary; app prechecks are only UX.

## Reprint UX
No existing operator surface for **comanda** reprint (only ticket reprint via `window.print`).
Per scope, the underlying audited reprint path is implemented and certified
(`enqueueComandaReprint` → new row at `reprint_seq+1`; call site emits
`logAudit action='comanda_reprinted'`). **Visible UX deferred** — reported, not blocking.

## Certification (isolated PG16, REAL Batch E migration)
14 checks PASS: initial send (1/station), replay & double-fire → one row, reload same id,
stale second terminal, additions (new batch rows), fan-out, technical retry (same row,
seq unchanged), operator reprint (reprint_seq=1 new row), legacy NULL-batch valid,
cross-tenant no-collision, rollback+reapply. vitest 20/20, tsc 0, eslint clean (0 errors),
`next build` exit 0.

## Claim boundary
- **PRINT INTENT / DB EXACTLY-ONCE: CERTIFIED.**
- **PHYSICAL PRINT EXACTLY-ONCE: NOT CERTIFIED** — Bridge `/print` is fire-and-forget with
  no semantic dedup; a lost ACK after a successful physical print can still reprint on retry.

## BATCH E2 — Bridge physical dedup (future, DO NOT implement)
Make the Bridge `/print` path idempotent by the SAME canonical print-intent identity
`(order_id, station, comanda_batch_id, reprint_seq)`: the Bridge records processed intents
and drops a repeat, closing the lost-ACK physical-duplicate window. Reuse the identity from
this batch. **Only after** the frozen Offline field certification completes and the Electron/
Bridge release is deliberately reopened.
