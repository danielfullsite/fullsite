"""
Shared aggregation logic for pos_orders → ops_daily metrics.

Used by both:
- pos_intraday_snapshot.py (snapshots every 15 min)
- pos_daily_aggregator.py (cierre at end of day)

Single source of truth for how POS orders become operational metrics.
"""

import json
from collections import defaultdict


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
