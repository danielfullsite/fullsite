"""
Wansoft Authentication — Cookie Relay

Single module for all scrapers to authenticate with Wansoft.

Strategy:
  Wansoft added Cloudflare Turnstile (CAPTCHA) to their login page,
  blocking all programmatic login (requests, Playwright headless/headed).

  Solution: Daniel logs in manually via Chrome. Session cookies are stored
  in Supabase `clients` table. All scrapers load cookies from there and
  inject them into requests.Session().

Cookie storage in Supabase `clients` table:
  wansoft_cookies  jsonb  {
    "aspxauth": "...",
    "session_id": "...",
    "csrf_token": "...",
    "updated_at": "2026-07-20T13:36:00Z"
  }

Usage:
  from wansoft_auth import get_session

  session = get_session()  # raises WansoftAuthExpired if cookie is dead
  r = session.post(".../Reports/GetConsolidatedSales", data={...})
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

_sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


class WansoftAuthExpired(Exception):
    """Raised when the stored session cookie is expired or missing."""
    pass


def _load_cookies(client_id: str = "amalay") -> dict:
    """Load stored cookies from Supabase clients table."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/clients",
        headers=_sb_headers,
        params={"id": f"eq.{client_id}", "select": "wansoft_cookies"},
        timeout=10,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise WansoftAuthExpired(f"Client '{client_id}' not found in Supabase")

    cookies = rows[0].get("wansoft_cookies")
    if not cookies:
        raise WansoftAuthExpired(
            "No wansoft_cookies stored. Run: python3 wansoft_auth.py store <client_id>"
        )

    if isinstance(cookies, str):
        cookies = json.loads(cookies)

    if not cookies.get("aspxauth"):
        raise WansoftAuthExpired("wansoft_cookies.aspxauth is empty")

    return cookies


def _build_session(cookies: dict) -> requests.Session:
    """Build a requests.Session with Wansoft cookies injected."""
    s = requests.Session()

    cookie_parts = [f'.ASPXAUTH={cookies["aspxauth"]}']
    if cookies.get("session_id"):
        cookie_parts.append(f'ASP.NET_SessionId={cookies["session_id"]}')
    if cookies.get("csrf_token"):
        cookie_parts.append(f'__RequestVerificationToken={cookies["csrf_token"]}')
    if cookies.get("subsidiary_id"):
        cookie_parts.append(f'SubsidiaryId={cookies["subsidiary_id"]}')

    s.headers["Cookie"] = "; ".join(cookie_parts)
    return s


def _validate(session: requests.Session) -> bool:
    """Check if session is still authenticated against Wansoft.

    Uses the GetConsolidatedSales API endpoint (returns JSON when
    authenticated, HTML login page when not). More reliable than
    checking for text in the Dashboard HTML page.
    """
    try:
        from datetime import datetime as _dt

        r = session.post(
            f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
            data={
                "subsidiaryId": "6043",
                "startDate": _dt.now().strftime("%m/%d/%Y"),
                "endDate": _dt.now().strftime("%m/%d/%Y"),
            },
            timeout=15,
        )
        return r.status_code == 200 and r.text.strip().startswith("{")
    except Exception:
        return False


def _send_alert(client_id: str, message: str):
    """Send expiration alert via Supabase agent_runs log."""
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={
                **_sb_headers,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={
                "agent_id": "wansoft-auth",
                "client_slug": client_id,
                "trigger_type": "alert",
                "status": "error",
                "output_summary": message,
                "tentacle": "ops",
            },
            timeout=10,
        )
    except Exception:
        pass

    # Also try Telegram
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    tg_chat = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
    if tg_token and tg_chat:
        try:
            requests.post(
                f"https://api.telegram.org/bot{tg_token}/sendMessage",
                json={"chat_id": tg_chat, "text": f"⚠️ {message}"},
                timeout=10,
            )
        except Exception:
            pass


def get_session(client_id: str = "amalay", validate: bool = True) -> requests.Session:
    """
    Get an authenticated Wansoft session using stored cookies.

    Args:
        client_id: Client ID in Supabase
        validate: If True, validates the cookie before returning.
                  Set to False for speed when you'll detect auth failure
                  from endpoint responses anyway.

    Returns:
        Authenticated requests.Session

    Raises:
        WansoftAuthExpired: If cookies are missing or expired
    """
    cookies = _load_cookies(client_id)
    session = _build_session(cookies)

    if validate:
        if not _validate(session):
            msg = (
                f"Wansoft session expired for {client_id}. "
                "Login manually at https://www.wansoft.net/Wansoft.Web/ "
                "and run: python3 wansoft_auth.py store"
            )
            _send_alert(client_id, msg)
            raise WansoftAuthExpired(msg)

    return session


def store_cookies(
    client_id: str,
    aspxauth: str,
    session_id: str = "",
    csrf_token: str = "",
    subsidiary_id: str = "6043",
):
    """
    Store Wansoft session cookies in Supabase.

    Call this after a manual login to Chrome.
    """
    cookies = {
        "aspxauth": aspxauth,
        "session_id": session_id,
        "csrf_token": csrf_token,
        "subsidiary_id": subsidiary_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/clients",
        headers={
            **_sb_headers,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        params={"id": f"eq.{client_id}"},
        json={"wansoft_cookies": cookies},
        timeout=10,
    )
    r.raise_for_status()
    print(f"[wansoft_auth] Cookies stored for {client_id}")
    return cookies


# ── CLI ─────────────────────────────────────────────────────────────────────
def main():
    """CLI for storing and testing cookies."""
    import argparse

    parser = argparse.ArgumentParser(description="Wansoft Cookie Auth Manager")
    sub = parser.add_subparsers(dest="command")

    # store command
    sp = sub.add_parser("store", help="Store cookies in Supabase")
    sp.add_argument("--client-id", default="amalay")
    sp.add_argument("--aspxauth", required=True)
    sp.add_argument("--session-id", default="")
    sp.add_argument("--csrf-token", default="")
    sp.add_argument("--subsidiary-id", default="6043")

    # test command
    tp = sub.add_parser("test", help="Test stored cookies")
    tp.add_argument("--client-id", default="amalay")

    args = parser.parse_args()

    if args.command == "store":
        store_cookies(
            args.client_id,
            args.aspxauth,
            args.session_id,
            args.csrf_token,
            args.subsidiary_id,
        )
        # Validate immediately
        try:
            session = get_session(args.client_id)
            print("[wansoft_auth] ✓ Cookie is valid")
        except WansoftAuthExpired as e:
            print(f"[wansoft_auth] ✗ Cookie stored but validation failed: {e}")

    elif args.command == "test":
        try:
            session = get_session(args.client_id)
            print("[wansoft_auth] ✓ Session is valid")

            # Quick endpoint test
            r = session.post(
                f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
                data={
                    "subsidiaryId": "6043",
                    "startDate": datetime.now().strftime("%m/%d/%Y"),
                    "endDate": datetime.now().strftime("%m/%d/%Y"),
                },
                timeout=15,
            )
            if r.text.strip().startswith("{"):
                data = r.json()
                print(f"[wansoft_auth] ✓ API works — TotalSales: ${data.get('TotalSales', 0):,.2f}")
            else:
                print("[wansoft_auth] ✗ API returned non-JSON")

        except WansoftAuthExpired as e:
            print(f"[wansoft_auth] ✗ {e}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
