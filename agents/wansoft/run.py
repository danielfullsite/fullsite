#!/usr/bin/env python3
"""End-to-end: scrape Wansoft XLSX → parse → send to Telegram."""

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ENV_FILE = Path(__file__).parent / ".env"
TZ_MX = ZoneInfo("America/Mexico_City")

EXIT_OK = 0
EXIT_ENV = 1
EXIT_SCRAPE = 2
EXIT_PARSE = 3
EXIT_SEND = 4


def log(msg: str):
    ts = datetime.now(TZ_MX).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def main():
    # Load env
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)

    ap = argparse.ArgumentParser(description="Wansoft → Telegram pipeline")
    ap.add_argument("target_date", nargs="?", default=None,
                    help="Target date YYYY-MM-DD (default: yesterday MX)")
    ap.add_argument("--type", dest="report_type", choices=["cierre", "avance"],
                    default="cierre", help="Report type (default: cierre)")
    args = ap.parse_args()

    # Resolve target date
    from scraper import resolve_target_date
    target_date = resolve_target_date(args.target_date)

    try:
        datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        log(f"Fecha invalida: {target_date}")
        sys.exit(EXIT_ENV)

    report_type = args.report_type
    log(f"=== Pipeline Wansoft → Telegram | {target_date} | {report_type} ===")

    # Step 1: Scrape
    log("Paso 1/3: Descargando XLSX de Wansoft...")
    try:
        from scraper import scrape
        xlsx_path = scrape(target_date)
    except SystemExit:
        log("Scraper fallo (ver logs arriba)")
        sys.exit(EXIT_SCRAPE)
    except Exception as e:
        log(f"Error en scraper: {e}")
        sys.exit(EXIT_SCRAPE)
    log(f"XLSX: {xlsx_path}")

    # Step 2: Parse
    log("Paso 2/3: Parseando reporte...")
    try:
        from parser import format_message
        message = format_message(str(xlsx_path), report_type=report_type)
    except Exception as e:
        log(f"Error en parser: {e}")
        sys.exit(EXIT_PARSE)
    log(f"Mensaje generado ({len(message)} chars, tipo={report_type})")

    # Step 3: Send
    log("Paso 3/3: Enviando a Telegram...")
    try:
        from sender import send_telegram
        ok = send_telegram(message)
    except Exception as e:
        log(f"Error en sender: {e}")
        sys.exit(EXIT_SEND)

    if not ok:
        log("Envio a Telegram fallo")
        sys.exit(EXIT_SEND)

    log("=== Pipeline completado ===")
    sys.exit(EXIT_OK)


if __name__ == "__main__":
    main()
