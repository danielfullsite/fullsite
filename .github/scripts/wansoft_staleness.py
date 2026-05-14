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

# ── Check wansoft_kpis ────────────────────────────────────────────────────────
print("[wansoft-staleness] Checking wansoft_kpis...")

rows = sb_get("wansoft_kpis", [
    ("id",     f"eq.{CLIENT.get('kpis_row_id', 'amalay')}"),
    ("select", "updated_at,fecha_reporte,ventas_dia"),
])

status     = "success"
output_sum = ""
error_msg  = None

if not rows:
    msg = "⚠️ Wansoft: tabla wansoft_kpis vacía — sin datos de operaciones."
    send_telegram(msg)
    output_sum = "ALERT: tabla vacía"
    print(f"[wansoft-staleness] {output_sum}")
else:
    row       = rows[0]
    upd_str   = row.get("updated_at", "")
    upd_dt    = datetime.fromisoformat(upd_str.replace("Z", "+00:00"))
    diff_secs = (now_utc - upd_dt).total_seconds()
    diff_hrs  = diff_secs / 3600
    diff_days = int(diff_secs / 86400)
    diff_rem  = int((diff_secs % 86400) / 3600)

    MX_TZ     = timezone(timedelta(hours=-6))
    upd_local = upd_dt.astimezone(MX_TZ).strftime("%Y-%m-%d %H:%M")

    if diff_hrs <= 24:
        print(f"[wansoft-staleness] OK — updated {diff_hrs:.1f}h ago. Silent success.")
        output_sum = f"OK — sync hace {diff_hrs:.1f}h. Sin alerta."
    else:
        msg = (
            f"⚠️ Wansoft sync STALE\n"
            f"Último sync: {row.get('fecha_reporte','')} a las {upd_local} hrs\n"
            f"Hace: {diff_days}d {diff_rem}h\n"
            f"Ventas último dato: ${row.get('ventas_dia','N/D')}\n\n"
            f"Acción: revisar Chrome Extension de Wansoft sync"
        )
        send_telegram(msg)
        output_sum = f"ALERT enviado. Stale {diff_days}d {diff_rem}h."
        print(f"[wansoft-staleness] STALE alert sent — {diff_days}d {diff_rem}h")

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
