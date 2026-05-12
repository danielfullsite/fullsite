"""
Persistencia a Supabase para reportes de Wansoft.
NO bloquea el envio de Telegram si falla.
"""
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    from supabase import create_client, Client
except ImportError:
    print("[supabase_client] supabase SDK no instalado, persistencia deshabilitada", file=sys.stderr)
    create_client = None


def get_supabase() -> Optional["Client"]:
    """Retorna cliente Supabase o None si no esta configurado."""
    if create_client is None:
        return None

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("[supabase_client] SUPABASE_URL o SUPABASE_SERVICE_KEY no configurado", file=sys.stderr)
        return None

    return create_client(url, key)


def upsert_daily_report(
    fecha: str,
    report_type: str,
    agg_meseros: Dict[str, Any],
    agg_platillos: Dict[str, Any],
    client_slug: str = "amalay",
) -> bool:
    """
    UPSERT del reporte diario a wansoft_daily.
    Retorna True si exitoso, False si hubo error.
    NO levanta excepcion.
    """
    try:
        supabase = get_supabase()
        if supabase is None:
            return False

        row = {
            "client_slug": client_slug,
            "fecha": fecha,
            "report_type": report_type,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            # De agg_meseros
            "ventas_dia": agg_meseros.get("total_dia"),
            "personas_restaurant": agg_meseros.get("personas_dia"),
            "ticket_promedio_restaurant": agg_meseros.get("ticket_promedio"),
            "meseros": agg_meseros.get("meseros_top", []),
            # De agg_platillos
            "chilaquiles_total": agg_platillos.get("chilaquiles_total"),
            "half_half_total": agg_platillos.get("half_half_total"),
            "platillos_top": agg_platillos.get("platillos_top", []),
        }

        supabase.table("wansoft_daily").upsert(
            row, on_conflict="client_slug,fecha,report_type"
        ).execute()
        print(f"[supabase_client] UPSERT OK: {fecha} {report_type}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[supabase_client] UPSERT FAIL: {e}", file=sys.stderr)
        return False
