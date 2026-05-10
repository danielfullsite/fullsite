#!/usr/bin/env python3
"""Send a message via Telegram Bot API."""

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


def log(msg: str):
    ts = datetime.now(TZ_MX).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def send_telegram(message: str) -> bool:
    """Send message via Telegram. Returns True on success."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        log("Error: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID requeridos")
        return False

    url = TELEGRAM_API.format(token=token)
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }

    try:
        resp = requests.post(url, json=payload, timeout=15)
    except requests.RequestException as e:
        log(f"Error de red enviando a Telegram: {e}")
        return False

    if resp.status_code == 200 and resp.json().get("ok"):
        log("Mensaje enviado a Telegram")
        return True

    log(f"Telegram respondio {resp.status_code}: {resp.text[:200]}")
    return False


if __name__ == "__main__":
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)

    if len(sys.argv) < 2:
        print(f"Uso: python {sys.argv[0]} \"mensaje de prueba\"", file=sys.stderr)
        sys.exit(1)

    msg = " ".join(sys.argv[1:])
    ok = send_telegram(msg)
    sys.exit(0 if ok else 1)
