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

        # ══════════════════════════════════════════════════════════════════
        # CRITICAL: This XLSX parser ONLY writes meseros.
        # ALL other fields come from intraday_sales.py (HTTP API).
        #
        # WHY: The XLSX "Reporte por Mesero" has different values:
        # - ventas_dia: XLSX = subtotals sin IVA ($45K), API = TotalSales con IVA ($63K)
        # - personas: XLSX = sum per-mesero (84), API = real covers (158)
        # - platillos/grupos/pagos: not in XLSX at all
        #
        # The XLSX is ONLY useful for mesero names (properly formatted).
        # If we write ventas_dia here, it overwrites the correct API value.
        # ══════════════════════════════════════════════════════════════════

        meseros = agg_meseros.get("meseros_top")
        if meseros:
            row["meseros"] = json.dumps(meseros) if not isinstance(meseros, str) else meseros

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
