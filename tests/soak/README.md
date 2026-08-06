# POS Bridge Soak-Test Harness

Long-running soak test for the Local Server (`electron-app/local-server`). Boots the
**real server** as a child process with an isolated temp data dir and a non-default
port, drives it with simulated restaurant traffic over the real WS protocol, injects
faults, and verifies **zero data loss and zero duplicates** from the on-disk artifacts.

## Run

```bash
# 4-hour soak
node tests/soak/soak-harness.js --minutes 240

# 5-minute smoke (fault intervals compress automatically for runs < 30 min)
node tests/soak/soak-harness.js --minutes 5
```

Options: `--port <n>` (default 17817), `--printer-port <n>` (default 17919),
`--data-dir <path>` (default: fresh `fullsite-soak-*` temp dir), `--keep-data`.

Outputs (all in `tests/soak/`, overwritten per run):
- `soak-report.json` — machine-readable metrics + verification verdict (updated every 30 s during the run)
- `soak-progress.log` — one progress line per minute + fault/recovery events
- `soak-server.log` — child server stdout/stderr across all restarts

Exit code **0 only if every invariant holds**.

## What it simulates

- **3 terminals** over the real WS protocol (SUBSCRIBE / SNAPSHOT / COMMAND / ACK /
  REJECT / DELTA): 2 POS + 1 KDS.
- **Order lifecycle** per order (all real command types from `core/command-handler.js`):
  `MESA_LOCK` → `ORDER_UPSERTED` (items + modificadores) → optional re-upsert →
  `MESA_UNLOCK` → `ORDER_SENT` → `PRINT_COMMAND` (comanda) → KDS `KDS_ITEM_STATUS`
  (mark-ready) → `ORDER_CLOSED` with payment (+ `PRINT_COMMAND` receipt), ~10%
  `ORDER_CANCELLED` with authorization fields, ~12% split payment. `TURNO_OPENED`/
  `TURNO_CLOSED` bracket the run.
- **Real printing path**: `PRINT_COMMAND` drives the printer adapter + persistent
  print queue against a fake ESC/POS TCP printer run by the harness.
- **Fault injection** (compressed proportionally when duration < 30 min):
  - SIGKILL + restart (crash) every ~20 min
  - SIGTERM + restart (graceful) every ~30 min
  - random WS network flaps per client (hard socket terminate)
  - fake-printer outages (ECONNREFUSED → recoverable-job path)
  - while the server is down, clients **keep generating commands locally** and replay
    them on reconnect **with the same `command_id`s**, so server-side dedup
    (`processed-commands.ndjson`) is exercised as designed. Deliberate re-sends of
    already-ACKed commands ("dedup probes") additionally assert `ACK{duplicate:true}`.

## What it asserts (end-of-run verification)

1. `events.ndjson`: all lines parseable; **zero duplicate event ids**, zero duplicate
   sequences, sequences strictly increasing.
2. **Zero loss**: every command the server ACKed appears **exactly once** in the log;
   after the drain phase no command remains unACKed; no phantom events.
3. Every created order has **exactly one** terminal event (`ORDER_CLOSED` or
   `ORDER_CANCELLED`).
4. Full log **replays through the real `RestaurantState`** (as in `state.test.js`)
   without error, ending with: no open orders, empty KDS queue, all mesas `libre`,
   no locks, turno closed.
5. `processed-commands.ndjson` has no duplicate idempotency keys.
6. `print-queue.json` has **no stuck `printing` jobs** (leftover `recoverable` /
   `retrying` jobs are reported as warnings, not failures).
7. Dedup was actually exercised (duplicate ACKs observed) and never violated.
8. ≥2 SIGKILL cycles and ≥1 graceful restart occurred (for runs ≥ 4 min); ≥10 orders.
9. Recovery time (spawn → first successful ACK) recorded per restart; server RSS
   sampled every 15 s.

## Known limitations

- **Split payments** are simulated at the payload level (`ORDER_CLOSED` with a
  `payments: [...]` array). The protocol has no dedicated split/partial-payment
  command; the server treats command payloads as opaque, so this exercises
  persistence, not split-specific server logic.
- **Printing** is exercised via `PRINT_COMMAND` → printer adapter → print queue →
  fake TCP printer. Real ESC/POS hardware behavior (paper-out, USB spooler paths,
  drawer kick) is not simulated; `windows`/`usb` connection types are untested here.
- Supabase sync, mDNS discovery by real tablets, fleet heartbeat and the updater are
  inert (no credentials / no consumers) — the soak covers the local event-sourcing
  core, not cloud sync.
- Clients run in the harness process on localhost: real network latency, packet loss
  (vs. clean disconnects), and multi-machine clock skew are not modeled.
- KDS mark-ready is best-effort (an order may close before the KDS marks it), which
  matches how the state machine tolerates late `KDS_ITEM_STATUS` events.
