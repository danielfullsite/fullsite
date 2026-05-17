#!/usr/bin/env python3
"""
Wansoft Query Agent — Multi-tenant
Responds to any question about Wansoft data via Telegram.
"""

import os, sys, json, time, re, requests
from datetime import date, timedelta, datetime, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_tz, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL  = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
TG_TOKEN     = os.environ["TELEGRAM_BOT_TOKEN"]
TG_CHAT_ID   = os.environ.get("INPUT_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
MESSAGE      = os.environ.get("INPUT_MESSAGE", "").strip()
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "workflow_dispatch")

MX_TZ = get_tz(CLIENT)
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

    from datetime import date as _date
    yesterday_str = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")
    week_start = (now_mx - timedelta(days=now_mx.weekday())).strftime("%Y-%m-%d")
    month_start = now_mx.strftime("%Y-%m-01")

    try:
        r = requests.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                     "Content-Type": "application/json"},
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 50,
                "system": f"""Hoy es {today_str} ({dow}). Ayer fue {yesterday_str}. Extrae el rango de fechas.
Responde SOLO JSON: {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}
- "hoy" → {{"start":"{today_str}","end":"{today_str}"}}
- "ayer" → {{"start":"{yesterday_str}","end":"{yesterday_str}"}}
- "esta semana" → {{"start":"{week_start}","end":"{today_str}"}}
- "este mes" → {{"start":"{month_start}","end":"{today_str}"}}
- Sin fecha → {{"start":"{today_str}","end":"{today_str}"}}
Solo JSON.""",
                "messages": [{"role": "user", "content": question}],
            }, timeout=15)
        r.raise_for_status()
        raw = r.json()["content"][0]["text"].strip()
        # Extract JSON from response (may have extra text)
        import re
        json_match = re.search(r'\{[^}]+\}', raw)
        if json_match:
            parsed = json.loads(json_match.group())
        else:
            parsed = json.loads(raw)
        start = parsed.get("start", today_str)
        end = parsed.get("end", today_str)
        print(f"[wansoft-query] Date detection raw: {raw} → {start} to {end}")
        return start, end
    except Exception as e:
        # Fallback: simple keyword detection
        q = question.lower()
        if "ayer" in q:
            return yesterday_str, yesterday_str
        elif "esta semana" in q or "semana" in q:
            return week_start, today_str
        elif "este mes" in q or "mes" in q:
            return month_start, today_str
        print(f"[wansoft-query] Date detection fallback: {today_str} (error: {e})")
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
    # Fetch all days in the date range and aggregate
    try:
        wc_params = {
            "select": "fecha,data",
            "order": "fecha.desc",
            "limit": "31",
        }
        # Use PostgREST AND filter for date range
        if start == end:
            wc_params["fecha"] = f"eq.{start}"
        else:
            wc_params["and"] = f"(fecha.gte.{start},fecha.lte.{end})"
        wc = sb_get("wansoft_waiter_categories", wc_params)
        if not wc:
            # Fallback: get most recent entry
            wc = sb_get("wansoft_waiter_categories", {
                "select": "fecha,data", "order": "fecha.desc", "limit": "1",
            })
        if wc:
            # Aggregate across all days
            from collections import defaultdict as _dd
            agg_grupo = _dd(lambda: _dd(lambda: {"qty": 0, "total": 0.0}))
            agg_platillo = _dd(lambda: _dd(lambda: {"qty": 0, "total": 0.0}))
            agg_cats = _dd(lambda: _dd(lambda: {"qty": 0, "total": 0.0}))

            for row in wc:
                d = row["data"]
                if isinstance(d, str):
                    d = json.loads(d)
                # Aggregate mesero × grupo
                for mesero, grupos in d.get("__por_mesero_grupo", {}).items():
                    for grupo, vals in grupos.items():
                        agg_grupo[mesero][grupo]["qty"] += vals.get("qty", 0)
                        agg_grupo[mesero][grupo]["total"] += vals.get("total", 0)
                # Aggregate mesero × platillo
                for mesero, platillos in d.get("__por_mesero_platillo", {}).items():
                    for platillo, vals in platillos.items():
                        agg_platillo[mesero][platillo]["qty"] += vals.get("qty", 0)
                        agg_platillo[mesero][platillo]["total"] += vals.get("total", 0)
                # Aggregate categories (H&H, Pan, etc.) and KPIs per mesero
                for key, val in d.items():
                    if not key.startswith("__") and isinstance(val, dict):
                        for cat, cat_vals in val.items():
                            if not isinstance(cat_vals, dict):
                                continue
                            if "qty" in cat_vals:
                                agg_cats[key][cat]["qty"] += cat_vals.get("qty", 0)
                                agg_cats[key][cat]["total"] += cat_vals.get("total", 0)
                            elif cat == "KPIs":
                                # Accumulate KPI raw values for averaging later
                                if "KPIs" not in agg_cats[key]:
                                    agg_cats[key]["KPIs"] = {"bebidas_total": 0, "alimentos_total": 0,
                                                              "personas": 0, "tickets": 0, "ventas_total": 0}
                                for f in ["bebidas_total", "alimentos_total", "personas", "tickets"]:
                                    agg_cats[key]["KPIs"][f] = agg_cats[key]["KPIs"].get(f, 0) + cat_vals.get(f, 0)
                                agg_cats[key]["KPIs"]["ventas_total"] = agg_cats[key]["KPIs"].get("ventas_total", 0) + cat_vals.get("ticket_promedio", 0) * cat_vals.get("tickets", 0)

            # Compute averaged KPIs
            combined = {}
            for mesero, cats in agg_cats.items():
                combined[mesero] = dict(cats)
                if "KPIs" in cats and isinstance(cats["KPIs"], dict) and cats["KPIs"].get("personas", 0) > 0:
                    kpi = cats["KPIs"]
                    p = kpi["personas"] or 1
                    t = kpi["tickets"] or 1
                    combined[mesero]["KPIs"] = {
                        "bebidas_por_persona": round(kpi["bebidas_total"] / p, 2),
                        "alimentos_por_persona": round(kpi["alimentos_total"] / p, 2),
                        "ticket_promedio": round(kpi["ventas_total"] / t, 2),
                        "bebidas_total": kpi["bebidas_total"],
                        "alimentos_total": kpi["alimentos_total"],
                        "personas": kpi["personas"],
                        "tickets": kpi["tickets"],
                    }
            combined["__por_mesero_grupo"] = {m: dict(g) for m, g in agg_grupo.items()}
            combined["__por_mesero_platillo"] = {m: dict(p) for m, p in agg_platillo.items()}
            combined["__dias_incluidos"] = len(wc)
            combined["__rango"] = f"{wc[-1]['fecha']} a {wc[0]['fecha']}"
            data["ventas_por_mesero_x_categoria"] = combined
            print(f"[wansoft-query] Waiter categories loaded: {len(wc)} days, {len([k for k in combined if not k.startswith('__')])} meseros")
    except Exception as e:
        print(f"[wansoft-query] Waiter categories FAILED: {e}")

    return data


def fetch_historical(days=90):
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
            "limit": "100",
        })
        return rows
    except Exception as e:
        return [{"error": str(e)}]


# ── Groq response ──────────────────────────────────────────────────────────
_exclude_names = (CLIENT.get("staff_exclude_meseros") or []) + (CLIENT.get("staff_market") or [])
_exclude_str = ", ".join(_exclude_names) if _exclude_names else "ninguno"

SYSTEM_PROMPT = f"""Eres el analista operativo en tiempo real de {CLIENT['display_name']} ({CLIENT.get('city', '')}).
Tu trabajo: convertir datos en acción inmediata.

FORMATO DE RESPUESTA:
- Preguntas simples (un dato): responde directo en 1-3 líneas. Texto plano, sin markdown.
- Análisis o "por qué": usa este formato:
  1. ALERTA OPERATIVA — qué cambió, cuándo, vs qué comparación
  2. POSIBLES CAUSAS — 3-5 causas específicas basadas en datos
  3. MESEROS/ÁREAS INVOLUCRADAS — solo los que explican la variación
  4. ACCIONES SUGERIDAS — concretas, inmediatas, operables
  5. PRIORIDAD — Alta/Media/Baja

REGLAS:
- Montos en MXN con $ SIN decimales
- EXCLUYE SIEMPRE de rankings: {_exclude_str}
- H&H = Half & Half. "Pan" = toast + bagels. "2da Bebida" = segunda bebida del comensal
- Usa los RANKINGS PRECALCULADOS directamente — no recalcules
- Ticket promedio = ventas / PERSONAS (no tickets). Usa campo "ticket_promedio" de KPIs
- Siempre conecta: dato → causa probable → acción
- Si no hay dato, di "No tengo ese dato" y punto. No inventes
- Para historial, muestra TODOS los días disponibles
- Prioriza insights que ayuden al gerente a actuar HOY

MÉTRICAS CLAVE:
1. Ticket promedio por comensal y por mesero
2. Bebidas por persona (upselling)
3. H&H vs chilaquiles solos
4. Add-ons/extras (pollo, aguacate, proteína)
5. 2da bebida por comensal
6. Pan/Toast/Bagel por mesero
7. Postres por mesero
8. Desempeño de cada mesero en upselling
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

    # Block 0: If waiter × category data exists and question is about H&H/pan/postres/mesero, put FIRST
    waiter_cats = wd.pop("ventas_por_mesero_x_categoria", None)
    cat_keywords = ["h&h", "half", "pan", "toast", "bagel", "postre", "dessert", "2da bebida",
                    "segunda bebida", "bebida", "bebidas por persona", "categoría", "categoria",
                    "pizza", "chilaquile", "enchilada", "café", "cafe", "latte",
                    "mesero vendió", "mesero vendio", "vendió cada", "vendio cada",
                    "upselling", "up selling", "extras", "extra", "mesero que más", "mesero que menos",
                    "quién vendió", "quien vendio", "quién fue", "quien fue",
                    "por mesero", "por persona", "kpi", "ticket promedio"]
    matched_kw = [kw for kw in cat_keywords if kw in q_lower]
    print(f"[wansoft-query] Waiter cats exists: {waiter_cats is not None}, matched keywords: {matched_kw[:5]}")
    if waiter_cats and matched_kw:
        # Extract relevant mesero×grupo or mesero×platillo data
        wc_data = {}

        # Check if question mentions a specific mesero
        por_mesero_grupo = waiter_cats.get("__por_mesero_grupo", {})
        por_mesero_platillo = waiter_cats.get("__por_mesero_platillo", {})

        # Filter to relevant mesero if mentioned
        # Exclude generic words and excluded staff from matching
        _excl_lower = [e.lower() for e in _exclude_names] + ["mesero evento", "aplicaciones", "hector enrique"]
        _skip_match = {"mesero", "total", "ranking", "todos", "ayer", "mayo", "bebida", "persona"}
        mesero_match = None
        for mesero_name in por_mesero_grupo:
            if any(ex in mesero_name.lower() for ex in _excl_lower):
                continue
            name_parts = mesero_name.lower().split()
            matching_parts = [p for p in name_parts if len(p) > 3 and p not in _skip_match and p in q_lower]
            if matching_parts:
                mesero_match = mesero_name
                break

        if mesero_match:
            # Always include this mesero's category summary (H&H, Pan, Postres, 2da Bebida, KPIs)
            mesero_cats = {k: v for k, v in waiter_cats.items()
                          if k == mesero_match and isinstance(v, dict)}
            if mesero_cats:
                wc_data[f"categorias_de_{mesero_match}"] = mesero_cats[mesero_match]

            # Also include platillo detail if available
            if por_mesero_platillo.get(mesero_match):
                all_platillos = por_mesero_platillo[mesero_match]
                filtered = {k: v for k, v in all_platillos.items()
                            if any(term in k.lower() for term in search_terms)}
                if filtered:
                    wc_data[f"platillos_de_{mesero_match}_filtrados"] = filtered
                else:
                    top = dict(sorted(all_platillos.items(), key=lambda x: -x[1].get("qty", 0))[:20])
                    wc_data[f"top_platillos_de_{mesero_match}"] = top
            wc_data[f"grupos_de_{mesero_match}"] = por_mesero_grupo.get(mesero_match, {})
        else:
            # No specific mesero — show compact summary for ALL meseros
            # Filter out excluded meseros from the data
            _excl_lower = [e.lower() for e in _exclude_names] + ["mesero evento", "aplicaciones", "hector enrique"]
            all_meseros = {}
            for mesero_name, mesero_data in waiter_cats.items():
                if mesero_name.startswith("__") or not isinstance(mesero_data, dict):
                    continue
                if any(ex in mesero_name.lower() for ex in _excl_lower):
                    continue
                compact_m = {}
                kpis = mesero_data.get("KPIs", {})
                if kpis:
                    compact_m["bebidas_por_persona"] = kpis.get("bebidas_por_persona", 0)
                    compact_m["alimentos_por_persona"] = kpis.get("alimentos_por_persona", 0)
                    compact_m["ticket_promedio"] = kpis.get("ticket_promedio", 0)
                    compact_m["personas"] = kpis.get("personas", 0)
                    compact_m["tickets"] = kpis.get("tickets", 0)
                # Add all categories (H&H, Pan, Postres, 2da Bebida) as explicit numbers
                for cat, cat_vals in mesero_data.items():
                    if cat == "KPIs" or not isinstance(cat_vals, dict):
                        continue
                    if "qty" in cat_vals:
                        compact_m[f"{cat}_qty"] = cat_vals['qty']
                        compact_m[f"{cat}_total"] = round(cat_vals.get('total', 0))
                if compact_m:
                    all_meseros[mesero_name] = compact_m
            wc_data["todos_los_meseros"] = all_meseros

            # Pre-build rankings as plain text so AI doesn't miss them
            rankings = []
            # H&H ranking
            hh_rank = [(m, d.get("H&H_qty", 0), d.get("H&H_total", 0)) for m, d in all_meseros.items()]
            hh_rank.sort(key=lambda x: -x[1])
            rankings.append("RANKING H&H POR MESERO:")
            for m, qty, total in hh_rank:
                rankings.append(f"  {m}: {qty} pzas (${total:,})")

            # 2da Bebida ranking
            beb_rank = [(m, d.get("2da Bebida_qty", 0)) for m, d in all_meseros.items()]
            beb_rank.sort(key=lambda x: -x[1])
            rankings.append("\nRANKING 2DA BEBIDA POR MESERO:")
            for m, qty in beb_rank:
                rankings.append(f"  {m}: {qty} pzas")

            # Bebidas por persona ranking
            bp_rank = [(m, d.get("bebidas_por_persona", 0)) for m, d in all_meseros.items()]
            bp_rank.sort(key=lambda x: -x[1])
            rankings.append("\nRANKING BEBIDAS POR PERSONA:")
            for m, bp in bp_rank:
                rankings.append(f"  {m}: {bp}")

            # Pan ranking
            pan_rank = [(m, d.get("Pan_qty", 0), d.get("Pan_total", 0)) for m, d in all_meseros.items()]
            pan_rank.sort(key=lambda x: -x[1])
            rankings.append("\nRANKING PAN/TOAST/BAGEL POR MESERO:")
            for m, qty, total in pan_rank:
                rankings.append(f"  {m}: {qty} pzas (${total:,})")

            # Postres ranking
            post_rank = [(m, d.get("Postres_qty", 0), d.get("Postres_total", 0)) for m, d in all_meseros.items()]
            post_rank.sort(key=lambda x: -x[1])
            rankings.append("\nRANKING POSTRES POR MESERO:")
            for m, qty, total in post_rank:
                if qty > 0:
                    rankings.append(f"  {m}: {qty} pzas (${total:,})")

            # Put rankings as plain text FIRST — insert at position 0
            blocks.insert(0, "\n".join(rankings))

        wc_data["dias_incluidos"] = waiter_cats.get("__dias_incluidos", 1)
        wc_data["rango"] = waiter_cats.get("__rango", "")

        # Remove todos_los_meseros from JSON to save space (rankings already have the data)
        wc_data.pop("todos_los_meseros", None)
        blocks.append("DATOS MESERO × CATEGORÍA:\n"
                      + json.dumps(wc_data, ensure_ascii=False, indent=1))

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

    # Block 5: Historical
    hist_keywords = ["historial", "historia", "abril", "marzo", "últimos", "ultimos", "mejorado", "tendencia", "comparar"]
    wants_history = any(kw in q_lower for kw in hist_keywords)
    hist_limit = 90 if wants_history else 7
    if historical_data:
        if wants_history:
            hist_lines = ["HISTÓRICO TICKET PROMEDIO DIARIO:"]
            for r in reversed(historical_data[:hist_limit]):
                tp = r.get("ticket_promedio_restaurant")
                if tp:
                    hist_lines.append(f"  {r['fecha']}: ${round(tp)}")
            print(f"[wansoft-query] History block: {len(hist_lines)-1} days, {len(chr(10).join(hist_lines))} chars")
            # Insert at position 1 (after rankings) so it doesn't get cut
            blocks.insert(1, "\n".join(hist_lines))
        else:
            hist_compact = [{"fecha": r.get("fecha"), "ventas": r.get("ventas_dia"),
                             "ticket_prom": r.get("ticket_promedio_restaurant")}
                            for r in historical_data[:hist_limit]]
            blocks.append(f"HISTÓRICO ({len(hist_compact)} días):\n" + json.dumps(hist_compact, ensure_ascii=False, indent=1))

    # Assemble context — cap total at 40000 chars
    context = ""
    for block in blocks:
        if len(context) + len(block) > 40000:
            break
        context += block + "\n\n"
    print(f"[wansoft-query] Context size: {len(context)} chars, {len(blocks)} blocks")

    context += f"PREGUNTA: {question}"

    r = requests.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"},
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4000,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": context}],
        }, timeout=30)
    r.raise_for_status()
    return r.json()["content"][0]["text"].strip()


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
        historical = fetch_historical(90)

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
