#!/usr/bin/env python3
"""
reportes/weekly-amalay
Reporte ejecutivo semanal: semana pasada de amalay_reservaciones + wansoft_daily + wansoft_kpis.
"""

import os, sys, time, requests
from datetime import date, timedelta, datetime, timezone
from collections import defaultdict

from client_config import get_client, get_chat_ids
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("weekly_amalay")
except ImportError:
    _audit = None
CLIENT       = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_IDS  = get_chat_ids(CLIENT, "weekly")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

today      = date.today()
# Semana pasada: lunes a domingo previo
last_mon   = today - timedelta(days=today.weekday() + 7)
last_sun   = last_mon + timedelta(days=6)
# Semana anterior para comparar
prev_mon   = last_mon - timedelta(days=7)
prev_sun   = last_mon - timedelta(days=1)

last_mon_s = last_mon.isoformat()
last_sun_s = last_sun.isoformat()
prev_mon_s = prev_mon.isoformat()
prev_sun_s = prev_sun.isoformat()

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

start = time.time()
if _audit: _audit.log_start()

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
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CHAT_IDS[0] if TG_CHAT_IDS else "", "text": chunk},
            timeout=15)
        r.raise_for_status()

# ── Fetch data ────────────────────────────────────────────────────────────────
print(f"[weekly-amalay] Semana: {last_mon_s} → {last_sun_s}")

# wansoft_daily semana pasada
daily_this = sb_get("wansoft_daily", [
    ("fecha",  f"gte.{last_mon_s}"),
    ("fecha",  f"lte.{last_sun_s}"),
    ("order",  "fecha.asc"),
    ("select", "fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,mesas_atendidas,"
               "ordenes_llevar,propinas_total,efectivo,tarjeta"),
])

# wansoft_daily semana anterior (para comparar)
daily_prev = sb_get("wansoft_daily", [
    ("fecha",  f"gte.{prev_mon_s}"),
    ("fecha",  f"lte.{prev_sun_s}"),
    ("order",  "fecha.asc"),
    ("select", "ventas_dia,tickets_count"),
])

# Reservaciones semana pasada
reservas = sb_get(CLIENT.get("reservaciones_table", "amalay_reservaciones"), [
    ("fecha",  f"gte.{last_mon_s}"),
    ("fecha",  f"lte.{last_sun_s}"),
    ("order",  "fecha.asc"),
    ("select", "fecha,nombre,guests,espacio,total,status,codigo_reserva"),
])

# wansoft_kpis para snapshot actual
kpis_rows = sb_get("wansoft_kpis", [
    ("id",     f"eq.{CLIENT.get('kpis_row_id', 'amalay')}"),
    ("select", "ventas_dia,tickets_count,ticket_promedio_restaurant,updated_at,fecha_reporte"),
])
kpis = kpis_rows[0] if kpis_rows else {}

print(f"[weekly-amalay] daily_this={len(daily_this)}, daily_prev={len(daily_prev)}, "
      f"reservas={len(reservas)}")

# ── Calcular métricas ─────────────────────────────────────────────────────────
def safe_float(v):
    try: return float(v or 0)
    except: return 0.0

# Esta semana
total_ventas   = sum(safe_float(r["ventas_dia"])   for r in daily_this)
total_brutas   = sum(safe_float(r["ventas_brutas"]) for r in daily_this)
total_desctos  = sum(safe_float(r["descuentos"])    for r in daily_this)
total_tickets  = sum(int(r.get("tickets_count") or 0) for r in daily_this)
total_mesas    = sum(int(r.get("mesas_atendidas") or 0) for r in daily_this)
total_llevar   = sum(int(r.get("ordenes_llevar") or 0) for r in daily_this)
total_propinas = sum(safe_float(r.get("propinas_total")) for r in daily_this)
dias_con_data  = len(daily_this)

ticket_prom    = (total_ventas / total_tickets) if total_tickets > 0 else 0.0

# Semana anterior (para % cambio)
prev_ventas  = sum(safe_float(r["ventas_dia"]) for r in daily_prev)
prev_tickets = sum(int(r.get("tickets_count") or 0) for r in daily_prev)

pct_ventas   = ((total_ventas - prev_ventas) / prev_ventas * 100) if prev_ventas > 0 else None
pct_tickets  = ((total_tickets - prev_tickets) / prev_tickets * 100) if prev_tickets > 0 else None

def pct_str(v):
    if v is None: return "N/D"
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.1f}%"

# Reservaciones
res_confirmadas = [r for r in reservas if r["status"] == "confirmed"]
res_pendientes  = [r for r in reservas if r["status"] == "pending"]
res_canceladas  = [r for r in reservas if r["status"] == "cancelled"]
total_guests    = sum(int(r.get("guests") or 0) for r in res_confirmadas)
revenue_eventos = sum(safe_float(r.get("total")) for r in res_confirmadas)

# ── Construir bloque de datos para Groq ──────────────────────────────────────
datos = f"""SEMANA: {last_mon_s} al {last_sun_s} ({dias_con_data} días con datos de ventas)

VENTAS WANSOFT:
- Total neto: ${total_ventas:,.2f}
- Total bruto: ${total_brutas:,.2f}
- Descuentos: ${total_desctos:,.2f}
- vs semana anterior (${prev_ventas:,.2f}): {pct_str(pct_ventas)}
- Tickets: {total_tickets} (vs {prev_tickets}: {pct_str(pct_tickets)})
- Mesas atendidas: {total_mesas}
- Órdenes para llevar: {total_llevar}
- Ticket promedio (calculado): ${ticket_prom:,.2f}
- Propinas: ${total_propinas:,.2f}

EVENTOS/RESERVACIONES:
- Confirmados: {len(res_confirmadas)} eventos, {total_guests} personas, ${revenue_eventos:,.2f}
- Pendientes: {len(res_pendientes)}
- Cancelados: {len(res_canceladas)}
- Total reservaciones: {len(reservas)}

NOTA: {"Solo " + str(dias_con_data) + " días tienen datos en wansoft_daily (sync intermitente)" if dias_con_data < 5 else "Datos completos de la semana"}
WANSOFT SNAPSHOT ACTUAL: fecha_reporte={kpis.get('fecha_reporte','N/D')}, ventas_día=${kpis.get('ventas_dia','N/D')}
"""

SYSTEM = f"""Eres el analista de operaciones de {CLIENT['display_name']}.
Genera un reporte ejecutivo semanal conciso para el dueño del negocio.
Texto plano, sin markdown complejo. Máximo 300 palabras. Español mexicano.

ESTRUCTURA:
Reporte Semanal {CLIENT['display_name']} — [rango de fechas]

VENTAS
(números clave con comparativa %)

EVENTOS
(resumen de reservaciones)

OBSERVACIONES
(2-3 hallazgos relevantes del período, incluyendo cualquier anomalía como datos faltantes)

RECOMENDACIÓN
(1 acción concreta para la semana que inicia)"""

print("[weekly-amalay] Llamando Groq...")
groq_r = requests.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={"Authorization": f"Bearer {GROQ_API_KEY}",
             "Content-Type": "application/json"},
    json={"model": "llama-3.3-70b-versatile",
          "messages": [{"role": "system", "content": SYSTEM},
                       {"role": "user",   "content": f"Datos de la semana:\n\n{datos}"}],
          "temperature": 0.3, "max_tokens": 600},
    timeout=30)
groq_r.raise_for_status()
gdata      = groq_r.json()
reporte    = gdata["choices"][0]["message"]["content"]
usage      = gdata.get("usage", {})
tokens_in  = usage.get("prompt_tokens", 0)
tokens_out = usage.get("completion_tokens", 0)

print(f"[weekly-amalay] Groq OK — {tokens_in}in/{tokens_out}out")

send_telegram(reporte)
print("[weekly-amalay] Telegram OK")

status     = "success"
output_sum = (f"Reporte semanal enviado. Ventas: ${total_ventas:,.2f}, "
              f"reservas: {len(reservas)}, tokens: {tokens_in}in/{tokens_out}out")

# ── Log ──────────────────────────────────────────────────────────────────────
duration_ms = int((time.time() - start) * 1000)
try:
    sb_post("agent_runs", {
        "agent_id":       "weekly-amalay",
        "trigger_type":   TRIGGER_TYPE,
        "status":         status,
        "duration_ms":    duration_ms,
        "output_summary": output_sum,
        "error_message":  None,
        "tokens_in":      tokens_in,
        "tokens_out":     tokens_out,
        "tentacle":       "reportes",
    })
    print("[weekly-amalay] agent_runs logged OK")
except Exception as e:
    print(f"[weekly-amalay] WARN: log failed: {e}", file=sys.stderr)

print(f"[weekly-amalay] Done {duration_ms}ms. {output_sum}")
