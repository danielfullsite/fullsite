# AMALAY Digital Twin — Rehearsal Harness

Evolution of `tests/soak/soak-harness.js` for the AMALAY digital-twin rehearsal.
Drives the **real Bridge** (`electron-app/local-server`) over the **real WS
protocol** with AMALAY-shaped traffic, verifies the founder's invariants from
the on-disk / REST event log replayed through the **real** `RestaurantState`,
and captures raw ESC/POS bytes from **five named fake printers** matching the
physical Jul-12 AMALAY topology:

| Twin printer | Port | Station(s) | Real device |
|---|---|---|---|
| `twin-cocina-1` | 19100 | `cocina` | cocina fría TCP 192.168.1.21:9100 |
| `twin-cocina-2` | 19101 | `cocina` | cocina caliente TCP 192.168.1.40:9100 |
| `twin-barra` | 19102 | `barra` | barra TCP 192.168.1.30:9100 |
| `twin-entrada` | 19103 | `tickets-entrada` | PDV3 local USB "TICKET" |
| `twin-caja` | 19104 | `tickets-caja`,`caja`,`tickets` | SERVER1 local USB "PANADERIA"/"EC01" |

Station `cocina` fans out to **both** cocina devices (array of 2, as in the
captured `printers.json`). Ticket/receipt jobs route to the printer **local to
the terminal that charges** (fixture `terminals[].ticket_station`). ESCONDITE
(PDV1) has **no working local ticket printer** — a known physical FAIL — so its
tickets fall back to SERVER1's `tickets-caja` station, with origin evidence.
The three POS carry AMALAY terminal identities (ENTRADA / ESCONDITE / CAJA):
every command payload records `terminal_id`/`terminal_alias` and every printed
ticket embeds `term=<alias>`.

Nothing in `electron-app/`, `dashboard-app/` or `tests/soak/` is modified.

## Files

| File | Purpose |
|---|---|
| `twin-harness.js` | Main harness: scenario engine, traffic, faults, invariants, report |
| `twin-server-runner.js` | Child-process entrypoint that boots the real local-server (spawn mode) |
| `twin-fixture.js` | Loads `amalay-twin-config.json` (canonical or rich AMALAY shape); labeled FALLBACK fixture if absent |
| `fake-printer.js` | Capturing fake ESC/POS TCP printer (raw bytes → evidence files) |
| `fingerprint-mock.js` | Fingerprint-service mock on 127.0.0.1:7718 (`/health /list /enroll /auth`) |
| `staging-mock.js` | Supabase REST mock for the bridge's `startSupabasePoll` (injectable latency/errors) |
| `amalay-twin-config.json` | AMALAY twin fixture (authored separately — see `AMALAY-CONFIG-PROVENANCE.md`) |
| `twin-evidence/` | Runtime artifacts (gitignored): printer bytes, report, logs, hooks |

## Running

### Spawn mode (Mac/CI smoke — bridge is a child process)

```bash
node tests/twin/twin-harness.js --phase smoke  --spawn
node tests/twin/twin-harness.js --phase shift  --spawn            # 4h-equivalent, default 6× compression
node tests/twin/twin-harness.js --phase shift  --spawn --compress 12
node tests/twin/twin-harness.js --phase accum7  --spawn
node tests/twin/twin-harness.js --phase accum30 --spawn
node tests/twin/twin-harness.js --phase full   --spawn            # smoke → shift → accum7 → drain → replay
```

Useful flags: `--port 17917` (bridge), `--data-dir <dir>`, `--keep-data`,
`--config <path>` (fixture), `--fp-port 7718`, `--staging-port 19200`.
Printer names/ports/stations come from the fixture `printers_config`
(`--printer-cocina-port`/`--printer-barra-port` remain as legacy overrides for
the first printer carrying that station).

### External mode (already-running Bridge, e.g. canonical installed app on a Windows runner)

```bash
node tests/twin/twin-harness.js --phase shift --external \
  --bridge-host 192.168.1.50 --bridge-port 7717
```

External-mode contract:

- The harness **never** kills the bridge process. Where spawn mode would
  SIGKILL, it writes a named hook file to
  `twin-evidence/orchestrator-hooks/NN-REQUEST-<NAME>.json` and waits
  (`--hook-timeout`, default 120 s) for the outer orchestrator to act.
  Restart completion is detected via `/health` (`uptime_s` reset with the same
  `server_id`; a **changed** `server_id` fails the config-persistence gate).
- Hooks emitted: `BRIDGE-RESTART-KILL`, `BRIDGE-RESTART-GRACEFUL`, `WAN-LOSS`,
  `CLOCK-SKEW`, `DISK-PRESSURE`, `FP-STATES`, `FINAL-FLUSH-RESTART`. The
  orchestrator acknowledges with the `ack_file` named inside each hook.
- Printer capture still works **if** the installed bridge's `printers.json`
  points its printers at this harness host's IP on the fixture ports
  (19100–19104).
- The harness refuses to run if the external bridge's `/health.restaurant_id`
  differs from the fixture (wrong-install protection).
- Verification uses `GET /events?since=0` instead of reading `events.ndjson`;
  file-based metrics (data-dir bytes, print-queue.json, processed-commands)
  are unavailable and marked as such.

## What each phase asserts

Every phase runs: the scenario suite (below), traffic, fault injection, drain,
a final-flush restart (spawn), then **all** invariant gates.

| Phase | Traffic | Faults | Notes |
|---|---|---|---|
| `smoke` | ≥100 orders, ~4.5 min paced | 2×SIGKILL, 1×graceful, both printer outages, client kill, flaps, tenant probes, fp 4 states, dedup probes | ~10–13 min wall time |
| `shift` | ~120 tickets over a 4 h AMALAY load curve compressed by `--compress` (default 6× → 40 min). Temporal ordering preserved (curve-sampled start times; per-mesa lifecycles sequential) | periodic kills/graceful/outages | volume derived from ~120 tickets/day AMALAY scale |
| `accum7` | ~840 tickets at burst rate ("offline" accumulation) | light | **accelerated-equivalent of 7 days** — never claims physical 7 days |
| `accum30` | ~3600 tickets | light | **accelerated-equivalent of 30 days** — never claims physical 30 days |
| `full` | smoke → shift → accum7 sequentially on one data dir, then one drain + replay | per phase | end-to-end rehearsal |

`accumN` measures event-log/data-dir growth and queue depths during
accumulation, then drains and verifies the whole log by replay. WAN-offline is
a documented **no-op** in spawn mode (the Phase-1 command path has no cloud
dependency; see Limitations).

## Invariant gates (founder's 13 → exit code)

Hard gates verified at end of run (STOP-class failures → `STOP-CONDITION.md`
+ **exit 2**; other failures → exit 1; all green → exit 0):

1. **0 lost orders** — every ACKed command appears in the event log exactly once; every order has exactly one terminal event.
2. **0 double-applied commands** — dedup probes must return `duplicate:true`; violations abort mid-run.
3. **0 duplicate ids** — event ids unique.
4. **0 invalid sequences** — unique, strictly increasing in log order.
5. **Outbox 0** after drain — no client-side unacked commands remain.
6. **0 permanently-stuck print jobs** — file view (spawn: `print-queue.json` has no printing/pending/retrying/failed/recoverable after final flush) **and** end-to-end view (every ACKed `PRINT_COMMAND`'s nonce found in captured printer bytes; waits one 60 s recovery cycle before judging). Duplicate physical prints after crash-replay are counted and reported (reprint-on-uncertainty is by design).
7. **Recovery after every crash** — every restart reached healthy + first ACK; recovery ms recorded per restart.
8. **Cortes consistent** — *adapted*: no corte command exists at protocol level, so the gate is payments-reconciliation: every `ORDER_CLOSED` has `sum(payments) === total === harness ledger`.
9. **POS/KDS state compatible** — full log replayed through the real `RestaurantState`: no exception, no open orders/KDS entries/locks, all mesas free, turno closed; KDS client caught up to last sequence.
10. **No wrong tenant** — every event's `restaurant_id` equals the fixture id; live probes: COMMAND with foreign tenant must be REJECTed, SUBSCRIBE with foreign tenant must be refused; any leak aborts immediately.
11. **PIN flow works without fingerprint** — PIN-carrying commands ACKed in all four fingerprint states (available / stopped / crash / 30 s timeout).
12. **Config persists across restart** — single `server_id` across all restarts; `printers.json` still valid v2 (spawn).
13. **Full sync after WAN return** — **not exercisable in Phase 1** (see Limitations); recorded as `n/a`, never silently passed.

## Scenario engine (founder 35-step flow at protocol level)

The protocol (`protocol.js`) has exactly 10 COMMAND types. Steps the protocol
supports are exercised for real; steps it does not support are recorded as
`NOT-EXERCISABLE-AT-PROTOCOL-LEVEL` with the owning layer — **never faked**:

| Exercised (PASS/FAIL) | Not exercisable at protocol level (owner) |
|---|---|
| cold start, discovery (/identity), turno open/close, mesa lock/unlock + conflict, multi-comensal order, multilevel modifiers (payload-opaque), partial kitchen send, add-after-send, **print routing 5 destinations** (cocina → COCINA-1 AND COCINA-2, barra → BARRA, ticket → the charging terminal's local printer; bytes verified), **escondite-ticket-fallback** (PDV1 sin impresora local → tickets-caja), KDS receive + two-step status maps, split payment, cancel w/ authorization fields, cash payment, multi-method + tip, dedup re-sends, **dedup-after-restart** (pre-crash ACKed ids re-sent after SIGKILL+restart → 0 re-applications), **concurrent-drains** (2 simultaneous drain cycles → no duplicated ACK-applications), **corte-print-outage** (corte print with its printer down → parked visibly, exits on recovery), **wan-offline-socket-window** (staging TCP listener closed → real ECONNREFUSED, LAN WS alive, drain on reopen), client kill + recover, bridge crash + recover, printer outage + recover, sync-inbound vs staging mock (SIMULATED-PARTIAL) | login-PIN (web app UI + fingerprint service), **revoked-staff-offline** (no staff surface in protocol.js — enforcement owner: web app UI pos-manager-auth + Supabase pos_staff; the Bridge ACKs revoked-staff commands opaquely), transfer mesa (web app UI; `ORDER_UPSERTED` mesa-change would leak the origin mesa — `state.js` never frees it), retiro/deposito (web app UI + Supabase), corte X computation (web app UI + Supabase), WAN loss in spawn mode (no cloud dependency in Phase-1 command path), clock skew + disk pressure (orchestrator/OS hooks emitted) |

## Fixture contract

See the header of `twin-fixture.js` for the canonical JSON contract. The loader
also accepts the **rich AMALAY shape** actually authored in
`amalay-twin-config.json` (`menu.categories`, `printers_config` v2,
`mesas.count`, `modifier_groups.groups`, `payment_methods` objects) and adapts
it. If the file is absent/invalid, a built-in fixture clearly labeled
`FALLBACK` is used and the report says so.

## Telemetry (`twin-evidence/twin-report.json`)

Memory initial/peak/final + kb/hour growth (spawn), event-log bytes + growth,
data-dir KB, outbox max, per-restart ready/first-ACK ms, drain duration,
command retries, duplicates absorbed, per-printer jobs/bytes/connections,
per-component error counts, full scenario table, and both sync-queue counters —
the `/health.sync_queue_size` value is recorded but **explicitly not trusted**
(in-memory, misleading across restarts); the file-truth count from
`events.ndjson` `synced` flags is authoritative.

Printer evidence: `twin-evidence/printer-<printer_id>-jobs/NNN.bin` +
`index.json` (`ts`/`len`/`sha256` + parsed `pn`/`origin_terminal`/`order`/`kind`
markers per job — per-printer bytes + origin + timestamp).

## Honest limitations

1. **No outbound cloud sync exists in Phase 1.** `markSynced()` has zero
   production callers; local events are never pushed to Supabase. "Full sync
   after WAN return" (founder gate 13) therefore cannot be exercised at any
   layer — the harness marks it `n/a` and the sync scenario covers only the
   **inbound** Supabase→bridge poll (labeled SIMULATED-PARTIAL). Owner:
   Phase-2 sync engine.
2. **Sync mock isolation.** The inbound poll's `STATE_SYNC` events wholesale
   replace mesa/KDS state (`core/state.js _applyStateSync`), so the staging
   mock is only ever pointed at a **dedicated** bridge instance
   (`--sync-port`), never the instance carrying twin traffic. Feasible with
   zero electron-app changes because `startSupabasePoll` takes
   `config.supabaseUrl/supabaseKey` from the spawn config.
3. **WAN loss is a no-op in spawn mode** — the Phase-1 command/ACK path is
   LAN-only. In external mode it is delegated to the orchestrator via hook.
4. **Clock skew / disk pressure** cannot be induced from a Node harness without
   endangering the host — orchestrator hook files are emitted with exact
   instructions instead.
5. **PIN verification is not a server feature.** The bridge records
   `authorized_by` / `*_pin_ok` fields opaquely; enforcement lives in the web
   app UI. The harness proves the *transport* keeps working without the
   fingerprint service, which is the protocol-level claim.
6. **mDNS is advertised but not independently browsed** — discovery is asserted
   via the `/identity` HTTP contract.
7. **accumN phases are accelerated equivalents** (same order volume/ordering,
   compressed time). They surface log-growth, replay-cost and queue behavior —
   not month-long OS-level effects (fragmentation, log rotation, RTC drift).
8. **External mode cannot read the bridge's disk** — file gates
   (print-queue.json, processed-commands.ndjson, data-dir size) run in spawn
   mode only; external verification uses `/events` + captured printer bytes +
   `/health` identity.
9. **Fingerprint mock binds 127.0.0.1:7718** (the bridge's hardcoded proxy
   target). If something else owns that port, fp scenarios are SKIPPED, not
   silently passed. In external mode the fp service lives on the bridge host
   and is orchestrator-owned.
