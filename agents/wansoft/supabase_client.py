"""
Persistencia a Supabase para reportes de Wansoft.
NO bloquea el envio de Telegram si falla.

REGLA: nunca escribir ventas_dia=null. Si el parser no tiene el dato,
no tocar el campo. El avance (3pm) siempre tiene ventas, el cierre
actualiza el mismo row.
"""
import os
import sys
import json
import requests
from datetime import datetime, timezone
from typing import Any, Dict


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def upsert_daily_report(
    fecha: str,
    report_type: str,
    agg_meseros: Dict[str, Any],
    agg_platillos: Dict[str, Any],
    client_slug: str = "amalay",
) -> bool:
    """
    Upsert del reporte diario a wansoft_daily.
    Avance y cierre actualizan el MISMO row (no crean duplicados).
    NUNCA escribe ventas_dia=null.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[supabase_client] SUPABASE_URL o KEY no configurado", file=sys.stderr)
        return False

    try:
        # Build row — only include fields that have actual values
        row: Dict[str, Any] = {
            "fecha": fecha,
            "report_type": report_type,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        # From agg_meseros — only set if value exists and is not None
        ventas = agg_meseros.get("total_dia")
        if ventas is not None and ventas > 0:
            row["ventas_dia"] = ventas

        # NOTE: personas_restaurant, tickets_count, and ticket_promedio_restaurant
        # are NOT written here. They come from intraday_sales.py which uses the
        # Wansoft HTTP API (SalesByTypeOfOrder) — the same source as the Wansoft app.
        # The XLSX "Reporte por Mesero" has different definitions for "personas"
        # (sum of per-mesero personas vs total covers) which caused data mismatches.
        # See: https://github.com/ramonfaurdaniel-png/fullsite/issues/data-accuracy

        meseros = agg_meseros.get("meseros_top")
        if meseros:
            row["meseros"] = json.dumps(meseros) if not isinstance(meseros, str) else meseros

        # From agg_platillos
        chil = agg_platillos.get("chilaquiles_total")
        if chil is not None:
            row["chilaquiles_total"] = chil

        hh = agg_platillos.get("half_half_total")
        if hh is not None:
            row["half_half_total"] = hh

        platillos = agg_platillos.get("platillos_top")
        if platillos:
            row["platillos_top"] = json.dumps(platillos) if not isinstance(platillos, str) else platillos

        ventas_grupo = agg_platillos.get("ventas_por_grupo")
        if ventas_grupo:
            row["ventas_por_grupo"] = json.dumps(ventas_grupo) if not isinstance(ventas_grupo, str) else ventas_grupo

        pago = agg_platillos.get("pago_metodos")
        if pago:
            row["pago_metodos"] = json.dumps(pago) if not isinstance(pago, str) else pago

        ventas_brutas = agg_platillos.get("ventas_brutas") or agg_meseros.get("ventas_brutas")
        if ventas_brutas is not None:
            row["ventas_brutas"] = ventas_brutas

        descuentos = agg_platillos.get("descuentos") or agg_meseros.get("descuentos")
        if descuentos is not None:
            row["descuentos"] = descuentos

        # Check if row for this date already exists
        check = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}&ventas_dia=gt.0&limit=1",
            headers=_sb_headers(), timeout=10,
        )

        if check.ok and check.json():
            # UPDATE existing row (PATCH)
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/wansoft_daily?fecha=eq.{fecha}&ventas_dia=gt.0",
                headers={**_sb_headers(), "Prefer": "return=minimal"},
                json=row, timeout=10,
            )
            print(f"[supabase_client] PATCH {fecha} {report_type}: {resp.status_code}", file=sys.stderr)
        else:
            # INSERT new row — but only if we have ventas_dia
            if "ventas_dia" not in row:
                print(f"[supabase_client] SKIP {fecha} {report_type}: no ventas_dia, won't create empty row", file=sys.stderr)
                return False
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/wansoft_daily",
                headers={**_sb_headers(), "Prefer": "return=minimal"},
                json=row, timeout=10,
            )
            print(f"[supabase_client] POST {fecha} {report_type}: {resp.status_code}", file=sys.stderr)

        return resp.ok

    except Exception as e:
        print(f"[supabase_client] FAIL: {e}", file=sys.stderr)
        return False
