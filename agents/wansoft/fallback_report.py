#!/usr/bin/env python3
"""
Fallback: cuando Wansoft web truena (error de su lado), construye el
reporte de meseros desde Supabase (wansoft_daily, alimentada por el
pipeline HTTP intraday) y lo manda igual a Telegram.

NO toca scraper.py / parser.py / sender.py — solo lee Supabase.
"""
import os
import sys
import json
from typing import Any, Dict, List, Optional

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def _loads_jsonb(value: Any) -> List[Dict[str, Any]]:
    """wansoft_daily guarda jsonb a veces double-encoded como string."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, ValueError):
            return []
    return []


def _fmt(n: float) -> str:
    return f"${n:,.2f}"


def build_fallback_message(target_date: str, report_type: str) -> Optional[str]:
    """Construye el reporte desde wansoft_daily. None si no hay datos."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[fallback] SUPABASE_URL/KEY no configurado", file=sys.stderr)
        return None

    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily",
            headers=_headers(),
            params={"fecha": f"eq.{target_date}", "limit": "1"},
            timeout=15,
        )
        rows = r.json() if r.ok else []
    except Exception as e:
        print(f"[fallback] error consultando Supabase: {e}", file=sys.stderr)
        return None

    if not rows:
        print(f"[fallback] sin datos en wansoft_daily para {target_date}", file=sys.stderr)
        return None

    row = rows[0]
    ventas = float(row.get("ventas_dia") or 0)
    if ventas <= 0:
        print(f"[fallback] ventas_dia vacio para {target_date}", file=sys.stderr)
        return None

    tickets = row.get("tickets_count") or 0
    propinas = float(row.get("propinas_total") or 0)
    personas = row.get("personas_restaurant") or 0
    ticket_prom = float(row.get("ticket_promedio_restaurant") or 0)
    if not ticket_prom and tickets:
        ticket_prom = ventas / tickets

    meseros = _loads_jsonb(row.get("meseros"))
    grupos = _loads_jsonb(row.get("ventas_por_grupo"))

    titulo = "CIERRE" if report_type == "cierre" else "AVANCE"
    lines = [
        f"📊 *{titulo} {target_date}* (fuente: Fullsite — Wansoft web caído)",
        "",
        f"💰 Ventas: *{_fmt(ventas)}*",
        f"🧾 Tickets: {tickets}" + (f" | 👥 Personas: {personas}" if personas else ""),
    ]
    if ticket_prom:
        lines.append(f"🎟 Ticket promedio: {_fmt(ticket_prom)}")
    if propinas:
        lines.append(f"💵 Propinas: {_fmt(propinas)}")

    if meseros:
        lines += ["", "*Meseros:*"]
        for m in sorted(meseros, key=lambda x: -float(x.get("total") or 0))[:10]:
            lines.append(f"  • {m.get('nombre', '?')}: {_fmt(float(m.get('total') or 0))}")

    if grupos:
        lines += ["", "*Top categorías:*"]
        for g in sorted(grupos, key=lambda x: -float(x.get("total") or 0))[:8]:
            lines.append(f"  • {g.get('nombre', '?')}: {_fmt(float(g.get('total') or 0))}")

    lines += ["", "_Reporte generado desde datos Fullsite (el portal de Wansoft tiene un error del lado de ellos)._"]
    return "\n".join(lines)
