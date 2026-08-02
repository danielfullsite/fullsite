#!/usr/bin/env python3
"""
NÓMADA-MINI Smoke Test — validates that a new client is properly isolated.

Usage:
  python smoke_test_nomada.py --client-id nomada [--base-url https://app.fullsite.mx]

Steps (mirrors the 7-step NÓMADA-MINI protocol in GOLDEN-POS-SKELETON.md):
  1. clients row exists with no AMALAY data
  2. pos_staff populated for the client
  3. pos_settings[pos.station_routing] exists
  4. features.bakery_station = false and features.posTienda = false (unless manifest sets them)
  5. No AMALAY defaults remain in DB for this client's rows
  6. KDS config file exists (local check)
  7. Grep: no AMALAY hardcodes in relevant source files (local check)

Exits 0 if all steps pass. Exits 1 with FAIL details if any step fails.
"""

import os
import sys
import argparse
import subprocess
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
    sys.exit(1)

HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

RESULTS = []


def check(name: str, passed: bool, detail: str = "") -> bool:
    status = "PASS" if passed else "FAIL"
    line = f"  [{status}] {name}"
    if detail:
        line += f" — {detail}"
    RESULTS.append((passed, line))
    print(line)
    return passed


def sb_get(table: str, params: dict) -> list:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=HEADERS, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def run(client_id: str) -> bool:
    print(f"\nNÓMADA-MINI Smoke Test — client: {client_id}\n")

    # Step 1: clients row exists
    rows = sb_get("clients", {"id": f"eq.{client_id}", "select": "*"})
    if not check("S1: clients row exists", bool(rows)):
        print(f"\n  FATAL: client '{client_id}' not found. Run bootstrap first.\n")
        return False

    client = rows[0]

    # Step 1b: no AMALAY-specific values
    amalay_fields = []
    for field in ["rfc", "phone", "address"]:
        val = client.get(field, "")
        if val and "AFO200806" in str(val):
            amalay_fields.append(f"{field}={val}")
    check("S1b: no AMALAY fiscal data in clients row", not amalay_fields,
          ", ".join(amalay_fields) if amalay_fields else "clean")

    # Step 2: pos_staff populated
    staff = sb_get("pos_staff", {"client_id": f"eq.{client_id}", "active": "eq.true", "select": "name,role"})
    check("S2: pos_staff populated", bool(staff), f"{len(staff)} members")

    # Step 3: station routing in pos_settings
    routing = (client.get("pos_settings") or {}).get("pos.station_routing")
    check("S3: pos_settings[pos.station_routing] set", routing is not None,
          f"{len(routing)} stations" if routing else "missing")

    # Step 4: feature flags
    features = client.get("features") or {}
    bakery = features.get("bakery_station", False)
    tienda = features.get("posTienda", False)
    check("S4: bakery_station=false (default for new clients)", not bakery)
    check("S4b: posTienda=false (default for new clients)", not tienda)

    # Step 5: no AMALAY data cross-contamination in pos_orders
    sample = sb_get("pos_orders", {
        "client_id": f"neq.{client_id}",
        "select": "id,client_id",
        "limit": "1",
    })
    check("S5: no cross-tenant pos_orders visible", not sample,
          f"found {len(sample)} rows from other tenants — RLS issue!" if sample else "isolated")

    # Step 6: KDS config file (local check)
    kds_path = f"kds-config-{client_id}.json"
    kds_exists = os.path.exists(kds_path)
    check("S6: kds.config.json generated", kds_exists, kds_path if kds_exists else "not found — run bootstrap")

    # Step 7: grep for AMALAY hardcodes in source
    grep_targets = [
        ("D-01", r"AFO200806JI0|8115324371|Omar Aguilera", "dashboard-app/src/lib/client-config.ts"),
        ("D-02", r"ramonfaur.daniel@gmail.com", "dashboard-app/src/lib/client-config.ts"),
        ("D-14", r"ramonfaur.daniel@gmail.com", "dashboard-app/src/lib/roles.ts"),
        ("D-11", r"Omar Aguilera.*Hector Rodriguez", "dashboard-app/src/app/api/chat/route.ts"),
        ("D-13", r"qjiomlvudfmzuvqvhwpk", "electron-kds/main.js"),
    ]
    all_clean = True
    for label, pattern, path in grep_targets:
        try:
            result = subprocess.run(
                ["grep", "-n", "-E", pattern, path],
                capture_output=True, text=True
            )
            has_hits = bool(result.stdout.strip())
            ok = check(f"S7/{label}: grep clean in {path}", not has_hits,
                       f"{len(result.stdout.strip().splitlines())} hits" if has_hits else "0 hits")
            if not ok:
                all_clean = False
        except FileNotFoundError:
            check(f"S7/{label}: file exists", False, f"{path} not found")
            all_clean = False

    # Summary
    passed = [r for ok, r in RESULTS if ok]
    failed = [r for ok, r in RESULTS if not ok]

    print(f"\n{'─'*50}")
    print(f"Result: {len(passed)}/{len(RESULTS)} checks passed")
    if failed:
        print("\nFailed:")
        for r in failed:
            print(r)
        print(f"\nVeredicto: FAIL — fix issues and re-run\n")
        return False
    else:
        print(f"\nVeredicto: PASS — {client_id} is AMALAY-independent\n")
        return True


def main():
    parser = argparse.ArgumentParser(description="NÓMADA-MINI Smoke Test")
    parser.add_argument("--client-id", required=True, help="Client ID to test")
    args = parser.parse_args()

    ok = run(args.client_id)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
