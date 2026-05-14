#!/usr/bin/env python3
"""
Wansoft Query Agent — responde preguntas sobre datos de Wansoft en tiempo real.
Flow: Telegram question → Wansoft API scrape → Groq format → Telegram response
"""

import os, sys, json, time, requests
from datetime import date, timedelta, datetime, timezone
from bs4 import BeautifulSoup

# ── Config ──────────────────────────────────────────────────────────────────
WANSOFT_USER = os.environ["WANSOFT_USER"]
WANSOFT_PASS = os.environ["WANSOFT_PASS"]
WANSOFT_URL  = "https://www.wansoft.net/Wansoft.Web"
SUBSIDIARY   = "6043"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID   = os.environ.get("INPUT_CHAT_ID") or os.environ["TELEGRAM_CHAT_ID_DANIEL"]
MESSAGE      = os.environ.get("INPUT_MESSAGE", "").strip()
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "workflow_dispatch")

MX_TZ = timezone(timedelta(hours=-6))
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


# ── Helpers ─────────────────────────────────────────────────────────────────
def send_telegram(text):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk}, timeout=15)


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params)
    r.raise_for_status()
    return r.json()


def wansoft_login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    r = s.post(f"{WANSOFT_URL}/", data={"UserName": WANSOFT_USER, "Password": WANSOFT_PASS},
               allow_redirects=True)
    if "Dashboard" not in r.url:
        raise Exception("Wansoft login failed")
    return s


def parse_rows(html):
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for row in soup.select(".rowReport"):
        cols = [c.text.strip() for c in row.select("div")]
        rows.append(cols)
    return rows


# ── Wansoft Data Fetchers ───────────────────────────────────────────────────
def fetch_all_wansoft_data(session, start, end):
    """Fetch all available data from Wansoft for the given date range."""
    data = {}

    # Consolidated sales (JSON)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        data["consolidated"] = r.json()
    except Exception as e:
        data["consolidated"] = {"error": str(e)}

    # Sales by user
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByUser",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        data["by_user"] = [{"name": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                           for r in rows if len(r) >= 5]
    except Exception as e:
        data["by_user"] = {"error": str(e)}

    # Sales by group
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByGroup",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        data["by_group"] = [{"group": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                            for r in rows if len(r) >= 5]
    except Exception as e:
        data["by_group"] = {"error": str(e)}

    # Sales by saucer (top 30 only to keep context small)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesBySaucer",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        items = [{"name": r[0], "qty": r[1], "subtotal": r[2], "total": r[3], "pct": r[4]}
                 for r in rows if len(r) >= 5]
        data["by_saucer_top30"] = items[:30]
        data["by_saucer_count"] = len(items)
    except Exception as e:
        data["by_saucer_top30"] = {"error": str(e)}

    # Sales by order type (tickets + personas)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByTypeOfOrder",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        data["by_order_type"] = [{"type": r[0], "avg_ticket": r[1], "tickets": r[2],
                                  "personas": r[3], "subtotal": r[4], "total": r[5]}
                                 for r in rows if len(r) >= 6]
    except Exception as e:
        data["by_order_type"] = {"error": str(e)}

    # Sales by payment type
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByPaymentType",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        data["by_payment"] = [{"method": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                              for r in rows if len(r) >= 5]
    except Exception as e:
        data["by_payment"] = {"error": str(e)}

    # Sales by hour
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/SalesByHours",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        rows = parse_rows(r.text)
        data["by_hour"] = [{"hour": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                           for r in rows if len(r) >= 5]
    except Exception as e:
        data["by_hour"] = {"error": str(e)}

    return data


def fetch_historical(days=30):
    """Fetch historical data from Supabase wansoft_daily."""
    try:
        start = (date.today() - timedelta(days=days)).isoformat()
        rows = sb_get("wansoft_daily", {
            "select": "fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,"
                      "personas_restaurant,ticket_promedio_restaurant,propinas_total,"
                      "meseros,platillos_top,ventas_por_grupo,pago_metodos",
            "fecha": f"gte.{start}",
            "order": "fecha.desc",
            "limit": "60",
        })
        return rows
    except Exception as e:
        return [{"error": str(e)}]


# ── Groq response ──────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Eres el asistente de datos de AMALAY Coffee & Market (Monterrey, MX).
Respondes preguntas sobre ventas, meseros, platillos, inventario y operaciones usando datos reales de Wansoft.

REGLAS:
- Responde en español, conciso y directo
- Montos en MXN con símbolo $ y separador de miles
- Si la pregunta es sobre "hoy", usa los datos de wansoft_today
- Si es sobre fechas pasadas, usa historical_data
- Si no tienes los datos para responder, dilo claramente
- No inventes datos — solo usa lo que está en el contexto
- Formato plano (no markdown), máximo 3000 caracteres
- Incluye totales y porcentajes cuando sea relevante
"""


def ask_groq(question, wansoft_data, historical_data):
    context = f"""DATOS WANSOFT HOY:
{json.dumps(wansoft_data, ensure_ascii=False, indent=1)[:6000]}

DATOS HISTÓRICOS (últimos 30 días, de Supabase wansoft_daily):
{json.dumps(historical_data[:10], ensure_ascii=False, indent=1)[:3000]}

PREGUNTA DEL USUARIO: {question}"""

    r = requests.post("https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context},
            ],
            "temperature": 0.2,
            "max_tokens": 1500,
        }, timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


# ── Log ─────────────────────────────────────────────────────────────────────
def log_run(status, duration_ms, summary="", error=""):
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={"agent_id": "wansoft-query", "trigger_type": TRIGGER_TYPE, "status": status,
                  "duration_ms": duration_ms, "output_summary": summary[:500],
                  "error_message": error[:500] if error else None, "tentacle": "kb"})
    except Exception:
        pass


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    start_time = time.time()

    if not MESSAGE:
        print("[wansoft-query] No message provided")
        sys.exit(0)

    print(f"[wansoft-query] Question: {MESSAGE[:100]}")

    try:
        # Determine date range from question
        now_mx = datetime.now(MX_TZ)
        today_str = now_mx.strftime("%Y-%m-%d")

        # Login to Wansoft
        print("[wansoft-query] Logging into Wansoft...")
        session = wansoft_login()

        # Fetch today's data
        print("[wansoft-query] Fetching Wansoft data...")
        wansoft_data = fetch_all_wansoft_data(session, today_str, today_str)

        # Fetch historical
        print("[wansoft-query] Fetching historical...")
        historical = fetch_historical(30)

        # Ask Groq to answer
        print("[wansoft-query] Asking Groq...")
        answer = ask_groq(MESSAGE, wansoft_data, historical)

        # Send to Telegram
        send_telegram(answer)
        print(f"[wansoft-query] Sent response ({len(answer)} chars)")

        duration = int((time.time() - start_time) * 1000)
        log_run("success", duration, f"Q: {MESSAGE[:100]} A: {answer[:100]}")

    except Exception as e:
        duration = int((time.time() - start_time) * 1000)
        log_run("error", duration, error=str(e))
        send_telegram(f"Error consultando Wansoft: {e}")
        print(f"[wansoft-query] ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
