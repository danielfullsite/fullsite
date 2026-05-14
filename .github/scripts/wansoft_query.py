#!/usr/bin/env python3
"""
Wansoft Query Agent — responde preguntas sobre datos de Wansoft en tiempo real.
Flow: Telegram question → Groq date parse → Wansoft API scrape → Groq answer → Telegram
"""

import os, sys, json, time, re, requests
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


def wansoft_post(session, endpoint, start, end, extra=None):
    """POST to a Wansoft endpoint and return parsed rows."""
    data = {"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end}
    if extra:
        data.update(extra)
    try:
        r = session.post(f"{WANSOFT_URL}/{endpoint}", data=data, timeout=15)
        return parse_rows(r.text)
    except Exception as e:
        return [["error", str(e)]]


# ── Date range detection ────────────────────────────────────────────────────
def detect_date_range(question):
    """Use Groq to extract date range from a natural language question."""
    now_mx = datetime.now(MX_TZ)
    today_str = now_mx.strftime("%Y-%m-%d")
    dow = now_mx.strftime("%A")

    try:
        r = requests.post("https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": f"""Hoy es {today_str} ({dow}). Extrae el rango de fechas de la pregunta.
Responde SOLO con JSON: {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}
- "hoy" → start=end={today_str}
- "ayer" → start=end=fecha de ayer
- "esta semana" → lunes a hoy
- "la semana pasada" → lunes a domingo pasado
- "este mes" → primer día del mes a hoy
- "mayo" → 2026-05-01 a 2026-05-31
- Si no menciona fecha → start=end={today_str}
Solo JSON, sin texto adicional."""},
                    {"role": "user", "content": question},
                ],
                "temperature": 0, "max_tokens": 50,
            }, timeout=10)
        raw = r.json()["choices"][0]["message"]["content"].strip()
        parsed = json.loads(raw)
        return parsed.get("start", today_str), parsed.get("end", today_str)
    except Exception:
        return today_str, today_str


# ── Wansoft Data Fetchers ───────────────────────────────────────────────────
def fetch_all_wansoft_data(session, start, end):
    """Fetch ALL available data from Wansoft for the given date range."""
    data = {"date_range": f"{start} a {end}"}

    # 1. Consolidated sales (JSON)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetConsolidatedSales",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end})
        data["ventas_consolidadas"] = r.json()
    except Exception as e:
        data["ventas_consolidadas"] = {"error": str(e)}

    # 2. Sales by user (meseros)
    rows = wansoft_post(session, "Reports/SalesByUser", start, end)
    data["ventas_por_mesero"] = [{"mesero": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                                  for r in rows if len(r) >= 5]

    # 3. Sales by group (categorías del menú)
    rows = wansoft_post(session, "Reports/SalesByGroup", start, end)
    data["ventas_por_grupo"] = [{"grupo": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                                 for r in rows if len(r) >= 5]

    # 4. Sales by saucer (platillos — ALL of them)
    rows = wansoft_post(session, "Reports/SalesBySaucer", start, end)
    saucers = [{"platillo": r[0], "cantidad": r[1], "subtotal": r[2], "total": r[3], "pct": r[4]}
               for r in rows if len(r) >= 5]
    data["platillos_vendidos"] = saucers  # all items
    data["total_platillos_distintos"] = len(saucers)

    # 5. Sales by order type (tickets + personas)
    rows = wansoft_post(session, "Reports/SalesByTypeOfOrder", start, end)
    data["por_tipo_orden"] = [{"tipo": r[0], "ticket_promedio": r[1], "tickets": r[2],
                                "personas": r[3], "subtotal": r[4], "total": r[5]}
                               for r in rows if len(r) >= 6]

    # 6. Sales by payment type (métodos de pago)
    rows = wansoft_post(session, "Reports/SalesByPaymentType", start, end)
    data["metodos_pago"] = [{"metodo": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                             for r in rows if len(r) >= 5]

    # 7. Sales by hour
    rows = wansoft_post(session, "Reports/SalesByHours", start, end)
    data["ventas_por_hora"] = [{"hora": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                                for r in rows if len(r) >= 5]

    # 8. Sales by area (terraza, salón, etc.)
    rows = wansoft_post(session, "Reports/SalesByArea", start, end)
    if rows and len(rows[0]) >= 5:
        data["ventas_por_area"] = [{"area": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                                    for r in rows if len(r) >= 5]

    # 9. Sales by terminal
    rows = wansoft_post(session, "Reports/SalesByTerminal", start, end)
    if rows and len(rows[0]) >= 5:
        data["ventas_por_terminal"] = [{"terminal": r[0], "subtotal": r[1], "iva": r[2], "total": r[3], "pct": r[4]}
                                        for r in rows if len(r) >= 5]

    # 10. Sales by modifiers (extras)
    rows = wansoft_post(session, "Reports/SalesByModifiers", start, end)
    if rows and len(rows[0]) >= 4:
        data["modificadores"] = [{"modificador": r[0], "cantidad": r[1], "total": r[2]}
                                  for r in rows if len(r) >= 3][:30]

    # 11. Discounts detail
    rows = wansoft_post(session, "Reports/DiscountsDetail", start, end)
    if rows and len(rows[0]) >= 3:
        data["descuentos_detalle"] = rows[:20]

    # 12. Cancellations detail
    rows = wansoft_post(session, "Reports/CancelSalesDetail", start, end)
    if rows and len(rows[0]) >= 3:
        data["cancelaciones_detalle"] = rows[:20]

    # 13. Nullifications
    rows = wansoft_post(session, "Reports/SaleNullificationDetail", start, end)
    if rows and len(rows[0]) >= 3:
        data["anulaciones_detalle"] = rows[:20]

    # 14. Courtesies (cortesías)
    rows = wansoft_post(session, "Reports/CourtesiesDetail", start, end)
    if rows and len(rows[0]) >= 3:
        data["cortesias_detalle"] = rows[:20]

    # 15. Tips (propinas) — from Supabase since Wansoft uses jqGrid (JS-only)
    try:
        kpis = sb_get("wansoft_kpis", {"select": "propinas_total,propinas_meseros", "limit": "1"})
        if kpis and kpis[0].get("propinas_meseros"):
            data["propinas_meseros"] = kpis[0]["propinas_meseros"]
            data["propinas_total"] = kpis[0].get("propinas_total", 0)
    except Exception:
        pass

    # 16. Inventory — reorder point (qué falta)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/ReorderPoint",
                         data={"subsidiaryId": SUBSIDIARY}, timeout=15)
        inv_rows = parse_rows(r.text)
        if inv_rows:
            data["inventario_punto_reorden"] = inv_rows[:20]
    except Exception:
        pass

    # 17. Closing cash (corte de caja)
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/ClosingCash",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end},
                         timeout=15)
        close_rows = parse_rows(r.text)
        if close_rows:
            data["cortes_caja"] = close_rows[:10]
    except Exception:
        pass

    # 18. Waiter × Category (H&H, Pan, Postres, 2da Bebida por mesero)
    try:
        wc = sb_get("wansoft_waiter_categories", {
            "select": "fecha,data",
            "fecha": f"eq.{start}",
            "limit": "1",
        })
        if wc and wc[0].get("data"):
            wc_data = wc[0]["data"]
            if isinstance(wc_data, str):
                import json as _json
                wc_data = _json.loads(wc_data)
            data["ventas_por_mesero_x_categoria"] = wc_data
    except Exception:
        pass

    return data


def fetch_historical(days=30):
    """Fetch historical data from Supabase wansoft_daily."""
    try:
        now_mx = datetime.now(MX_TZ)
        start = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
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

DATOS DISPONIBLES EN EL CONTEXTO:
- ventas_consolidadas: totales de ventas, descuentos, cortesías, anulaciones
- ventas_por_mesero: ventas de cada mesero con subtotal, IVA, total y porcentaje
- ventas_por_grupo: ventas por categoría del menú (CHILAQUILES, COFFEE, DESSERTS, etc.)
- platillos_vendidos: TODOS los platillos vendidos con cantidad y monto
- por_tipo_orden: Restaurant vs Para llevar vs eCommerce con tickets y personas
- metodos_pago: efectivo, tarjeta crédito, tarjeta débito, transferencia, etc.
- ventas_por_hora: ventas desglosadas por hora del día
- ventas_por_area: terraza, salón, barra (si hay datos)
- ventas_por_terminal: por caja/iPad
- modificadores: extras pedidos (queso extra, etc.)
- descuentos_detalle: qué descuentos se aplicaron
- cancelaciones_detalle: qué órdenes se cancelaron
- anulaciones_detalle: qué se anuló
- cortesias_detalle: qué cortesías se dieron
- propinas: propinas por mesero (si hay datos)
- inventario_punto_reorden: productos que están por debajo del mínimo
- cortes_caja: cortes de caja del día
- ventas_por_mesero_x_categoria: cruce mesero × categoría — H&H, Pan, Postres y 2da Bebida vendidos POR CADA MESERO (qty, total, % de tickets con 2+ bebidas)
- historical_data: datos diarios de los últimos 30 días (Supabase)

REGLAS:
- Responde en español, conciso y directo
- Montos en MXN con símbolo $ y separador de miles
- Si no tienes los datos para responder, di qué dato falta y sugiere cómo obtenerlo
- No inventes datos — solo usa lo que está en el contexto
- Formato plano (no markdown), máximo 3000 caracteres
- Incluye totales y porcentajes cuando sea relevante
- Si la pregunta es sobre un platillo específico, busca en platillos_vendidos
- Si preguntan "cuántos lattes" busca por nombre parcial en platillos_vendidos
"""


def ask_groq(question, wansoft_data, historical_data):
    wd = dict(wansoft_data)
    platillos = wd.pop("platillos_vendidos", [])
    date_range = wd.get("date_range", "hoy")

    # Smart search: find platillos matching the question
    q_lower = question.lower()
    skip_words = {"hoy", "ayer", "cuántos", "cuantos", "cuánto", "cuanto", "vendieron",
                  "vendió", "vendio", "qué", "que", "cómo", "como", "los", "las", "del",
                  "por", "para", "con", "sin", "hay", "tiene", "fueron", "total", "todos",
                  "mes", "semana", "día", "dia"}
    search_terms = [w.rstrip("s") for w in q_lower.split() if len(w) > 2 and w not in skip_words]

    relevant_platillos = []
    for p in platillos:
        name_lower = p["platillo"].lower()
        if any(term in name_lower for term in search_terms):
            relevant_platillos.append(p)

    # Build context in priority order — most relevant first
    blocks = []

    # Block 1: If there are matching platillos, put them FIRST
    if relevant_platillos:
        blocks.append(f"PLATILLOS QUE COINCIDEN CON LA BÚSQUEDA ({len(relevant_platillos)}):\n"
                      + json.dumps(relevant_platillos[:50], ensure_ascii=False, indent=1))

    # Block 2: Core sales data (compact)
    core = {
        "ventas_consolidadas": wd.get("ventas_consolidadas"),
        "por_tipo_orden": wd.get("por_tipo_orden"),
        "ventas_por_mesero": wd.get("ventas_por_mesero"),
        "ventas_por_grupo": wd.get("ventas_por_grupo"),
        "metodos_pago": wd.get("metodos_pago"),
    }
    blocks.append(f"DATOS CORE ({date_range}):\n" + json.dumps(core, ensure_ascii=False, indent=1))

    # Block 3: Detail data (descuentos, cancelaciones, etc.)
    detail = {}
    for key in ["ventas_por_mesero_x_categoria",
                "descuentos_detalle", "cancelaciones_detalle", "anulaciones_detalle",
                "cortesias_detalle", "propinas_meseros", "propinas_total",
                "cortes_caja", "inventario_punto_reorden", "modificadores",
                "ventas_por_hora", "ventas_por_area", "ventas_por_terminal"]:
        if key in wd and wd[key]:
            detail[key] = wd[key]
    if detail:
        blocks.append("DATOS DETALLE:\n" + json.dumps(detail, ensure_ascii=False, indent=1))

    # Block 4: Top platillos (always useful)
    blocks.append(f"TOP 20 PLATILLOS (de {len(platillos)} distintos):\n"
                  + json.dumps(platillos[:20], ensure_ascii=False, indent=1))

    # Block 5: Historical (compact — just last 7 days)
    if historical_data:
        hist_compact = [{"fecha": r.get("fecha"), "ventas": r.get("ventas_dia"),
                         "ticket_prom": r.get("ticket_promedio_restaurant"),
                         "propinas": r.get("propinas_total")}
                        for r in historical_data[:7]]
        blocks.append("HISTÓRICO (últimos 7 días):\n" + json.dumps(hist_compact, ensure_ascii=False, indent=1))

    # Assemble context — cap total at 12000 chars
    context = ""
    for block in blocks:
        if len(context) + len(block) > 12000:
            break
        context += block + "\n\n"

    context += f"PREGUNTA: {question}"

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
        # Detect date range from question
        print("[wansoft-query] Detecting date range...")
        start_date, end_date = detect_date_range(MESSAGE)
        print(f"[wansoft-query] Date range: {start_date} to {end_date}")

        # Login to Wansoft
        print("[wansoft-query] Logging into Wansoft...")
        session = wansoft_login()

        # Fetch all data for the date range
        print("[wansoft-query] Fetching Wansoft data...")
        wansoft_data = fetch_all_wansoft_data(session, start_date, end_date)

        # Fetch historical from Supabase
        print("[wansoft-query] Fetching historical...")
        historical = fetch_historical(30)

        platillos_count = wansoft_data.get("total_platillos_distintos", 0)
        meseros_count = len(wansoft_data.get("ventas_por_mesero", []))
        print(f"[wansoft-query] Data: {meseros_count} meseros, {platillos_count} platillos, range={start_date}..{end_date}")

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
