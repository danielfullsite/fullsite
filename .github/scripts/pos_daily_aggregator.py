#!/usr/bin/env python3
"""
POS Daily Aggregator — Multi-tenant
Suma todas las ordenes cerradas del dia y escribe a wansoft_daily.
Formato identico al scraper de Wansoft para que los 26 agentes
no noten el cambio cuando se apague Wansoft.

Corre al cierre (11pm MX) y genera el resumen del dia.
Tambien corre al avance (3pm MX) para intraday.

Logica:
1. Fetch todas las pos_orders cerradas del dia
2. Agregar: ventas, descuentos, propinas, metodos de pago
3. Agregar: ventas por mesero, top platillos, ventas por grupo
4. UPSERT en wansoft_daily (mismo formato, misma tabla)
5. Los agentes siguen leyendo de wansoft_daily sin cambios

Este script es el PUENTE entre Fullsite POS y el ecosistema de agentes.
Cuando AMALAY migre 100% a Fullsite POS, este agregador reemplaza
al scraper de Wansoft.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone, date
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz, get_chat_ids
from agent_common import log_run as _log_run

# -- Config --
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "ops")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")
TARGET_DATE = os.environ.get("TARGET_DATE", "")  # override: YYYY-MM-DD

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


def sb_get(table, params):
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=sb_headers, params=params, timeout=15,
        )
        return r.json() if r.ok else []
    except:
        return []


def sb_upsert_daily(fecha, data):
    """Check if row exists for fecha, then update or insert."""
    try:
        # Check if row exists
        existing = sb_get("wansoft_daily", {
            "select": "fecha",
            "fecha": f"eq.{fecha}",
            "limit": "1",
        })

        if existing:
            # UPDATE existing row
            r = requests.patch(
                f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}",
                headers={
                    **sb_headers,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=data, timeout=15,
            )
            print(f"PATCH {fecha}: {r.status_code}")
            return r.ok
        else:
            # INSERT new row
            r = requests.post(
                f"{SUPABASE_URL}/rest/v1/wansoft_daily",
                headers={
                    **sb_headers,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=data, timeout=15,
            )
            print(f"POST {fecha}: {r.status_code}")
            return r.ok
    except Exception as e:
        print(f"sb_upsert_daily error: {e}")
        return False


def get_target_date():
    """Determine which date to aggregate."""
    if TARGET_DATE:
        return TARGET_DATE
    now_mx = datetime.now(MX_TZ)
    return now_mx.strftime("%Y-%m-%d")


def fetch_closed_orders(fecha):
    """Fetch all closed POS orders for a given date."""
    # Orders closed on this date (using closed_at, not created_at)
    start = f"{fecha}T00:00:00"
    end = f"{fecha}T23:59:59"

    # Use PostgREST AND filter for date range
    orders = sb_get("pos_orders", {
        "select": "*",
        "client_id": f"eq.{CLIENT['id']}",
        "status": "eq.cerrada",
        "or": f"(closed_at.gte.{start},created_at.gte.{start})",
        "order": "created_at.asc",
        "limit": "500",
    })

    # Filter in Python to ensure correct date (PostgREST OR is loose)
    orders = [o for o in orders if
        (o.get("closed_at", "") or "").startswith(fecha) or
        (o.get("created_at", "") or "").startswith(fecha)
    ]

    return orders


def fetch_menu_categories():
    """Fetch menu categories for group mapping."""
    cats = sb_get("pos_menu_categories", {
        "select": "id,name",
        "client_id": f"eq.{CLIENT['id']}",
    })
    return {c["id"]: c["name"] for c in cats}


def fetch_menu_items():
    """Fetch menu items with their category."""
    items = sb_get("pos_menu_items", {
        "select": "id,name,category_id",
        "client_id": f"eq.{CLIENT['id']}",
    })
    return {i["name"].lower(): i.get("category_id", "") for i in items}


def aggregate(orders, cat_map, item_cat_map):
    """Aggregate orders into wansoft_daily format."""

    if not orders:
        return None

    # -- Basic totals --
    ventas_dia = 0
    ventas_brutas = 0
    descuentos_total = 0
    propinas_total = 0
    efectivo = 0
    tarjeta = 0
    personas_total = 0
    mesas = set()
    ordenes_llevar = 0
    metodos = defaultdict(float)
    mesero_ventas = defaultdict(float)
    platillo_ventas = defaultdict(float)
    platillo_counts = defaultdict(int)
    grupo_ventas = defaultdict(float)

    for order in orders:
        total = float(order.get("total", 0) or 0)
        subtotal = float(order.get("subtotal", 0) or 0)
        desc = float(order.get("descuento", 0) or 0)
        propina = float(order.get("propina", 0) or 0)
        personas = int(order.get("personas", 1) or 1)
        mesa_num = order.get("mesa", 0)
        mesero_name = order.get("mesero", "Desconocido")
        metodo = order.get("metodo_pago", "Efectivo") or "Efectivo"

        ventas_dia += total
        ventas_brutas += total + desc
        descuentos_total += desc
        propinas_total += propina
        personas_total += personas

        if mesa_num:
            mesas.add(mesa_num)

        # Metodo de pago
        metodos[metodo] += total
        if "efectivo" in metodo.lower():
            efectivo += total
        elif "tarjeta" in metodo.lower() or "credito" in metodo.lower() or "debito" in metodo.lower():
            tarjeta += total

        # Ventas por mesero
        mesero_ventas[mesero_name] += total

        # Items breakdown
        items = order.get("items", [])
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except:
                items = []

        for item in items:
            if item.get("cancelled"):
                continue
            nombre = item.get("nombre", item.get("name", ""))
            cantidad = int(item.get("cantidad", item.get("quantity", 1)) or 1)
            precio = float(item.get("precio", item.get("price", 0)) or 0)
            item_total = precio * cantidad

            if nombre:
                platillo_ventas[nombre] += item_total
                platillo_counts[nombre] = platillo_counts.get(nombre, 0) + cantidad

                # Map to category/group
                cat_id = item_cat_map.get(nombre.lower(), "")
                cat_name = cat_map.get(cat_id, "VARIOS")
                grupo_ventas[cat_name] += item_total

    tickets_count = len(orders)
    mesas_atendidas = len(mesas)
    ticket_promedio = ventas_dia / tickets_count if tickets_count > 0 else 0

    # -- Build wansoft_daily row --
    row = {
        "fecha": get_target_date(),
        "client_slug": CLIENT["id"],
        "report_type": "fullsite_pos",  # mark as coming from Fullsite, not Wansoft
        "ventas_dia": round(ventas_dia, 2),
        "ventas_brutas": round(ventas_brutas, 2),
        "descuentos": round(descuentos_total, 2),
        "devoluciones": 0,
        "efectivo": round(efectivo, 2),
        "tarjeta": round(tarjeta, 2),
        "tickets_count": tickets_count,
        "mesas_atendidas": mesas_atendidas,
        "ordenes_llevar": ordenes_llevar,
        "personas_restaurant": personas_total,
        "cuentas_restaurant": tickets_count,
        "ticket_promedio_restaurant": round(ticket_promedio, 2),
        "propinas_total": round(propinas_total, 2),
        "chilaquiles_total": round(sum(v for k, v in platillo_ventas.items() if "chilaquil" in k.lower()), 2),
        "half_half_total": round(sum(v for k, v in platillo_ventas.items() if "half" in k.lower()), 2),
        "meseros": json.dumps(
            sorted([{"nombre": k, "total": round(v, 2)} for k, v in mesero_ventas.items()],
                   key=lambda x: x["total"], reverse=True)
        ),
        "platillos_top": json.dumps(
            sorted([{"nombre": k, "cantidad": platillo_counts.get(k, 0), "total": round(v, 2)} for k, v in platillo_ventas.items()],
                   key=lambda x: x["total"], reverse=True)[:20]
        ),
        "ventas_por_grupo": json.dumps(
            sorted([{"nombre": k, "total": round(v, 2)} for k, v in grupo_ventas.items()],
                   key=lambda x: x["total"], reverse=True)
        ),
        "pago_metodos": json.dumps(
            sorted([{"nombre": k, "total": round(v, 2)} for k, v in metodos.items()],
                   key=lambda x: x["total"], reverse=True)
        ),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    return row


def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        try:
            requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
                timeout=10,
            )
        except:
            pass


def log_run(status, duration_ms, summary, tokens=0):
    _data_status = "ok" if status == "success" else ("no_data" if status == "no_data" else "error")
    _log_run(
        agent_id="pos-daily-aggregator",
        status=status,
        duration_ms=duration_ms,
        output_summary=summary[:500] if summary else "",
        tentacle="ops",
        data_status=_data_status,
        rows_processed=0,
    )


if __name__ == "__main__":
    start = time.time()
    try:
        fecha = get_target_date()
        print(f"Agregando ordenes para {fecha}...")

        orders = fetch_closed_orders(fecha)
        cat_map = fetch_menu_categories()
        item_cat_map = fetch_menu_items()

        if not orders:
            print(f"Sin ordenes cerradas para {fecha}")
            duration = int((time.time() - start) * 1000)
            log_run("no_data", duration, f"0 ordenes para {fecha}")
            sys.exit(0)

        row = aggregate(orders, cat_map, item_cat_map)

        if row:
            ok = sb_upsert_daily(fecha, row)
            if ok:
                print(f"OK — {row['tickets_count']} ordenes, ${row['ventas_dia']:,.2f} ventas")

                # Dual-write: also write cierre to ops_daily
                try:
                    from ops_aggregate import aggregate_orders
                    ops_row = {
                        "client_id": CLIENT["id"],
                        "fecha": fecha,
                        "record_type": "cierre",
                        "source_system": "fullsite",
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                        "data_freshness": row.get("data_freshness") or datetime.now(timezone.utc).isoformat(),
                        "rows_aggregated": row.get("rows_aggregated", row["tickets_count"]),
                        "ventas_dia": row["ventas_dia"],
                        "ventas_brutas": row["ventas_brutas"],
                        "descuentos": row["descuentos"],
                        "devoluciones": row.get("devoluciones", 0),
                        "efectivo": row["efectivo"],
                        "tarjeta": row["tarjeta"],
                        "tickets_count": row["tickets_count"],
                        "mesas_atendidas": row["mesas_atendidas"],
                        "personas_restaurant": row["personas_restaurant"],
                        "ticket_promedio_restaurant": row["ticket_promedio_restaurant"],
                        "propinas_total": row["propinas_total"],
                        "meseros": row["meseros"],
                        "platillos_top": row["platillos_top"],
                        "ventas_por_grupo": row["ventas_por_grupo"],
                        "pago_metodos": row["pago_metodos"],
                    }
                    # INSERT or UPDATE cierre for this date
                    r_ops = requests.post(
                        f"{SUPABASE_URL}/rest/v1/ops_daily",
                        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                        json=ops_row, timeout=15,
                    )
                    if r_ops.status_code == 409 or r_ops.status_code == 400:
                        requests.patch(
                            f"{SUPABASE_URL}/rest/v1/ops_daily?client_id=eq.{CLIENT['id']}&fecha=eq.{fecha}&record_type=eq.cierre",
                            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                            json={k: v for k, v in ops_row.items() if k not in ("client_id", "fecha", "record_type", "source_system")},
                            timeout=15,
                        )
                    print(f"  ops_daily cierre written for {fecha}")
                except Exception as e:
                    print(f"  WARN: ops_daily write failed: {e}", file=sys.stderr)

                # Parse meseros for summary
                meseros = json.loads(row["meseros"])
                top_mesero = meseros[0]["nombre"].split()[0] if meseros else "N/A"

                msg = (
                    f"📊 *Agregador POS* — {fecha}\n\n"
                    f"• Ordenes: *{row['tickets_count']}*\n"
                    f"• Ventas: *${row['ventas_dia']:,.2f}*\n"
                    f"• Personas: *{row['personas_restaurant']}*\n"
                    f"• Ticket prom: *${row['ticket_promedio_restaurant']:,.2f}*\n"
                    f"• Propinas: *${row['propinas_total']:,.2f}*\n"
                    f"• Top mesero: *{top_mesero}*\n"
                    f"• Efectivo: ${row['efectivo']:,.2f} / Tarjeta: ${row['tarjeta']:,.2f}\n\n"
                    f"_Datos escritos a wansoft\\_daily + ops\\_daily._"
                )
                send_telegram(msg)

                duration = int((time.time() - start) * 1000)
                log_run("success", duration, f"{row['tickets_count']} ordenes, ${row['ventas_dia']:,.2f}")
            else:
                print("ERROR: No se pudo escribir a wansoft_daily")
                duration = int((time.time() - start) * 1000)
                log_run("error", duration, "upsert failed")
                sys.exit(1)

    except Exception as e:
        duration = int((time.time() - start) * 1000)
        log_run("error", duration, str(e)[:200])
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
