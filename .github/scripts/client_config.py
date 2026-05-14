"""
Shared client config — all scripts import this instead of hardcoding values.
Fetches per-client config from Supabase `clients` table.
"""

import os
import requests
import json
from datetime import timezone, timedelta

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
_sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

_cache = {}


def get_client(client_id: str = None) -> dict:
    """Fetch and cache client config from Supabase."""
    if client_id is None:
        client_id = os.environ.get("CLIENT_ID", "amalay")

    if client_id in _cache:
        return _cache[client_id]

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/clients",
        headers=_sb_headers,
        params={"id": f"eq.{client_id}", "select": "*", "limit": "1"},
        timeout=10,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise ValueError(f"Client '{client_id}' not found")

    client = rows[0]
    # Parse JSONB fields if they came as strings
    for field in ["telegram_chat_ids", "staff_exclude_meseros", "staff_market",
                  "menu_categories", "bebida_groups", "report_recipients"]:
        if isinstance(client.get(field), str):
            client[field] = json.loads(client[field])

    _cache[client_id] = client
    return client


def get_tz(client: dict):
    """Return timezone for the client."""
    tz_name = client.get("timezone", "America/Mexico_City")
    # Map common IANA names to UTC offsets (avoid zoneinfo dependency)
    tz_map = {
        "America/Mexico_City": -6,
        "America/Monterrey": -6,
        "America/Cancun": -5,
        "America/Tijuana": -8,
        "America/Chicago": -6,
        "America/New_York": -5,
        "America/Los_Angeles": -8,
    }
    offset = tz_map.get(tz_name, -6)
    return timezone(timedelta(hours=offset))


def get_chat_ids(client: dict, report_name: str) -> list[str]:
    """Return list of Telegram chat_ids for a specific report."""
    recipients = client.get("report_recipients") or {}
    roles = recipients.get(report_name, [])
    all_chats = client.get("telegram_chat_ids") or {}
    return [all_chats[role] for role in roles if role in all_chats]


def get_all_chat_ids(client: dict) -> list[str]:
    """Return all Telegram chat_ids for this client."""
    all_chats = client.get("telegram_chat_ids") or {}
    return list(all_chats.values())


def is_mesero(name: str, client: dict) -> bool:
    """Check if a name is a real mesero (not cajero/market)."""
    exclude = client.get("staff_exclude_meseros") or []
    market = client.get("staff_market") or []
    all_excluded = [e.lower() for e in exclude + market]
    return not any(ex in name.lower() for ex in all_excluded)


def is_market(name: str, client: dict) -> bool:
    """Check if a name is market staff."""
    market = client.get("staff_market") or []
    return any(m.lower() in name.lower() for m in market)


def get_wansoft_creds(client: dict) -> tuple[str, str, str]:
    """Return (subsidiary_id, user, password) for Wansoft login."""
    return (
        client.get("wansoft_subsidiary_id", ""),
        client.get("wansoft_user", ""),
        client.get("wansoft_pass", ""),
    )
