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


def get_locations(client: dict) -> list[dict]:
    """Fetch active locations for this client from Supabase."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/client_locations",
            headers=_sb_headers,
            params={"client_id": f"eq.{client['id']}", "active": "eq.true", "order": "name.asc"},
            timeout=10,
        )
        return r.json() if r.ok else []
    except Exception:
        return []


def get_bebida_keywords(client: dict) -> list[str]:
    """Return beverage keywords for this client. Falls back to common defaults."""
    custom = client.get("bebida_groups") or []
    if custom:
        return [k.lower() for k in custom]
    # Universal defaults that work for most restaurants
    return ["cafe", "café", "cappuccino", "latte", "americano", "espresso",
            "te ", "té ", "jugo", "limonada", "smoothie", "frappe",
            "cerveza", "vino", "cocktail", "cóctel", "sangria", "agua",
            "refresco", "soda", "tinto", "blanco", "rosado", "cava",
            "rioja", "ribera", "albarino", "albariño"]


def get_category_map(client: dict) -> dict:
    """Return client-specific category keywords for tracking.
    Keys: category name, Values: list of keywords to match in menu items.
    Falls back to empty dict (agents use generic logic)."""
    return client.get("menu_categories") or {}


def get_signature_items(client: dict) -> list[str]:
    """Return the client's signature/tracked items (e.g. chilaquiles for AMALAY, paella for Atope)."""
    return client.get("signature_items") or []


def location_filter(location_id: str = None) -> dict:
    """Return Supabase REST params to filter by location. Empty dict if no location."""
    if location_id:
        return {"location_id": f"eq.{location_id}"}
    return {}


def sb_get_by_location(table: str, params: dict, locations: list[dict],
                        supabase_url: str = None, sb_headers: dict = None) -> dict:
    """Query a table for each location separately. Returns {location_name: rows}.
    If no locations, returns {"all": rows} (single-location mode)."""
    url = supabase_url or SUPABASE_URL
    headers = sb_headers or _sb_headers
    results = {}

    if not locations:
        # Single location — query without filter
        try:
            r = requests.get(f"{url}/rest/v1/{table}", headers=headers, params=params, timeout=15)
            results["all"] = r.json() if r.ok else []
        except Exception:
            results["all"] = []
        return results

    for loc in locations:
        loc_params = {**params, "location_id": f"eq.{loc['id']}"}
        try:
            r = requests.get(f"{url}/rest/v1/{table}", headers=headers, params=loc_params, timeout=15)
            results[loc.get("name", loc["id"])] = r.json() if r.ok else []
        except Exception:
            results[loc.get("name", loc["id"])] = []
    return results
