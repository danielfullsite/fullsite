#!/usr/bin/env python3
"""
POS Intraday Snapshot — writes accumulated business-day metrics to ops_daily.

Runs every 15 minutes during service hours. Each run produces one snapshot
for the current 15-minute bucket. Rerunning within the same bucket is
idempotent (UPSERT by partial unique index).

Revenue recognition:
  - Only orders with status='cerrada' are counted as revenue.
  - 'enviada', 'entregada', 'abierta', 'preparando' = open, not revenue.
  - 'cancelada', 'anulada' = excluded from revenue.
  - An order created yesterday but closed today belongs to today's business day
    (determined by closed_at in client timezone, not created_at).

Business day:
  - Determined by client timezone (clients.timezone).
  - If current time is before 5:00 AM local, the business day is yesterday.
    This handles late-night closes correctly.

Bucket:
  - 15-minute canonical bucket: floor(minute / 15) * 15.
  - bucket_start is in client timezone, stored as TIMESTAMPTZ.
  - Example: run at 14:23 MX → bucket_start = 2026-07-14T14:15:00-06:00.

Idempotency:
  - UPSERT via ON CONFLICT on partial unique index uq_ops_daily_snapshot
    (client_id, fecha, bucket_start) WHERE record_type = 'snapshot'.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz
from agent_common import log_run as _log_run
from ops_aggregate import aggregate_orders, get_business_day_config, get_business_day_bounds

CLIENT = get_client()
CLIENT_ID = CLIENT["id"]
MX_TZ = get_tz(CLIENT)  # kept for display/logging; business-day logic uses shared primitive
BIZ_TZ, BIZ_BOUNDARY = get_business_day_config(CLIENT)  # fails closed if missing

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}",
                     headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def sb_upsert_snapshot(data):
    """
    Insert or update a snapshot in ops_daily.
    PostgREST can't use partial unique indexes for merge-duplicates,
    so we use raw SQL via the management API or a two-step check.
    """
    # Try INSERT first
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/ops_daily",
        headers={**sb_headers, "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
        json=data, timeout=15,
    )
    if r.status_code == 409 or r.status_code == 400:
        # Row exists for this bucket — UPDATE it
        client_id = data["client_id"]
        fecha = data["fecha"]
        bucket = data["bucket_start"]
        update_data = {k: v for k, v in data.items()
                       if k not in ("client_id", "fecha", "record_type", "bucket_start", "source_system")}
        r2 = requests.patch(
            f"{SUPABASE_URL}/rest/v1/ops_daily?"
            f"client_id=eq.{client_id}&fecha=eq.{fecha}"
            f"&record_type=eq.snapshot&bucket_start=eq.{bucket}",
            headers={**sb_headers, "Content-Type": "application/json",
                     "Prefer": "return=minimal"},
            json=update_data, timeout=15,
        )
        r2.raise_for_status()
    elif r.status_code >= 400:
        r.raise_for_status()


def get_biz_date(now_local):
    """Business day from local time, using canonical boundary from client config."""
    boundary_today = now_local.replace(hour=BIZ_BOUNDARY.hour,
                                       minute=BIZ_BOUNDARY.minute,
                                       second=0, microsecond=0)
    if now_local < boundary_today:
        return (now_local.date() - timedelta(days=1))
    return now_local.date()


def get_bucket_start(now_local):
    """Floor to nearest 15-minute boundary in client timezone."""
    minute_bucket = (now_local.minute // 15) * 15
    return now_local.replace(minute=minute_bucket, second=0, microsecond=0)


def fetch_closed_orders(business_date):
    """Fetch all cerrada orders whose closed_at falls on the business day.

    Uses canonical shared primitive for business-day bounds.
    """
    _, _, utc_start, utc_end = get_business_day_bounds(
        str(business_date), BIZ_TZ, BIZ_BOUNDARY)

    orders = sb_get("pos_orders", {
        "client_id": f"eq.{CLIENT_ID}",
        "status": "eq.cerrada",
        "closed_at": f"gte.{utc_start.isoformat()}",
        "and": f"(closed_at.lt.{utc_end.isoformat()})",
        "order": "closed_at.asc",
        "limit": "1000",
    })
    return orders


def fetch_menu_maps():
    """Build menuItemId → category_name mapping."""
    categories = sb_get("pos_menu_categories", {
        "client_id": f"eq.{CLIENT_ID}",
        "select": "id,name",
    })
    cat_map = {c["id"]: c["name"] for c in categories}

    items = sb_get("pos_menu_items", {
        "client_id": f"eq.{CLIENT_ID}",
        "select": "id,category_id",
    })
    item_cat = {}
    for item in items:
        cid = item.get("category_id")
        item_cat[item["id"]] = cat_map.get(cid, "Otros")

    return item_cat


def aggregate(orders, item_cat_map):
    """Delegate to shared aggregation logic."""
    return aggregate_orders(orders, item_cat_map)


def main():
    start = time.time()

    now_local = datetime.now(BIZ_TZ)
    business_date = get_biz_date(now_local)
    bucket = get_bucket_start(now_local)

    print(f"[intraday] {now_local.strftime('%Y-%m-%d %H:%M')} MX | "
          f"business_date={business_date} | bucket={bucket.isoformat()}")

    orders = fetch_closed_orders(business_date)
    print(f"[intraday] {len(orders)} cerrada orders for {business_date}")

    if not orders:
        duration = int((time.time() - start) * 1000)
        _log_run("pos-intraday-snapshot", "no_data", duration,
                 output_summary=f"0 ordenes cerradas para {business_date}",
                 tentacle="ops", data_status="no_data",
                 rows_processed=0,
                 skip_reason=f"Sin ordenes cerradas para {business_date}")
        print(f"[intraday] No cerrada orders — snapshot skipped")
        sys.exit(0)

    item_cat_map = fetch_menu_maps()
    metrics = aggregate(orders, item_cat_map)

    # Write snapshot to ops_daily
    row = {
        "client_id": CLIENT_ID,
        "fecha": str(business_date),
        "record_type": "snapshot",
        "bucket_start": bucket.isoformat(),
        "source_system": "fullsite",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **metrics,
    }

    sb_upsert_snapshot(row)

    duration = int((time.time() - start) * 1000)
    summary = (f"${metrics['ventas_dia']:,.0f} ventas, "
               f"{metrics['tickets_count']} tickets, "
               f"{metrics['personas_restaurant']} personas, "
               f"bucket={bucket.strftime('%H:%M')}")
    print(f"[intraday] Snapshot written: {summary}")

    _log_run("pos-intraday-snapshot", "success", duration,
             output_summary=summary, tentacle="ops",
             data_status="ok", rows_processed=metrics["rows_aggregated"],
             input_freshness=metrics.get("data_freshness"))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        duration = int((time.time() - time.time()) * 1000)
        _log_run("pos-intraday-snapshot", "error", 0,
                 output_summary=f"ERROR: {str(e)[:100]}",
                 error_message=str(e)[:500],
                 tentacle="ops", data_status="error")
        print(f"[intraday] FATAL: {e}", file=sys.stderr)
        sys.exit(1)
