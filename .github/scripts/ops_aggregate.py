"""
Shared aggregation logic for pos_orders → ops_daily metrics.

Used by both:
- pos_intraday_snapshot.py (snapshots every 15 min)
- pos_daily_aggregator.py (cierre at end of day)

Single source of truth for:
1. Business-day attribution (which date an order belongs to)
2. Revenue aggregation (pos_orders → ops_daily metrics)
"""

import json
from datetime import datetime, timedelta, date, time, timezone
from zoneinfo import ZoneInfo
from collections import defaultdict


# ── Business-day primitives ─────────────────────────────────────────────────
# Every producer MUST use these instead of hardcoding boundaries.

def get_business_day_config(client):
    """Read business-day config from client row. Fail closed if missing.

    Args:
        client: dict from client_config.get_client() (Supabase clients row)

    Returns:
        (tz: ZoneInfo, boundary: datetime.time)

    Raises:
        ValueError if timezone or business_day_start_local is missing/invalid.
    """
    tz_name = client.get("timezone")
    if not tz_name:
        raise ValueError(
            f"Client '{client.get('id')}' has no timezone configured. "
            f"Set clients.timezone to an IANA timezone (e.g. 'America/Monterrey')."
        )
    try:
        tz = ZoneInfo(tz_name)
    except (KeyError, Exception) as e:
        raise ValueError(
            f"Client '{client.get('id')}' has invalid timezone '{tz_name}': {e}"
        )

    boundary_raw = client.get("business_day_start_local")
    if not boundary_raw:
        raise ValueError(
            f"Client '{client.get('id')}' has no business_day_start_local configured. "
            f"Set clients.business_day_start_local (e.g. '05:00:00')."
        )
    # Parse TIME from string (Supabase returns "HH:MM:SS" for TIME columns)
    if isinstance(boundary_raw, str):
        parts = boundary_raw.split(":")
        try:
            boundary = time(int(parts[0]), int(parts[1]),
                            int(parts[2]) if len(parts) > 2 else 0)
        except (ValueError, IndexError) as e:
            raise ValueError(
                f"Client '{client.get('id')}' has invalid business_day_start_local "
                f"'{boundary_raw}': {e}"
            )
    elif isinstance(boundary_raw, time):
        boundary = boundary_raw
    else:
        raise ValueError(
            f"Client '{client.get('id')}' business_day_start_local has unexpected "
            f"type {type(boundary_raw)}: {boundary_raw}"
        )

    return tz, boundary


def get_business_day_bounds(fecha_str, tz, boundary_local_time):
    """Return [local_start, local_end, utc_start, utc_end) for a business day.

    Business day runs from [fecha at boundary, next_calendar_date at boundary).
    Each bound is constructed from its own calendar date — DST safe.

    Args:
        fecha_str: 'YYYY-MM-DD'
        tz: ZoneInfo instance
        boundary_local_time: datetime.time (e.g. time(5, 0))

    Returns:
        (local_start, local_end, utc_start, utc_end)
    """
    y, m, d = map(int, fecha_str.split("-"))
    local_start = datetime(y, m, d, boundary_local_time.hour,
                           boundary_local_time.minute, 0, tzinfo=tz)
    next_d = date(y, m, d) + timedelta(days=1)
    local_end = datetime(next_d.year, next_d.month, next_d.day,
                         boundary_local_time.hour,
                         boundary_local_time.minute, 0, tzinfo=tz)
    return (local_start, local_end,
            local_start.astimezone(timezone.utc),
            local_end.astimezone(timezone.utc))


def get_business_date(timestamp_utc_str, tz, boundary_local_time):
    """Determine which business date a UTC timestamp belongs to.

    Converts to local time, then: if local time < boundary → previous calendar day.

    Args:
        timestamp_utc_str: ISO format UTC timestamp
        tz: ZoneInfo instance
        boundary_local_time: datetime.time

    Returns:
        'YYYY-MM-DD' string
    """
    ts = datetime.fromisoformat(timestamp_utc_str).astimezone(tz)
    boundary_today = ts.replace(hour=boundary_local_time.hour,
                                minute=boundary_local_time.minute,
                                second=0, microsecond=0)
    if ts < boundary_today:
        return (ts.date() - timedelta(days=1)).isoformat()
    return ts.date().isoformat()


def get_current_business_date(client):
    """Return current business date string for this client.

    Ergonomic wrapper — delegates entirely to the canonical primitive.
    No independent attribution logic.
    """
    tz, boundary = get_business_day_config(client)
    now_utc = datetime.now(timezone.utc).isoformat()
    return get_business_date(now_utc, tz, boundary)


def aggregate_orders(orders, item_cat_map):
    """
    Aggregate closed pos_orders into ops_daily metrics.

    Revenue recognition:
    - Only orders with status='cerrada' should be passed in.
    - Caller is responsible for filtering by status and business date.

    Args:
        orders: list of pos_orders rows (dicts)
        item_cat_map: dict mapping menuItemId → category_name

    Returns:
        dict with all ops_daily metric columns, or None if no orders.
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
        ventas_brutas += subtotal + desc
        descuentos_total += desc
        propinas_total += prop
        personas += int(order.get("personas") or 0)
        if mesa:
            mesas.add(mesa)

        mesero_ventas[mesero] += total

        # Track max closed_at for data_freshness
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
