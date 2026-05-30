#!/usr/bin/env python3
"""
Smoke Test — Runs after every deploy.
Verifies critical pages return real data, not empty states.
Alerts on Telegram if anything fails.
"""
import os, sys, json, time, requests

TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
BASE_URL = os.environ.get("DASHBOARD_URL", "https://app.fullsite.mx")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

start = time.time()
failures = []
warnings = []

def check_url(name, url, expect_status=200, timeout=15):
    """Check that a URL returns the expected status code."""
    try:
        r = requests.get(url, timeout=timeout, allow_redirects=True)
        if r.status_code != expect_status:
            failures.append(f"{name}: expected {expect_status}, got {r.status_code}")
        else:
            print(f"OK: {name} ({r.status_code}, {r.elapsed.total_seconds():.1f}s)")
    except Exception as e:
        failures.append(f"{name}: {e}")

def check_health():
    """Check the /api/health endpoint returns healthy."""
    try:
        r = requests.get(f"{BASE_URL}/api/health", timeout=20)
        data = r.json()
        if data.get("status") != "healthy":
            failed_checks = [c for c in data.get("checks", []) if c.get("status") != "ok"]
            for fc in failed_checks:
                failures.append(f"Health/{fc['name']}: {fc['detail']}")
        else:
            print(f"OK: Health endpoint — all {len(data.get('checks', []))} checks passed ({data.get('total_ms', 0)}ms)")
    except Exception as e:
        failures.append(f"Health endpoint: {e}")

def check_supabase_data():
    """Verify critical data exists in Supabase."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    # 1. wansoft_daily has recent data
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_daily?select=fecha,ventas_dia&order=fecha.desc&limit=3",
            headers=headers, timeout=10
        )
        data = r.json()
        if not data or len(data) == 0:
            failures.append("wansoft_daily: NO DATA — dashboard will show empty")
        else:
            latest = data[0]
            print(f"OK: wansoft_daily latest={latest['fecha']} ventas={latest.get('ventas_dia', 0)}")
            if latest.get('ventas_dia', 0) == 0:
                warnings.append(f"wansoft_daily: latest day ({latest['fecha']}) has $0 ventas")
    except Exception as e:
        failures.append(f"wansoft_daily check: {e}")

    # 2. costeo_por_platillo exists
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/wansoft_data?select=fecha&data_key=eq.costeo_por_platillo&limit=1",
            headers=headers, timeout=10
        )
        data = r.json()
        if not data or len(data) == 0:
            failures.append("costeo_por_platillo: MISSING — food cost page will be empty")
        else:
            print(f"OK: costeo_por_platillo exists ({data[0]['fecha']})")
    except Exception as e:
        failures.append(f"costeo check: {e}")

    # 3. pos_menu_items has items (admin/menu page)
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/pos_menu_items?select=id&limit=5",
            headers=headers, timeout=10
        )
        data = r.json()
        if not data or len(data) == 0:
            warnings.append("pos_menu_items: empty — /admin/menu will show 0 platillos")
        else:
            print(f"OK: pos_menu_items has data ({len(data)}+ items)")
    except Exception as e:
        warnings.append(f"pos_menu_items check: {e}")

    # 4. agent_runs has recent activity
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/agent_runs?select=agent_id,created_at&order=created_at.desc&limit=1",
            headers=headers, timeout=10
        )
        data = r.json()
        if not data or len(data) == 0:
            failures.append("agent_runs: NO DATA — agents page will show all blank")
        else:
            from datetime import datetime, timezone
            last_run = datetime.fromisoformat(data[0]['created_at'].replace('Z', '+00:00'))
            hours_ago = (datetime.now(timezone.utc) - last_run).total_seconds() / 3600
            if hours_ago > 12:
                warnings.append(f"agent_runs: last run {hours_ago:.0f}h ago ({data[0]['agent_id']})")
            else:
                print(f"OK: agent_runs last={data[0]['agent_id']} ({hours_ago:.0f}h ago)")
    except Exception as e:
        warnings.append(f"agent_runs check: {e}")

# ── Run all checks ──
print("=" * 50)
print("SMOKE TEST — Post-Deploy Verification")
print("=" * 50)

# Pages load
check_url("Login page", f"{BASE_URL}/login")
check_url("Landing page", "https://fullsite.mx")

# Health endpoint
check_health()

# Data checks
check_supabase_data()

# ── Report ──
duration = int((time.time() - start) * 1000)

if failures:
    msg = "🔴 SMOKE TEST FAILED\n\n"
    msg += "FAILURES:\n" + "\n".join(f"✗ {f}" for f in failures)
    if warnings:
        msg += "\n\nWARNINGS:\n" + "\n".join(f"⚠ {w}" for w in warnings)
    msg += f"\n\nDuration: {duration}ms"
    requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    print(f"\nALERT SENT: {len(failures)} failures, {len(warnings)} warnings")
    sys.exit(1)
elif warnings:
    msg = "🟡 SMOKE TEST — Warnings\n\n"
    msg += "\n".join(f"⚠ {w}" for w in warnings)
    msg += f"\n\nDuration: {duration}ms"
    requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    print(f"\nWARNINGS SENT: {len(warnings)}")
else:
    print(f"\nALL CHECKS PASSED — {duration}ms — silent success")

# Log to agent_runs
try:
    requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"agent_id": "smoke-test", "trigger_type": os.environ.get("TRIGGER_TYPE", "deploy"),
              "status": "error" if failures else ("warning" if warnings else "success"),
              "duration_ms": duration,
              "output_summary": f"{len(failures)} failures, {len(warnings)} warnings" if (failures or warnings) else "All OK",
              "tentacle": "ops"}, timeout=10)
except:
    pass
