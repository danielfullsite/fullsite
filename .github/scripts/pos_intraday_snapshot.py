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

CLIENT = get_client()
CLIENT_ID = CLIENT["id"]
MX_TZ = get_tz(CLIENT)

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


def get_business_date(now_local):
    """Business day: if before 5 AM, it's still yesterday's business day."""
    if now_local.hour < 5:
        return (now_local - timedelta(days=1)).date()
    return now_local.date()


def get_bucket_start(now_local):
    """Floor to nearest 15-minute boundary in client timezone."""
    minute_bucket = (now_local.minute // 15) * 15
    return now_local.replace(minute=minute_bucket, second=0, microsecond=0)


def fetch_closed_orders(business_date):
    """
    Fetch all cerrada orders whose closed_at falls on the business day
    in the client's timezone.

    Business day window: business_date 05:00 → business_date+1 04:59:59
    (in client timezone, converted to UTC for the query).
    """
    day_start_local = datetime(business_date.year, business_date.month,
                               business_date.day, 5, 0, 0, tzinfo=MX_TZ)
    day_end_local = day_start_local + timedelta(hours=24)

    day_start_utc = day_start_local.astimezone(timezone.utc).isoformat()
    day_end_utc = day_end_local.astimezone(timezone.utc).isoformat()

    orders = sb_get("pos_orders", {
        "client_id": f"eq.{CLIENT_ID}",
        "status": "eq.cerrada",
        "closed_at": f"gte.{day_start_utc}",
        "and": f"(closed_at.lt.{day_end_utc})",
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
    """
    Aggregate closed orders into ops_daily metrics.

    Matches the exact column contract of ops_daily.
    """
    if not orders:
        return None

    ventas_dia = 0.0
    ventas_brutas = 0.0
    descuentos_total = 0.0
    propinas_total = 0.0
    efectivo = 0.0
    tarjeta = 0.0
    personas = 0
    mesas = set()

    mesero_ventas = defaultdict(float)
    platillo_data = defaultdict(lambda: {"cantidad": 0, "total": 0.0})
    grupo_ventas = defaultdict(float)
    pago_metodos = defaultdict(float)

    max_closed_at = None

    for order in orders:
        total = float(order.get("total") or 0)
        subtotal = float(order.get("subtotal") or 0)
        desc = float(order.get("descuento") or 0)
        prop = float(order.get("propina") or 0)
        mesero = order.get("mesero") or "Sin mesero"
        mesa = order.get("mesa")

        ventas_dia += total
        ventas_brutas += subtotal + desc  # bruto = neto + descuentos
        descuentos_total += desc
        propinas_total += prop
        personas += int(order.get("personas") or 0)
        if mesa:
            mesas.add(mesa)

        mesero_ventas[mesero] += total

        # Track closed_at for data_freshness
        cat = order.get("closed_at")
        if cat and (max_closed_at is None or cat > max_closed_at):
            max_closed_at = cat

        # Payment methods — use pagos array (split payments) if available
        pagos = order.get("pagos")
        if isinstance(pagos, str):
            try:
                pagos = json.loads(pagos)
            except Exception:
                pagos = None

        if isinstance(pagos, list) and pagos:
            for p in pagos:
                metodo = (p.get("metodo") or "Efectivo").strip()
                monto = float(p.get("monto") or 0)
                pago_metodos[metodo] += monto
                ml = metodo.lower()
                if "efectivo" in ml or "cash" in ml:
                    efectivo += monto
                else:
                    tarjeta += monto
        else:
            # Fallback: single metodo_pago
            metodo = (order.get("metodo_pago") or "Efectivo").strip()
            pago_metodos[metodo] += total
            ml = metodo.lower()
            if "efectivo" in ml or "cash" in ml:
                efectivo += total
            else:
                tarjeta += total

        # Line items → platillos_top + ventas_por_grupo
        items_raw = order.get("items")
        if isinstance(items_raw, str):
            try:
                items_raw = json.loads(items_raw)
            except Exception:
                items_raw = []
        if isinstance(items_raw, list):
            for item in items_raw:
                if not isinstance(item, dict):
                    continue
                nombre = item.get("nombre") or ""
                cantidad = int(item.get("cantidad") or 1)
                item_subtotal = float(item.get("subtotal") or item.get("precio") or 0) * cantidad
                menu_id = item.get("menuItemId") or ""

                platillo_data[nombre]["cantidad"] += cantidad
                platillo_data[nombre]["total"] += item_subtotal

                category = item_cat_map.get(menu_id, "Otros")
                grupo_ventas[category] += item_subtotal

    n_orders = len(orders)
    tp = round(ventas_dia / n_orders, 2) if n_orders > 0 else 0

    # Build JSONB arrays
    meseros_json = sorted(
        [{"nombre": k, "total": round(v, 2)} for k, v in mesero_ventas.items()],
        key=lambda x: -x["total"]
    )
    platillos_json = sorted(
        [{"nombre": k, "cantidad": v["cantidad"], "total": round(v["total"], 2)}
         for k, v in platillo_data.items()],
        key=lambda x: -x["total"]
    )[:20]
    grupos_json = sorted(
        [{"nombre": k, "total": round(v, 2)} for k, v in grupo_ventas.items()],
        key=lambda x: -x["total"]
    )
    pagos_json = sorted(
        [{"nombre": k, "total": round(v, 2)} for k, v in pago_metodos.items()],
        key=lambda x: -x["total"]
    )

    return {
        "ventas_dia": round(ventas_dia, 2),
        "ventas_brutas": round(ventas_brutas, 2),
        "descuentos": round(descuentos_total, 2),
        "devoluciones": 0,
        "efectivo": round(efectivo, 2),
        "tarjeta": round(tarjeta, 2),
        "tickets_count": n_orders,
        "mesas_atendidas": len(mesas),
        "personas_restaurant": personas,
        "ticket_promedio_restaurant": tp,
        "propinas_total": round(propinas_total, 2),
        "meseros": json.dumps(meseros_json),
        "platillos_top": json.dumps(platillos_json),
        "ventas_por_grupo": json.dumps(grupos_json),
        "pago_metodos": json.dumps(pagos_json),
        "rows_aggregated": n_orders,
        "data_freshness": max_closed_at,
    }


def main():
    start = time.time()

    now_local = datetime.now(MX_TZ)
    business_date = get_business_date(now_local)
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
