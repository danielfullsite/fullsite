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
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
TG_TOKEN     = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT_ID   = os.environ.get("INPUT_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")
MESSAGE      = os.environ.get("INPUT_MESSAGE", "").strip()
TRIGGER_TYPE = os.environ.get("TRIGGER_TYPE", "workflow_dispatch")

MX_TZ = get_tz(CLIENT)
sb_headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

# ── SECURITY: Bot constraints ──────────────────────────────────────────────
# Whitelist of tables the bot can read (no writes except agent_runs)
ALLOWED_TABLES = frozenset({
    "wansoft_daily", "wansoft_kpis", "wansoft_data", "wansoft_tips",
    "wansoft_waiter_categories", "wansoft_food_cost", "wansoft_hourly",
    "wansoft_persons_hourly", "wansoft_pnl", "wansoft_suppliers",
    "wansoft_shrinkage", "wansoft_inventory", "wansoft_labor",
    "pos_menu_items", "pos_menu_categories", "pos_ingredients",
    "pos_inventory", "pos_recipes", "pos_suppliers", "pos_orders",
    "agent_results", "agent_runs",
    "amalay_reservaciones", "clients",
})

MAX_MESSAGE_LENGTH = 2000  # Max chars from user input
DANGEROUS_PATTERNS = re.compile(r"(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE|GRANT|REVOKE)", re.IGNORECASE)

try:
    from audit_log import AuditLogger
    _audit = AuditLogger("wansoft_query")
except ImportError:
    _audit = None


# ── Helpers ─────────────────────────────────────────────────────────────────
def send_telegram(text):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT_ID, "text": chunk}, timeout=15)


def sb_get(table, params):
    # SECURITY: only allow whitelisted tables
    base_table = table.split("?")[0].strip()
    if base_table not in ALLOWED_TABLES:
        print(f"[SECURITY] BLOCKED read from non-whitelisted table: {base_table}")
        if _audit:
            _audit.log_error(f"BLOCKED: attempted read from {base_table}", [base_table])
        return []
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers, params=params)
    r.raise_for_status()
    return r.json()


def wansoft_login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    r = s.post(f"{WANSOFT_URL}/", data={"UserName": WANSOFT_USER, "Password": WANSOFT_PASS},
               allow_redirects=True)
    if "Dashboard" not in r.url and "MyDocumentsList" not in r.url:
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

    # Calculate last weekend (always the PAST one, never future)
    days_since_sunday = now_mx.weekday() + 1  # Monday=0+1=1, Sunday=6+1=7
    if days_since_sunday == 7:  # Today IS Sunday
        last_sunday = now_mx.strftime("%Y-%m-%d")
        last_saturday = (now_mx - timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        last_sunday = (now_mx - timedelta(days=days_since_sunday)).strftime("%Y-%m-%d")
        last_saturday = (now_mx - timedelta(days=days_since_sunday + 1)).strftime("%Y-%m-%d")

    try:
        r = requests.post("https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                     "Content-Type": "application/json"},
            json={
                "model": "llama-3.3-70b-versatile",
                "max_tokens": 50,
                "temperature": 0.0,
                "messages": [
                    {"role": "system", "content": f"""Hoy es {today_str} ({dow}). Ayer fue {yesterday_str}. Extrae el rango de fechas.
Responde SOLO JSON: {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}
- "hoy" → {{"start":"{today_str}","end":"{today_str}"}}
- "ayer" → {{"start":"{yesterday_str}","end":"{yesterday_str}"}}
- "esta semana" → {{"start":"{week_start}","end":"{today_str}"}}
- "este mes" → {{"start":"{month_start}","end":"{today_str}"}}
- "fin de semana" / "finde" / "sabado y domingo" → {{"start":"{last_saturday}","end":"{last_sunday}"}} (siempre el PASADO, nunca futuro)
- "el fin de semana pasado" → {{"start":"{last_saturday}","end":"{last_sunday}"}}
- Sin fecha → {{"start":"{today_str}","end":"{today_str}"}}
REGLA: "fin de semana" SIEMPRE es el pasado (sábado y domingo más recientes). NUNCA el futuro.
Solo JSON."""},
                    {"role": "user", "content": question},
                ],
            }, timeout=15)
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"].strip()
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
        elif "fin de semana" in q or "finde" in q:
            return last_saturday, last_sunday
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
    # CRITICAL: cols[2]=PERSONAS, cols[3]=ORDENES (verified by audit 2026-06-06)
    data["por_tipo_orden"] = [{"tipo": r[0], "ticket_promedio": r[1], "personas": r[2],
                                "ordenes": r[3], "subtotal": r[4], "total": r[5]}
                               for r in rows if len(r) >= 6]

    # 5b. OPEN orders (GetMonitoringInfo) — the Wansoft app's "# Órdenes" counts
    # closed + OPEN. SalesByTypeOfOrder is closed-only, so for "today" questions
    # we add live pending orders (same fix as intraday_sales.py, 2026-06-12).
    today_mx = datetime.now(MX_TZ).strftime("%Y-%m-%d")
    if str(end) >= today_mx:
        try:
            r = session.post(f"{WANSOFT_URL}/Reports/GetMonitoringInfo",
                             params={"subsidiaryId": SUBSIDIARY}, timeout=15)
            result = (r.json() or {}).get("Result") or {}
            abiertas = int(result.get("PendingOrdersCounter") or 0)
            monto = float(result.get("PendingOrdersAmount") or 0)
            personas_abiertas = sum(int(p) for p in re.findall(r'personas="(\d+)"', result.get("PendingOrders") or ""))
            data["ordenes_abiertas_ahora"] = {
                "ordenes": abiertas, "personas": personas_abiertas, "monto_mxn": monto,
                "nota": ("La app de Wansoft cuenta ordenes/personas CERRADAS + ABIERTAS. "
                         "Para totales de HOY suma estas abiertas a por_tipo_orden."),
            }
            print(f"[wansoft-query] Open orders now: {abiertas} ordenes, {personas_abiertas} personas")
        except Exception as e:
            print(f"[wansoft-query] GetMonitoringInfo failed (non-blocking): {e}")

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

    # 15. Tips + payment methods fallback from Supabase (Wansoft jqGrid/empty endpoints)
    try:
        # Propinas from KPIs (real-time, today only)
        kpis = sb_get("wansoft_kpis", {"select": "propinas_total,propinas_meseros", "limit": "1"})
        if kpis and kpis[0].get("propinas_meseros"):
            data["propinas_meseros"] = kpis[0]["propinas_meseros"]
            data["propinas_total"] = kpis[0].get("propinas_total", 0)
    except Exception:
        pass

    # Propinas from wansoft_daily (historical, for date ranges)
    try:
        if not data.get("propinas_meseros"):
            prop_params = {"select": "fecha,propinas_total,propinas_meseros", "order": "fecha.desc", "limit": "7"}
            if start == end:
                prop_params["fecha"] = f"eq.{start}"
            else:
                prop_params["and"] = f"(fecha.gte.{start},fecha.lte.{end})"
            prop_rows = sb_get("wansoft_daily", prop_params)
            if prop_rows:
                total_propinas = sum(float(r.get("propinas_total", 0) or 0) for r in prop_rows)
                data["propinas_total"] = total_propinas
                # Aggregate propinas_meseros across days
                from collections import defaultdict as _dd2
                pm_agg = _dd2(float)
                for r in prop_rows:
                    pm = r.get("propinas_meseros")
                    if isinstance(pm, str):
                        try: pm = json.loads(pm)
                        except: pm = []
                    for m in (pm or []):
                        pm_agg[m.get("nombre", "")] += float(m.get("total", 0))
                if pm_agg:
                    data["propinas_meseros"] = [{"nombre": k, "total": round(v)} for k, v in sorted(pm_agg.items(), key=lambda x: -x[1])]
    except Exception:
        pass

    # Payment methods fallback from wansoft_daily (if Wansoft endpoint returned empty)
    try:
        if not data.get("metodos_pago"):
            pm_params = {"select": "fecha,pago_metodos,efectivo,tarjeta", "order": "fecha.desc", "limit": "7"}
            if start == end:
                pm_params["fecha"] = f"eq.{start}"
            else:
                pm_params["and"] = f"(fecha.gte.{start},fecha.lte.{end})"
            pm_rows = sb_get("wansoft_daily", pm_params)
            if pm_rows:
                from collections import defaultdict as _dd3
                pm_agg = _dd3(float)
                total_efectivo = 0
                total_tarjeta = 0
                for r in pm_rows:
                    total_efectivo += float(r.get("efectivo", 0) or 0)
                    total_tarjeta += float(r.get("tarjeta", 0) or 0)
                    pms = r.get("pago_metodos")
                    if isinstance(pms, str):
                        try: pms = json.loads(pms)
                        except: pms = []
                    for p in (pms or []):
                        pm_agg[p.get("nombre", "")] += float(p.get("total", 0))
                if pm_agg:
                    grand_total = sum(pm_agg.values()) or 1
                    data["metodos_pago"] = [{"metodo": k, "total": round(v), "pct": f"{v/grand_total*100:.1f}%"}
                                             for k, v in sorted(pm_agg.items(), key=lambda x: -x[1])]
                elif total_efectivo or total_tarjeta:
                    grand_total = total_efectivo + total_tarjeta or 1
                    data["metodos_pago"] = [
                        {"metodo": "Efectivo", "total": round(total_efectivo), "pct": f"{total_efectivo/grand_total*100:.1f}%"},
                        {"metodo": "Tarjeta", "total": round(total_tarjeta), "pct": f"{total_tarjeta/grand_total*100:.1f}%"},
                    ]
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

    # 16b. Food cost (costo de platillos) — from Wansoft + Supabase fallback
    try:
        r = session.post(f"{WANSOFT_URL}/Reports/GetCostBySaucer",
                         data={"subsidiaryId": SUBSIDIARY, "startDate": start, "endDate": end},
                         timeout=15)
        cost_rows = parse_rows(r.text)
        if cost_rows and len(cost_rows) > 0 and len(cost_rows[0]) >= 3:
            data["food_cost"] = cost_rows[:50]
    except Exception:
        pass

    # 16c. Food cost fallback — cascade: pos_recipes → wansoft_food_cost → food_cost_real → food_cost_browser
    if "food_cost" not in data or not data["food_cost"]:
        # Try pos_recipes first (Excel costeo with real ingredient costs)
        try:
            recipes = sb_get("pos_recipes", {
                "select": "nombre,precio_venta,costo_total,pct_costo",
                "client_id": f"eq.{CLIENT['id']}",
                "costo_total": "gt.0",
                "limit": "120",
            })
            if recipes:
                data["food_cost"] = recipes
                data["food_cost_source"] = "pos_recipes"
                log(f"  food_cost: {len(recipes)} recipes from pos_recipes (Excel costeo)")
        except:
            pass

    if "food_cost" not in data or not data["food_cost"]:
        # Try pos_insumos (raw ingredient prices)
        try:
            insumos = sb_get("pos_insumos", {
                "select": "nombre,categoria,proveedor,um,precio_limpio,merma_pct",
                "client_id": f"eq.{CLIENT['id']}",
                "order": "precio_limpio.desc",
                "limit": "50",
            })
            if insumos:
                data["insumos"] = insumos
                log(f"  insumos: {len(insumos)} from pos_insumos")
        except:
            pass

    if "food_cost" not in data or not data["food_cost"]:
        for fc_source, fc_table, fc_params in [
            ("wansoft_food_cost", "wansoft_food_cost", {
                "client_id": f"eq.{CLIENT['id']}",
                "order": "fecha.desc", "limit": "1",
            }),
            ("food_cost_real", "wansoft_data", {
                "client_id": f"eq.{CLIENT['id']}",
                "data_key": "eq.food_cost_real",
                "order": "fecha.desc", "limit": "1",
            }),
            ("food_cost_browser", "wansoft_data", {
                "client_id": f"eq.{CLIENT['id']}",
                "data_key": "eq.food_cost_browser",
                "order": "fecha.desc", "limit": "1",
            }),
        ]:
            try:
                fc = sb_get(fc_table, fc_params)
                if fc and fc[0].get("data"):
                    fc_data = fc[0]["data"]
                    if isinstance(fc_data, str):
                        fc_data = json.loads(fc_data)
                    if isinstance(fc_data, list) and len(fc_data) > 0 and isinstance(fc_data[0], dict):
                        # Verify it's real data (not NR garbage or zeros)
                        if fc_data[0].get("platillo") or fc_data[0].get("nombre"):
                            data["food_cost_supabase"] = fc_data
                            print(f"[wansoft-query] Food cost loaded from {fc_source}: {len(fc_data)} items")
                            break
            except Exception:
                continue

    # 16d. Tips fallback from browser scraper
    if not data.get("propinas_meseros"):
        try:
            for tips_key in ["tips_browser", "tips_raw"]:
                tips_fb = sb_get("wansoft_data", {
                    "client_id": f"eq.{CLIENT['id']}",
                    "data_key": f"eq.{tips_key}",
                    "order": "fecha.desc",
                    "limit": "1",
                })
                if tips_fb and tips_fb[0].get("data"):
                    t_data = tips_fb[0]["data"]
                    if isinstance(t_data, str):
                        t_data = json.loads(t_data)
                    if t_data and isinstance(t_data, list) and len(t_data) > 0:
                        # Check if it has real propinas data (not all zeros)
                        has_propinas = any(float(t.get("propinas", 0) or 0) > 0 for t in t_data if isinstance(t, dict))
                        if has_propinas:
                            data["propinas_meseros"] = [
                                {"nombre": t.get("mesero", ""), "total": float(t.get("propinas", 0) or 0)}
                                for t in t_data if isinstance(t, dict) and float(t.get("propinas", 0) or 0) > 0
                            ]
                            data["propinas_total"] = sum(float(t.get("propinas", 0) or 0) for t in t_data if isinstance(t, dict))
                            print(f"[wansoft-query] Tips loaded from {tips_key}: {len(data['propinas_meseros'])} meseros")
                            break
        except Exception:
            pass

    # 16e. Recetas e ingredientes (from Excel costeo import) — always load, small data
    for key in ["recetas_costeo", "materia_prima"]:
        try:
            rc = sb_get("wansoft_data", {
                "client_id": f"eq.{CLIENT['id']}",
                "data_key": f"eq.{key}",
                "order": "fecha.desc", "limit": "1",
            })
            if rc and rc[0].get("data"):
                rc_data = rc[0]["data"]
                if isinstance(rc_data, str):
                    rc_data = json.loads(rc_data)
                if rc_data:
                    data[key] = rc_data
                    print(f"[wansoft-query] {key}: {len(rc_data)} items")
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


def fetch_inventory_and_costs():
    """Fetch ALL available data from Supabase — inventory, costs, agents, reservations, and wansoft_data."""
    extra = {}
    cid = CLIENT['id']

    # 1. Ingredients with costs, yield factor, suppliers
    ings = []
    try:
        ings = sb_get("pos_ingredients", {
            "client_id": f"eq.{cid}", "active": "eq.true",
            "select": "id,name,unit,cost_per_unit,yield_factor,supplier,category",
            "limit": "500",
        })
        extra["ingredientes"] = {
            "total": len(ings),
            "con_costo": len([i for i in ings if (i.get("cost_per_unit") or 0) > 0]),
            "con_merma": len([i for i in ings if (i.get("yield_factor") or 1) < 1]),
            "top_costos": sorted(ings, key=lambda x: -(x.get("cost_per_unit") or 0))[:15],
            "proveedores": list(set(i.get("supplier", "") for i in ings if i.get("supplier"))),
        }
        print(f"[wansoft-query] Ingredients: {len(ings)}")
    except Exception as e:
        print(f"[wansoft-query] Ingredients FAILED: {e}")

    # 2. Inventory levels
    try:
        inv = sb_get("pos_inventory", {
            "client_id": f"eq.{cid}",
            "select": "ingredient_id,stock,reorder_point",
            "limit": "500",
        })
        ing_id_map = {i["id"]: i["name"] for i in ings}
        critical = []
        for item in inv:
            stock = float(item.get("stock") or 0)
            reorder = float(item.get("reorder_point") or 0)
            if reorder > 0 and stock < reorder:
                critical.append({
                    "nombre": ing_id_map.get(item["ingredient_id"], item["ingredient_id"]),
                    "stock": stock, "reorder": reorder,
                })
        extra["inventario"] = {
            "total_items": len(inv),
            "criticos": len(critical),
            "en_cero": len([c for c in critical if c["stock"] == 0]),
            "items_criticos": critical[:20],
        }
        print(f"[wansoft-query] Inventory: {len(inv)} items, {len(critical)} critical")
    except Exception as e:
        print(f"[wansoft-query] Inventory FAILED: {e}")

    # 3. ALL wansoft_data keys (35 data types!)
    WANSOFT_DATA_KEYS = [
        "recetas_costeo", "materia_prima", "purchases_by_product",
        "costeo_por_platillo",
        "tips_raw", "modifiers_sold", "discounts_detail", "discounts_total",
        "courtesies", "courtesies_total", "cancel_sales", "voids",
        "cash_closing", "closing_cash_mega", "hours_worked", "shifts",
        "sales_area", "sales_terminal", "promotions_browser",
        "purchase_orders", "supplier_list", "cost_by_group",
    ]
    for key in WANSOFT_DATA_KEYS:
        try:
            rows = sb_get("wansoft_data", {
                "client_id": f"eq.{cid}", "data_key": f"eq.{key}",
                "select": "data", "order": "fecha.desc", "limit": "1",
            })
            if rows:
                raw = rows[0].get("data", "[]")
                if isinstance(raw, str):
                    try:
                        import json as _json
                        raw = _json.loads(raw)
                    except:
                        pass
                if isinstance(raw, str):
                    try:
                        raw = _json.loads(raw)
                    except:
                        pass
                # Only include if there's real data (not just empty arrays)
                if raw and raw != [] and raw != {}:
                    has_data = False
                    if isinstance(raw, list):
                        has_data = any(item.get("nombre") or item.get("total") or item.get("platillo") or item.get("empleado") or item.get("ingrediente") or item.get("mesero") or item.get("ProductName") for item in raw if isinstance(item, dict))
                    elif isinstance(raw, dict):
                        has_data = bool(raw.get("total") or raw.get("count") or raw.get("Result") or raw.get("ClosingCashPayments"))
                    if has_data:
                        extra[key] = raw
        except:
            pass
    loaded_keys = [k for k in WANSOFT_DATA_KEYS if k in extra]
    print(f"[wansoft-query] wansoft_data loaded: {len(loaded_keys)} keys: {', '.join(loaded_keys)}")

    # 4. Agent results
    try:
        agent_results = sb_get("agent_results", {
            "select": "agent_id,fecha,priority,summary",
            "order": "updated_at.desc", "limit": "50",
        })
        latest = {}
        for r in agent_results:
            if r["agent_id"] not in latest:
                latest[r["agent_id"]] = r
        extra["agentes"] = latest
        print(f"[wansoft-query] Agents: {len(latest)}")
    except Exception as e:
        print(f"[wansoft-query] Agents FAILED: {e}")

    # 5. Reservations
    try:
        from datetime import date
        today = date.today().isoformat()
        reservas = sb_get(CLIENT.get("reservaciones_table", "amalay_reservaciones"), {
            "fecha": f"gte.{today}", "status": "neq.cancelled",
            "select": "fecha,nombre,guests,espacio,horario_inicio,status",
            "order": "fecha.asc", "limit": "20",
        })
        extra["reservaciones"] = reservas
        print(f"[wansoft-query] Reservations: {len(reservas)}")
    except Exception as e:
        print(f"[wansoft-query] Reservations FAILED: {e}")

    # 6. Deep scraper tables
    for table, key in [("wansoft_tips", "propinas_detalle"), ("wansoft_suppliers", "proveedores_gasto"),
                       ("wansoft_labor", "labor_data"), ("wansoft_food_cost", "food_cost_data"),
                       ("wansoft_inventory", "inventario_wansoft")]:
        try:
            rows = sb_get(table, {"select": "data", "order": "fecha.desc", "limit": "1"})
            if rows:
                raw = rows[0].get("data", "[]")
                if isinstance(raw, str):
                    try: raw = _json.loads(raw)
                    except: pass
                if isinstance(raw, str):
                    try: raw = _json.loads(raw)
                    except: pass
                if raw and raw != []:
                    extra[key] = raw
        except:
            pass
    print(f"[wansoft-query] Deep tables: {', '.join(k for k in ['propinas_detalle','proveedores_gasto','labor_data','food_cost_data','inventario_wansoft'] if k in extra)}")

    # 7. Weather forecast (free API — wttr.in)
    try:
        city = CLIENT.get("city", "Monterrey")
        wr = requests.get(f"https://wttr.in/{city}?format=j1", timeout=5)
        if wr.ok:
            weather = wr.json()
            current = weather.get("current_condition", [{}])[0]
            forecast_days = weather.get("weather", [])
            extra["clima"] = {
                "actual": {
                    "temp_c": current.get("temp_C"),
                    "desc": current.get("lang_es", [{}])[0].get("value", current.get("weatherDesc", [{}])[0].get("value", "")),
                    "humedad": current.get("humidity"),
                    "lluvia_mm": current.get("precipMM"),
                },
                "pronostico": [
                    {
                        "fecha": d.get("date"),
                        "max_c": d.get("maxtempC"),
                        "min_c": d.get("mintempC"),
                        "desc": d.get("hourly", [{}])[4].get("lang_es", [{}])[0].get("value", "") if d.get("hourly") else "",
                        "lluvia_mm": max(float(h.get("precipMM", 0)) for h in d.get("hourly", [{"precipMM": "0"}])),
                    }
                    for d in forecast_days[:3]
                ],
            }
            print(f"[wansoft-query] Weather loaded: {extra['clima']['actual']['temp_c']}°C, {extra['clima']['actual']['desc']}")
    except Exception as e:
        print(f"[wansoft-query] Weather FAILED: {e}")

    return extra


def fetch_historical(days=90):
    """Fetch historical data from Supabase wansoft_daily."""
    try:
        now_mx = datetime.now(MX_TZ)
        start = (now_mx - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = sb_get("wansoft_daily", {"client_slug": f"eq.{CLIENT['id']}",
            "select": "fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,"
                      "personas_restaurant,ticket_promedio_restaurant,propinas_total,"
                      "efectivo,tarjeta,"
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
_supervisor_names = CLIENT.get("staff_supervisors") or []
_supervisor_str = ", ".join(_supervisor_names) if _supervisor_names else "ninguno configurado"

SYSTEM_PROMPT = f"""Eres el copiloto operativo de {CLIENT['display_name']} ({CLIENT.get('city', '')}). Consultor senior con 20 años de experiencia en restaurantes. Entiendes INTENCIÓN, no solo palabras.

PERSONALIDAD:
- Directo. Dato pedido = dato dado. Sin rodeos.
- "Mario está bajando" NO "Se observa una tendencia decreciente."
- Si preguntan "por qué" → causa raíz con datos. Si preguntan "qué hago" → acciones para HOY.
- Habla como socio de negocio. Texto plano para Telegram, sin markdown ni asteriscos.

REGLA #0 — NUNCA INVENTAR DATOS:
- PROHIBIDO usar palabras como "estimado", "aproximadamente", "podría ser", "calculo que" cuando NO tienes el dato real.
- PROHIBIDO inventar numeros que no estan en los datos proporcionados.
- Si NO tienes un dato, di EXACTAMENTE que dato falta y DONDE lo pueden encontrar. Ejemplo: "No tengo el costo de receta. Eso está en Wansoft > Reportes > Inventarios > Costo y margen."
- NUNCA extrapoles datos historicos para inventar meses que no existen en los datos.
- Si solo tienes datos parciales, di cuantos dias tienes y presenta solo esos.

REGLA #1 — SI NO HAY DATOS DE HOY:
- Si preguntan por "hoy" y los datos vienen vacíos o en 0: di "Aún no hay datos de hoy. El sync se actualiza con las ventas del día."
- Si no hay datos de hoy pero sí de ayer, ofrece los de ayer: "Aún no hay datos de hoy, pero ayer..."

REGLA #2 — BUSCAR ANTES DE DECIR "NO TENGO":
- Si puedes CALCULARLO de los datos que SI tienes: suma, promedia, compara. HAZLO.
- Busca SINÓNIMOS: H&H = Half & Half = HALF HALF COMBO. Pan = Toast = Bagel. Postre = Dessert.
- Los productos del MARKET (Smarty chips, snacks, abarrotes, marca propia) SÍ están en los
  platillos vendidos — NO es un módulo separado. Si preguntan por un producto del Market,
  búscalo en "PLATILLOS QUE COINCIDEN CON LA BÚSQUEDA" y suma las cantidades del periodo.

DATOS DISPONIBLES (tienes acceso a ABSOLUTAMENTE TODO):
VENTAS: ventas_consolidadas, ventas por fecha/mesero/platillo/categoría/método de pago, histórico 870+ días
COSTOS: ingredientes (412 con costo limpio incluyendo merma), yield factor, proveedor, categoría
RECETAS: recetas_costeo — cada platillo con sus ingredientes y porciones exactas
INVENTARIO: stock actual, punto de reorden, items críticos y en cero
COMPRAS: purchases_by_product — compras por producto con cantidades y costos reales
MATERIA PRIMA: materia_prima — todos los ingredientes con merma y rendimiento
PROPINAS: tips_raw — propinas detalladas por mesero (ventas, propinas, porcentaje)
DESCUENTOS: discounts_detail y discounts_total — quién autorizó, monto, detalle
CORTESÍAS: courtesies y courtesies_total — cortesías por orden con autorizador
CANCELACIONES: cancel_sales — cancelaciones por orden con mesa, mesero, platillo
ANULACIONES: voids — anulaciones por orden
CORTES DE CAJA: cash_closing y closing_cash_mega — cortes por día, terminal, métodos de pago
HORAS TRABAJADAS: hours_worked — entrada, salida, horas por empleado
TURNOS: shifts — turnos del personal
VENTAS POR ZONA: sales_area — ventas por área del restaurante
VENTAS POR TERMINAL: sales_terminal — ventas por terminal/punto
PROMOCIONES: promotions_browser — promociones activas con fechas
MODIFICADORES: modifiers_sold — modificadores vendidos (extras, sin X)
PROVEEDORES: supplier_list, proveedores_gasto — lista y gasto por proveedor
FOOD COST: food_cost_data — costo real vs ideal
LABOR: labor_data — datos laborales
AGENTES IA: resultados de los 30 agentes (anomalías, anti-fraude, auto-86, compras, staffing, etc.)
RESERVACIONES: próximas reservas con nombre, personas, espacio, hora

REGLA CRÍTICA: Si preguntan CUALQUIER COSA sobre el restaurante — costos, inventario, recetas, merma, proveedores, compras, propinas, descuentos, cortesías, cancelaciones, horas, cortes, food cost — TIENES LOS DATOS. Búscalos en los datos proporcionados. NUNCA digas "no tengo ese dato" sin antes revisar TODOS los bloques de datos.
- Si el mesero aparece en CUALQUIER dato: NO digas que no tienes info de ese mesero.
- Propinas: busca en propinas_meseros, propinas_total. Si no aparece, di "Las propinas no están en este reporte. Revisa el corte de caja del día en Wansoft."
- Efectivo/tarjeta: busca en metodos_pago, pago_metodos. Si hay datos historicos, usa esos.
- Food cost / costo de receta: busca en food_cost (fuente: pos_recipes = costeo REAL del Excel, campos: nombre, precio_venta, costo_total, pct_costo). REGLAS: (1) platillos con precio_venta=0 son extras/modificadores — NO usarlos para promedios; (2) el food cost general/teorico es el promedio de pct_costo de platillos con precio_venta>0 y pct_costo entre 0 y 100 (~27.6%); (3) si pct_costo>100 el platillo pierde dinero — menciónalo como alerta, no como promedio. Si el platillo buscado no aparece, di que no está en el costeo.

CÓMO INTERPRETAR:
- "cómo vamos" / "qué onda" → hoy vs promedio del mismo DOW
- "quién es el crack" / "mejor mesero" → ranking por ventas
- "por qué bajaron" → categorías + meseros que cambiaron
- "cuántos H&H" → desglose diario
- "cómo subo el ticket" → qué upselling está bajo + quién no vende
- "compara A con B" → ventas, TP, H&H, postres, bebidas/persona
- "qué hago ahorita" → staff brief 5 min + $ proyectado
- "cuánto cuesta X" / "costo de X" → buscar en food_cost. Si no hay, decir donde encontrarlo
- Cualquier nombre → buscar en TODOS los datos

MAPA DE DATOS DISPONIBLES:
Lo que SI tienes:
- Ventas diarias (brutas, netas, por mesero, por grupo, por platillo) — DATOS REALES
- Ordenes (tickets_count), personas (personas_restaurant), ticket promedio — DATOS REALES
- IMPORTANTE fórmulas (mismas que la app de Wansoft y el dashboard):
  * Promedio POR ORDEN = ventas / ordenes ← este es "ticket promedio" / ticket_promedio_restaurant
  * Promedio POR PERSONA = ventas / personas (solo si piden explícitamente "por persona")
- IMPORTANTE conteo de HOY: la app de Wansoft cuenta ordenes/personas CERRADAS + ABIERTAS.
  Si existe "ordenes_abiertas_ahora" en los datos, súmalo a los totales de por_tipo_orden
  para ordenes y personas de hoy (y su monto a las ventas en curso).
- Metodos de pago (conteo de transacciones + pesos) — DATOS REALES
- Efectivo y tarjeta en PESOS (historico diario) — DATOS REALES
- Mesero x categoria: H&H, Pan, Postres, 2da Bebida, bebidas por persona — DATOS REALES
- Historico diario de hasta 90 dias — DATOS REALES
- Descuentos y cortesias (resumen diario) — DATOS REALES
- Cancelaciones y anulaciones — DATOS REALES
- Food cost por platillo (costo, margen, recetas con ingredientes) — DATOS REALES
- Propinas por mesero — DATOS REALES (cuando hay datos del dia)
- Inventario (existencias, criticos, proveedores) — DATOS REALES
- Clima actual y pronostico 3 dias (temperatura, lluvia, descripcion) — DATOS REALES
- Reservaciones proximas — DATOS REALES
- Ventas por hora del dia — cuando Wansoft lo reporta

IMPORTANTE sobre ventas "a cierta hora":
- Los datos que tienes son el CONSOLIDADO del dia hasta el momento del ultimo sync.
- NO tienes snapshots por hora. Si preguntan "cuanto llevabamos a las 2pm", di que solo tienes el consolidado actual y la hora del ultimo sync.

Lo que NO tienes:
- Ventas acumuladas a una hora especifica del pasado → "Solo tengo el consolidado del dia. No tengo snapshots por hora."
- Detalle de una orden especifica → "Revisa en Wansoft > Reportes > Ingresos > Detalle de ticket"
- Promociones activas → "Revisa en Wansoft > Punto de venta > Restaurante > Promociones"

SUPERVISORES: {_supervisor_str}
Cuando pregunten por "supervisores" o "encargados", filtrar SOLO estos nombres de los datos de meseros/ventas. Un supervisor también vende — sus ventas aparecen en ventas_por_mesero y waiter_categories igual que cualquier mesero. Si preguntan "ticket promedio por supervisor", calcular usando SOLO los datos de estos nombres.

FORMATO: Moneda SIEMPRE en pesos mexicanos MXN. Usa $ sin decimales. NUNCA JAMAS digas "dólares", "USD", "dollars" — todo es PESOS MEXICANOS. Texto plano para Telegram, sin markdown, sin asteriscos, sin ##, sin **. EXCLUIR de rankings: {_exclude_str}
"""


def ask_groq(question, wansoft_data, historical_data):
    wd = dict(wansoft_data)
    platillos = wd.pop("platillos_vendidos", [])
    date_range = wd.get("date_range", "hoy")

    # Smart search: find platillos matching the question
    q_lower = question.lower()
    skip_words = {"hoy", "ayer", "cuántos", "cuantos", "cuánto", "cuanto", "cuántas",
                  "cuantas", "cuánta", "cuanta", "vendieron", "vendió", "vendio",
                  "vendido", "vendidos", "vendida", "vendidas", "vendimos", "venta",
                  "ventas", "qué", "que", "cómo", "como", "los", "las", "del",
                  "por", "para", "con", "sin", "hay", "tiene", "fueron", "total", "todos",
                  "mes", "semana", "día", "dia", "han", "sido", "este", "esta", "van",
                  "lleva", "llevamos", "enero", "febrero", "marzo", "abril", "mayo",
                  "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
                  "diciembre"}
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
    # Build keyword list: universal + client-specific signature items
    _sig_items = [s.lower() for s in (CLIENT.get("signature_items") or ["chilaquile", "h&h", "half"])]
    cat_keywords = _sig_items + [
                    "pan", "toast", "bagel", "postre", "dessert", "2da bebida",
                    "segunda bebida", "bebida", "bebidas por persona", "categoría", "categoria",
                    "pizza", "enchilada", "café", "cafe", "latte", "paella", "croqueta",
                    "tapa", "tapas", "vino", "pulpo", "solomillo", "arroz",
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
        _excl_lower = [e.lower() for e in _exclude_names] + ["mesero evento", "aplicaciones"]
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
            _excl_lower = [e.lower() for e in _exclude_names] + ["mesero evento", "aplicaciones"]
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

            # Supervisor summary (if configured)
            if _supervisor_names:
                _sup_lower = [s.lower() for s in _supervisor_names]
                sup_data = {m: d for m, d in all_meseros.items()
                            if any(s in m.lower() for s in _sup_lower)}
                if sup_data:
                    rankings.append("\nRESUMEN SUPERVISORES:")
                    for m, d in sorted(sup_data.items(), key=lambda x: -x[1].get("ticket_promedio", 0)):
                        tp = d.get("ticket_promedio", 0)
                        tickets = d.get("tickets", 0)
                        personas = d.get("personas", 0)
                        rankings.append(f"  {m}: TP ${tp:,.0f}, {tickets} tickets, {personas} personas")

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
        blocks.append(f"PLATILLOS QUE COINCIDEN CON LA BÚSQUEDA ({len(relevant_platillos)}) — "
                      f"'cantidad' y 'total' son ACUMULADOS de TODO el periodo {date_range}. "
                      f"Para responder cuántas piezas se vendieron de un producto, SUMA las "
                      f"cantidades de las variantes que coincidan. Estos datos SÍ incluyen "
                      f"productos del Market:\n"
                      + json.dumps(relevant_platillos[:50], ensure_ascii=False, indent=1))

    # Block 2: Core sales data (compact) — include propinas + food cost
    core = {
        "ventas_consolidadas": wd.get("ventas_consolidadas"),
        "por_tipo_orden": wd.get("por_tipo_orden"),
        "ventas_por_mesero": wd.get("ventas_por_mesero"),
        "ventas_por_grupo": wd.get("ventas_por_grupo"),
        "metodos_pago": wd.get("metodos_pago"),
        "propinas_meseros": wd.get("propinas_meseros"),
        "propinas_total": wd.get("propinas_total"),
    }
    # Add food cost if available — prioritize recipes matching the question so
    # the bot never says "no está en el costeo" for a dish we DO have
    def _fc_slice(items, limit=40):
        def _name(it):
            return str(it.get("nombre") or it.get("platillo") or "").lower()
        matching = [it for it in items if any(t in _name(it) for t in search_terms)]
        rest = [it for it in items if it not in matching]
        # Priced dishes first (extras with precio 0 last)
        rest.sort(key=lambda it: -float(it.get("precio_venta") or it.get("subtotal_venta") or 0))
        return (matching + rest)[:limit]

    if wd.get("food_cost"):
        core["food_cost"] = _fc_slice(wd["food_cost"])
    elif wd.get("food_cost_supabase"):
        core["food_cost"] = _fc_slice(wd["food_cost_supabase"])
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

    # Block 3b: CRITICAL — smart extraction based on question keywords
    cost_block = {}

    # Always include compact summaries
    if "ingredientes" in wd:
        ing_data = wd["ingredientes"]
        # Only send top 15 most expensive + summary stats
        cost_block["ingredientes_resumen"] = {
            "total": ing_data.get("total", 0),
            "con_costo": ing_data.get("con_costo", 0),
            "proveedores": ing_data.get("proveedores", []),
            "top_15_por_costo": ing_data.get("top_costos", [])[:15],
        }

    if "inventario" in wd:
        cost_block["inventario"] = wd["inventario"]

    if "agentes" in wd:
        cost_block["agentes"] = wd["agentes"]

    if "reservaciones" in wd:
        cost_block["reservaciones"] = wd["reservaciones"]

    if "clima" in wd:
        cost_block["clima"] = wd["clima"]

    # Smart: only include detailed data if question is about that topic
    keyword_map = {
        "purchases_by_product": ["compr", "compra", "proveedor", "gast", "kilo"],
        "materia_prima": ["materia", "ingrediente", "merma", "rendimiento", "yield"],
        "recetas_costeo": ["receta", "ingrediente", "porcion"],
        "costeo_por_platillo": ["costo", "costeo", "margen", "precio", "food cost", "cuanto cuesta", "cuánto cuesta", "cuesta", "platillo", "receta", "chilaquil", "pancake", "waffle", "toast", "acai", "bowl", "pasta", "panini", "ensalada", "sopa", "postre"],
        "tips_raw": ["propina", "tip"],
        "discounts_detail": ["descuento", "discount"],
        "discounts_total": ["descuento"],
        "courtesies": ["cortesia", "cortesía", "comps"],
        "courtesies_total": ["cortesia", "cortesía"],
        "cancel_sales": ["cancelaci", "cancela"],
        "voids": ["anulaci", "anula", "void"],
        "closing_cash_mega": ["corte", "caja", "cierre", "efectivo"],
        "hours_worked": ["hora", "asistencia", "entrada", "salida", "turno"],
        "sales_terminal": ["terminal", "punto de venta"],
        "modifiers_sold": ["modificador", "extra", "sin "],
        "proveedores_gasto": ["proveedor", "gasto", "compra"],
        "food_cost_data": ["food cost", "costo", "margen"],
        "propinas_detalle": ["propina", "tip"],
        "clima": ["clima", "tiempo", "lluvia", "llover", "temperatura", "calor", "frio", "pronostico", "pronóstico", "weather"],
    }

    for key, keywords in keyword_map.items():
        if key in wd and wd[key]:
            if any(kw in q_lower for kw in keywords):
                data = wd[key]
                # Truncate lists to max 30 items
                if isinstance(data, list) and len(data) > 30:
                    data = data[:30]
                elif isinstance(data, dict) and "Result" in data:
                    data["Result"] = data["Result"][:30]
                cost_block[key] = data

    if cost_block:
        cost_json = json.dumps(cost_block, ensure_ascii=False, indent=1)
        # Hard cap at 25000 chars for this block
        if len(cost_json) > 25000:
            cost_json = cost_json[:25000] + "\n... (truncado)"
        blocks.insert(1, "COSTOS, INVENTARIO, COMPRAS, AGENTES, RESERVACIONES:\n" + cost_json)

    # Block 4: Top platillos (always useful)
    blocks.append(f"TOP 20 PLATILLOS (de {len(platillos)} distintos):\n"
                  + json.dumps(platillos[:20], ensure_ascii=False, indent=1))

    # Block 5: Historical
    hist_keywords = ["historial", "historia", "abril", "marzo", "últimos", "ultimos", "mejorado", "tendencia", "comparar", "semana pasada", "semana anterior"]
    wants_history = any(kw in q_lower for kw in hist_keywords)
    hist_limit = 90 if wants_history else 7

    # Check if question asks about a specific category (Bakery, Coffee, etc.)
    category_keywords = {
        "bakery": "BAKERY", "coffee": "COFFEE HOT/ICE", "cafe": "COFFEE HOT/ICE",
        "chilaquile": "CHILAQUILES & ENCHILADAS", "eggs": "EGGS & KETO", "keto": "EGGS & KETO",
        "toast": "TOAST & BAGELS", "bagel": "TOAST & BAGELS", "pan": "TOAST & BAGELS",
        "smoothie": "SMOOTHIES", "juice": "JUGOS", "jugo": "JUGOS",
        "pizza": "PIZZAS & PASTAS", "pasta": "PIZZAS & PASTAS",
        "postre": "DESSERTS", "dessert": "DESSERTS", "postres": "DESSERTS",
        "croissant": "CROISSANTS BREAKFAST", "panini": "PANINIS",
        "bowl": "BOWLS", "signature": "SIGNATURE", "fresh": "FRESH DRINKS",
        "frappe": "FRAPPES", "pancake": "PANCAKES & WAFFLES", "waffle": "PANCAKES & WAFFLES",
        "soda": "SODAS", "tea": "TEA & TISANAS", "alcohol": "BEBIDAS OH",
        "market": "HEALTHY SNACKS & MARKET",
    }
    asked_category = None
    for kw, cat_name in category_keywords.items():
        if kw in q_lower:
            asked_category = cat_name
            break

    if historical_data:
        if wants_history:
            hist_lines = ["HISTÓRICO DIARIO:"]
            for r in reversed(historical_data[:hist_limit]):
                tp = r.get("ticket_promedio_restaurant")
                ventas = r.get("ventas_dia", 0)
                line = f"  {r['fecha']}: Ventas ${round(ventas or 0):,} | TP ${round(tp or 0)}"

                # Add category data if asked
                if asked_category:
                    grupos = r.get("ventas_por_grupo", [])
                    if isinstance(grupos, str):
                        try: grupos = json.loads(grupos)
                        except: grupos = []
                    # Use sum of all groups as denominator (same as Wansoft)
                    total_grupos = sum(g.get("total", 0) for g in (grupos or []))
                    for g in (grupos or []):
                        if g.get("nombre", "").upper() == asked_category.upper():
                            pct = (g["total"] / total_grupos * 100) if total_grupos > 0 else 0
                            line += f" | {asked_category}: ${round(g['total']):,} ({pct:.1f}%)"
                            break

                hist_lines.append(line)
            print(f"[wansoft-query] History block: {len(hist_lines)-1} days, cat={asked_category}")
            blocks.insert(1, "\n".join(hist_lines))
        else:
            # Include propinas and pago_metodos in historical for cash/tips queries
            wants_propinas = any(kw in q_lower for kw in ["propina", "tip", "propinas"])
            wants_pago = any(kw in q_lower for kw in ["efectivo", "tarjeta", "cash", "card", "pago", "metodo", "método"])

            hist_compact = []
            sum_efectivo = 0
            sum_tarjeta = 0
            sum_propinas = 0
            for r in historical_data[:hist_limit]:
                entry = {"fecha": r.get("fecha"), "ventas": r.get("ventas_dia"),
                         "ticket_prom": r.get("ticket_promedio_restaurant")}
                if wants_propinas:
                    pt = float(r.get("propinas_total") or 0)
                    entry["propinas_total"] = pt
                    sum_propinas += pt
                if wants_pago:
                    ef = float(r.get("efectivo") or 0)
                    tj = float(r.get("tarjeta") or 0)
                    entry["efectivo_mxn"] = ef
                    entry["tarjeta_mxn"] = tj
                    sum_efectivo += ef
                    sum_tarjeta += tj
                    pm = r.get("pago_metodos")
                    if isinstance(pm, str):
                        try: pm = json.loads(pm)
                        except: pm = None
                    entry["pago_metodos_transacciones"] = pm
                hist_compact.append(entry)

            # Pre-calculate totals so LLM doesn't have to sum
            summary_line = f"HISTÓRICO ({len(hist_compact)} días)"
            if wants_pago and (sum_efectivo > 0 or sum_tarjeta > 0):
                total_pagos = sum_efectivo + sum_tarjeta
                pct_ef = (sum_efectivo / total_pagos * 100) if total_pagos > 0 else 0
                pct_tj = (sum_tarjeta / total_pagos * 100) if total_pagos > 0 else 0
                summary_line += f"\nTOTAL EFECTIVO PERIODO: ${round(sum_efectivo):,} ({pct_ef:.0f}%)"
                summary_line += f"\nTOTAL TARJETA PERIODO: ${round(sum_tarjeta):,} ({pct_tj:.0f}%)"
                summary_line += f"\nTOTAL COBRADO: ${round(total_pagos):,}"
            if wants_propinas and sum_propinas > 0:
                summary_line += f"\nTOTAL PROPINAS PERIODO: ${round(sum_propinas):,}"

            blocks.append(summary_line + "\n" + json.dumps(hist_compact, ensure_ascii=False, indent=1))

    # Assemble context — cap at 25000 chars (Groq has 32K limit, leave room for system prompt)
    context = ""
    for i, block in enumerate(blocks):
        if len(context) + len(block) > 25000:
            print(f"[wansoft-query] Block {i} truncated ({len(block)} chars)")
            break
        context += block + "\n\n"
    print(f"[wansoft-query] Context size: {len(context)} chars, {len(blocks)} blocks")
    # Debug: show block sizes
    for i, block in enumerate(blocks):
        print(f"[wansoft-query] Block {i}: {len(block)} chars, starts with: {block[:60]}...")

    context += f"PREGUNTA: {question}"

    # Claude Haiku FIRST (sees the FULL context — Groq's 5K trim dropped the
    # DATOS CORE block entirely on 2026-06-12 and the bot told Monica
    # "Aún no hay datos de hoy" with the data right there). Groq is fallback only.
    answer = None
    try:
        if not ANTHROPIC_API_KEY:
            raise Exception("no ANTHROPIC_API_KEY")
        r = requests.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                     "Content-Type": "application/json"},
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 4000,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": context}],
            }, timeout=90)
        r.raise_for_status()
        answer = r.json()["content"][0]["text"].strip()
        print("[wansoft-query] Answered via Anthropic (Haiku, full context)")
    except Exception as e1:
        print(f"[wansoft-query] Anthropic failed: {e1}, trying Groq fallback...")
        # Trim context for Groq: max ~5K chars to stay under 6K token limit.
        # NOTE: blocks bigger than 5K get dropped whole — fallback quality is degraded.
        groq_context = context
        if len(context) > 5000:
            ctx_blocks = context.split("\n\n")
            essential = []
            total = 0
            for b in ctx_blocks:
                bl = b.lower()
                if any(kw in bl for kw in ["datos core", "histórico", "ranking", "pregunta"]):
                    if total + len(b) < 5000:
                        essential.append(b)
                        total += len(b)
            groq_context = "\n\n".join(essential) if essential else context[:5000]
            print(f"[wansoft-query] Trimmed context for Groq: {len(context)} → {len(groq_context)} chars")
        try:
            r = requests.post("https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT[:3000]},  # Trim system prompt too
                        {"role": "user", "content": groq_context},
                    ],
                    "temperature": 0.2, "max_tokens": 2000,
                }, timeout=30)
            r.raise_for_status()
            answer = r.json()["choices"][0]["message"]["content"].strip()
            print("[wansoft-query] Answered via Groq (fallback)")
        except Exception as e2:
            print(f"[wansoft-query] Both failed: {e2}")
            answer = "Estamos con intermitencia. Intenta de nuevo en 5 minutos."

    # Post-processing: strip markdown that Telegram can't render
    answer = answer.replace("**", "").replace("##", "").replace("# ", "")
    answer = answer.replace("```", "").replace("`", "")
    # Replace "dólares" / "dollars" / "USD" just in case LLM slips
    for bad_word in ["dólares", "dolares", "dollars", "USD"]:
        answer = answer.replace(bad_word, "pesos")

    return answer


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
    if _audit:
        _audit.log_start()

    if not MESSAGE:
        print("[wansoft-query] No message provided")
        sys.exit(0)

    # SECURITY: sanitize user input
    safe_message = MESSAGE[:MAX_MESSAGE_LENGTH]
    if DANGEROUS_PATTERNS.search(safe_message):
        print(f"[SECURITY] BLOCKED dangerous pattern in message: {safe_message[:80]}")
        if _audit:
            _audit.log_error(f"BLOCKED: dangerous SQL pattern in user input", [])
        send_telegram("No puedo procesar esa consulta.")
        sys.exit(0)

    print(f"[wansoft-query] Question: {safe_message[:100]}")

    try:
        # Detect date range from question
        print("[wansoft-query] Detecting date range...")
        start_date, end_date = detect_date_range(safe_message)
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

        # Fetch inventory, costs, agents, reservations
        print("[wansoft-query] Fetching inventory & costs...")
        extra_data = fetch_inventory_and_costs()
        wansoft_data.update(extra_data)

        platillos_count = wansoft_data.get("total_platillos_distintos", 0)
        meseros_count = len(wansoft_data.get("ventas_por_mesero", []))
        print(f"[wansoft-query] Data: {meseros_count} meseros, {platillos_count} platillos, range={start_date}..{end_date}")
        print(f"[wansoft-query] Extra: ingredientes={len(extra_data.get('ingredientes', {}).get('top_costos', []))}, inv_criticos={extra_data.get('inventario', {}).get('criticos', 0)}, agentes={len(extra_data.get('agentes', {}))}, reservas={len(extra_data.get('reservaciones', []))}")

        # Ask Groq to answer
        print("[wansoft-query] Asking Groq...")
        answer = ask_groq(safe_message, wansoft_data, historical)

        # Send to Telegram
        send_telegram(answer)
        print(f"[wansoft-query] Sent response ({len(answer)} chars)")

        duration = int((time.time() - start_time) * 1000)
        log_run("success", duration, f"Q: {safe_message[:100]} A: {answer[:100]}")
        log_query(safe_message, answer, wansoft_data, start_date, end_date, "success")
        if _audit:
            _audit.log_read(["wansoft_daily", "wansoft_kpis", "wansoft_data", "pos_ingredients", "pos_inventory"])
            _audit.log_end(duration, f"Q: {safe_message[:60]}")

    except Exception as e:
        duration = int((time.time() - start_time) * 1000)
        log_run("error", duration, error=str(e))
        send_telegram(f"Error consultando Wansoft: {e}")
        print(f"[wansoft-query] ERROR: {e}")
        log_query(safe_message, str(e), {}, "", "", "error")
        if _audit:
            _audit.log_error(str(e)[:200])
        sys.exit(1)


def log_query(question, answer, data_available, start_date, end_date, status):
    """Log query details for self-improvement. Detects gaps in data coverage."""
    try:
        # Detect what data was missing
        missing = []
        q_lower = question.lower()

        # Check if question asked about food cost but we had no data
        if any(kw in q_lower for kw in ["costo", "cost", "margen", "food cost", "receta"]):
            if not data_available.get("food_cost") and not data_available.get("food_cost_supabase"):
                missing.append("food_cost")

        # Check if question asked about discounts/cortesias
        if any(kw in q_lower for kw in ["descuento", "cortesia", "cortesía", "discount"]):
            if not data_available.get("descuentos_detalle"):
                missing.append("discounts_detail")

        # Check if question asked about inventory
        if any(kw in q_lower for kw in ["inventario", "stock", "falta", "reorden"]):
            if not data_available.get("inventario_punto_reorden"):
                missing.append("inventory")

        # Check if question asked about promotions
        if any(kw in q_lower for kw in ["promo", "promocion", "promoción"]):
            missing.append("promotions")

        # Check if answer contains "no tengo" or "no encuentro" (bot couldn't answer)
        if any(phrase in answer.lower() for phrase in ["no tengo", "no encuentro", "no cuento con",
                                                        "no disponible", "no hay datos"]):
            missing.append("answer_incomplete")

        # Log to agent_runs with detail
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs",
            headers={**sb_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={
                "agent_id": "wansoft-query-feedback",
                "trigger_type": "auto",
                "status": status,
                "duration_ms": 0,
                "output_summary": json.dumps({
                    "question": question[:200],
                    "answer_preview": answer[:200],
                    "missing_data": missing,
                    "data_keys_available": [k for k in data_available.keys() if data_available[k]],
                    "date_range": f"{start_date}..{end_date}",
                }, ensure_ascii=False)[:500],
                "tentacle": "kb",
            })

        if missing:
            print(f"[wansoft-query] FEEDBACK: missing data for this query: {missing}")

    except Exception as e:
        print(f"[wansoft-query] Feedback log error: {e}")


if __name__ == "__main__":
    main()
