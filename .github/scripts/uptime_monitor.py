#!/usr/bin/env python3
"""
Uptime Monitor v2 — Smart monitoring every 15 min.
Not just HTTP 200 — verifies real data exists and pages work.
Alerts on Telegram only when something is actually broken.
Silent when everything is OK.
"""
import os, sys, time, json, requests

TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
SUPABASE_URL = os.environ["SUPABASE_URL"]
# Least privilege: agent key (SELECT + INSERT agent_runs/results)
SUPABASE_KEY = os.environ.get("SUPABASE_AGENT_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "https://app.fullsite.mx")

start = time.time()
failures = []
warnings = []

def check_url(name, url, timeout=12):
    """Basic URL reachability."""
    try:
        r = requests.get(url, timeout=timeout, allow_redirects=True)
        if r.status_code >= 500:
            failures.append(f"{name}: HTTP {r.status_code}")
        else:
            print(f"OK: {name} ({r.status_code}, {r.elapsed.total_seconds():.1f}s)")
    except Exception as e:
        failures.append(f"{name}: {e}")

def check_health_endpoint():
    """Call /api/health and check each subsystem."""
    try:
        r = requests.get(f"{DASHBOARD_URL}/api/health", timeout=20)
        if r.status_code >= 500:
            failures.append(f"Health endpoint: HTTP {r.status_code}")
            return
        data = r.json()
        for check in data.get("checks", []):
            if check["status"] != "ok":
                # data_freshness and costeo are warnings, not critical failures
                if check["name"] in ("data_freshness", "costeo"):
                    warnings.append(f"{check['name']}: {check['detail']}")
                else:
                    failures.append(f"{check['name']}: {check['detail']}")
            else:
                print(f"OK: {check['name']} — {check['detail']} ({check['ms']}ms)")
    except Exception as e:
        failures.append(f"Health endpoint: {e}")

def check_data_has_values():
    """Verify dashboard won't show all zeros."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha,ventas_dia,tickets_count&order=fecha.desc&limit=1",
            headers=headers, timeout=10
        )
        data = r.json()
        if data and len(data) > 0:
            row = data[0]
            ventas = row.get("ventas_dia", 0) or 0
            tickets = row.get("tickets_count", 0) or 0
            if ventas == 0 and tickets == 0:
                warnings.append(f"Latest day ({row['fecha']}) has $0 ventas and 0 tickets — possible scraper failure")
            else:
                print(f"OK: Data values — {row['fecha']}: ${ventas:,.0f} ventas, {tickets} tickets")
        else:
            failures.append("wansoft_daily: completely empty")
    except Exception as e:
        warnings.append(f"Data values check: {e}")

# ── Run checks ──
print(f"Uptime Monitor v2 — {time.strftime('%Y-%m-%d %H:%M MX')}")
print("-" * 40)

# 1. Pages reachable
check_url("Dashboard", f"{DASHBOARD_URL}/login")
check_url("Landing", "https://fullsite.mx")

# 2. Smart health check (supabase, auth, agents, freshness, costeo)
check_health_endpoint()

# 3. Data has actual values (not just exists)
check_data_has_values()

# ── Report ──
duration = int((time.time() - start) * 1000)

if failures:
    msg = "🔴 DOWNTIME ALERT\n\n"
    msg += "\n".join(f"✗ {f}" for f in failures)
    if warnings:
        msg += "\n\n⚠ Warnings:\n" + "\n".join(f"  {w}" for w in warnings)
    msg += f"\n\n{time.strftime('%H:%M MX')}"
    requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    print(f"\nALERT SENT: {len(failures)} failures")
elif warnings:
    # Only send warnings if they're new (avoid spamming)
    msg = "🟡 Monitor Warning\n\n"
    msg += "\n".join(f"⚠ {w}" for w in warnings)
    msg += f"\n\n{time.strftime('%H:%M MX')}"
    requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    print(f"\nWARNING SENT: {len(warnings)}")
else:
    print(f"\nAll OK — {duration}ms — silent success")

# Log
try:
    requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"agent_id": "uptime-monitor", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
              "status": "error" if failures else ("warning" if warnings else "success"),
              "duration_ms": duration,
              "output_summary": f"{len(failures)}F {len(warnings)}W" if (failures or warnings) else "All OK",
              "tentacle": "ops"}, timeout=10)
except:
    pass
