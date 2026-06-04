#!/usr/bin/env python3
"""
Anomaly Detector Agent — Multi-tenant
Compara métricas del día actual vs promedio del mismo DOW (últimas 4 semanas).
Alerta solo cuando hay anomalías reales. Sin anomalía = sin mensaje.
Corre a las 2pm y 6pm MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from client_config import get_client, get_tz, get_chat_ids, is_mesero

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_IDS = get_chat_ids(CLIENT, "intraday")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# ── Thresholds ──────────────────────────────────────────────────────────────
VENTAS_THRESHOLD = 0.20       # 20% difference triggers alert
TICKET_THRESHOLD = 0.15       # 15% difference triggers alert
MESERO_THRESHOLD = 0.50       # 50% below normal for a mesero
CATEGORY_THRESHOLD = 0.30     # 30% below normal for a category


# ── Supabase helpers ────────────────────────────────────────────────────────
def sb_get(table, params):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=sb_headers,
        params=params,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


# ── Data fetching ───────────────────────────────────────────────────────────
def get_today_kpis():
    """Fetch today's data — prefer wansoft_daily (fresh) over wansoft_kpis (often stale)."""
    today_str = datetime.now(MX_TZ).strftime("%Y-%m-%d")
    # Try wansoft_daily first (updated by scrapers throughout the day)
    rows = sb_get("wansoft_daily", {
        "client_slug": f"eq.{CLIENT['id']}",
        "fecha": f"eq.{today_str}",
        "select": "*",
        "order": "updated_at.desc",
        "limit": "1",
    })
    if rows and float(rows[0].get("ventas_dia") or 0) > 0:
        return rows[0]
    # Fallback to wansoft_kpis (real-time but often stale)
    rows = sb_get("wansoft_kpis", {"select": "*", "limit": "1"})
    return rows[0] if rows else None


def get_historical_same_dow(today, weeks=4):
    """Fetch wansoft_daily for the same DOW over the last N weeks."""
    dates = []
    for w in range(1, weeks + 1):
        d = today - timedelta(weeks=w)
        dates.append(d.strftime("%Y-%m-%d"))

    if not dates:
        return []

    # Fetch each date individually (OR filters aren't clean in REST)
    results = []
    for fecha in dates:
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
            "select": "fecha,ventas_dia,ticket_promedio_restaurant,meseros,ventas_por_grupo",
            "fecha": f"eq.{fecha}",
            "limit": "1",
        })
        results.extend(rows)
    return results


# ── Analysis ────────────────────────────────────────────────────────────────
def analyze_anomalies(today_data, historical):
    """Compare today vs historical averages. Return list of anomaly dicts."""
    if not today_data or not historical:
        return []

    anomalies = []

    # --- Ventas del día (ajustado por hora) ---
    today_ventas = float(today_data.get("ventas_dia") or 0)
    hist_ventas = [float(d.get("ventas_dia") or 0) for d in historical if d.get("ventas_dia")]
    if hist_ventas and today_ventas > 0:
        avg_ventas_full_day = sum(hist_ventas) / len(hist_ventas)
        # Adjust for time of day: estimate what % of the day is done
        # Restaurant hours ~8am to 10pm (14 hours)
        now_mx = datetime.now(MX_TZ)
        hour = now_mx.hour + now_mx.minute / 60
        open_hour, close_hour = 8, 22
        if hour < open_hour:
            day_pct = 0
        elif hour >= close_hour:
            day_pct = 1.0
        else:
            day_pct = (hour - open_hour) / (close_hour - open_hour)

        # Expected ventas at this hour = full day avg * day_pct
        expected_at_this_hour = avg_ventas_full_day * day_pct if day_pct > 0.1 else avg_ventas_full_day
        label_hora = f"a las {int(hour)}:{int((hour%1)*60):02d}"

        if expected_at_this_hour > 0 and day_pct > 0.1:
            pct_diff = (today_ventas - expected_at_this_hour) / expected_at_this_hour
            if abs(pct_diff) >= VENTAS_THRESHOLD:
                direction = "arriba" if pct_diff > 0 else "abajo"
                emoji = "📈" if pct_diff > 0 else "📉"
                anomalies.append({
                    "type": "ventas",
                    "severity": "high",
                    "message": f"{emoji} Ventas ${today_ventas:,.0f} {label_hora} están {abs(pct_diff)*100:.0f}% {direction} de lo esperado (${expected_at_this_hour:,.0f} para esta hora)",
                })

    # --- Ticket promedio ---
    today_tp = float(today_data.get("ticket_promedio_restaurant") or 0)
    hist_tp = [float(d.get("ticket_promedio_restaurant") or 0) for d in historical if d.get("ticket_promedio_restaurant")]
    if hist_tp and today_tp > 0:
        avg_tp = sum(hist_tp) / len(hist_tp)
        if avg_tp > 0:
            pct_diff = (today_tp - avg_tp) / avg_tp
            if abs(pct_diff) >= TICKET_THRESHOLD:
                direction = "arriba" if pct_diff > 0 else "abajo"
                emoji = "🎫📈" if pct_diff > 0 else "🎫📉"
                anomalies.append({
                    "type": "ticket_promedio",
                    "severity": "medium",
                    "message": f"{emoji} Ticket promedio ${today_tp:,.0f} vs promedio ${avg_tp:,.0f} ({abs(pct_diff)*100:.0f}% {direction})",
                })

    # --- Meseros individuales ---
    today_meseros = today_data.get("meseros") or []
    if isinstance(today_meseros, str):
        today_meseros = json.loads(today_meseros)

    # Build historical averages per mesero
    mesero_hist = {}
    for day in historical:
        m_list = day.get("meseros") or []
        if isinstance(m_list, str):
            m_list = json.loads(m_list)
        for m in m_list:
            name = m.get("nombre", "")
            total = float(m.get("total") or 0)
            if name and total > 0 and is_mesero(name, CLIENT):
                mesero_hist.setdefault(name, []).append(total)

    for m in today_meseros:
        name = m.get("nombre", "")
        today_total = float(m.get("total") or 0)
        if not name or today_total <= 0 or not is_mesero(name, CLIENT):
            continue
        if name in mesero_hist and len(mesero_hist[name]) >= 2:
            avg_full_day = sum(mesero_hist[name]) / len(mesero_hist[name])
            # Adjust by hour — compare partial day vs expected at this hour
            avg_at_this_hour = avg_full_day * day_pct if day_pct > 0.1 else avg_full_day
            if avg_at_this_hour > 0:
                pct_diff = (today_total - avg_at_this_hour) / avg_at_this_hour
                if pct_diff <= -MESERO_THRESHOLD:
                    short_name = name.split()[0]
                    anomalies.append({
                        "type": "mesero",
                        "severity": "medium",
                        "message": f"👤 {short_name} lleva ${today_total:,.0f} — {abs(pct_diff)*100:.0f}% abajo de lo esperado para esta hora (${avg_at_this_hour:,.0f})",
                    })

    # --- Categorías (postres, H&H, pan) ---
    watch_keywords = {
        "Postres": ["DESSERT", "BROWNIE", "CHEESECAKE", "CAKE", "PANCAKE"],
        "Half & Half": ["HALF", "H&H"],
        "Pan": ["TOAST", "BAGEL", "CROISSANT"],
    }

    today_groups = today_data.get("ventas_por_grupo") or []
    if isinstance(today_groups, str):
        today_groups = json.loads(today_groups)

    # Build historical averages per category
    cat_hist = {}
    for day in historical:
        g_list = day.get("ventas_por_grupo") or []
        if isinstance(g_list, str):
            g_list = json.loads(g_list)
        for g in g_list:
            gname = g.get("nombre", "").upper()
            gtotal = float(g.get("total") or 0)
            if gname and gtotal > 0:
                cat_hist.setdefault(gname, []).append(gtotal)

    for label, keywords in watch_keywords.items():
        # Sum today's matching categories
        today_cat_total = sum(
            float(g.get("total") or 0)
            for g in today_groups
            if any(kw in g.get("nombre", "").upper() for kw in keywords)
        )
        # Sum historical matching categories
        matching_keys = [k for k in cat_hist if any(kw in k for kw in keywords)]
        if matching_keys:
            hist_totals = []
            for day in historical:
                g_list = day.get("ventas_por_grupo") or []
                if isinstance(g_list, str):
                    g_list = json.loads(g_list)
                day_total = sum(
                    float(g.get("total") or 0)
                    for g in g_list
                    if any(kw in g.get("nombre", "").upper() for kw in keywords)
                )
                if day_total > 0:
                    hist_totals.append(day_total)

            if hist_totals:
                avg_cat = sum(hist_totals) / len(hist_totals)
                if avg_cat > 0 and today_cat_total >= 0:
                    pct_diff = (today_cat_total - avg_cat) / avg_cat
                    if pct_diff <= -CATEGORY_THRESHOLD:
                        anomalies.append({
                            "type": "category",
                            "severity": "medium",
                            "message": f"🍽 {label}: ${today_cat_total:,.0f} vs promedio ${avg_cat:,.0f} ({abs(pct_diff)*100:.0f}% abajo)",
                        })

    return anomalies


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(anomalies):
    now_mx = datetime.now(MX_TZ)
    day_names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    today_name = day_names[now_mx.weekday()]

    msg = f"🚨 ANOMALÍAS DETECTADAS — {today_name} {now_mx.strftime('%d/%m %H:%M')}\n"
    msg += f"Comparado vs promedio últimos 4 {today_name}s\n\n"

    high = [a for a in anomalies if a["severity"] == "high"]
    medium = [a for a in anomalies if a["severity"] == "medium"]

    if high:
        msg += "⚠️ ALTA PRIORIDAD:\n"
        for a in high:
            msg += f"  {a['message']}\n"
        msg += "\n"

    if medium:
        msg += "📋 OBSERVAR:\n"
        for a in medium:
            msg += f"  {a['message']}\n"
        msg += "\n"

    # Action suggestions
    cat_anomalies = [a for a in anomalies if a["type"] == "category"]
    mesero_anomalies = [a for a in anomalies if a["type"] == "mesero"]
    ventas_low = any(a["type"] == "ventas" and "abajo" in a["message"] for a in anomalies)

    suggestions = []
    if ventas_low:
        suggestions.append("Revisar si hay factor externo (clima, evento, calle cerrada)")
    if cat_anomalies:
        suggestions.append("Verificar que meseros estén ofreciendo postres/H&H/pan")
    if mesero_anomalies:
        suggestions.append("Hablar con mesero(s) rezagados para identificar causa")

    if suggestions:
        msg += "💡 ACCIONES:\n"
        for s in suggestions:
            msg += f"  • {s}\n"

    return msg


# ── Telegram ────────────────────────────────────────────────────────────────
def send_telegram(msg):
    sent = 0
    for chat_id in TG_CHAT_IDS:
        if not chat_id:
            continue
        chunks = [msg[i:i + 4000] for i in range(0, len(msg), 4000)]
        for chunk in chunks:
            r = requests.post(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )
            if r.ok:
                sent += 1
    return sent


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"[anomaly] Starting for {CLIENT['id']} on {today_str}")

    # 1. Fetch today's real-time data
    print("[anomaly] Fetching today's KPIs...")
    today_data = get_today_kpis()
    if not today_data:
        print("[anomaly] No KPI data available, skipping")
        return

    today_ventas = float(today_data.get("ventas_dia") or 0)
    if today_ventas <= 0:
        print("[anomaly] Ventas = 0, skipping")
        return

    # 2. Fetch same DOW historical
    print("[anomaly] Fetching historical same DOW...")
    historical = get_historical_same_dow(now_mx, weeks=4)
    print(f"[anomaly] Got {len(historical)} historical days")

    if len(historical) < 2:
        print("[anomaly] Not enough historical data, skipping")
        return

    # 3. Analyze
    anomalies = analyze_anomalies(today_data, historical)
    print(f"[anomaly] Found {len(anomalies)} anomalies")

    elapsed = int((time.time() - start) * 1000)

    # 4. Determine priority
    has_high = any(a["severity"] == "high" for a in anomalies)
    priority = "critical" if has_high else "warning" if anomalies else "info"

    # 5. Build structured data for DB
    hist_ventas = [float(d.get("ventas_dia") or 0) for d in historical if d.get("ventas_dia")]
    avg_ventas = sum(hist_ventas) / len(hist_ventas) if hist_ventas else 0
    structured_data = {
        "anomalies": [
            {
                "type": a["type"],
                "severity": a["severity"],
                "message": a["message"],
            }
            for a in anomalies
        ],
        "today_ventas": float(today_data.get("ventas_dia") or 0),
        "today_tp": float(today_data.get("ticket_promedio_restaurant") or 0),
        "avg_ventas": round(avg_ventas),
        "total_anomalies": len(anomalies),
        "thresholds": {
            "ventas": VENTAS_THRESHOLD,
            "ticket": TICKET_THRESHOLD,
            "mesero": MESERO_THRESHOLD,
            "category": CATEGORY_THRESHOLD,
        },
    }

    # 6. Save to DB
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "anomaly",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": f"{len(anomalies)} anomalías detectadas" if anomalies else "Sin anomalías",
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[anomaly] Saved to agent_results")
    except Exception as e:
        print(f"[anomaly] Error saving to DB: {e}")

    # 7. Send Telegram ONLY when priority=critical
    sent = 0
    if anomalies and priority == "critical":
        msg = build_message(anomalies)
        print(f"\n{msg}")
        sent = send_telegram(msg)
        print(f"[anomaly] Sent to {sent} chats")
    else:
        print(f"[anomaly] {len(anomalies)} anomalies, priority={priority}, no Telegram")

    # 8. Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "anomaly-detector",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"anomalies: {len(anomalies)}, priority: {priority}, sent: {sent}",
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
