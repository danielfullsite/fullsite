# Twin STOP CONDITION (run +62:36) — Root-Cause Analysis

**Verdict: two HARNESS false positives, NOT product defects. No P0. No data loss, no duplication.**

The digital-twin `full` run (spawn mode, canonical code) aborted at +62:36 with
`unsyncable + stuck-print`. Both were investigated against the Bridge's own
durable artifacts before any conclusion. The product behaved correctly in both.

## Condition 1 — `outbox_zero_after_drain` (unsyncable): FALSE POSITIVE

- Flagged: 1 command `c-kds-cocina-8zs-b4c862` (`KDS_ITEM_STATUS`) in a client
  outbox after drain.
- **Evidence it was applied exactly once server-side:**
  - Present in `events.ndjson` at sequence 11655 (exactly one occurrence).
  - Present in `processed-commands.ndjson` (dedup ledger) — exactly once.
- **Cause:** the command was emitted during the final injected network flap; the
  client was killed/reconnected before it observed the ACK, so its local outbox
  bookkeeping still held the entry. The data itself reached the Bridge, was
  applied once, and is dedup-protected.
- **Real-POS behavior:** a terminal persists its outbox and replays on reconnect;
  the Bridge returns `ACK{duplicate:true}` (id already in processed-commands) and
  the outbox clears with no new event. Zero loss, zero duplication.
- **Harness bug:** the invariant compared the client's ACK-observation snapshot at
  the drain boundary instead of reconciling against server truth.
- **Fix:** `outbox_zero_after_drain` now excludes commands present in the event
  log or processed-commands ledger (applied-exactly-once = synced, dedup-safe).
  The genuine failure — a command neither acked nor present server-side — still
  trips the stop condition.

## Condition 2 — `zero_stuck_print_jobs_file_view` (stuck-print): FALSE POSITIVE

- Flagged: print-queue file view `printed=3016, retrying=226` at the check moment.
- **Evidence:** the same `print-queue.json`, read after the retry loop finished,
  shows **`printed=3242, retrying=0`** — every one of the 226 retrying jobs
  completed. They were a transient backlog from the injected printer outages, not
  stuck.
- **Harness bug:** the check counted `retrying`/`pending` (transient,
  actively-progressing states) as "stuck" and evaluated only ~8 s after the
  final-flush restart — too soon for the retry backoff to clear a 226-job backlog.
  (The 4h soak drained fully precisely because its drain waited longer.)
- **Fix:** the check now waits for print-queue quiescence (transient count → 0, or
  no forward progress for 20 s, bounded at 120 s) before counting as permanently
  stuck only states that cannot self-progress: `printing` (crash-mid-print,
  PRR-04), `failed` (terminal), `recoverable` (awaiting health-restore).

## Why fixing the harness is correct here

These are `tests/twin` changes only — `electron-app` is untouched and the release
stays frozen. The fixes make the invariants measure the actual data-safety
properties (exactly-once server application; no permanently-stuck print) rather
than a client-side timing snapshot. Left unfixed, they would raise a false alarm
during Monday's physical run. No data problem was masked — the safety properties
were independently proven from the Bridge's own event log and dedup ledger.
