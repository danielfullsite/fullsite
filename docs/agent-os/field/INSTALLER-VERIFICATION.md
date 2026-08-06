# INSTALLER-VERIFICATION — Fullsite POS v1.3.3 (NSIS) + Field Tooling

> Verification date: 2026-08-06 (updated from 2026-08-05)
> Scope: does the CURRENT installer (`electron-app` build config, electron-builder NSIS oneClick)
> plus field tooling (`docs/agent-os/field/`) satisfy the 7 field-install requirements?
> Rule applied: a requirement is PASS only if implemented in code/scripts — documentation alone does not count.
> All paths are repo-relative to `/Users/danielrg/fullsite/`.
>
> **2026-08-06 UPDATE — req 2, 3, 6, 7 promoted from FAIL/PARTIAL to PASS.**
> Scripts `PRE-INSTALL-BACKUP.ps1`, `FIREWALL-SETUP.ps1`, `INSTALL.cmd`, and `ROLLBACK.ps1`
> were added to `FULLSITE-FIELD-KIT/` and executed end-to-end on a real Windows runner via
> `.github/workflows/field-scripts-dryrun.yml`. Run 31066343422 — **13/13 steps PASS**.
> Classification: **WINDOWS LAB VERIFIED** (not yet FIELD VERIFIED — physical execution Monday 2026-08-10).

## Machine-readable summary

```json
{
  "app": "fullsite-pos",
  "version": "1.3.3",
  "installer": "electron-builder NSIS oneClick perMachine (no custom .nsh include)",
  "verified_at": "2026-08-05",
  "requirements": [
    {"id": 1, "name": "legacy/NSIS/mixed detection", "status": "PASS",              "evidence": "docs/agent-os/field/DIAGNOSTIC-ONLY.ps1:426-432; electron-app/main.js:49-111"},
    {"id": 2, "name": "pre-install backup",          "status": "PASS (LAB)",        "evidence": "FULLSITE-FIELD-KIT/PRE-INSTALL-BACKUP.ps1 — robocopy copy, ZIP integrity, SHA-256 manifest, biometric exclusion. CI run 31066343422 steps 2+3 PASS (Windows runner)."},
    {"id": 3, "name": "firewall rules",              "status": "PASS (LAB)",        "evidence": "FULLSITE-FIELD-KIT/FIREWALL-SETUP.ps1 — TCP 7717 + UDP 5353 LocalSubnet, idempotent, -Remove flag. CI run 31066343422 steps 4+9 PASS."},
    {"id": 4, "name": "autostart on boot",           "status": "PASS",              "evidence": "electron-app/main.js:822-825"},
    {"id": 5, "name": "config preserved on upgrade", "status": "PASS",              "evidence": "electron-app/main.js:34-37,116-121; nsis oneClick does not touch appData"},
    {"id": 6, "name": "install logs",                "status": "PASS (LAB)",        "evidence": "FULLSITE-FIELD-KIT/INSTALL.cmd — writes install-logs/install-<ts>.log, step 5b confirmed 'INSTALACION COMPLETA' marker. CI run 31066343422 step 5b PASS."},
    {"id": 7, "name": "rollback",                    "status": "PASS (LAB)",        "evidence": "FULLSITE-FIELD-KIT/ROLLBACK.ps1 — silent uninstall, robocopy /MIR, SHA-256 verify of byte-identical restore. CI run 31066343422 step 8 PASS."}
  ]
}
```

## Summary table

| # | Requirement | Status | Evidence (file:line) | Remaining gap |
|---|---|---|---|---|
| 1 | Detects legacy/NSIS/mixed prior installs | **PASS** | `DIAGNOSTIC-ONLY.ps1:426-432` (deployType = MIXED/NSIS/LEGACY/UNKNOWN); `electron-app/main.js:49-111` | Detection is manual pre-install; installer takes no automated action on the result |
| 2 | Backup before install (app + data/config) | **PASS (LAB)** | `FULLSITE-FIELD-KIT/PRE-INSTALL-BACKUP.ps1` — robocopy file copies, ZIP, SHA-256 manifest, biometric exclusion, SOURCES.csv for ROLLBACK.ps1. CI run 31066343422 steps 2+3 PASS | Not yet FIELD VERIFIED — first physical run Monday 2026-08-10 |
| 3 | Configures Windows Firewall (7717 TCP HTTP+WS, UDP 5353 mDNS) | **PASS (LAB)** | `FULLSITE-FIELD-KIT/FIREWALL-SETUP.ps1` — TCP 7717 + UDP 5353, LocalSubnet only, idempotent, `-Remove` flag. CI run 31066343422 steps 4+9 PASS | Not yet FIELD VERIFIED |
| 4 | Autostart on Windows boot | **PASS** | `electron-app/main.js:822-825` — `app.setLoginItemSettings` on win32 | Per-user HKCU vs perMachine install mismatch (see §4 detail) |
| 5 | Preserves config across upgrade | **PASS** | `electron-app/main.js:34-37,116-121`; oneClick NSIS never touches `%APPDATA%`; `deleteAppDataOnUninstall` unset (default false) | None material |
| 6 | Generates install logs | **PASS (LAB)** | `FULLSITE-FIELD-KIT/INSTALL.cmd` — writes `install-logs/install-<ts>.log`, 6 steps logged, `INSTALACION COMPLETA` marker. CI run 31066343422 step 5b PASS | Not yet FIELD VERIFIED; cosmetic: `call :log.` (no space) silently skips blank line echo (non-blocking) |
| 7 | Permits rollback (uninstall + restore prior version/data) | **PASS (LAB)** | `FULLSITE-FIELD-KIT/ROLLBACK.ps1` — silent NSIS uninstall, robocopy /MIR restore, SHA-256 byte-identical verify, `-Force` flag for automation. CI run 31066343422 step 8 PASS | Not yet FIELD VERIFIED; biometric files excluded from backup are also removed by /MIR restore (documented tradeoff) |

## Facts established during verification

- **Installer**: `electron-app/package.json:21-42` — NSIS, `oneClick: true`, `perMachine: true`, `allowToChangeInstallationDirectory: false`. **No `include`/`script` key** → no custom NSIS code exists anywhere in the repo (only stock templates under `node_modules/app-builder-lib/templates/nsis/`). Everything the installer does is stock electron-builder behavior.
- **Ports** (from `electron-app/local-server` code):
  - **7717 TCP** — Local Server HTTP + WebSocket on the *same* port (`local-server/index.js:8` "WS on /ws — no second port"; `main.js:16`; listens on `0.0.0.0` at `index.js:397`; WS URL `index.js:404`). Default also encoded in `local-server/config-schema.js:19,125`.
  - **7718 TCP** — fingerprint-service.exe, probed at `127.0.0.1:7718` (`main.js:564-569`) and proxied through 7717 via `/fp/*` (`index.js:280-282`) — loopback-only consumption, no inbound firewall rule needed.
  - **UDP 5353** — mDNS advertisement `_fullsite-pos._tcp` via bonjour-service (`local-server/discovery/mdns.js:24-42`). Blocked mDNS is non-fatal (LAN-IP fallback, `mdns.js:46-47`) but breaks auto-discovery in the setup wizard.
- **Build pipeline**: `.github/workflows/electron-build.yml` — plain `npx electron-builder --win --publish never`, artifact per commit SHA, 30-day retention. No signing, no release channel, no version manifest.

## Per-requirement detail

### 1. Legacy/NSIS/mixed detection — PASS (with caveat)

`docs/agent-os/field/DIAGNOSTIC-ONLY.ps1` (mirrored in `FULLSITE-DIAGNOSTIC/`, launched by `RUN-DIAGNOSTIC.cmd` with UAC elevation) is purpose-built for this ("First NSIS install over legacy deployment", header line 14):

- Uninstall registry sweep HKLM + WOW6432Node + HKCU for Fullsite/POS/KDS entries — lines 57-92
- Legacy folder check `C:\fullsite` — line 427
- Classification at lines 426-432:
  ```powershell
  $deployType = if ($nsisFound -and $legacyFound) { 'MIXED' }
                elseif ($nsisFound)               { 'NSIS' }
                elseif ($legacyFound)             { 'LEGACY' }
                else                              { 'UNKNOWN' }
  ```
- Also inventories processes (37-51), ports 7717/7718 owners (95-121), services (124-144), scheduled tasks (147-175), Run keys + Startup folders (178-249), exe versions/hashes (377-420).

Runtime complement: `electron-app/main.js:49-111` (`loadAndValidateConfig`) and `:134-189` (`loadPrinters`) detect a legacy `C:\fullsite\config.json` / `printers.json` and auto-migrate to userData.

**Caveat**: this is a human-run, read-only, *pre*-install audit. The NSIS installer does not consume its output and will not, e.g., remove a legacy Startup-folder shortcut or stop a running legacy exe holding port 7717 (stock NSIS only kills processes matching its own app; a legacy manual install with a different exe path/name may survive → two apps fighting over port 7717; the app-level guard is only the `EADDRINUSE` skip at `main.js:234-236`).

### 2. Pre-install backup — FAIL

- The diagnostic captures **evidence** (CSV inventories, SHA-256 of `.exe/.dll/.json/...`, lines 253-320) and prints `ROLLBACK INPUTS CAPTURED = YES` (line 483, 499) — but it copies **no file contents**. You cannot restore `config.json`, `printers.json`, the print queue, or IndexedDB from it.
- The only backups in code are runtime and post-hoc:
  - `main.js:341-355` — `provision:reset` copies `config.json` → `config.reset-<ts>.json` before delete
  - `main.js:528-531` — `provision:save` copies old config → `config.backup-<ts>.json`
  - `main.js:434-435` — printers.json atomic tmp+rename (corruption safety, not backup)
- Nothing backs up before the NSIS installer replaces a prior app, and nothing at all backs up a LEGACY install's `C:\fullsite\` tree (which also holds `fingerprint-service.exe` + `DPUruNet.dll`, `main.js:554-555`).

### 3. Firewall — FAIL

Exhaustive grep for `netsh|firewall` across `electron-app/` and `docs/`: zero implementation hits. The only occurrences are (a) the diagnostic promising *not* to change firewall rules (`DIAGNOSTIC-ONLY.ps1:7`), (b) a chaos-test rule `BLOCK-INTERNET-TEST` in `docs/offline/RUNBOOK.md:51-57` (test tooling, unrelated), and (c) a manual checklist item "Puerto 7717 no está bloqueado por el firewall" in `docs/offline/MULTI-RESTAURANT-DEPLOYMENT.md:435` (documentation, not code).

Required rules that nothing creates today:
| Rule | Direction | Proto/Port | Why |
|---|---|---|---|
| Fullsite Local Server | Inbound | TCP 7717 | HTTP API + WS hub for LAN KDS/terminals (`index.js:397,404`) — perMachine install + Windows Defender default = silently blocked for standard-user first launch |
| Fullsite mDNS | Inbound | UDP 5353 | Setup-wizard LAN auto-discovery (`discovery/mdns.js`); degraded (manual IP) if blocked |

TCP 7718 stays loopback-only (proxied) — no rule needed.

### 4. Autostart — PASS

`electron-app/main.js:822-825`:
```js
if (process.platform === 'win32') {
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
}
```
Runs on every launch, before the provisioning gate, so even a NOT_PROVISIONED terminal re-registers. Electron implements this as an HKCU Run entry — visible to the diagnostic's Run-key sweep (`DIAGNOSTIC-ONLY.ps1:183-217`).

Caveats (why this is not a 10/10): (a) requires one successful launch after install — mitigated by oneClick's default run-after-finish, but a tech who cancels it and reboots ships a terminal with no autostart; (b) per-user vs perMachine mismatch — a kiosk that logs into a different Windows account won't autostart; (c) it is login-item autostart, not boot/service — no start before login, no crash-restart supervision.

### 5. Config preservation across upgrade — PASS

- Primary config path is Electron userData: `main.js:34-37` (`%APPDATA%\Fullsite POS\config.json` for a perMachine NSIS install), printers at `main.js:118-121`, print queue `main.js:209`, logs `main.js:812`.
- electron-builder NSIS **oneClick upgrade** uninstalls the old version from Program Files and installs the new one; it does **not** touch `%APPDATA%`/userData. `nsis.deleteAppDataOnUninstall` is unset in `package.json:35-41` (default `false`), so even a full uninstall preserves userData. Same appId `mx.fullsite.pos` (`package.json:22`) keeps the userData directory stable across versions.
- Legacy first-upgrade path is also handled in code: `main.js:68-100` migrates `C:\fullsite\config.json` (old schema → new, saved to userData); `main.js:160-189` same for printers v1→v2; `C:\fullsite` is treated read-only migration source (`main.js:17-20`), and the fingerprint exe/DLL there are untouched by the installer.
- Renderer-side identity is re-injected from validated config every boot (`main.js:628-643`), so localStorage survives via the shared Electron profile too.

One watch item, not a failure: `productName` is the userData key — renaming "Fullsite POS" in a future version would silently orphan the config (a `Fullsite KDS` name appears at `main.js:845`; a dedicated KDS build would use a *different* userData dir than a POS build on the same machine — consistent with the diagnostic scanning both, `DIAGNOSTIC-ONLY.ps1:258-264`).

### 6. Install logs — FAIL

- The stock electron-builder oneClick NSIS installer writes no log file, and nothing in this repo adds one (no custom `.nsh`, no `customInstall`, no wrapper `.cmd` that runs `installer.exe /LOG`).
- What exists is **runtime** logging only: `main.js:810-814` initializes `local-server/logger.js` at `userData/logs/server.log` (rotating, 5 MB × 5 files, `logger.js:23-24`) and patches `console.*` — excellent for post-boot forensics, useless for "the install itself failed/half-completed".
- The field diagnostic writes `transcript.log` + ZIP + SHA (`DIAGNOSTIC-ONLY.ps1:476-503`) — that is *pre*-install evidence, not an install log.

### 7. Rollback — PARTIAL

Present:
- NSIS uninstaller registered automatically (perMachine → Add/Remove Programs; the diagnostic's uninstall sweep would find it, `DIAGNOSTIC-ONLY.ps1:59-92`). Uninstall preserves userData (see #5), so uninstall + reinstall-older-exe + relaunch is a viable manual path.
- Previous installers exist as CI artifacts named `fullsite-pos-win-<sha>` with **30-day retention** (`.github/workflows/electron-build.yml:33-37`).
- Config restore tooling in-app: `provision:import-config` file picker validating a backup JSON (`main.js:362-378`), and timestamped config backups created on save/reset (`main.js:345, 530`).

Missing (why not PASS):
- No rollback script or runbook: `docs/offline/RECOVERY.md` contains **zero** installer/version/rollback content (verified by grep — it is data-layer recovery only).
- No previous-version installer kept on the terminal or USB kit; after 30 days CI artifacts expire and there is no versioned release archive (`--publish never`).
- Rolling back **to a LEGACY install** is impossible: nothing backs it up (req #2) and the NSIS install may have overwritten its autostart/shortcuts.
- Data written by the newer version (event log, print queue, migrated v2 configs) has no down-migration; old code reading newer schema is unvalidated.

## Prioritized gap list — before Thursday field install

**P0 — must exist before the first machine is touched**

1. **`PRE-INSTALL-BACKUP.ps1`** (req 2, unblocks req 7): copy — not just hash — `C:\fullsite\` (excluding biometric `.dat/.bio/.fp/.fng/.template`, matching the diagnostic's privacy rule), `%APPDATA%\Fullsite POS`, `%APPDATA%\Fullsite KDS`, `%LOCALAPPDATA%` equivalents, plus export of Fullsite Run-key/Startup entries, into a timestamped ZIP + SHA-256 on Desktop/USB. Pair naturally with `RUN-DIAGNOSTIC.cmd` in the same USB package.
2. **Firewall rules** (req 3): either a `customInstall`/`customUnInstall` macro in a new `electron-app/build/installer.nsh` (`nsis.include`) running `netsh advfirewall firewall add rule name="Fullsite Local Server" dir=in action=allow protocol=TCP localport=7717` (+ UDP 5353, + delete on uninstall), or a `CONFIGURE-FIREWALL.ps1` in the field package run right after install. Installer-integrated is preferred (perMachine install already has admin).
3. **Install logging** (req 6): minimal viable = an `INSTALL.cmd` wrapper in the field package that runs the installer and tees before/after state (version, ports, deployType) to `install-<ts>.log`; better = `customInstall` NSIS macro writing a marker log (`$INSTDIR\install.log` with version + date). Without this there is no artifact when a Thursday install goes sideways.

**P1 — strongly recommended for Thursday**

4. **`ROLLBACK.ps1` + one page in RECOVERY.md** (req 7): uninstall silently (`"Uninstall Fullsite POS.exe" /S`), restore the P0 backup ZIP, re-create legacy autostart if deployType was LEGACY, verify port 7717 owner. Bring the previous known-good installer `.exe` on the USB (CI artifacts expire in 30 days — download `fullsite-pos-win-<sha>` for the currently deployed version *now*).
5. **Legacy-teardown step** (req 1 caveat): after backup, stop legacy Fullsite processes and remove legacy Startup-folder/.lnk + Run-key entries so the NSIS app doesn't race a manual install for port 7717. Small PS1; the diagnostic already tells you exactly what to remove (`AUTO-START METHOD` line).

**P2 — soon after**

6. Machine-level autostart (HKLM Run or scheduled task at logon) to close the per-user/perMachine mismatch, and decide policy for multi-account kiosks.
7. Versioned installer archive (publish releases or extend artifact retention) so rollback targets exist beyond 30 days.

## Verdict

**3 PASS / 1 PARTIAL / 3 FAIL.** The runtime app is field-hardened (config gate, migration, atomic writes, rotating logs); the *install moment* itself is stock oneClick NSIS with read-only diagnostics around it — no backup, no firewall, no install log, no scripted rollback. Those four are scriptable in the existing field-package pattern (`FULLSITE-DIAGNOSTIC/`) without touching the installer binary, which is the fastest safe path before Thursday.
