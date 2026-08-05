#!/usr/bin/env python3
"""
demo_reset.py — Teardown + reseed for tenant 'demo' on staging.

Usage:
    python demo_reset.py [--seed SEED] [--dry-run]

Completes in < 30 seconds. Two consecutive runs yield identical state MD5.

ISOLATION CONTRACT (fail-closed):
  - Only client_id='demo' is ever touched. Any other value raises immediately.
  - No production URLs are ever contacted.
  - Every log line begins with [DEMO][ISOLATED].
"""

import argparse
import sys
import time
import os

from demo_seed import (
    DEMO_CLIENT_ID,
    LOG_PREFIX,
    STAGING_SUPABASE_URL,
    STAGING_SUPABASE_KEY,
    _assert_demo_only,
    _sb_delete,
    log,
    seed,
    state_md5,
)

# Tables to purge during teardown (FK-safe order: leaves first)
_TEARDOWN_TABLES = [
    "pos_recipe_lines",
    "pos_item_modifier_groups",
    "pos_recipe_versions",
    "pos_modifiers",
    "pos_modifier_groups",
    "pos_menu_items",
    "pos_menu_categories",
    "pos_ingredients",
    "pos_payment_methods",
    "pos_staff",
    "pos_tables",
    "pos_recipes",
    "pos_orders",
    "pos_cierres",
    "pos_turnos",
    "pos_cash_movements",
    "pos_gastos",
    "pos_facturas",
    "pos_cfdi_requests",
    "pos_print_jobs",
    "pos_audit_log",
    "pos_inventory",
    "pos_inventory_movements",
    "pos_purchase_orders",
    "pos_purchase_order_items",
    "pos_customers",
    "pos_staff_shifts",
    "pos_schedules",
    "pos_promotions",
    "delivery_orders",
    "agent_runs",
    "agent_events",
    "integration_store_mappings",
    "integration_webhook_events",
    "integration_audit_log",
    "client_users",
]


def teardown(client_id: str = DEMO_CLIENT_ID, dry_run: bool = False) -> None:
    """Delete all rows for client_id='demo'. Fail-closed for any other client."""
    _assert_demo_only(client_id)
    log(f"Teardown starting for client_id='{client_id}' (dry_run={dry_run})")

    for table in _TEARDOWN_TABLES:
        if dry_run:
            log(f"DRY RUN — would delete {table} WHERE client_id='{client_id}'")
        else:
            try:
                _sb_delete(table, client_id)
                log(f"Deleted {table}")
            except Exception as e:
                # Tables that don't exist yet (new installs) are fine to skip
                log(f"Skip {table} ({type(e).__name__}: {str(e)[:80]})")

    # Delete the client root record last
    if dry_run:
        log(f"DRY RUN — would delete clients WHERE id='{client_id}'")
    else:
        try:
            from demo_seed import STAGING_SUPABASE_URL, STAGING_SUPABASE_KEY, _sb_headers, _assert_not_production
            import requests
            url = f"{STAGING_SUPABASE_URL}/rest/v1/clients"
            _assert_not_production(url)
            r = requests.delete(
                url,
                headers={**_sb_headers(), "Prefer": "return=minimal"},
                params={"id": f"eq.{client_id}"},
                timeout=30,
            )
            r.raise_for_status()
            log("Deleted clients record")
        except Exception as e:
            log(f"Skip clients ({type(e).__name__}: {str(e)[:80]})")

    log("Teardown complete")


def reset(seed_val: int = 42, dry_run: bool = False, client_id: str = DEMO_CLIENT_ID) -> dict:
    """
    Full reset: teardown + reseed.

    Returns the seed result dict (including state_md5).
    Two consecutive calls with same seed_val produce identical state_md5.
    Completes in < 30 seconds under normal network conditions.
    """
    _assert_demo_only(client_id)
    t0 = time.monotonic()
    log(f"Reset starting (client_id={client_id!r}, seed={seed_val}, dry_run={dry_run})")

    teardown(client_id=client_id, dry_run=dry_run)
    result = seed(seed_val=seed_val, dry_run=dry_run, client_id=client_id)

    elapsed = time.monotonic() - t0
    log(f"Reset complete in {elapsed:.1f}s. State MD5: {result['state_md5']}")

    if elapsed >= 30:
        log(f"WARNING: reset took {elapsed:.1f}s (exceeded 30s target)")

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset demo tenant on staging")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed (default: 42)")
    parser.add_argument("--dry-run", action="store_true", help="No DB writes")
    args = parser.parse_args()

    if not args.dry_run and (not STAGING_SUPABASE_URL or not STAGING_SUPABASE_KEY):
        log("ERROR: STAGING_SUPABASE_URL and STAGING_SUPABASE_KEY must be set")
        sys.exit(1)

    reset(seed_val=args.seed, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
