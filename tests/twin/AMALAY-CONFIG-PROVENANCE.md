# AMALAY Twin Config — Provenance

> Companion to `tests/twin/amalay-twin-config.json`.
> Rule: every fixture field appears in **exactly one** of the three blocks below.
> Nothing here was invented silently — anything not sourced verbatim is in INFERRED (with basis) or UNKNOWN.
> Sanitization applied: staff surnames reduced to initials, PINs synthetic, no phones, no biometrics, tenant id is `amalay-twin` (never `amalay`).

---

## 1. KNOWN AMALAY CONFIG (fact, with repo source)

| Fixture field | Value | Source (file:line) |
|---|---|---|
| tenant/client id (real) | `amalay` | `scripts/manifests/amalay.json:3`; `docs/customers/amalay/DEPLOYMENT-STATE.md:20` |
| display_name | AMALAY Coffee & Market | `scripts/manifests/amalay.json:4` |
| branch (single, Plaza Duendes, SPGG) | Plaza Duendes, San Pedro Garza García | `scripts/manifests/amalay.json:6,34,63` |
| timezone | America/Monterrey | `scripts/manifests/amalay.json:7` |
| iva_rate | 0.16 (prices include IVA — POS uses IVA_RATE=0 for add-on) | `scripts/manifests/amalay.json:31`; `dashboard-app/src/lib/pos-constants.ts:3-5` |
| receipt_footer | "Gracias por tu visita!" | `scripts/manifests/amalay.json:32` |
| accent_color | emerald | `scripts/manifests/amalay.json:28` |
| Terminal names | SERVER1 = "CAJA", PDV3 = "ENTRADA", PDV1 = "ESCONDITE" | `docs/customers/amalay/FIELD-NOTES-PREFLIGHT-JUL12.md:37,64,86`; `docs/agent-os/field/THURSDAY-RUNBOOK.md:3` |
| SERVER1 runs the Bridge / local server; PDV3 is a POS terminal | Thursday cert targets exactly these two | `docs/agent-os/field/THURSDAY-RUNBOOK.md:3,46` |
| Terminal config format (fixture `terminals[]`) | config_version 1; roles `server_pos|pos|kds|admin`; port 7717; protocol 1.0 | `electron-app/local-server/config-schema.js:7-31` |
| Local server port 7717 (+7718 checked by diagnostic) | — | `electron-app/local-server/config-schema.js:19`; `docs/agent-os/field/FULLSITE-DIAGNOSTIC/README.txt:18` |
| mDNS service `_fullsite-pos._tcp` | — | `electron-app/local-server/discovery/mdns.js:42` |
| `/health` (lan_ip, clients_connected) and `/state` (sequence) endpoints | — | `docs/agent-os/field/THURSDAY-RUNBOOK.md:33,272,278,324` |
| Stations: cocina / barra / caja (+tickets as print station) | — | `scripts/manifests/amalay.json:45-60`; `docs/customers/amalay/FIELD-NOTES-PREFLIGHT-JUL12.md:41` |
| Real printer topology (documented, NOT used as twin hosts) | cocina fría TCP 192.168.1.21:9100; cocina caliente TCP 192.168.1.40:9100; barra TCP 192.168.1.30:9100; caja/tickets USB "PANADERIA" (SERVER1), USB "TICKET" (PDV3), "EC01"/"EC TICKET"; default station `tickets` | `docs/customers/amalay/FIELD-NOTES-PREFLIGHT-JUL12.md:41,68,90`; `docs/customers/amalay/MANUAL-OPERATIVO.md:134-136` |
| Printer config v2 format (fixture `printers_config`) | `{schema_version:2, printers:[{printer_id,name,enabled,connection,station_ids,document_types,copies,encoding}], routing:{default_station}}`; tcp requires host+port; encodings cp850/cp858/utf-8; document types kitchen_ticket/bar_ticket/receipt/pre_ticket/invoice/corte/reprint | `electron-app/local-server/adapters/printer-config-schema.js:20-53,102-201` |
| ESC/POS over Bridge; v1 printers.json at C:\fullsite auto-migrates to v2 | — | `docs/customers/amalay/MANUAL-OPERATIVO.md:74`; `printer-config-schema.js:12-14` |
| role_hierarchy | mesero 1, cajero 2, capitan 3, gerente 4, admin 5 (unknown → 0, fail-safe) | `dashboard-app/src/lib/pos-manager-auth.ts:66-72` |
| permission_model | 50+ granular permissions per role in PERMISSION_PROFILES; manager PIN for descuentos/cierre/reabrir | `dashboard-app/src/lib/pos-permissions.ts:7,81`; `docs/customers/amalay/MANUAL-OPERATIVO.md:77,159,209` |
| Staff first names (roster basis; surnames sanitized in fixture) | Omar Aguilera, Hector Enrique R.L., Brayan B.S., Daniela Edith R.S., Julio Cesar H.H., Mauricio R.R., Oscar R.A., Alexis Alejandro O.V., Aldo R.R., Mariana Carolina S.A., Mario G.R., MESERO EVENTO | `/Users/danielrg/fullsite/CLAUDE.md` (Meseros activos); `scripts/manifests/amalay.json:65` |
| Eduardo (Esquivel) is the operational contact, trained on apertura/cierre | — | `docs/customers/amalay/DEPLOYMENT-STATE.md:18,78` |
| pos_staff row shape (staff fixture format) | `{client_id, name, pin, role, role_display, active}` | `scripts/seed/nomada/v1_staff.sql:5` |
| mesas count | 16 | `scripts/manifests/amalay.json:30` |
| mesas features | merge, cuentas por nombre, mis-mesas, alerta +90min; mesa is numeric in audit | `docs/customers/amalay/MANUAL-OPERATIVO.md:66`; `pos-data.ts:1587` |
| Menu categories + 84 items with real prices | MENU_CATEGORIES static AMALAY menu (verbatim) | `dashboard-app/src/lib/pos-data.ts:827-991` |
| Full catalog certified vs Wansoft | "Precios 509/509 match Wansoft PASS 2026-06-27" | `docs/customers/amalay/MANUAL-OPERATIVO.md:352` |
| Wansoft group names (29) | ventas_por_grupo list | `/Users/danielrg/fullsite/CLAUDE.md` (Categorías de menú) |
| Modifier multinivel schema | `pos_modifier_groups {level, min_selections, max_selections, required}` ordered `level.asc`; item-level + category-level assignment tables | `dashboard-app/src/lib/pos-data.ts:522-546,631-634` |
| Modifier contents (names/prices) | MODIFIERS_QUITAR / AGREGAR_FOOD / AGREGAR_COFFEE / AGREGAR_DRINKS; category mapping "validated against AMALAY categories (June 2026)" | `dashboard-app/src/lib/pos-data.ts:200-266` |
| No-modifier categories | sodas, cerveza, vinos, licores (+bakery/toast/postres get no food extras) | `dashboard-app/src/lib/pos-data.ts:239-241` |
| routing_rules category→station map | manifest `station_routing` (cocina 23 cats, barra 12, caja 7) — mirrors STATION_CATEGORIES | `scripts/manifests/amalay.json:45-60`; `pos-constants.ts:90-108` |
| routing fallback chain | `resolveItemStation`: item.station ('bar'→'barra') → CATEGORY_TO_STATION → DB category-name keywords → BEBIDA_KEYWORDS → CAJA_KEYWORDS → cocina | `dashboard-app/src/lib/pos-constants.ts:158-216` |
| Routing certified | "Routing 38/40 grupos PASS" | `docs/customers/amalay/MANUAL-OPERATIVO.md:353` |
| payment_methods (5 real) | Tarjeta de crédito, Tarjeta de débito, Efectivo, Transferencia electrónica, Ubereats | `/Users/danielrg/fullsite/CLAUDE.md` (Métodos de pago / pago_metodos) |
| POS UI payment buttons | efectivo, tarjeta, transferencia, mixto | `dashboard-app/src/lib/pos-constants.ts:226-231` |
| Card terminal standalone (not integrated to cobro flow) | Getnet standalone (Jun 30 doc) / Mercado Pago Point (Jul 31 doc — later; MP recovery CERTIFIED P0-2) | `docs/customers/amalay/MANUAL-OPERATIVO.md:164,274`; `DEPLOYMENT-STATE.md:36,48` |
| caja.turno open | `openTurno(fondoInicial, openedBy)` → pos_turnos | `dashboard-app/src/lib/pos-data.ts:471-480` |
| caja.turno close | CierreCajaWizard 4 pasos (billetes, monedas, resumen+diferencia, PIN gerente) → pos_cierres | `docs/customers/amalay/MANUAL-OPERATIVO.md:203-214` |
| caja.cortes | Corte X parcial, corte por turno, corte por día; **Corte Z formal NO existe** (DT-17) | `docs/customers/amalay/MANUAL-OPERATIVO.md:193-199,261` |
| cash_movements | audit actions `cash_retiro`/`cash_deposito`; IDB v3 has turnos + cash_movements stores | `dashboard-app/src/lib/pos-data.ts:1571-1572`; `DEPLOYMENT-STATE.md:90` |
| drawer behavior | abre con efectivo, no con tarjeta; conectado a impresora de tickets | `docs/customers/amalay/MANUAL-OPERATIVO.md:161,372`; `DEPLOYMENT-STATE.md:35` |

## 2. INFERRED AMALAY CONFIG (reasoned, with basis)

| Fixture field | Value | Basis |
|---|---|---|
| `restaurantId: "amalay-twin"` | synthetic | Deliberate tenant isolation per twin harness rules — real id is `amalay` (KNOWN). |
| `terminals[].terminal_id` / `provisioned_at` / `channel: development` / `instance_name` | synthetic | Real terminal UUIDs live only in each machine's config.json (never committed). Format follows `config-schema.js` required fields so `validate()` passes. |
| PDV3 role `pos`, SERVER1 role `server_pos` + `kds:true` | inferred | THURSDAY-RUNBOOK.md:3 ("PDV3 terminal POS, SERVER1 Bridge/Local Server"); `kds` flag exists for server_pos (config-schema.js:26); AMALAY has a cocina KDS (MANUAL-OPERATIVO.md:65, DEPLOYMENT-STATE.md:31). Actual on-disk roles unverified until diagnostic. |
| `printers_config` hosts `127.0.0.1:19100/19101`, ids `twin-cocina`/`twin-barra`, 2 printers only | synthetic twin overrides | Harness requirement (local mock listeners). Real topology is KNOWN (3+ physical printers incl. cocina fría/caliente array). Twin folds caja/tickets/receipt docs onto the barra mock — basis: PDV1 field notes show caja+tickets can point at one target (FIELD-NOTES:90). |
| `encoding: cp850`, `copies: 1`, `default_station: tickets` | defaults | cp850/copies=1 are the v1→v2 migration defaults (`printer-config-schema.js:243-245`); `default: "tickets"` is verbatim in all three real printers.json (KNOWN) — carried into twin routing. |
| Staff sanitized names ("Omar A." etc.) | derived | Real first names from CLAUDE.md roster (KNOWN); surnames reduced to initials per sanitization rule. |
| Eduardo E. as `gerente`; Cajero Twin (`cajero`) and Admin Twin (`admin`) | inferred/synthetic | Eduardo is the trained operational contact for apertura/cierre (DEPLOYMENT-STATE.md:78) → gerente is the reasonable role; no repo doc states his pos_staff role. Cajero/Admin rows are synthetic so the twin can exercise every ROLE_HIERARCHY level. No `capitan` row: no evidence AMALAY uses one. |
| All meseros role `mesero` | inferred | CLAUDE.md labels them "Meseros activos"; per-person real roles unverified ("Staff 36/40 match", MANUAL-OPERATIVO.md:354 — actual pos_staff rows live in production DB). |
| PINs (1001–1012, 2001, 9001, 9999) | synthetic | Pattern copied from staging seed convention (`scripts/seed/nomada/v1_staff.sql`). Real PINs never appear in repo and must never be used. |
| mesas naming "numeric 1-16" | inferred | Count 16 is KNOWN (manifest); audit log stores `mesa` as number (pos-data.ts:1587). No named-planogram data found in repo. |
| Modifier `groups[]` (Quitar level 1, Extras* level 2, min/max/required values) | inferred structuring | Multinivel schema is KNOWN; real AMALAY `pos_modifier_groups` rows live only in production DB. Groups constructed from repo static modifier arrays (contents KNOWN, pos-data.ts:200-228) arranged per the level-ordered schema. Visit 2 note "ajuste de modificadores (combos)" (DEPLOYMENT-STATE.md:84) means production groups have drifted from these defaults. |
| `payment_methods[].type` / `opens_drawer` flags | inferred | Type taxonomy from `scripts/seed/nomada/v1_payment_methods.sql` (cash/card/transfer); drawer-on-cash is KNOWN behavior; method names themselves are KNOWN. |
| `fondo_inicial_twin_default: 2000.00` | synthetic | openTurno requires a fondo (KNOWN mechanism); no real fondo amount documented in repo. Placeholder for rehearsal only. |
| menu `station` per category | derived | Join of KNOWN category ids with KNOWN manifest station_routing — the join itself is mechanical, not documented per-item. |
| `item_count: 84` | derived | Count of priced items in the static repo menu; real production catalog is 509 items (KNOWN count, items not in repo — market items are price 0 in repo and excluded). |

## 3. UNKNOWN UNTIL FIELD DIAGNOSTIC (Monday must capture)

1. **Real SERVER1 LAN IP** — runbook only lists candidates 192.168.1.71 / 192.168.0.71 / 192.168.1.1; confirm via `/health.lan_ip` (THURSDAY-RUNBOOK.md:324).
2. **Deployment type per machine** — docs conflict: Windows Electron + C:\fullsite bridge.js (FIELD-NOTES Jul 12) vs "Tablet + Chrome at app.fullsite.mx" (DEPLOYMENT-STATE Jul 31). Which stack is actually serving production today, per terminal? (Diagnostic README captures DEPLOYMENT TYPE / EXECUTABLE.)
3. **Installed version / EXE + app.asar hashes per terminal** — vs CAJA-KNOWN-GOOD artifact (commit 2932000, EXE SHA-256 c6ccd31c…, FIELD-NOTES:11-16). PDV3 had an *older* build on Jul 12 (DEBRIEF-JUL12.md:56).
4. **Fingerprint enrollment state** — huellas de Eduardo y meseros were pending (FIELD-NOTES:145); which staff are enrolled, and does the reader auto-restart patch hold? (Never copy biometric data — diagnostic explicitly excludes .dat/.bio/.fp/.fng.)
5. **Actual terminal count in operation** — SERVER1 + PDV3 + PDV1(Escondite)? Plus KDS tablets in cocina/barra? Is PDV1's ticket printing still broken (192.168.1.250 unreachable, FIELD-NOTES:105-112)?
6. **printers.json current state per machine** — still v1 at C:\fullsite (would auto-migrate to v2) or already v2 in userData? Are EC TICKET jam and PANADERIA sharing still as of Jul 12?
7. **Windows versions, user accounts, admin availability** — user "Cliente" has no admin (FIELD-NOTES:50); password "1234" incorrect for SERVER1 (FIELD-NOTES:110).
8. **Port 7717/7718 ownership** — any leftover start-bridge.bat / legacy bridge process re-occupying 7717 (root cause of the Jul 12 PIN-only bug, FIELD-NOTES:118).
9. **Real staff roster + roles + PINs in pos_staff** — repo shows 36/40 match at cert time; current active list, role per person, and whether a capitan/cajero role is used. (PINs stay out of the twin regardless.)
10. **Real pos_modifier_groups / combos** — production groups were adjusted after cocina feedback (DEPLOYMENT-STATE.md:84); actual multinivel group definitions, and full 509-item catalog snapshot.
11. **Cash/caja operating values** — real fondo inicial norm, retiro/deposito practice, corte schedule, Getnet vs MP Point which terminal is actually on the counter today.
12. **Router/LAN layout** — subnet (192.168.1.x vs 192.168.0.x), WiFi stability near extractor (KDS drops, DEPLOYMENT-STATE.md:85), printer static IPs still valid.

---

**Counts:** KNOWN 36 rows · INFERRED 15 rows · UNKNOWN 12 items.
