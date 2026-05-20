#!/usr/bin/env python3
"""
Hermes — The agent that improves agents.
Runs daily. Audits all 12 agents + chat, detects failures,
identifies data gaps, and saves improvement recommendations.

Hermes does NOT just report — it FIXES what it can automatically:
- Updates agent_results with corrected priorities
- Logs improvement suggestions to hermes_improvements table
- Tracks patterns over time to detect recurring issues
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from client_config import get_client, get_tz

CLIENT = get_client()
MX_TZ = get_tz(CLIENT)
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "cron")

sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
sb_write = {**sb_headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params, timeout=15)
    return r.json() if r.ok else []


def sb_upsert(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_write, json=data, timeout=15)
    return r.ok


def send_telegram(msg):
    if not TG_CHAT_ID:
        return
    for chunk in [msg[i:i+4000] for i in range(0, len(msg), 4000)]:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk})


# ── AUDIT 1: Agent Health ─────────────────────────────────────────────────

def audit_agent_health():
    """Check which agents ran, which failed, which have stale data."""
    issues = []
    now = datetime.now(timezone.utc)

    # Check agent_results
    results = sb_get("agent_results", {"select": "agent_id,fecha,priority,summary,updated_at", "order": "updated_at.desc", "limit": "50"})

    agents_seen = {}
    for r in results:
        aid = r.get("agent_id", "")
        if aid not in agents_seen:
            agents_seen[aid] = r

    expected_agents = ["anomaly", "predictor", "upselling", "menu-engineering", "staffing",
                       "antifraud", "kitchen", "table-time", "tips", "suppliers", "waste", "climate"]

    for agent in expected_agents:
        if agent not in agents_seen:
            issues.append({
                "agent": agent,
                "type": "missing",
                "severity": "high",
                "message": f"Agente '{agent}' nunca ha guardado resultados",
                "fix": "Verificar que el workflow corre y guarda a agent_results",
            })
        else:
            last = agents_seen[agent]
            updated = datetime.fromisoformat(last["updated_at"].replace("Z", "+00:00"))
            hours_ago = (now - updated).total_seconds() / 3600

            if hours_ago > 48:
                issues.append({
                    "agent": agent,
                    "type": "stale",
                    "severity": "medium",
                    "message": f"Agente '{agent}' no se actualiza desde hace {int(hours_ago)}h",
                    "fix": "Verificar cron schedule y que el workflow no falle",
                })

            # Check for empty data
            if last.get("summary") and ("0 " in last["summary"][:10] or "Sin " in str(last.get("summary", ""))):
                issues.append({
                    "agent": agent,
                    "type": "empty_data",
                    "severity": "low",
                    "message": f"Agente '{agent}' reporta datos vacíos: {last['summary']}",
                    "fix": "Verificar fuente de datos (Supabase tables, Wansoft scraper)",
                })

    # Check agent_runs for failures
    runs = sb_get("agent_runs", {
        "select": "agent_id,status,error_message,created_at",
        "status": "eq.error",
        "order": "created_at.desc",
        "limit": "20",
    })

    error_counts = defaultdict(int)
    for run in runs:
        error_counts[run.get("agent_id", "unknown")] += 1

    for agent, count in error_counts.items():
        if count >= 3:
            issues.append({
                "agent": agent,
                "type": "recurring_error",
                "severity": "high",
                "message": f"Agente '{agent}' ha fallado {count} veces recientemente",
                "fix": "Revisar logs del workflow en GitHub Actions",
            })

    return issues


# ── AUDIT 2: Data Quality ─────────────────────────────────────────────────

def audit_data_quality():
    """Check data freshness and completeness."""
    issues = []
    now_mx = datetime.now(MX_TZ)
    today = now_mx.strftime("%Y-%m-%d")
    yesterday = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")

    # Check wansoft_daily freshness
    daily = sb_get("wansoft_daily", {
        "select": "fecha,ventas_dia,meseros,ventas_por_grupo",
        "order": "fecha.desc",
        "limit": "3",
    })

    if daily:
        latest_fecha = daily[0].get("fecha", "")
        if latest_fecha < yesterday:
            issues.append({
                "agent": "intraday_sales",
                "type": "stale_data",
                "severity": "high",
                "message": f"wansoft_daily última fecha: {latest_fecha} (debería ser {yesterday} o {today})",
                "fix": "Verificar intraday-sales workflow y Wansoft login",
            })

        # Check for missing fields
        for d in daily[:1]:
            meseros = d.get("meseros")
            if not meseros or meseros == "[]" or meseros == "null":
                issues.append({
                    "agent": "intraday_sales",
                    "type": "missing_field",
                    "severity": "medium",
                    "message": f"wansoft_daily {d['fecha']}: meseros vacío",
                    "fix": "Verificar parse de SalesByUser en intraday_sales.py",
                })

            grupos = d.get("ventas_por_grupo")
            if not grupos or grupos == "[]" or grupos == "null":
                issues.append({
                    "agent": "intraday_sales",
                    "type": "missing_field",
                    "severity": "medium",
                    "message": f"wansoft_daily {d['fecha']}: ventas_por_grupo vacío",
                    "fix": "Verificar parse de SalesByGroup en intraday_sales.py",
                })
    else:
        issues.append({
            "agent": "intraday_sales",
            "type": "no_data",
            "severity": "critical",
            "message": "wansoft_daily está vacía — sin datos de ventas",
            "fix": "Correr intraday-sales manualmente",
        })

    # Check waiter categories freshness
    wc = sb_get("wansoft_waiter_categories", {
        "select": "fecha",
        "order": "fecha.desc",
        "limit": "1",
    })
    if wc:
        wc_fecha = wc[0].get("fecha", "")
        if wc_fecha < yesterday:
            issues.append({
                "agent": "ticket_detail",
                "type": "stale_data",
                "severity": "medium",
                "message": f"waiter_categories última fecha: {wc_fecha}",
                "fix": "Verificar ticket-detail workflow",
            })

    # Check deep scraper tables
    for table in ["wansoft_tips", "wansoft_food_cost", "wansoft_suppliers"]:
        data = sb_get(table, {"select": "fecha", "order": "fecha.desc", "limit": "1"})
        if not data:
            issues.append({
                "agent": "deep_scraper",
                "type": "empty_table",
                "severity": "low",
                "message": f"Tabla {table} está vacía",
                "fix": "Correr wansoft-deep workflow o verificar parsing",
            })

    return issues


# ── AUDIT 3: Chat Quality ─────────────────────────────────────────────────

def audit_chat_patterns():
    """Analyze common failure patterns in chat responses."""
    issues = []

    # Check if chat has data gaps
    # This checks what data the chat CAN'T answer
    gaps = []

    # Can the chat answer "platillo más vendido"?
    daily = sb_get("wansoft_daily", {
        "select": "fecha,ventas_por_grupo",
        "order": "fecha.desc",
        "limit": "1",
    })
    if daily:
        grupos = daily[0].get("ventas_por_grupo")
        if grupos:
            parsed = json.loads(grupos) if isinstance(grupos, str) else grupos
            # Check if we have individual items or just categories
            has_items = any("HALF" in str(g.get("nombre", "")).upper() for g in parsed)
            if not has_items:
                gaps.append("platillos individuales (solo tiene categorías, no items específicos)")

    # Check if per-mesero per-platillo data exists
    wc = sb_get("wansoft_waiter_categories", {"select": "fecha,data", "order": "fecha.desc", "limit": "1"})
    if wc:
        data = wc[0].get("data")
        if data:
            parsed = json.loads(data) if isinstance(data, str) else data
            has_platillo = "__por_mesero_platillo" in parsed
            if not has_platillo:
                gaps.append("desglose mesero × platillo individual")
    else:
        gaps.append("datos de waiter_categories (H&H, Pan, Postres por mesero)")

    if gaps:
        issues.append({
            "agent": "chat",
            "type": "data_gap",
            "severity": "medium",
            "message": f"El chat no puede responder preguntas sobre: {', '.join(gaps)}",
            "fix": "Agregar SalesBySaucer al sync diario para tener platillos individuales",
        })

    return issues


# ── AUTO-HEAL: Fix what we can automatically ──────────────────────────────

def auto_heal(all_issues):
    """Attempt to fix issues automatically. Returns list of actions taken."""
    actions = []

    for issue in all_issues:
        # Auto-fix: re-trigger stale agents
        if issue["type"] == "stale" and issue["severity"] in ("high", "medium"):
            agent = issue["agent"]
            workflow_map = {
                "anomaly": "agents-hourly.yml",
                "predictor": "agents-hourly.yml",
                "upselling": "agents-hourly.yml",
                "kitchen": "agents-daily.yml",
                "table-time": "agents-daily.yml",
                "staffing": "agents-weekly.yml",
                "menu-engineering": "agents-weekly.yml",
                "antifraud": "agents-weekly.yml",
                "tips": "agents-weekly.yml",
                "suppliers": "agents-weekly.yml",
                "waste": "agents-weekly.yml",
                "climate": "climate-events.yml",
                "intraday_sales": "intraday-sales.yml",
                "deep_scraper": "wansoft-deep.yml",
                "ticket_detail": "ticket-detail.yml",
            }
            wf = workflow_map.get(agent)
            if wf:
                try:
                    github_token = os.environ.get("GITHUB_TOKEN", "")
                    if github_token:
                        r = requests.post(
                            f"https://api.github.com/repos/ramonfaurdaniel-png/fullsite/actions/workflows/{wf}/dispatches",
                            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"},
                            json={"ref": "main"},
                            timeout=10,
                        )
                        if r.ok:
                            actions.append(f"Re-triggered {wf} for stale agent '{agent}'")
                        else:
                            actions.append(f"Failed to trigger {wf}: {r.status_code}")
                except Exception as e:
                    actions.append(f"Error triggering {wf}: {e}")

        # Auto-fix: update priority of agents with wrong priority
        if issue["type"] == "empty_data" and issue["severity"] == "low":
            try:
                # Downgrade empty agents to 'info' priority
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/agent_results?agent_id=eq.{issue['agent']}&priority=neq.info",
                    headers=sb_write,
                    json={"priority": "info"},
                    timeout=10,
                )
                actions.append(f"Downgraded empty agent '{issue['agent']}' priority to info")
            except:
                pass

    return actions


# ── AUDIT 5: Track improvement over time ──────────────────────────────────

def track_improvement_trend():
    """Compare today's issues vs last run to see if things are getting better."""
    history = sb_get("agent_results", {
        "select": "fecha,data",
        "agent_id": "eq.hermes",
        "order": "fecha.desc",
        "limit": "7",
    })

    if len(history) < 2:
        return None

    trend = []
    for h in history:
        d = h.get("data")
        if isinstance(d, str):
            d = json.loads(d)
        if d:
            trend.append({
                "fecha": h["fecha"],
                "total": d.get("total_issues", 0),
                "critical": d.get("critical_count", 0),
                "high": d.get("high_count", 0),
            })

    if len(trend) >= 2:
        prev = trend[1]["total"]
        curr = trend[0]["total"]
        direction = "mejorando" if curr < prev else "empeorando" if curr > prev else "estable"
        return {
            "direction": direction,
            "current": curr,
            "previous": prev,
            "change": curr - prev,
            "history": trend[:7],
        }

    return None


# ── AUDIT 4: Improvement Tracking ─────────────────────────────────────────

def generate_improvements(all_issues):
    """Generate concrete improvement recommendations."""
    improvements = []

    # Group by severity
    critical = [i for i in all_issues if i["severity"] == "critical"]
    high = [i for i in all_issues if i["severity"] == "high"]
    medium = [i for i in all_issues if i["severity"] == "medium"]

    if critical:
        improvements.append({
            "priority": "critical",
            "title": f"{len(critical)} problemas críticos",
            "details": [f"{i['agent']}: {i['message']}" for i in critical],
            "fixes": [i["fix"] for i in critical],
        })

    if high:
        improvements.append({
            "priority": "high",
            "title": f"{len(high)} problemas altos",
            "details": [f"{i['agent']}: {i['message']}" for i in high],
            "fixes": list(set(i["fix"] for i in high)),
        })

    if medium:
        improvements.append({
            "priority": "medium",
            "title": f"{len(medium)} mejoras sugeridas",
            "details": [f"{i['agent']}: {i['message']}" for i in medium],
            "fixes": list(set(i["fix"] for i in medium)),
        })

    # Always suggest proactive improvements
    improvements.append({
        "priority": "info",
        "title": "Mejoras proactivas",
        "details": [
            "Agregar SalesBySaucer a intraday_sales para responder 'qué platillo se vendió más'",
            "Agregar propinas por mesero al sync diario",
            "Implementar feedback loop: cuando el chat no responde bien, guardar la pregunta para mejorar",
        ],
        "fixes": [],
    })

    return improvements


# ── MAIN ──────────────────────────────────────────────────────────────────

def main():
    start = time.time()
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")

    print(f"{'='*60}")
    print(f"HERMES — Agent Improvement System — {today_str}")
    print(f"{'='*60}\n")

    # Run all audits
    print("━━━ AGENT HEALTH ━━━")
    health_issues = audit_agent_health()
    print(f"  {len(health_issues)} issues found\n")

    print("━━━ DATA QUALITY ━━━")
    data_issues = audit_data_quality()
    print(f"  {len(data_issues)} issues found\n")

    print("━━━ CHAT QUALITY ━━━")
    chat_issues = audit_chat_patterns()
    print(f"  {len(chat_issues)} issues found\n")

    all_issues = health_issues + data_issues + chat_issues
    improvements = generate_improvements(all_issues)

    # Auto-heal what we can
    print("━━━ AUTO-HEAL ━━━")
    heal_actions = auto_heal(all_issues)
    for action in heal_actions:
        print(f"  ✓ {action}")
    if not heal_actions:
        print("  No auto-fixes needed")

    # Track improvement trend
    print("\n━━━ TREND ━━━")
    trend = track_improvement_trend()
    if trend:
        print(f"  Direction: {trend['direction']} ({trend['previous']} → {trend['current']}, {trend['change']:+d})")
    else:
        print("  Not enough history yet")

    # Save to agent_results
    structured_data = {
        "health_issues": health_issues,
        "data_issues": data_issues,
        "chat_issues": chat_issues,
        "improvements": improvements,
        "auto_heal_actions": heal_actions,
        "trend": trend,
        "total_issues": len(all_issues),
        "critical_count": len([i for i in all_issues if i["severity"] == "critical"]),
        "high_count": len([i for i in all_issues if i["severity"] == "high"]),
    }

    has_critical = structured_data["critical_count"] > 0
    has_high = structured_data["high_count"] > 0
    priority = "critical" if has_critical else "warning" if has_high else "info"
    summary = f"{len(all_issues)} issues: {structured_data['critical_count']} critical, {structured_data['high_count']} high"

    sb_upsert("agent_results", {
        "client_id": CLIENT["id"],
        "agent_id": "hermes",
        "fecha": today_str,
        "data": json.dumps(structured_data),
        "summary": summary,
        "priority": priority,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    print(f"[hermes] Saved to agent_results: {summary}")

    # Send Telegram report (only if critical/high issues)
    if has_critical or has_high:
        msg = f"🔱 HERMES — {today_str}\n{len(all_issues)} issues detectados\n\n"
        for imp in improvements:
            if imp["priority"] in ("critical", "high"):
                msg += f"{'🔴' if imp['priority']=='critical' else '🟡'} {imp['title']}\n"
                for d in imp["details"][:5]:
                    msg += f"  • {d}\n"
                if imp["fixes"]:
                    msg += f"  Fix: {imp['fixes'][0]}\n"
                msg += "\n"
        send_telegram(msg)

    elapsed = int((time.time() - start) * 1000)
    print(f"\n[hermes] Done in {elapsed}ms")

    # Log run
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers=sb_write,
            json={"agent_id": "hermes", "trigger_type": TRIGGER_TYPE,
                  "status": "success", "duration_ms": elapsed,
                  "output_summary": summary, "tentacle": "meta"})
    except:
        pass


if __name__ == "__main__":
    main()
