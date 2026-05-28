#!/usr/bin/env python3
"""
Uptime Monitor — Pings dashboard + bot + Supabase every 15 min.
Alerts on Telegram if anything is down.
Silent when everything is OK.
"""
import os, sys, time, requests

TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

start = time.time()
failures = []

def check(name, url, timeout=10):
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code >= 500:
            failures.append(f"{name}: HTTP {r.status_code}")
        else:
            print(f"OK: {name} ({r.status_code}, {r.elapsed.total_seconds():.1f}s)")
    except Exception as e:
        failures.append(f"{name}: {e}")

# 1. Dashboard
check("Dashboard", "https://app.fullsite.mx/login")

# 2. Landing
check("Landing", "https://fullsite.mx")

# 3. Supabase REST API
check("Supabase API", f"{SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha&order=fecha.desc&limit=1",)

# 4. Supabase Auth
check("Supabase Auth", f"{SUPABASE_URL}/auth/v1/health")

if failures:
    msg = "DOWNTIME ALERT\n\n" + "\n".join(f"x {f}" for f in failures)
    msg += f"\n\nChecked at {time.strftime('%H:%M MX', time.localtime())}"
    requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    print(f"ALERT SENT: {len(failures)} failures")
else:
    print("All systems OK — silent success")

# Log
duration = int((time.time() - start) * 1000)
try:
    requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"agent_id": "uptime-monitor", "trigger_type": os.environ.get("TRIGGER_TYPE", "cron"),
              "status": "error" if failures else "success", "duration_ms": duration,
              "output_summary": f"{len(failures)} failures" if failures else "All OK",
              "tentacle": "ops"}, timeout=10)
except:
    pass
