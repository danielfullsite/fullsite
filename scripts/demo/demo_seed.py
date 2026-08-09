#!/usr/bin/env python3
"""
demo_seed.py — Deterministic seed for tenant 'demo' on staging.

Usage:
    python demo_seed.py [--seed SEED] [--dry-run]

All generated rows carry source='SIMULATED', environment='DEMO'.
Every log line begins with [DEMO][ISOLATED].
Idempotent: same --seed value produces identical rows on every run.

ISOLATION CONTRACT (fail-closed):
  - Any attempt to target a non-demo tenant raises RuntimeError immediately.
  - Any HTTP call to a production URL raises RuntimeError immediately.
  - No real network calls are made during tests (unittest.mock intercepts all).
"""

import argparse
import hashlib
import json
import os
import random
import sys
import uuid

import requests

# ─── Constants ────────────────────────────────────────────────────────────────

LOG_PREFIX = "[DEMO][ISOLATED]"

DEMO_CLIENT_ID = "demo"
DEMO_SLUG = "demo"
DEMO_NAME = "El Molcajete Demo"
DEMO_DATA_SOURCE = "demo"
DEMO_ENVIRONMENT = "DEMO"

# Any URL containing these fragments is considered production — hard-blocked.
# Only block specific production project IDs; staging also uses supabase.co/rest/v1.
_PRODUCTION_URL_FRAGMENTS = [
    "qjiomlvudfmzuvqvhwpk.supabase.co",   # fullsite-amalay production project ID
    "fullsite-amalay",                       # named production environment
]

# Optional staging allowlist — when set, any URL NOT containing this fragment is rejected.
_STAGING_URL_FRAGMENT = os.environ.get("STAGING_URL_FRAGMENT", "")

STAGING_SUPABASE_URL = os.environ.get("STAGING_SUPABASE_URL", "").rstrip("/")
STAGING_SUPABASE_KEY = os.environ.get("STAGING_SUPABASE_KEY", "")

# ─── Logging ──────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(f"{LOG_PREFIX} {msg}", flush=True)


# ─── Isolation guards ─────────────────────────────────────────────────────────

def _assert_demo_only(client_id: str) -> None:
    """IG-01: Fail-closed — reject any non-demo client."""
    if client_id != DEMO_CLIENT_ID:
        raise RuntimeError(
            f"{LOG_PREFIX} ABORT: refused operation for client_id='{client_id}'. "
            f"Only '{DEMO_CLIENT_ID}' is allowed in demo scripts."
        )


def _assert_not_production(url: str) -> None:
    """IG-02: Fail-closed — refuse any call to a production URL."""
    for fragment in _PRODUCTION_URL_FRAGMENTS:
        if fragment in url:
            raise RuntimeError(
                f"{LOG_PREFIX} ABORT: refused to call production URL containing '{fragment}': {url}"
            )
    # Also require staging fragment when URL is set (prevents accidental wrong env)
    if url and _STAGING_URL_FRAGMENT and _STAGING_URL_FRAGMENT not in url:
        raise RuntimeError(
            f"{LOG_PREFIX} ABORT: URL '{url}' does not look like staging "
            f"(expected fragment '{_STAGING_URL_FRAGMENT}')."
        )


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def _sb_headers() -> dict:
    return {
        "apikey": STAGING_SUPABASE_KEY,
        "Authorization": f"Bearer {STAGING_SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _sb_upsert(table: str, rows: list) -> None:
    url = f"{STAGING_SUPABASE_URL}/rest/v1/{table}"
    _assert_not_production(url)
    r = requests.post(
        url,
        headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
        timeout=30,
    )
    r.raise_for_status()


def _sb_delete(table: str, client_id: str) -> None:
    """Delete all rows for client_id from table. Only 'demo' allowed."""
    _assert_demo_only(client_id)
    url = f"{STAGING_SUPABASE_URL}/rest/v1/{table}"
    _assert_not_production(url)
    r = requests.delete(
        url,
        headers={**_sb_headers(), "Prefer": "return=minimal"},
        params={"client_id": f"eq.{client_id}"},
        timeout=30,
    )
    r.raise_for_status()


# ─── Deterministic data generators ───────────────────────────────────────────

def _make_uuid(rng: random.Random) -> str:
    """Generate a deterministic UUID from the RNG state."""
    return str(uuid.UUID(int=rng.getrandbits(128)))


def _demo_row(rng: random.Random, client_id: str, extra: dict) -> dict:
    """Base row with required demo tags."""
    _assert_demo_only(client_id)
    row = {
        "id": _make_uuid(rng),
        "client_id": client_id,
        "source": "SIMULATED",
        "environment": "DEMO",
    }
    row.update(extra)
    return row


def _generate_client_record() -> dict:
    """F-01: Reproducible client record (no RNG — fully deterministic)."""
    return {
        "id": DEMO_CLIENT_ID,
        "slug": DEMO_SLUG,
        "name": DEMO_NAME,
        "display_name": DEMO_NAME,
        "data_source": DEMO_DATA_SOURCE,
        "environment": DEMO_ENVIRONMENT,
        "source": "SIMULATED",
        "active": True,
        "timezone": "America/Mexico_City",
        "iva_rate": "0.16",
        "type": "Mexican Restaurant Demo",
        "mesas": 10,
        "default_theme": "dark",
        "accent_color": "orange",
        "city": "Monterrey, NL",
        "features": json.dumps({
            "pos": True,
            "posRestaurant": True,
            "chatIA": True,
            "agentesIA": False,
            "inventory": True,
            "facturacion": False,
        }),
        "meseros": json.dumps([
            "Ana García", "Carlos Méndez", "Diana Torres",
            "Eduardo Reyes", "Fernanda López",
        ]),
    }


# Menu: 5 categories × 6 items = 30 items exactly
_MENU_DATA = [
    ("Entradas", [
        ("Guacamole", 95.0),
        ("Elote en vaso", 75.0),
        ("Sopa de lima", 120.0),
        ("Tostadas de tinga", 110.0),
        ("Queso fundido", 145.0),
        ("Quesadillas surtidas", 130.0),
    ]),
    ("Platillos fuertes", [
        ("Enchiladas verdes", 175.0),
        ("Mole negro con pollo", 210.0),
        ("Chiles en nogada", 240.0),
        ("Tamales oaxaqueños", 155.0),
        ("Pozole rojo", 185.0),
        ("Tlayuda con tasajo", 225.0),
    ]),
    ("Tacos", [
        ("Taco de carnitas", 65.0),
        ("Taco de barbacoa", 70.0),
        ("Taco de canasta", 45.0),
        ("Taco de chapulines", 85.0),
        ("Taco de frijoles", 50.0),
        ("Taco de cochinita", 72.0),
    ]),
    ("Bebidas", [
        ("Agua de horchata", 55.0),
        ("Agua de jamaica", 50.0),
        ("Tepache", 65.0),
        ("Mezcal artesanal (50ml)", 120.0),
        ("Café de olla", 60.0),
        ("Agua mineral", 40.0),
    ]),
    ("Postres", [
        ("Flan napolitano", 85.0),
        ("Arroz con leche", 75.0),
        ("Buñuelos", 70.0),
        ("Capirotada", 80.0),
        ("Pay de limón", 90.0),
        ("Helado artesanal", 65.0),
    ]),
]


def generate_menu_items(rng: random.Random, client_id: str) -> list:
    """Generate exactly 30 deterministic menu items (5 categories × 6)."""
    items = []
    for cat_name, cat_items in _MENU_DATA:
        cat_id = _make_uuid(rng)
        for item_name, price in cat_items:
            items.append({
                "id": _make_uuid(rng),
                "client_id": client_id,
                "category_id": cat_id,
                "category_name": cat_name,
                "name": item_name,
                "price": price,
                "active": True,
                "source": "SIMULATED",
                "environment": "DEMO",
            })
    return items


def generate_tables(rng: random.Random, client_id: str) -> list:
    """Generate exactly 10 deterministic tables."""
    capacities = [2, 4, 4, 6, 4, 2, 6, 8, 4, 4]
    return [
        {
            "id": _make_uuid(rng),
            "client_id": client_id,
            "number": i + 1,
            "name": f"Mesa {i + 1}",
            "capacity": capacities[i],
            "active": True,
            "source": "SIMULATED",
            "environment": "DEMO",
        }
        for i in range(10)
    ]


def generate_staff(rng: random.Random, client_id: str) -> list:
    """Generate exactly 5 deterministic staff members."""
    names = [
        "Ana García",
        "Carlos Méndez",
        "Diana Torres",
        "Eduardo Reyes",
        "Fernanda López",
    ]
    return [
        {
            "id": _make_uuid(rng),
            "client_id": client_id,
            "name": name,
            "role": "mesero",
            "active": True,
            "source": "SIMULATED",
            "environment": "DEMO",
        }
        for name in names
    ]


# ─── State hash ───────────────────────────────────────────────────────────────

def state_md5(data: dict) -> str:
    """Compute MD5 of the canonical seed state for comparison across runs."""
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=True)
    return hashlib.md5(canonical.encode()).hexdigest()


# ─── Core seed function ───────────────────────────────────────────────────────

def seed(seed_val: int = 42, dry_run: bool = False, client_id: str = DEMO_CLIENT_ID) -> dict:
    """
    Seed the demo tenant. Idempotent — same seed_val → same rows.

    Returns a dict with all generated data and the state MD5.
    """
    _assert_demo_only(client_id)
    rng = random.Random(seed_val)

    log(f"Starting seed (client_id={client_id!r}, seed={seed_val}, dry_run={dry_run})")
    log(f"Staging URL: {STAGING_SUPABASE_URL or '(not set)'}")

    client_record = _generate_client_record()
    menu_items = generate_menu_items(rng, client_id)
    tables = generate_tables(rng, client_id)
    staff = generate_staff(rng, client_id)

    assert len(menu_items) == 30, f"Expected 30 menu items, got {len(menu_items)}"
    assert len(tables) == 10, f"Expected 10 tables, got {len(tables)}"
    assert len(staff) == 5, f"Expected 5 staff, got {len(staff)}"

    log(f"Generated: 1 client | {len(menu_items)} menu items | {len(tables)} tables | {len(staff)} staff")

    result = {
        "client": client_record,
        "menu_items": menu_items,
        "tables": tables,
        "staff": staff,
        "seed_val": seed_val,
    }
    result["state_md5"] = state_md5({k: v for k, v in result.items() if k != "state_md5"})

    if dry_run:
        log("DRY RUN — no writes performed")
        log(f"State MD5: {result['state_md5']}")
        return result

    _sb_upsert("clients", [client_record])
    log("Upserted clients record")

    _sb_upsert("pos_menu_items", menu_items)
    log(f"Upserted {len(menu_items)} menu items")

    _sb_upsert("pos_tables", tables)
    log(f"Upserted {len(tables)} tables")

    _sb_upsert("pos_staff", staff)
    log(f"Upserted {len(staff)} staff")

    log(f"Seed complete. State MD5: {result['state_md5']}")
    return result


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo tenant on staging")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed (default: 42)")
    parser.add_argument("--dry-run", action="store_true", help="No DB writes, just print plan")
    args = parser.parse_args()

    if not args.dry_run and (not STAGING_SUPABASE_URL or not STAGING_SUPABASE_KEY):
        log("ERROR: STAGING_SUPABASE_URL and STAGING_SUPABASE_KEY must be set")
        sys.exit(1)

    seed(seed_val=args.seed, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
