"""
Shared utilities for Fullsite AI agents.
Replaces per-agent copies of sb_get, log_run, send_telegram.
Enforces truthful reporting: no silent success on empty/stale data.
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
_sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


# ─── Supabase helpers ─────────────────────────────────────────

def sb_get(table: str, params: str) -> list:
    """Fetch from Supabase. Raises on HTTP error — never silently returns []."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers=_sb_headers, timeout=15,
    )
    r.raise_for_status()
    return r.json()


def sb_post(table: str, data: dict, upsert: bool = False) -> dict:
    """Insert/upsert to Supabase. Returns response JSON."""
    headers = {**_sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"}
    if upsert:
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=headers, json=data, timeout=15,
    )
    r.raise_for_status()
    return {}


def sb_patch(table: str, params: str, data: dict) -> None:
    """Update rows in Supabase."""
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers={**_sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=data, timeout=15,
    )
    r.raise_for_status()


# ─── Data freshness check ─────────────────────────────────────

def check_freshness(rows: list, date_field: str = "fecha", max_stale_hours: int = 48) -> dict:
    """
    Check if data is fresh enough to analyze.
    Returns: { fresh: bool, latest: str, hours_stale: float, status: str }
    """
    if not rows:
        return {"fresh": False, "latest": None, "hours_stale": None, "status": "no_data"}

    dates = []
    for r in rows:
        val = r.get(date_field) or r.get("updated_at") or r.get("created_at")
        if val:
            dates.append(val)

    if not dates:
        return {"fresh": False, "latest": None, "hours_stale": None, "status": "no_data"}

    latest = max(dates)
    # Parse — handle both date and datetime formats
    try:
        if "T" in str(latest) or " " in str(latest):
            dt = datetime.fromisoformat(str(latest).replace("Z", "+00:00").replace(" ", "T"))
        else:
            dt = datetime.fromisoformat(str(latest) + "T23:59:59+00:00")
    except Exception:
        return {"fresh": False, "latest": str(latest), "hours_stale": None, "status": "parse_error"}

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    status = "ok" if hours <= max_stale_hours else "stale_data"
    return {"fresh": hours <= max_stale_hours, "latest": str(latest), "hours_stale": round(hours, 1), "status": status}


# ─── Agent run logging (truthful) ─────────────────────────────

def log_run(
    agent_id: str,
    status: str,  # "success" | "error" | "skipped" | "no_data" | "stale_data"
    duration_ms: int,
    output_summary: str = "",
    error_message: str = "",
    tentacle: str = "ops",
    input_freshness: str = None,
    rows_processed: int = 0,
    skip_reason: str = None,
    data_status: str = "ok",  # "ok" | "no_data" | "stale_data" | "partial" | "error"
    tokens_in: int = None,
    tokens_out: int = None,
):
    """Log agent run to agent_runs with truthful status reporting."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print(f"[{agent_id}] Cannot log run: Supabase not configured", file=sys.stderr)
        return

    row = {
        "agent_id": agent_id,
        "trigger_type": os.environ.get("TRIGGER_TYPE", "schedule"),
        "status": status,
        "duration_ms": duration_ms,
        "output_summary": output_summary[:500] if output_summary else "",
        "error_message": error_message[:500] if error_message else "",
        "tentacle": tentacle,
        "input_freshness": input_freshness,
        "rows_processed": rows_processed,
        "skip_reason": skip_reason,
        "data_status": data_status,
    }
    if tokens_in is not None:
        row["tokens_in"] = tokens_in
    if tokens_out is not None:
        row["tokens_out"] = tokens_out

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**_sb_headers, "Content-Type": "application/json"},
            json=row, timeout=10,
        )
    except Exception as e:
        # Log failure must NOT be swallowed — print to stderr so CI shows it
        print(f"[{agent_id}] FAILED to log run: {e}", file=sys.stderr)


# ─── Structured insight creation ──────────────────────────────

def create_insight(
    agent_id: str,
    category: str,  # "inventory" | "costs" | "operations" | "sales" | "staffing" | "fraud" | "config"
    severity: str,  # "critical" | "high" | "medium" | "info"
    title: str,
    summary: str = None,
    evidence: dict = None,
    recommended_action: str = None,
    deep_link: str = None,
    data_freshness: str = None,
    confidence: float = None,
    client_id: str = "amalay",
):
    """Create a structured insight in agent_insights table."""
    row = {
        "agent_id": agent_id,
        "client_id": client_id,
        "category": category,
        "severity": severity,
        "title": title,
        "summary": summary,
        "evidence": json.dumps(evidence) if evidence else None,
        "recommended_action": recommended_action,
        "deep_link": deep_link,
        "data_freshness": data_freshness,
        "confidence": confidence,
    }

    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_insights",
            headers={**_sb_headers, "Content-Type": "application/json"},
            json=row, timeout=10,
        )
    except Exception as e:
        print(f"[{agent_id}] FAILED to create insight: {e}", file=sys.stderr)


# ─── Telegram helper ──────────────────────────────────────────

def send_telegram(chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    """Send message to Telegram. Returns True on success."""
    if not TELEGRAM_TOKEN:
        print("[telegram] No TELEGRAM_BOT_TOKEN set", file=sys.stderr)
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text[:4096], "parse_mode": parse_mode},
            timeout=15,
        )
        return r.ok
    except Exception as e:
        print(f"[telegram] Send failed: {e}", file=sys.stderr)
        return False
