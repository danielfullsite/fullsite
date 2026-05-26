#!/usr/bin/env python3
"""
ops/wansoft-staleness
Verifica si wansoft_kpis.updated_at tiene más de 24h.
Silent success si está fresco. Alert a Telegram si está stale.
"""

import os, sys, time, requests
from datetime import datetime, timezone, timedelta
from client_config import get_client, get_chat_ids

CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS  = get_chat_ids(CLIENT, "wansoft_staleness")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start   = time.time()
now_utc = datetime.now(timezone.utc)

def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}",
                     headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
                      headers={**sb_headers, "Content-Type": "application/json",
                                "Prefer": "return=minimal"},
                      json=data, timeout=15)
    r.raise_for_status()

def send_telegram(text):
    r = requests.post(
        f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT_IDS[0] if TG_CHAT_IDS else "", "text": text},
        timeout=15)
    r.raise_for_status()

# ── Check wansoft_daily (primary — this is the real data source) ──────────────
print("[wansoft-staleness] Checking wansoft_daily...")

daily_rows = sb_get("wansoft_daily", [
    ("client_slug", f"eq.{CLIENT['id']}"),
    ("ventas_dia", "gt.0"),
    ("select", "fecha,ventas_dia,updated_at"),
    ("order", "fecha.desc"),
    ("limit", "1"),
])

status     = "success"
output_sum = ""
error_msg  = None

MX_TZ = timezone(timedelta(hours=-6))

if not daily_rows:
    msg = "⚠️ Wansoft: tabla wansoft_daily vacía — sin datos de ventas."
    send_telegram(msg)
    output_sum = "ALERT: tabla vacía"
    print(f"[wansoft-staleness] {output_sum}")
else:
    row = daily_rows[0]
    latest_fecha = row.get("fecha", "")
    upd_str = row.get("updated_at", "")

    # Calculate staleness based on fecha (date of data), not updated_at
    from datetime import date as date_type
    latest_date = date_type.fromisoformat(latest_fecha)
    today_date = now_utc.astimezone(MX_TZ).date()
    days_behind = (today_date - latest_date).days

    if days_behind <= 1:
        # Data is from today or yesterday — OK
        print(f"[wansoft-staleness] OK — latest data: {latest_fecha} (${row.get('ventas_dia', 0):,.0f}). Silent success.")
        output_sum = f"OK — datos al {latest_fecha}. Sin alerta."
    else:
        upd_local = ""
        if upd_str:
            upd_dt = datetime.fromisoformat(upd_str.replace("Z", "+00:00"))
            upd_local = upd_dt.astimezone(MX_TZ).strftime("%Y-%m-%d %H:%M")

        msg = (
            f"⚠️ Wansoft sync STALE\n"
            f"Último dato: {latest_fecha} (hace {days_behind} días)\n"
            f"Ventas: ${row.get('ventas_dia', 'N/D')}\n"
            f"Updated: {upd_local}\n\n"
            f"Acción: revisar scraper de Wansoft"
        )
        send_telegram(msg)
        output_sum = f"ALERT enviado. Datos de hace {days_behind} días."
        print(f"[wansoft-staleness] STALE alert sent — {days_behind} days behind")

# ── Log ──────────────────────────────────────────────────────────────────────
duration_ms = int((time.time() - start) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id":       "wansoft-staleness",
        "trigger_type":   TRIGGER_TYPE,
        "status":         status,
        "duration_ms":    duration_ms,
        "output_summary": output_sum,
        "error_message":  error_msg,
        "tokens_in":      0,
        "tokens_out":     0,
        "tentacle":       "ops",
    })
    print("[wansoft-staleness] agent_runs logged OK")
except Exception as e:
    print(f"[wansoft-staleness] WARN: log failed: {e}", file=sys.stderr)

print(f"[wansoft-staleness] Done {duration_ms}ms. {output_sum}")
