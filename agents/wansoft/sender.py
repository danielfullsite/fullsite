#!/usr/bin/env python3
"""Send a message via Telegram Bot API to multiple recipients."""

import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

ENV_FILE = Path(__file__).parent / ".env"
TZ_MX = ZoneInfo("America/Mexico_City")

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"

RECIPIENTS = [
    ("Daniel", "TELEGRAM_CHAT_ID"),
    ("Mónica", "TELEGRAM_CHAT_ID_MONICA"),
]


def log(msg: str):
    ts = datetime.now(TZ_MX).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _send_one(token: str, chat_id: str, message: str, name: str) -> bool:
    """Send to a single chat_id. Returns True on success."""
    url = TELEGRAM_API.format(token=token)
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }
    try:
        resp = requests.post(url, json=payload, timeout=15)
    except requests.RequestException as e:
        log(f"Enviado a {name} ✗ (red: {e})")
        return False

    if resp.status_code == 200 and resp.json().get("ok"):
        log(f"Enviado a {name} ✓")
        return True

    log(f"Enviado a {name} ✗ ({resp.status_code}: {resp.text[:150]})")
    return False


def send_telegram(message: str) -> bool:
    """Send message to all configured recipients.

    Returns True if at least one recipient received the message.
    Returns False if all fail or no recipients configured.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        log("Error: TELEGRAM_BOT_TOKEN requerido")
        return False

    sent = 0
    failed = 0
    skipped = 0

    for name, env_var in RECIPIENTS:
        chat_id = os.environ.get(env_var, "").strip()
        if not chat_id:
            skipped += 1
            continue
        if _send_one(token, chat_id, message, name):
            sent += 1
        else:
            failed += 1

    if sent == 0 and skipped == len(RECIPIENTS):
        log("Error: ningun TELEGRAM_CHAT_ID configurado")
        return False

    return sent > 0


if __name__ == "__main__":
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)

    if len(sys.argv) < 2:
        print(f"Uso: python {sys.argv[0]} \"mensaje de prueba\"", file=sys.stderr)
        sys.exit(1)

    msg = " ".join(sys.argv[1:])
    ok = send_telegram(msg)
    sys.exit(0 if ok else 1)
