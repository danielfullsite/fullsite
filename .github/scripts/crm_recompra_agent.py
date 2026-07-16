#!/usr/bin/env python3
"""
CRM Recompra Agent — Detects regular customers who stopped coming.
Analyzes wansoft_daily mesero patterns to identify revenue at risk.
Runs weekly (Mondays). Sends Telegram alert with recovery opportunities.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("crm_recompra_agent")
except ImportError:
    _audit = None
CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_IDS  = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
start_time = time.time()
if _audit: _audit.log_start()
status = "success"
output_sum = ""
error_msg = None

def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data, timeout=15)
    r.raise_for_status()

def sb_upsert(table, data):
    headers_u = {**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers_u, json=data, timeout=15)
    if r.status_code == 409:
        agent_id = data.get("agent_id", "")
        fecha = data.get("fecha", "")
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?agent_id=eq.{agent_id}&fecha=eq.{fecha}",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={k: v for k, v in data.items() if k not in ("agent_id", "fecha")},
            timeout=15)
    r.raise_for_status()

def send_telegram(text):
    for chat_id in TG_CHAT_IDS:
        for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk}, timeout=15)

try:
    cid = CLIENT["id"]
    MX_TZ = get_tz(CLIENT)
    now_mx = datetime.now(timezone.utc).astimezone(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[crm] Starting for {cid}...")

    # Get last 60 days of daily data with meseros
    days_60 = sb_get("wansoft_daily", {
        "client_slug": f"eq.{cid}",
        "ventas_dia": "gt.0",
        "select": "fecha,ventas_dia,tickets_count,ticket_promedio_restaurant,meseros",
        "order": "fecha.desc",
        "limit": "60",
    })

    if len(days_60) < 14:
        output_sum = f"Insuficiente historial ({len(days_60)} días). Necesita 14+ días."
        print(f"[crm] {output_sum}")
        raise SystemExit(0)

    # Analyze: ventas trends (week over week)
    recent_7 = days_60[:7]
    prev_7 = days_60[7:14]

    avg_recent = sum(d.get("ventas_dia", 0) or 0 for d in recent_7) / max(len(recent_7), 1)
    avg_prev = sum(d.get("ventas_dia", 0) or 0 for d in prev_7) / max(len(prev_7), 1)
    ventas_change = ((avg_recent - avg_prev) / avg_prev * 100) if avg_prev > 0 else 0

    avg_tickets_recent = sum(d.get("tickets_count", 0) or 0 for d in recent_7) / max(len(recent_7), 1)
    avg_tickets_prev = sum(d.get("tickets_count", 0) or 0 for d in prev_7) / max(len(prev_7), 1)
    tickets_change = ((avg_tickets_recent - avg_tickets_prev) / avg_tickets_prev * 100) if avg_tickets_prev > 0 else 0

    avg_tp_recent = sum(d.get("ticket_promedio_restaurant", 0) or 0 for d in recent_7) / max(len(recent_7), 1)
    avg_tp_prev = sum(d.get("ticket_promedio_restaurant", 0) or 0 for d in prev_7) / max(len(prev_7), 1)

    # Mesero performance trends
    mesero_recent = defaultdict(float)
    mesero_prev = defaultdict(float)
    mesero_recent_days = defaultdict(int)
    mesero_prev_days = defaultdict(int)

    for d in recent_7:
        meseros = d.get("meseros", [])
        if isinstance(meseros, str):
            try: meseros = json.loads(meseros)
            except: meseros = []
        for m in (meseros or []):
            name = m.get("nombre", "")
            total = m.get("total", 0) or 0
            if name and total > 0:
                mesero_recent[name] += total
                mesero_recent_days[name] += 1

    for d in prev_7:
        meseros = d.get("meseros", [])
        if isinstance(meseros, str):
            try: meseros = json.loads(meseros)
            except: meseros = []
        for m in (meseros or []):
            name = m.get("nombre", "")
            total = m.get("total", 0) or 0
            if name and total > 0:
                mesero_prev[name] += total
                mesero_prev_days[name] += 1

    # Find meseros who dropped significantly
    dropping_meseros = []
    for name in set(list(mesero_recent.keys()) + list(mesero_prev.keys())):
        recent = mesero_recent.get(name, 0)
        prev = mesero_prev.get(name, 0)
        if prev > 0:
            change = ((recent - prev) / prev) * 100
            if change < -20:  # dropped more than 20%
                dropping_meseros.append({
                    "nombre": name,
                    "recent": round(recent),
                    "prev": round(prev),
                    "change": round(change, 1),
                    "recent_days": mesero_recent_days.get(name, 0),
                    "prev_days": mesero_prev_days.get(name, 0),
                })

    dropping_meseros.sort(key=lambda x: x["change"])

    # Estimate revenue at risk
    total_drop = sum(m["prev"] - m["recent"] for m in dropping_meseros if m["recent"] < m["prev"])

    # Build message
    lines = [f"CRM RECOMPRA — Análisis semanal {today_str}"]
    lines.append(f"\nVentas promedio/día:")
    lines.append(f"  Esta semana: ${avg_recent:,.0f} ({ventas_change:+.1f}%)")
    lines.append(f"  Semana pasada: ${avg_prev:,.0f}")
    lines.append(f"\nTickets promedio/día:")
    lines.append(f"  Esta semana: {avg_tickets_recent:.0f} ({tickets_change:+.1f}%)")
    lines.append(f"  Semana pasada: {avg_tickets_prev:.0f}")
    lines.append(f"\nTicket promedio:")
    lines.append(f"  Esta semana: ${avg_tp_recent:,.0f}")
    lines.append(f"  Semana pasada: ${avg_tp_prev:,.0f}")

    if dropping_meseros:
        lines.append(f"\n{len(dropping_meseros)} mesero(s) con caída >20%:")
        for m in dropping_meseros[:5]:
            lines.append(f"  {m['nombre']}: ${m['recent']:,} vs ${m['prev']:,} ({m['change']:+.1f}%)")
            lines.append(f"    {m['recent_days']}d activo vs {m['prev_days']}d anterior")

    if total_drop > 0:
        lines.append(f"\nIngreso en riesgo: ${total_drop:,.0f}/semana")
        lines.append(f"Si se recupera: +${total_drop * 4:,.0f}/mes")

    # Only send if there's something actionable
    if ventas_change < -5 or dropping_meseros or tickets_change < -10:
        msg = "\n".join(lines)
        send_telegram(msg)
        output_sum = f"ALERTA: ventas {ventas_change:+.1f}%, {len(dropping_meseros)} meseros bajando, ${total_drop:,.0f}/sem en riesgo"
    else:
        output_sum = f"OK — ventas {ventas_change:+.1f}%, tickets {tickets_change:+.1f}%. Sin alertas."
        print(f"[crm] {output_sum}")

    # Save results
    sb_upsert("agent_results", {
        "agent_id": "crm-recompra",
        "fecha": today_str,
        "priority": "warning" if (ventas_change < -5 or dropping_meseros) else "info",
        "summary": output_sum,
        "data": json.dumps({
            "ventas_avg_recent": round(avg_recent),
            "ventas_avg_prev": round(avg_prev),
            "ventas_change_pct": round(ventas_change, 1),
            "tickets_avg_recent": round(avg_tickets_recent),
            "tickets_change_pct": round(tickets_change, 1),
            "tp_recent": round(avg_tp_recent),
            "dropping_meseros": dropping_meseros[:5],
            "revenue_at_risk_weekly": round(total_drop),
        }),
    })

except SystemExit:
    pass
except Exception as e:
    status = "error"
    error_msg = str(e)
    output_sum = f"ERROR: {e}"
    print(f"[crm] {output_sum}", file=sys.stderr)

duration_ms = int((time.time() - start_time) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id": "crm-recompra",
        "trigger_type": TRIGGER_TYPE,
        "status": status,
        "duration_ms": duration_ms,
        "output_summary": output_sum,
        "error_message": error_msg,
        "tentacle": "ops",
    })
    print(f"[crm] Done in {duration_ms}ms. {output_sum}")
except Exception as e:
    print(f"[crm] WARN: log failed: {e}", file=sys.stderr)
