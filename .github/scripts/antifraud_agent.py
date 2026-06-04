#!/usr/bin/env python3
"""
Anti-Fraud Agent — Multi-tenant
Detecta patrones sospechosos: cancelaciones, cortesías, cambios en efectivo/tarjeta.
Corre los viernes a las 9am MX.
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz, get_chat_ids, is_mesero
try:
    from audit_log import AuditLogger
    _audit = AuditLogger("antifraud_agent")
except ImportError:
    _audit = None
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

# Thresholds
CANCEL_RATE_THRESHOLD = 0.05    # 5% cancellation rate is suspicious
DISCOUNT_RATE_THRESHOLD = 0.08  # 8% discount rate is suspicious
CASH_SHIFT_THRESHOLD = 0.15    # 15% shift in cash ratio is suspicious
COURTESY_THRESHOLD = 500        # More than $500 in courtesies per week


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
def get_weekly_data(weeks=2):
    """Fetch last N weeks of daily data for fraud analysis."""
    cutoff = (datetime.now(MX_TZ) - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    return sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
        "select": "fecha,ventas_dia,ventas_brutas,descuentos,devoluciones,efectivo,tarjeta,tickets_count,meseros,pago_metodos",
        "fecha": f"gte.{cutoff}",
        "ventas_dia": "gt.0",
        "order": "fecha.desc",
        "limit": str(weeks * 7),
    })


def get_waiter_categories():
    """Fetch waiter category data if available (has cancellation details)."""
    cutoff = (datetime.now(MX_TZ) - timedelta(weeks=2)).strftime("%Y-%m-%d")
    try:
        return sb_get("wansoft_waiter_categories", {
            "select": "*",
            "fecha": f"gte.{cutoff}",
            "order": "fecha.desc",
            "limit": "100",
        })
    except:
        return []


def get_discount_details(weeks=2):
    """Fetch detailed discount data from wansoft_data (deep scraper).
    This is the REAL source — wansoft_daily.descuentos is often 0."""
    cutoff = (datetime.now(MX_TZ) - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    try:
        return sb_get("wansoft_data", {
            "client_id": f"eq.{CLIENT['id']}",
            "data_key": "eq.discounts_detail",
            "fecha": f"gte.{cutoff}",
            "order": "fecha.desc",
            "limit": str(weeks * 7),
        })
    except:
        return []


def get_courtesy_details(weeks=2):
    """Fetch detailed courtesy data from wansoft_data (deep scraper)."""
    cutoff = (datetime.now(MX_TZ) - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    try:
        return sb_get("wansoft_data", {
            "client_id": f"eq.{CLIENT['id']}",
            "data_key": "eq.courtesies",
            "fecha": f"gte.{cutoff}",
            "order": "fecha.desc",
            "limit": str(weeks * 7),
        })
    except:
        return []


# ── Analysis ────────────────────────────────────────────────────────────────
def analyze_cancellations(data):
    """Detect meseros with high cancellation/void rates."""
    findings = []

    for day in data:
        ventas_brutas = float(day.get("ventas_brutas") or 0)
        devoluciones = float(day.get("devoluciones") or 0)
        ventas = float(day.get("ventas_dia") or 0)

        if ventas_brutas > 0 and devoluciones > 0:
            cancel_rate = devoluciones / ventas_brutas
            if cancel_rate >= CANCEL_RATE_THRESHOLD:
                findings.append({
                    "type": "cancellations",
                    "fecha": day["fecha"],
                    "ventas_brutas": ventas_brutas,
                    "devoluciones": devoluciones,
                    "rate": cancel_rate,
                    "message": f"Devoluciones de ${devoluciones:,.0f} ({cancel_rate*100:.1f}% de ventas brutas) el {day['fecha']}",
                })

    return findings


def analyze_discounts(data):
    """Detect unusual discount patterns.
    Uses BOTH wansoft_daily (summary) AND wansoft_data (detail) for full picture."""
    findings = []

    # ── 1. Summary-level analysis from wansoft_daily ──
    now_mx = datetime.now(MX_TZ)
    week_cutoff = (now_mx - timedelta(days=7)).strftime("%Y-%m-%d")

    this_week = [d for d in data if d["fecha"] >= week_cutoff]
    last_week = [d for d in data if d["fecha"] < week_cutoff]

    tw_ventas = sum(float(d.get("ventas_brutas") or 0) for d in this_week)
    tw_descuentos = sum(float(d.get("descuentos") or 0) for d in this_week)

    lw_ventas = sum(float(d.get("ventas_brutas") or 0) for d in last_week)
    lw_descuentos = sum(float(d.get("descuentos") or 0) for d in last_week)

    if tw_ventas > 0 and tw_descuentos > 0:
        tw_rate = tw_descuentos / tw_ventas
        lw_rate = lw_descuentos / lw_ventas if lw_ventas > 0 else 0

        if tw_rate >= DISCOUNT_RATE_THRESHOLD:
            findings.append({
                "type": "discount_high",
                "severity": "high",
                "message": f"Descuentos esta semana: ${tw_descuentos:,.0f} ({tw_rate*100:.1f}% de ventas brutas)",
                "detail": f"Semana pasada fue {lw_rate*100:.1f}%",
            })

        if lw_rate > 0 and tw_rate > lw_rate * 1.5:
            findings.append({
                "type": "discount_spike",
                "severity": "medium",
                "message": f"Descuentos subieron {((tw_rate/lw_rate)-1)*100:.0f}% vs semana pasada ({lw_rate*100:.1f}% → {tw_rate*100:.1f}%)",
            })

    # ── 2. Detail-level analysis from wansoft_data (deep scraper) ──
    discount_rows = get_discount_details(weeks=2)
    courtesy_rows = get_courtesy_details(weeks=2)

    for day_record in discount_rows:
        fecha = day_record.get("fecha", "?")
        items = day_record.get("data", [])
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except:
                continue

        # Flag self-authorized discounts (mesero == autorizador)
        for item in items:
            mesero = (item.get("mesero") or "").strip()
            autorizador = (item.get("autorizador") or "").strip()
            monto = float(item.get("total") or 0)

            if mesero and autorizador and mesero.lower() == autorizador.lower() and monto > 0:
                findings.append({
                    "type": "self_authorized_discount",
                    "severity": "high",
                    "fecha": fecha,
                    "message": f"Auto-descuento: {mesero} se autoriza ${monto:,.0f} a si mismo ({fecha})",
                    "detail": f"Orden: {item.get('orden', '?')}, Mesa: {item.get('mesa', '?')}, Platillo: {item.get('platillo', '?')}",
                })

        # Flag single-table discount totals over $1,000
        mesa_totals = defaultdict(lambda: {"total": 0, "items": [], "mesero": ""})
        for item in items:
            mesa = item.get("mesa", "?")
            mesa_totals[mesa]["total"] += float(item.get("total") or 0)
            mesa_totals[mesa]["items"].append(item.get("platillo") or item.get("nombre", "?"))
            mesa_totals[mesa]["mesero"] = item.get("mesero", "?")

        for mesa, info in mesa_totals.items():
            if info["total"] >= 1000:
                findings.append({
                    "type": "high_table_discount",
                    "severity": "high",
                    "fecha": fecha,
                    "message": f"Mesa {mesa}: ${info['total']:,.0f} en descuentos ({len(info['items'])} items) — {info['mesero']} ({fecha})",
                    "detail": f"Items: {', '.join(info['items'][:5])}{'...' if len(info['items']) > 5 else ''}",
                })

        # Flag high daily discount count (20+ items)
        if len(items) >= 20:
            daily_total = sum(float(i.get("total") or 0) for i in items)
            findings.append({
                "type": "excessive_daily_discounts",
                "severity": "medium",
                "fecha": fecha,
                "message": f"{len(items)} descuentos en un dia (${daily_total:,.0f} total) — {fecha}",
            })

    # ── 3. Courtesy analysis ──
    for day_record in courtesy_rows:
        fecha = day_record.get("fecha", "?")
        items = day_record.get("data", [])
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except:
                continue

        daily_courtesy_total = sum(float(i.get("total") or 0) for i in items)
        if daily_courtesy_total >= COURTESY_THRESHOLD:
            findings.append({
                "type": "high_daily_courtesies",
                "severity": "high",
                "fecha": fecha,
                "message": f"Cortesias: ${daily_courtesy_total:,.0f} en un dia ({len(items)} items) — {fecha}",
            })

        # Self-authorized courtesies
        for item in items:
            mesero = (item.get("mesero") or "").strip()
            autorizador = (item.get("autorizador") or "").strip()
            monto = float(item.get("total") or 0)
            if mesero and autorizador and mesero.lower() == autorizador.lower() and monto > 0:
                findings.append({
                    "type": "self_authorized_courtesy",
                    "severity": "high",
                    "fecha": fecha,
                    "message": f"Auto-cortesia: {mesero} se autoriza cortesia de ${monto:,.0f} ({fecha})",
                    "detail": f"Orden: {item.get('orden', '?')}, Platillo: {item.get('platillo', '?')}",
                })

    return findings


def analyze_cash_ratio(data):
    """Detect suspicious shifts in cash vs card ratio."""
    findings = []

    # Split into this week vs last week
    now_mx = datetime.now(MX_TZ)
    week_cutoff = (now_mx - timedelta(days=7)).strftime("%Y-%m-%d")

    this_week_cash = 0
    this_week_total = 0
    last_week_cash = 0
    last_week_total = 0

    for day in data:
        efectivo = float(day.get("efectivo") or 0)
        ventas = float(day.get("ventas_dia") or 0)

        if day["fecha"] >= week_cutoff:
            this_week_cash += efectivo
            this_week_total += ventas
        else:
            last_week_cash += efectivo
            last_week_total += ventas

    if this_week_total > 0 and last_week_total > 0:
        tw_cash_ratio = this_week_cash / this_week_total
        lw_cash_ratio = last_week_cash / last_week_total
        shift = tw_cash_ratio - lw_cash_ratio

        if abs(shift) >= CASH_SHIFT_THRESHOLD:
            direction = "más efectivo" if shift > 0 else "menos efectivo"
            severity = "high" if shift > 0 else "low"  # More cash = more suspicious
            findings.append({
                "type": "cash_shift",
                "severity": severity,
                "tw_cash_ratio": tw_cash_ratio,
                "lw_cash_ratio": lw_cash_ratio,
                "message": f"Cambio en ratio efectivo: {lw_cash_ratio*100:.0f}% → {tw_cash_ratio*100:.0f}% ({direction})",
                "detail": f"Efectivo esta semana: ${this_week_cash:,.0f} de ${this_week_total:,.0f}",
            })

    # Also flag if cash ratio is unusually high on any single day
    for day in data:
        efectivo = float(day.get("efectivo") or 0)
        ventas = float(day.get("ventas_dia") or 0)
        if ventas > 0:
            day_cash_ratio = efectivo / ventas
            if day_cash_ratio > 0.60:  # More than 60% cash in a day is unusual for a café
                findings.append({
                    "type": "cash_day_high",
                    "severity": "medium",
                    "message": f"Efectivo inusualmente alto el {day['fecha']}: {day_cash_ratio*100:.0f}% (${efectivo:,.0f} de ${ventas:,.0f})",
                })

    return findings


def analyze_mesero_patterns(data):
    """Detect meseros with suspicious patterns."""
    findings = []
    mesero_stats = defaultdict(lambda: {"ventas": 0, "days": 0})

    for day in data:
        meseros_list = day.get("meseros") or []
        if isinstance(meseros_list, str):
            meseros_list = json.loads(meseros_list)

        for m in meseros_list:
            name = m.get("nombre", "")
            total = float(m.get("total") or 0)
            if name and is_mesero(name, CLIENT):
                short = name.split()[0]
                mesero_stats[short]["ventas"] += total
                mesero_stats[short]["days"] += 1

    # Find meseros with very low average (potential under-reporting)
    if mesero_stats:
        avgs = {name: stats["ventas"] / stats["days"] for name, stats in mesero_stats.items() if stats["days"] >= 3}
        if avgs:
            overall_avg = sum(avgs.values()) / len(avgs)
            for name, avg in avgs.items():
                if avg < overall_avg * 0.4 and overall_avg > 0:
                    findings.append({
                        "type": "mesero_low",
                        "severity": "low",
                        "message": f"{name}: promedio diario ${avg:,.0f} — {((1-avg/overall_avg)*100):.0f}% debajo del promedio (${overall_avg:,.0f})",
                    })

    return findings


def calculate_risk_score(all_findings):
    """Calculate overall risk score 0-100."""
    score = 0
    weights = {
        "cancellations": 15,
        "discount_high": 20,
        "discount_spike": 10,
        "cash_shift": 25,
        "cash_day_high": 15,
        "mesero_low": 10,
    }

    for finding in all_findings:
        f_type = finding.get("type", "")
        score += weights.get(f_type, 5)

    return min(score, 100)


# ── Build Message ───────────────────────────────────────────────────────────
def build_message(all_findings, risk_score, data):
    now_mx = datetime.now(MX_TZ)

    msg = f"🔍 REPORTE ANTI-FRAUDE — Semana del {now_mx.strftime('%d/%m/%Y')}\n\n"

    # Risk score
    if risk_score == 0:
        msg += "✅ RIESGO: 0/100 — Todo normal esta semana.\n\n"
    elif risk_score <= 25:
        msg += f"🟢 RIESGO: {risk_score}/100 — Bajo. Algunas observaciones menores.\n\n"
    elif risk_score <= 50:
        msg += f"🟡 RIESGO: {risk_score}/100 — Moderado. Revisar hallazgos.\n\n"
    elif risk_score <= 75:
        msg += f"🟠 RIESGO: {risk_score}/100 — Alto. Requiere atención.\n\n"
    else:
        msg += f"🔴 RIESGO: {risk_score}/100 — Crítico. Acción inmediata necesaria.\n\n"

    if not all_findings:
        msg += "No se detectaron patrones sospechosos.\n"
        return msg

    # Group by type
    by_type = defaultdict(list)
    for f in all_findings:
        by_type[f["type"]].append(f)

    # Cancellations
    cancel_findings = by_type.get("cancellations", [])
    if cancel_findings:
        msg += "🚫 CANCELACIONES/DEVOLUCIONES:\n"
        for f in cancel_findings[:3]:
            msg += f"  • {f['message']}\n"
        msg += "\n"

    # Discounts
    discount_findings = by_type.get("discount_high", []) + by_type.get("discount_spike", [])
    if discount_findings:
        msg += "🏷 DESCUENTOS:\n"
        for f in discount_findings:
            msg += f"  • {f['message']}\n"
            if f.get("detail"):
                msg += f"    ({f['detail']})\n"
        msg += "\n"

    # Cash ratio
    cash_findings = by_type.get("cash_shift", []) + by_type.get("cash_day_high", [])
    if cash_findings:
        msg += "💵 EFECTIVO:\n"
        for f in cash_findings[:3]:
            msg += f"  • {f['message']}\n"
            if f.get("detail"):
                msg += f"    ({f['detail']})\n"
        msg += "\n"

    # Mesero patterns
    mesero_findings = by_type.get("mesero_low", [])
    if mesero_findings:
        msg += "👤 MESEROS:\n"
        for f in mesero_findings:
            msg += f"  • {f['message']}\n"
        msg += "\n"

    # Weekly summary
    total_ventas = sum(float(d.get("ventas_dia") or 0) for d in data)
    total_descuentos = sum(float(d.get("descuentos") or 0) for d in data)
    total_devoluciones = sum(float(d.get("devoluciones") or 0) for d in data)
    total_efectivo = sum(float(d.get("efectivo") or 0) for d in data)

    msg += "📊 RESUMEN SEMANAL:\n"
    msg += f"  Ventas: ${total_ventas:,.0f}\n"
    msg += f"  Descuentos: ${total_descuentos:,.0f} ({total_descuentos/total_ventas*100:.1f}%)\n" if total_ventas > 0 else ""
    msg += f"  Devoluciones: ${total_devoluciones:,.0f}\n"
    msg += f"  Efectivo: ${total_efectivo:,.0f} ({total_efectivo/total_ventas*100:.0f}%)\n" if total_ventas > 0 else ""

    # Recommendations
    recs = []
    if cancel_findings:
        recs.append("Revisar tickets cancelados — solicitar justificación por escrito")
    if discount_findings:
        recs.append("Auditar quién autoriza descuentos y por qué concepto")
    if cash_findings and any(f.get("severity") == "high" for f in cash_findings):
        recs.append("URGENTE: Aumento de efectivo puede indicar fraude. Verificar cortes de caja.")
    if mesero_findings:
        recs.append("Revisar ventas de meseros con bajo rendimiento — posible subfacturación")

    if recs:
        msg += "\n💡 ACCIONES:\n"
        for rec in recs:
            msg += f"  • {rec}\n"

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
    if _audit: _audit.log_start()
    now_mx = datetime.now(MX_TZ)

    print(f"[antifraud] Starting for {CLIENT['id']}")

    # 1. Fetch data
    print("[antifraud] Fetching weekly data...")
    data = get_weekly_data(2)
    print(f"[antifraud] Got {len(data)} days")

    if len(data) < 3:
        print("[antifraud] Not enough data, skipping")
        return

    # 2. Analyze
    print("[antifraud] Analyzing...")
    all_findings = []
    all_findings.extend(analyze_cancellations(data))
    all_findings.extend(analyze_discounts(data))
    all_findings.extend(analyze_cash_ratio(data))
    all_findings.extend(analyze_mesero_patterns(data))

    risk_score = calculate_risk_score(all_findings)
    print(f"[antifraud] Findings: {len(all_findings)}, Risk: {risk_score}/100")

    # 3. Build structured data
    total_ventas = sum(float(d.get("ventas_dia") or 0) for d in data)
    total_descuentos = sum(float(d.get("descuentos") or 0) for d in data)
    total_devoluciones = sum(float(d.get("devoluciones") or 0) for d in data)
    total_efectivo = sum(float(d.get("efectivo") or 0) for d in data)

    structured_data = {
        "risk_score": risk_score,
        "findings": all_findings,
        "total_findings": len(all_findings),
        "summary_stats": {
            "ventas": total_ventas,
            "descuentos": total_descuentos,
            "devoluciones": total_devoluciones,
            "efectivo": total_efectivo,
            "descuento_pct": round(total_descuentos / total_ventas * 100, 1) if total_ventas > 0 else 0,
            "efectivo_pct": round(total_efectivo / total_ventas * 100, 1) if total_ventas > 0 else 0,
        },
        "analysis_days": len(data),
    }

    priority = "critical" if risk_score > 50 else "warning" if risk_score > 25 else "info"
    summary = f"Riesgo {risk_score}/100, {len(all_findings)} hallazgos"

    # 4. Save to DB
    today_str = now_mx.strftime("%Y-%m-%d")
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_results",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "client_id": CLIENT["id"],
                "agent_id": "antifraud",
                "fecha": today_str,
                "data": json.dumps(structured_data),
                "summary": summary,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(f"[antifraud] Saved to agent_results")
    except Exception as e:
        print(f"[antifraud] Error saving to DB: {e}")

    # 5. Send Telegram ONLY when risk > 50
    sent = 0
    if risk_score > 50:
        msg = build_message(all_findings, risk_score, data)
        print(f"\n{msg}")
        sent = send_telegram(msg)
        print(f"[antifraud] Sent to {sent} chats")
    else:
        print(f"[antifraud] Risk {risk_score}/100, no Telegram")

    elapsed = int((time.time() - start) * 1000)

    # 6. Log
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "antifraud-agent",
                "trigger_type": TRIGGER_TYPE,
                "status": "success",
                "duration_ms": elapsed,
                "output_summary": f"findings: {len(all_findings)}, risk: {risk_score}/100, sent: {sent}",
                "tentacle": "ops",
            },
        )
    except:
        pass


if __name__ == "__main__":
    main()
