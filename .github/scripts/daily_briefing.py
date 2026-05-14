#!/usr/bin/env python3
"""
Daily Briefing — Multi-tenant
Flow: Supabase REST → Groq llama-3.3-70b → Telegram → log agent_runs
"""

import os
import sys
import json
import time
import requests
from datetime import date, timedelta, datetime, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT           = get_client()
SUPABASE_URL     = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY     = os.environ["SUPABASE_SERVICE_KEY"]
GROQ_API_KEY     = os.environ["GROQ_API_KEY"]
TG_TOKEN         = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS      = get_chat_ids(CLIENT, "daily_briefing")
TRIGGER_TYPE     = os.environ.get("TRIGGER_TYPE", "cron")

MX_TZ   = get_tz(CLIENT)
now_utc = datetime.now(timezone.utc)
today   = date.today()

today_str    = today.isoformat()
tomorrow_str = (today + timedelta(days=1)).isoformat()
week_end_str = (today + timedelta(days=8)).isoformat()

# Calendar window in UTC (MX is UTC-6)
cal_start = f"{today_str}T06:00:00+00:00"
cal_end   = f"{tomorrow_str}T05:59:59+00:00"

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start_time   = time.time()
tokens_in    = 0
tokens_out   = 0
status       = "error"
output_sum   = ""
error_msg    = None

# ── Helpers ──────────────────────────────────────────────────────────────────
def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        params=params,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()

def sb_post(table, data):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data,
        timeout=15,
    )
    r.raise_for_status()

def send_telegram(text):
    """Send message to all recipients; splits at 4096 chars if needed."""
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chat_id in TG_CHAT_IDS:
        for chunk in chunks:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
                timeout=15,
            )
            r.raise_for_status()

DAY_NAMES = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"]

# ── Fetch data ───────────────────────────────────────────────────────────────
print(f"[briefing] Fetching data for {today_str}...")

reservas_hoy = sb_get(CLIENT.get("reservaciones_table", "amalay_reservaciones"), [
    ("fecha",  f"eq.{today_str}"),
    ("status", "neq.cancelled"),
    ("order",  "horario_inicio.asc"),
    ("select", "*"),
])

reservas_proximas = sb_get(CLIENT.get("reservaciones_table", "amalay_reservaciones"), [
    ("fecha",  f"gte.{tomorrow_str}"),
    ("fecha",  f"lte.{week_end_str}"),
    ("status", "neq.cancelled"),
    ("order",  "fecha.asc,horario_inicio.asc"),
    ("select", "fecha,nombre,guests,codigo_reserva,status,espacio,horario_inicio"),
])

calendario = sb_get("calendar_sync_log", [
    ("event_start", f"gte.{cal_start}"),
    ("event_start", f"lt.{cal_end}"),
    ("action",      "neq.declined"),
    ("order",       "event_start.asc"),
    ("select",      "event_title,event_start"),
    ("limit",       "20"),
])

wansoft_rows = sb_get("wansoft_kpis", [
    ("id",     f"eq.{CLIENT.get('kpis_row_id', 'amalay')}"),
    ("select", "ventas_dia,tickets_count,ticket_promedio_restaurant,ultima_venta,updated_at,fecha_reporte"),
])
wansoft = wansoft_rows[0] if wansoft_rows else {}

print(f"[briefing] reservas_hoy={len(reservas_hoy)}, proximas={len(reservas_proximas)}, "
      f"cal={len(calendario)}, wansoft={'ok' if wansoft else 'empty'}")

# ── Format data block ────────────────────────────────────────────────────────

# Calendar
cal_lines = []
for e in calendario:
    raw = e["event_start"].replace("Z", "+00:00")
    dt_local = datetime.fromisoformat(raw).astimezone(MX_TZ)
    cal_lines.append(f"  {dt_local.strftime('%H:%M')} — {e['event_title'][:70]}")

# Reservaciones hoy
def fmt_reserva(r):
    lines = [
        f"  {r.get('horario_inicio','')[:5]} | {r.get('codigo_reserva','')} | "
        f"{r.get('nombre','')} | {r.get('guests','')} px | {r.get('espacio','')}",
        f"  Tel: {r.get('telefono') or 'sin tel'} | Paquete: {r.get('paquete','')} | "
        f"Total: ${r.get('total','')}",
    ]
    if r.get("pastel"):   lines.append(f"  Pastel: {r['pastel']}")
    if r.get("deco"):     lines.append(f"  Deco: {r['deco']}")
    if r.get("entradas"): lines.append(f"  Entradas: {r['entradas']}")
    return "\n".join(lines)

reservas_hoy_fmt = (
    "\n".join(fmt_reserva(r) for r in reservas_hoy)
    if reservas_hoy else "  Sin reservaciones."
)

# Próximas agrupadas por fecha
by_date = defaultdict(list)
for r in reservas_proximas:
    by_date[r["fecha"]].append(r)

proximas_lines = []
for fecha in sorted(by_date):
    items    = by_date[fecha]
    d        = date.fromisoformat(fecha)
    day_name = DAY_NAMES[d.weekday()]
    nombres  = ", ".join(r["nombre"] for r in items)
    px_total = sum((r.get("guests") or 0) for r in items)
    proximas_lines.append(
        f"  {fecha} ({day_name}): {len(items)} evento(s) — {nombres} — {px_total} px"
    )

# Wansoft staleness
wansoft_stale = ""
wansoft_fmt   = "  Sin datos."
if wansoft:
    upd_str = wansoft.get("updated_at", "")
    if upd_str:
        upd_dt   = datetime.fromisoformat(upd_str.replace("Z", "+00:00"))
        hrs_diff = (now_utc - upd_dt).total_seconds() / 3600
        if hrs_diff > 24:
            days_diff = int(hrs_diff // 24)
            rem_hrs   = int(hrs_diff % 24)
            upd_local = upd_dt.astimezone(MX_TZ).strftime("%H:%M")
            wansoft_stale = (
                f"  STALE {days_diff}d {rem_hrs}h — "
                f"último sync: {wansoft.get('fecha_reporte','')} {upd_local} hrs\n"
            )
    wansoft_fmt = (
        f"{wansoft_stale}"
        f"  Ventas día: ${wansoft.get('ventas_dia','N/D')}\n"
        f"  Tickets: {wansoft.get('tickets_count') or 'N/D'}\n"
        f"  Ticket promedio: ${wansoft.get('ticket_promedio_restaurant') or 'N/D'}\n"
        f"  Última venta: {wansoft.get('ultima_venta','N/D')}"
    )

data_block = f"""=== DATOS {CLIENT['display_name']} {today_str} ===

CALENDARIO HOY:
{chr(10).join(cal_lines) if cal_lines else "  Sin eventos."}

RESERVACIONES HOY:
{reservas_hoy_fmt}

PRÓXIMAS RESERVACIONES (7 días):
{chr(10).join(proximas_lines) if proximas_lines else "  Sin reservaciones próximas."}

KPI WANSOFT:
{wansoft_fmt}
"""

# ── Groq ─────────────────────────────────────────────────────────────────────
_client_name = CLIENT['display_name']
SYSTEM_PROMPT = f"""Eres el asistente de operaciones de {_client_name}.
Con los datos que te paso, genera el Morning Briefing diario en texto plano conciso, optimizado para lectura mobile.

ESTRUCTURA EXACTA (usa estos headers tal cual):

# Morning Briefing {_client_name} — YYYY-MM-DD

## Calendario
(eventos HH:MM — título, o "Sin eventos")

## Reservaciones hoy
(cada reservación: hora | código | nombre | guests px | espacio / tel / paquete / total)

## Próximas reservaciones
(una línea por día: YYYY-MM-DD (día): N evento(s) — nombres — total px)

## Ventas (Wansoft)
(KPIs; si los datos tienen más de 24h de antigüedad, inicia con: ⚠️ DATA STALE — último sync: fecha hora)

## Top 3 acciones
(exactamente 3 bullets, específicos y accionables; ejemplos: sin teléfono de contacto, sync caído, status pending sin confirmar, anomalías de datos)

REGLAS:
- Español
- Montos en MXN: $X,XXX.XX
- Sin emojis excepto ⚠️ para data stale
- Máximo 10 líneas por sección
- Texto plano, sin markdown complejo"""

print("[briefing] Calling Groq...")
groq_resp = requests.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"Genera el Morning Briefing con estos datos:\n\n{data_block}"},
        ],
        "temperature": 0.2,
        "max_tokens":  1200,
    },
    timeout=60,
)
groq_resp.raise_for_status()
groq_data  = groq_resp.json()
briefing   = groq_data["choices"][0]["message"]["content"]
usage      = groq_data.get("usage", {})
tokens_in  = usage.get("prompt_tokens", 0)
tokens_out = usage.get("completion_tokens", 0)

print(f"[briefing] Groq OK — {tokens_in} in / {tokens_out} out tokens")
print(f"[briefing] Preview:\n{briefing[:200]}...")

# ── Telegram ──────────────────────────────────────────────────────────────────
print("[briefing] Sending to Telegram...")
send_telegram(briefing)
print("[briefing] Telegram OK")

status    = "success"
output_sum = (
    f"Briefing enviado. {len(reservas_hoy)} reservas hoy, "
    f"{len(reservas_proximas)} próximas. "
    f"Tokens: {tokens_in}in/{tokens_out}out"
)

# ── Log agent_runs ────────────────────────────────────────────────────────────
duration_ms = int((time.time() - start_time) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id":      "daily-briefing",
        "trigger_type":  TRIGGER_TYPE,
        "status":        status,
        "duration_ms":   duration_ms,
        "output_summary": output_sum,
        "error_message": error_msg,
        "tokens_in":     tokens_in,
        "tokens_out":    tokens_out,
    })
    print("[briefing] agent_runs logged OK")
except Exception as e:
    print(f"[briefing] WARN: agent_runs log failed: {e}", file=sys.stderr)

print(f"[briefing] Done in {duration_ms}ms. {output_sum}")
