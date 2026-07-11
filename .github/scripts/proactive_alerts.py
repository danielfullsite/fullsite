#!/usr/bin/env python3
"""
Proactive Alerts — Multi-tenant
Compares today's KPIs vs historical averages and sends alerts when anomalies detected.
Runs at 2pm and 4pm MX time.
"""

import os, sys, json, time, requests
from datetime import date, timedelta, datetime, timezone
sys.path.insert(0, os.path.dirname(__file__))
from client_config import get_client, get_tz, get_chat_ids
from agent_common import log_run as _log_run
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("proactive_alerts")
except ImportError:
    _audit = None
CLIENT = get_client()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "daily_briefing")
MX_TZ = get_tz(CLIENT)

sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def send_telegram(text):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chat_id in TG_CHAT_IDS:
        for chunk in chunks:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                          json={"chat_id": chat_id, "text": chunk}, timeout=15)

def main():
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    dow = now_mx.weekday()  # 0=Monday

    print(f"[alerts] Checking alerts for {today_str} ({now_mx.strftime('%H:%M')} MX)...")

    # 1. Get today's data from ops_daily_live
    live_rows = sb_get("ops_daily_live", {"client_id": f"eq.{CLIENT['id']}",
        "fecha": f"eq.{today_str}",
        "select": "ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant",
        "limit": "1",
    })
    if not live_rows or not live_rows[0].get("ventas_dia"):
        print("[alerts] No live data for today — skipping")
        return
    live = live_rows[0]
    today_sales = float(live.get("ventas_dia") or 0)
    total_ordenes = int(live.get("tickets_count") or 0)
    total_personas = int(live.get("personas_restaurant") or 0)
    ticket_promedio = float(live.get("ticket_promedio_restaurant") or 0)

    print(f"[alerts] Today: ${today_sales:,.0f}, {total_ordenes} ordenes, {total_personas} personas, TP ${ticket_promedio:,.0f}")

    # 2. Get historical averages (same day of week, last 4 weeks)
    hist_dates = []
    for weeks_back in range(1, 5):
        d = now_mx - timedelta(weeks=weeks_back)
        hist_dates.append(d.strftime("%Y-%m-%d"))

    hist_data = []
    for hd in hist_dates:
        rows = sb_get("ops_daily_history", {"client_id": f"eq.{CLIENT['id']}",
            "fecha": f"eq.{hd}",
            "select": "ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant",
            "limit": "1",
        })
        if rows and rows[0].get("ventas_dia"):
            hist_data.append(rows[0])

    if not hist_data:
        print("[alerts] No historical data for comparison — skipping")
        return

    avg_sales = sum(h.get("ventas_dia", 0) or 0 for h in hist_data) / len(hist_data)
    avg_tickets = sum(h.get("tickets_count", 0) or 0 for h in hist_data) / len(hist_data)
    avg_personas = sum(h.get("personas_restaurant", 0) or 0 for h in hist_data) / len(hist_data)
    avg_tp = sum(h.get("ticket_promedio_restaurant", 0) or 0 for h in hist_data) / len(hist_data)

    print(f"[alerts] Avg (same DOW, 4 wks): ${avg_sales:,.0f}, {avg_tickets:.0f} tickets, TP ${avg_tp:,.0f}")

    # 3. Detect anomalies
    alerts = []

    # Adjust for time of day — if it's 2pm, compare proportionally
    hour = now_mx.hour
    day_fraction = min(1.0, max(0.3, (hour - 8) / 14))  # 8am-10pm = full day

    expected_sales = avg_sales * day_fraction
    sales_pct = ((today_sales - expected_sales) / expected_sales * 100) if expected_sales > 0 else 0

    if sales_pct < -15:
        alerts.append({
            "tipo": "VENTAS BAJAS",
            "dato": f"Ventas ${today_sales:,.0f} vs esperado ${expected_sales:,.0f} ({sales_pct:+.0f}%)",
            "prioridad": "Alta" if sales_pct < -25 else "Media",
        })

    if ticket_promedio > 0 and avg_tp > 0:
        tp_pct = ((ticket_promedio - avg_tp) / avg_tp * 100)
        if tp_pct < -10:
            alerts.append({
                "tipo": "TICKET PROMEDIO BAJO",
                "dato": f"TP ${ticket_promedio:,.0f} vs promedio ${avg_tp:,.0f} ({tp_pct:+.0f}%)",
                "prioridad": "Alta" if tp_pct < -20 else "Media",
            })

    expected_personas = avg_personas * day_fraction
    if total_personas > 0 and expected_personas > 0:
        pers_pct = ((total_personas - expected_personas) / expected_personas * 100)
        if pers_pct < -20:
            alerts.append({
                "tipo": "COMENSALES BAJOS",
                "dato": f"{total_personas} personas vs esperado {expected_personas:.0f} ({pers_pct:+.0f}%)",
                "prioridad": "Media",
            })
        elif pers_pct > 20 and sales_pct < 5:
            alerts.append({
                "tipo": "MAS COMENSALES PERO VENTAS NO SUBEN",
                "dato": f"Personas +{pers_pct:.0f}% pero ventas {sales_pct:+.0f}% — ticket por persona bajó",
                "prioridad": "Alta",
            })

    # 4. If no alerts, don't send anything
    if not alerts:
        print("[alerts] No anomalies detected — all good")
        return

    # 5. Use AI to generate actionable analysis
    alerts_text = "\n".join(f"- {a['tipo']} ({a['prioridad']}): {a['dato']}" for a in alerts)

    # Get waiter data for context
    wc = sb_get("wansoft_waiter_categories", {"select": "fecha,data", "order": "fecha.desc", "limit": "1"})
    waiter_context = ""
    if wc:
        d = wc[0]["data"]
        if isinstance(d, str):
            d = json.loads(d)
        exclude = ["oscar ricardo", "rodrigo", "aplicaciones", "mesero evento", "fany elizabeth", "ericka tamara", "frida vianney", "jorge antonio"]
        lines = []
        for name, val in d.items():
            if name.startswith("__") or not isinstance(val, dict):
                continue
            if any(ex in name.lower() for ex in exclude):
                continue
            kpis = val.get("KPIs", {})
            if kpis:
                lines.append(f"{name}: TP ${kpis.get('ticket_promedio',0):,.0f}, beb/persona {kpis.get('bebidas_por_persona',0)}, {kpis.get('personas',0)} personas")
        if lines:
            waiter_context = "\nMeseros (ultimo dia):\n" + "\n".join(lines)

    prompt = f"""Eres el analista operativo de {CLIENT['display_name']}.
Se detectaron estas anomalías HOY ({today_str}, {now_mx.strftime('%H:%M')} hrs):

{alerts_text}

Datos de hoy: Ventas ${today_sales:,.0f}, {total_ordenes} tickets, {total_personas} personas, TP ${ticket_promedio:,.0f}
Promedio mismo día (4 semanas): Ventas ${avg_sales:,.0f}, {avg_tickets:.0f} tickets, TP ${avg_tp:,.0f}
{waiter_context}

Responde con este formato EXACTO:

ALERTA OPERATIVA
[qué cambió, cuándo, vs qué comparación]

POSIBLES CAUSAS
[3-5 causas basadas en datos]

MESEROS/ÁREAS
[solo los que explican la variación]

ACCIONES SUGERIDAS
[concretas, inmediatas, operables]

PRIORIDAD: [Alta/Media/Baja]

Máximo 20 líneas. Sin markdown. Directo al punto."""

    # Groq first (FREE), Anthropic fallback
    try:
        r = requests.post("https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ.get('GROQ_API_KEY', '')}", "Content-Type": "application/json"},
            json={"model": "llama-3.3-70b-versatile", "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0.2, "max_tokens": 1500}, timeout=30)
        r.raise_for_status()
        analysis = r.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        r = requests.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
            json={"model": "claude-haiku-4-5-20251001", "max_tokens": 1500,
                  "messages": [{"role": "user", "content": prompt}]}, timeout=30)
        r.raise_for_status()
        analysis = r.json()["content"][0]["text"].strip()

    # 6. Send alert
    header = f"{'🔴' if any(a['prioridad'] == 'Alta' for a in alerts) else '🟡'} ALERTA FULLSITE — {today_str} {now_mx.strftime('%H:%M')}"
    message = f"{header}\n\n{analysis}"

    send_telegram(message)
    print(f"[alerts] Sent {len(alerts)} alerts to Telegram")

if __name__ == "__main__":
    _start = time.time()
    try:
        main()
        _log_run("proactive-alerts", "success", int((time.time() - _start) * 1000),
                 output_summary="Alerts sent", tentacle="ops", data_status="ok")
    except Exception as e:
        _ms = int((time.time() - _start) * 1000)
        _err = str(e)[:500]
        _ds = "error"
        _log_run("proactive-alerts", "error", _ms,
                 output_summary=f"ERROR: {_err[:100]}", error_message=_err,
                 tentacle="ops", data_status=_ds)
        print(f"[proactive-alerts] {_err}", file=sys.stderr)
        sys.exit(1)
