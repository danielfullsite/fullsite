#!/usr/bin/env python3
"""
Restaurant Bootstrap — provisions a new client from a manifest JSON.

Usage:
  python bootstrap_client.py scripts/manifests/nomada-mini.json [--dry-run]

What it does:
  1. Creates / updates the clients row in Supabase
  2. Upserts station routing into pos_settings
  3. Seeds staff members into pos_staff
  4. Generates kds.config.json for KDS installation
  5. Prints remaining manual steps (Vercel env vars, Cloudflare secrets)

Requirements:
  - SUPABASE_URL, SUPABASE_SERVICE_KEY in environment
  - Optional: DASHBOARD_URL (default: https://app.fullsite.mx)

Security: kds.config.json contains credentials — never commit it.
"""

import json
import os
import sys
import argparse
import requests
from datetime import datetime

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "https://app.fullsite.mx")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


def sb_upsert(table: str, data: dict) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
        json=data,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()[0] if r.json() else {}


def sb_patch(table: str, filter_col: str, filter_val: str, data: dict) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{filter_col}=eq.{filter_val}",
        headers=HEADERS,
        json=data,
        timeout=15,
    )
    r.raise_for_status()


def provision(manifest: dict, dry_run: bool) -> None:
    client_id = manifest["client_id"]
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Bootstrapping: {client_id} — {manifest['display_name']}")

    # ── 1. clients row ───────────────────────────────────────────────────────
    # Core columns (always exist)
    client_row = {
        "id": client_id,
        "display_name": manifest["display_name"],
        "type": manifest.get("type", ""),
        "city": manifest.get("city", ""),
        "timezone": manifest.get("timezone", "America/Mexico_City"),
        "features": manifest.get("features", {}),
        "accent_color": manifest.get("accent_color", "emerald"),
        "default_theme": manifest.get("default_theme", "light"),
        "mesas": manifest.get("mesas", 12),
        "iva_rate": manifest.get("iva_rate", 0.16),
        "receipt_footer": manifest.get("receipt_footer", ""),
        "address": manifest.get("address"),
        "phone": manifest.get("phone"),
        "rfc": manifest.get("rfc"),
        "razon_social": manifest.get("razon_social"),
        "business_context": manifest.get("business_context"),
        "data_source": manifest.get("data_source", "fullsite"),
        "wansoft_subsidiary_id": manifest.get("wansoft_subsidiary_id"),
        "telegram_chat_ids": (
            {"owner": manifest["telegram_chat_id_owner"]}
            if manifest.get("telegram_chat_id_owner") else None
        ),
        "report_recipients": manifest.get("report_recipients"),
        "logo_url": manifest.get("logo_url"),
    }
    # Columns added in P1-D12 migration (omit if migration hasn't run yet)
    if manifest.get("plan"):
        client_row["plan"] = manifest["plan"]
    if manifest.get("support_email"):
        client_row["support_email"] = manifest["support_email"]
    # Strip None values to avoid overwriting existing data with nulls
    client_row = {k: v for k, v in client_row.items() if v is not None}

    if not dry_run:
        sb_upsert("clients", client_row)
    print(f"  ✓ clients row: {client_id}")

    # ── 2. Station routing into pos_settings ─────────────────────────────────
    routing = manifest.get("station_routing")
    if routing:
        if not dry_run:
            # Merge into existing pos_settings via JSONB patch
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/clients?id=eq.{client_id}&select=pos_settings",
                headers=HEADERS, timeout=10,
            )
            r.raise_for_status()
            current_settings = (r.json()[0].get("pos_settings") or {}) if r.json() else {}
            current_settings["pos.station_routing"] = routing
            sb_patch("clients", "id", client_id, {"pos_settings": current_settings})
        print(f"  ✓ pos_settings[pos.station_routing]: {len(routing)} stations")

    # ── 3. Staff ─────────────────────────────────────────────────────────────
    staff_list = manifest.get("staff", [])
    for member in staff_list:
        staff_row = {
            "client_id": client_id,
            "name": member["name"],
            "role": member["role"],
            "active": True,
        }
        if member.get("pin"):
            staff_row["pin"] = member["pin"]
        if not dry_run:
            sb_upsert("pos_staff", staff_row)
        print(f"  ✓ staff: {member['name']} ({member['role']})")

    # ── 4. KDS config file ───────────────────────────────────────────────────
    kds_email = next(
        (m["email"] for m in staff_list if m["role"] == "dueño" and m.get("email")),
        None,
    )
    kds_config = {
        "client_id": client_id,
        "dashboard_url": f"{DASHBOARD_URL}/pos/cocina",
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY or "SET_ANON_KEY_HERE",
        "kds_email": kds_email or "SET_KDS_EMAIL_HERE",
        "kds_password": "SET_KDS_PASSWORD_HERE",
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    kds_path = f"kds-config-{client_id}.json"
    if not dry_run:
        with open(kds_path, "w") as f:
            json.dump(kds_config, f, indent=2)
    print(f"  ✓ KDS config: {kds_path} (copy to electron-kds/kds.config.json on the KDS machine)")

    # ── 5. Manual steps ──────────────────────────────────────────────────────
    print(f"\n  Remaining manual steps for {client_id}:")
    print(f"  [ ] Create Supabase Auth user for KDS: email={kds_config['kds_email']}")
    print(f"  [ ] Set password in kds-config-{client_id}.json → kds_password")
    print(f"  [ ] Set NEXT_PUBLIC_DEFAULT_CLIENT_ID={client_id} in Vercel")
    print(f"  [ ] Set BACKUP_ADMIN_EMAILS in Vercel")
    if manifest.get("reviews"):
        print(f"  [ ] Set Cloudflare Worker secrets for reviews-manager: RESTAURANT_NAME, RESTAURANT_LOCATION, SUPPORT_EMAIL")
    print(f"  [ ] Run SQL migrations: P1-D03 (if station_routing set above), P1-D09, P1-D20")
    print(f"\n  Bootstrap complete for: {client_id}\n")


def main():
    parser = argparse.ArgumentParser(description="Fullsite Restaurant Bootstrap")
    parser.add_argument("manifest", help="Path to restaurant manifest JSON")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without writing to DB")
    args = parser.parse_args()

    with open(args.manifest) as f:
        manifest = json.load(f)

    provision(manifest, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
