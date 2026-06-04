#!/usr/bin/env python3
"""
Weekly Summary Report — Multi-tenant
Compares this week vs last week: ventas, ticket promedio, top meseros, trends.
Runs every Monday at 9am MX.
"""

import os, json, requests
from datetime import date, timedelta, datetime, timezone
from client_config import get_client, get_tz, get_chat_ids

CLIENT = get_client()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
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

    # This week = last 7 days ending yesterday
    yesterday = (now_mx - timedelta(days=1)).date()
    this_week_start = yesterday - timedelta(days=6)

    # Last week = 7 days before this week
    last_week_end = this_week_start - timedelta(days=1)
    last_week_start = last_week_end - timedelta(days=6)

    print(f"[weekly] This week: {this_week_start} to {yesterday}")
    print(f"[weekly] Last week: {last_week_start} to {last_week_end}")

    # Fetch both weeks
    this_week = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,propinas_total,meseros",
        "and": f"(fecha.gte.{this_week_start},fecha.lte.{yesterday})",
        "order": "fecha.asc",
    })

    last_week = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,propinas_total,meseros",
        "and": f"(fecha.gte.{last_week_start},fecha.lte.{last_week_end})",
        "order": "fecha.asc",
    })

    if not this_week:
        print("[weekly] No data for this week — skipping")
        return

    # Calculate totals
    def calc_totals(data):
        ventas = sum(d.get("ventas_dia") or 0 for d in data)
        tickets = sum(d.get("tickets_count") or 0 for d in data)
        personas = sum(d.get("personas_restaurant") or 0 for d in data)
        propinas = sum(d.get("propinas_total") or 0 for d in data)
        tp = ventas / personas if personas > 0 else 0
        days = len(data)

        # Aggregate meseros
        mesero_totals = {}
        for d in data:
            meseros = d.get("meseros") or []
            if isinstance(meseros, str):
                meseros = json.loads(meseros)
            for m in meseros:
                name = (m.get("nombre") or "").strip()
                if not name:
                    continue
                mesero_totals[name] = mesero_totals.get(name, 0) + (m.get("total") or 0)

        top_meseros = sorted(mesero_totals.items(), key=lambda x: -x[1])[:7]

        return {
            "ventas": ventas, "tickets": tickets, "personas": personas,
            "propinas": propinas, "tp": tp, "days": days,
            "daily_avg": ventas / days if days > 0 else 0,
            "top_meseros": top_meseros,
        }

    tw = calc_totals(this_week)
    lw = calc_totals(last_week) if last_week else None

    def pct_change(current, previous):
        if not previous or previous == 0:
            return ""
        pct = ((current - previous) / previous) * 100
        return f" ({pct:+.0f}%)"

    # Build message
    lines = [
        f"REPORTE SEMANAL — {CLIENT['display_name']}",
        f"{this_week_start} a {yesterday} ({tw['days']} dias)",
        "",
        f"VENTAS: ${tw['ventas']:,.0f}{pct_change(tw['ventas'], lw['ventas'] if lw else 0)}",
        f"Promedio diario: ${tw['daily_avg']:,.0f}{pct_change(tw['daily_avg'], lw['daily_avg'] if lw else 0)}",
        f"Ticket promedio: ${tw['tp']:,.0f}{pct_change(tw['tp'], lw['tp'] if lw else 0)}",
        f"Personas: {tw['personas']:,}{pct_change(tw['personas'], lw['personas'] if lw else 0)}",
        f"Propinas: ${tw['propinas']:,.0f}",
        "",
        "TOP MESEROS:",
    ]

    exclude = ["oscar ricardo", "rodrigo", "aplicaciones", "mesero evento", "fany elizabeth", "ericka tamara", "frida vianney", "jorge antonio"]
    for i, (name, total) in enumerate(tw['top_meseros']):
        if any(ex in name.lower() for ex in exclude):
            continue
        lines.append(f"  {i+1}. {name}: ${total:,.0f}")

    # Daily breakdown
    lines.append("")
    lines.append("POR DIA:")
    for d in this_week:
        fecha = d.get("fecha", "")
        ventas = d.get("ventas_dia") or 0
        tp = d.get("ticket_promedio_restaurant") or 0
        personas = d.get("personas_restaurant") or 0
        lines.append(f"  {fecha}: ${ventas:,.0f} | TP ${tp:,.0f} | {personas} personas")

    if lw:
        lines.append("")
        ventas_diff = tw['ventas'] - lw['ventas']
        lines.append(f"VS SEMANA ANTERIOR: {'+' if ventas_diff >= 0 else ''}{ventas_diff:,.0f} ({pct_change(tw['ventas'], lw['ventas']).strip()})")

    msg = "\n".join(lines)
    print(f"[weekly] Message: {len(msg)} chars")
    send_telegram(msg)
    print("[weekly] Sent")

if __name__ == "__main__":
    main()
