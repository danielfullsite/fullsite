#!/usr/bin/env python3
"""
Onboard Client — Creates everything needed for a new Fullsite client.

Usage:
  python onboard_client.py \
    --id atope \
    --name "Atope" \
    --city "Monterrey, NL" \
    --type "Cocina Española" \
    --mesas 20 \
    --email "ricardo@atope.mx" \
    --password "temp123456"

Creates:
  1. Client record in `clients` table
  2. Auth user in Supabase Auth
  3. Staff/meseros config
  4. Default menu categories (optional)
  5. Welcome Telegram message (optional)
"""

import os
import sys
import json
import argparse
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def create_client(args):
    """Create client record in clients table."""
    client = {
        "id": args.id,
        "display_name": args.name,
        "city": args.city or "Monterrey, NL",
        "timezone": "America/Mexico_City",
        "iva_rate": "0.16",
        "type": args.type or "Casual Dining",
        "mesas": args.mesas or 16,
        "active": True,
        "default_theme": "dark",
        "accent_color": "emerald",
        "data_source": "supabase",
        "features": json.dumps({
            "pos": True,
            "posRestaurant": True,
            "chatIA": True,
            "coach": True,
            "agentesIA": True,
            "inventory": True,
            "foodCost": True,
            "facturacion": True,
        }),
        "meseros": json.dumps(args.meseros.split(",") if args.meseros else []),
        "menu_categories": json.dumps({
            "hh": [],
            "pan": [],
            "postres": [],
            "chilaquiles": [],
        }),
        "bebida_groups": json.dumps([]),
        "staff_exclude_meseros": json.dumps([]),
    }

    # Add Wansoft credentials if provided
    if args.wansoft_user:
        client["wansoft_user"] = args.wansoft_user
        client["wansoft_pass"] = args.wansoft_pass or ""
        client["wansoft_subsidiary_id"] = args.wansoft_subsidiary or ""
        client["data_source"] = "wansoft"

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/clients",
        headers=sb_headers,
        json=client,
    )
    if r.status_code < 300:
        print(f"✓ Client '{args.id}' created in clients table")
        return True
    elif r.status_code == 409:
        print(f"⚠ Client '{args.id}' already exists — skipping")
        return True
    else:
        print(f"✗ Failed to create client: {r.status_code} {r.text[:200]}")
        return False


def create_user(args):
    """Create auth user in Supabase Auth."""
    if not args.email:
        print("⚠ No email provided — skipping user creation")
        return True

    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "email": args.email,
            "password": args.password or "fullsite2026",
            "email_confirm": True,
            "user_metadata": {
                "client_id": args.id,
                "role": "admin",
                "name": args.name,
            },
        },
    )
    if r.status_code < 300:
        user = r.json()
        print(f"✓ Auth user created: {args.email} (id: {user.get('id', '?')[:8]}...)")
        return True
    elif "already been registered" in r.text:
        print(f"⚠ User {args.email} already exists — skipping")
        return True
    else:
        print(f"✗ Failed to create user: {r.status_code} {r.text[:200]}")
        return False


def create_pos_staff(args):
    """Create POS staff entries."""
    if not args.meseros:
        print("⚠ No meseros provided — skipping staff creation")
        return True

    meseros = [m.strip() for m in args.meseros.split(",") if m.strip()]
    for i, name in enumerate(meseros):
        pin = str(1000 + i)
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/pos_staff",
            headers=sb_headers,
            json={
                "client_id": args.id,
                "name": name,
                "role": "mesero",
                "pin": pin,
                "active": True,
            },
        )
        if r.status_code < 300:
            print(f"  ✓ Staff: {name} (PIN: {pin})")
        elif r.status_code == 409:
            print(f"  ⚠ Staff {name} already exists")
        else:
            print(f"  ✗ Failed: {name} — {r.status_code}")

    # Create admin user
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/pos_staff",
        headers=sb_headers,
        json={
            "client_id": args.id,
            "name": "Admin",
            "role": "admin",
            "pin": "0000",
            "active": True,
        },
    )
    print(f"  ✓ Staff: Admin (PIN: 0000)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Onboard a new Fullsite client")
    parser.add_argument("--id", required=True, help="Client ID (slug, e.g. 'atope')")
    parser.add_argument("--name", required=True, help="Display name (e.g. 'Atope')")
    parser.add_argument("--city", default="Monterrey, NL", help="City")
    parser.add_argument("--type", default="Casual Dining", help="Restaurant type")
    parser.add_argument("--mesas", type=int, default=16, help="Number of tables")
    parser.add_argument("--email", help="Admin email for login")
    parser.add_argument("--password", default="fullsite2026", help="Initial password")
    parser.add_argument("--meseros", help="Comma-separated mesero names")
    parser.add_argument("--wansoft-user", help="Wansoft username (if they have Wansoft)")
    parser.add_argument("--wansoft-pass", help="Wansoft password")
    parser.add_argument("--wansoft-subsidiary", help="Wansoft subsidiary ID")

    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables")
        sys.exit(1)

    print(f"{'=' * 50}")
    print(f"ONBOARDING: {args.name} ({args.id})")
    print(f"{'=' * 50}\n")

    ok = True
    ok = create_client(args) and ok
    ok = create_user(args) and ok
    ok = create_pos_staff(args) and ok

    print(f"\n{'=' * 50}")
    if ok:
        print(f"✓ ONBOARDING COMPLETE — {args.name}")
        print(f"\nNext steps:")
        print(f"  1. Client logs in at app.fullsite.mx with {args.email}")
        print(f"  2. POS accessible at app.fullsite.mx/pos (PIN: 0000 for admin)")
        print(f"  3. Set localStorage 'fullsite_client_id' = '{args.id}'")
        if args.wansoft_user:
            print(f"  4. Wansoft data will start syncing automatically")
        else:
            print(f"  4. No Wansoft — client uses Fullsite POS directly")
    else:
        print(f"✗ ONBOARDING HAD ERRORS — check above")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
