#!/usr/bin/env python3
"""
Wansoft Recipe Scraper — extrae TODAS las recetas de platillos
desde Production/SaucerRecipe (Inventario / Configuración / Receta de platillos).

Fase 1 (discovery): carga la página, encuentra el dropdown de platillos y
los endpoints AJAX que usa (lista de platillos + ingredientes por platillo).
Fase 2 (scrape): pide la receta de cada platillo y guarda en wansoft_recipes.

Run on-demand via GitHub Actions (workflow_dispatch).
"""

import os
import re
import json
import time
import requests
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_tz, get_wansoft_creds

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT = get_client()
SUBSIDIARY_ID, WANSOFT_USER, WANSOFT_PASS = get_wansoft_creds(CLIENT)
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL", "")

sb_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def wansoft_session():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/")
    resp = s.post(f"{WANSOFT_URL}/", data={
        "UserName": WANSOFT_USER,
        "Password": WANSOFT_PASS,
    }, allow_redirects=True)
    if "Dashboard" not in resp.url and "MyDocumentsList" not in resp.url:
        raise Exception(f"Wansoft login failed. URL: {resp.url}")
    print("[OK] Login")
    return s


def safe_float(val):
    try:
        return float(str(val).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


# ── Fase 1: Discovery ───────────────────────────────────────────────────────

def extract_urls(text):
    """Extrae rutas AJAX relevantes de HTML/JS. Excluye assets estáticos."""
    urls = set()
    for m in re.finditer(r"""["'](/?(?:Wansoft\.Web/)?[A-Za-z0-9_]+/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)?)["']""", text):
        u = m.group(1).lstrip("/").replace("Wansoft.Web/", "")
        if u.endswith((".js", ".css", ".png", ".gif")) or "ScriptsViews" in u or "Content/" in u or "Scripts/" in u:
            continue
        if any(k in u for k in ("Saucer", "Recipe", "Ingredient", "Product", "Complement", "Get", "Load", "Search")):
            urls.add(u)
    return urls


def discover(session):
    """Carga la página SaucerRecipe + su JS y descubre dropdown + endpoints AJAX."""
    r = session.get(f"{WANSOFT_URL}/Production/SaucerRecipe", timeout=30)
    html = r.text
    print(f"[Page] status={r.status_code} len={len(html)}")

    soup = BeautifulSoup(html, "html.parser")

    # 1) Opciones server-rendered en selects (ignorando el de sucursal)
    saucers = []
    for sel in soup.select("select"):
        sel_id = (sel.get("id") or "") + (sel.get("name") or "")
        if "subsidiary" in sel_id.lower():
            continue
        opts = [(o.get("value", "").strip(), o.text.strip()) for o in sel.select("option")]
        opts = [(v, t) for v, t in opts if v and v != "0"]
        if len(opts) > len(saucers):
            saucers = opts
            print(f"[Select] id={sel.get('id')} name={sel.get('name')} → {len(opts)} options")

    # 2) URLs AJAX en la página
    urls = extract_urls(html)

    # 3) Bajar los JS de ScriptsViews referenciados (ahí vive la lógica AJAX real)
    js_files = set(re.findall(r"""["']([^"']*ScriptsViews/[A-Za-z0-9_/\.]+\.js)["']""", html))
    for js in sorted(js_files):
        js_path = js.lstrip("/").replace("Wansoft.Web/", "")
        try:
            jr = session.get(f"{WANSOFT_URL}/{js_path}", timeout=30)
            print(f"[JS] {js_path} status={jr.status_code} len={len(jr.text)}")
            if jr.status_code == 200:
                urls |= extract_urls(jr.text)
                # Dump de llamadas ajax para debugging (url + data cercana)
                for m in re.finditer(r"""(?:\$\.(?:ajax|post|get|getJSON)|url\s*:)""", jr.text):
                    snippet = jr.text[m.start():m.start() + 220].replace("\n", " ")
                    snippet = re.sub(r"\s+", " ", snippet)
                    print(f"    [ajax] {snippet[:200]}")
        except Exception as e:
            print(f"    [!] {js_path}: {e}")

    print(f"[Discovery] URLs candidatas:")
    for u in sorted(urls):
        print(f"    - {u}")

    # 4) Inputs ocultos / config útil (subsidiary, tokens)
    hidden = {i.get("name") or i.get("id"): i.get("value", "") for i in soup.select("input[type=hidden]")}
    if hidden:
        print(f"[Hidden inputs] {json.dumps({k: v[:40] for k, v in hidden.items() if k}, ensure_ascii=False)}")

    return saucers, sorted(urls), html


def try_endpoint(session, path, params, method="POST"):
    """Llama un endpoint y regresa JSON o filas HTML si hay datos reales."""
    try:
        url = f"{WANSOFT_URL}/{path}"
        r = session.post(url, data=params, timeout=30) if method == "POST" else session.get(url, params=params, timeout=30)
        if r.status_code != 200:
            return None
        try:
            data = r.json()
            if data and data != [] and data != {}:
                return {"type": "json", "data": data}
        except ValueError:
            pass
        soup = BeautifulSoup(r.text, "html.parser")
        rows = []
        for tr in soup.select("table tr"):
            cols = [td.text.strip() for td in tr.select("td")]
            if cols and any(cols):
                rows.append(cols)
        if not rows:
            for row in soup.select(".rowReport"):
                cols = [c.text.strip() for c in row.select("div")]
                if cols and any(cols):
                    rows.append(cols)
        if rows:
            return {"type": "html", "data": rows}
    except Exception as e:
        print(f"    [!] {path}: {e}")
    return None


def get_saucer_list(session, saucers_from_page, discovered_urls):
    """Consigue la lista (id, nombre) de platillos."""
    if saucers_from_page:
        print(f"[Saucers] {len(saucers_from_page)} desde el select de la página")
        return saucers_from_page

    candidates = [u for u in discovered_urls if "Saucer" in u and "Recipe" not in u]
    candidates += [
        "Production/GetSaucers", "Production/GetAllSaucers",
        "Production/SaucerRecipe/GetSaucers", "Menu/GetSaucers",
        "Menu/GetSaucersBySubsidiary", "Catalogs/GetSaucers",
    ]
    for path in candidates:
        for method in ("POST", "GET"):
            res = try_endpoint(session, path, {"subsidiaryId": SUBSIDIARY_ID}, method)
            if res and res["type"] == "json" and isinstance(res["data"], list) and len(res["data"]) > 5:
                items = res["data"]
                # Detectar keys de id y nombre
                first = items[0]
                if isinstance(first, dict):
                    id_key = next((k for k in first if k.lower() in ("id", "saucerid", "value")), None)
                    name_key = next((k for k in first if k.lower() in ("name", "nombre", "text", "description")), None)
                    if id_key and name_key:
                        out = [(str(i[id_key]), str(i[name_key])) for i in items]
                        print(f"[Saucers] {len(out)} desde {method} {path}")
                        return out
    return []


RECIPE_PARAM_NAMES = ["saucerId", "SaucerId", "id", "Id", "saucer", "idSaucer"]


def find_recipe_endpoint(session, discovered_urls, sample_id):
    """Encuentra el endpoint+param que regresa los ingredientes de un platillo."""
    candidates = [u for u in discovered_urls if any(k in u for k in ("Recipe", "Ingredient"))]
    candidates += [
        "Production/GetSaucerRecipe", "Production/GetRecipeBySaucer",
        "Production/SaucerRecipe/GetRecipe", "Production/SaucerRecipe/GetIngredients",
        "Production/GetIngredientsBySaucer", "Production/GetRecipe",
    ]
    seen = set()
    for path in candidates:
        if path in seen or path == "Production/SaucerRecipe":
            continue
        seen.add(path)
        for pname in RECIPE_PARAM_NAMES:
            for method in ("POST", "GET"):
                params = {pname: sample_id, "subsidiaryId": SUBSIDIARY_ID}
                res = try_endpoint(session, path, params, method)
                if res and res["data"]:
                    # Validar que parece receta (lista con contenido)
                    d = res["data"]
                    if isinstance(d, dict):
                        for k, v in d.items():
                            if isinstance(v, list) and v:
                                d = v
                                break
                    # Validación: JSON con dicts, o HTML con filas de 2+ columnas reales
                    looks_real = False
                    if isinstance(d, list) and d:
                        if res["type"] == "json" and isinstance(d[0], dict):
                            looks_real = True
                        elif res["type"] == "html" and isinstance(d[0], list) and len(d[0]) >= 2 and "this." not in str(d[0]):
                            looks_real = True
                    if looks_real:
                        print(f"[Recipe endpoint] {method} {path} param={pname} → {len(d)} items ({res['type']})")
                        print(f"    Sample: {json.dumps(d[0], ensure_ascii=False, default=str)[:300]}")
                        return path, pname, method
    return None, None, None


def fetch_recipe(session, path, pname, method, saucer_id):
    res = try_endpoint(session, path, {pname: saucer_id, "subsidiaryId": SUBSIDIARY_ID}, method)
    if not res:
        return None, None
    data = res["data"]
    raw = data
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, list):
                data = v
                break
    return data, raw


def sb_upsert_recipe(saucer_id, name, ingredients, raw):
    budget = None
    if isinstance(raw, dict):
        for k in raw:
            if "cost" in k.lower() or "costo" in k.lower():
                budget = safe_float(raw[k])
                break
    row = {
        "client_id": CLIENT["id"],
        "saucer_id": str(saucer_id),
        "saucer_name": name,
        "budget_cost": budget,
        "ingredients": ingredients,
        "raw": raw,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_recipes?on_conflict=client_id,saucer_id",
        headers=sb_headers, json=row, timeout=15,
    )
    if not r.ok:
        print(f"    [!] Supabase: {r.status_code} {r.text[:150]}")
    return r.ok


def telegram(msg):
    if not TG_TOKEN or not TG_CHAT:
        return
    try:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                      json={"chat_id": TG_CHAT, "text": msg}, timeout=10)
    except Exception:
        pass


def log_run(status, detail, duration_ms):
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/agent_runs", headers=sb_headers, json={
            "agent_id": "wansoft-recipe-scraper", "tentacle": "ops",
            "status": status, "duration_ms": duration_ms,
            "detail": detail[:500],
        }, timeout=10)
    except Exception:
        pass


def main():
    start = time.time()
    print("=" * 60)
    print(f"WANSOFT RECIPE SCRAPER — client={CLIENT['id']} subsidiary={SUBSIDIARY_ID}")
    print("=" * 60)

    session = wansoft_session()

    saucers_page, urls, _html = discover(session)
    saucers = get_saucer_list(session, saucers_page, urls)
    if not saucers:
        msg = "Recipe scraper: no encontré la lista de platillos. Revisa logs de discovery."
        print(f"[FAIL] {msg}")
        telegram(f"⚠️ {msg}")
        log_run("error", "no saucer list", int((time.time() - start) * 1000))
        return

    print(f"\n[Total] {len(saucers)} platillos. Buscando endpoint de receta...")
    path, pname, method = None, None, None
    for sid, sname in saucers[:5]:
        path, pname, method = find_recipe_endpoint(session, urls, sid)
        if path:
            break
    if not path:
        msg = f"Recipe scraper: encontré {len(saucers)} platillos pero ningún endpoint de ingredientes respondió. URLs descubiertas: {', '.join(urls[:10])}"
        print(f"[FAIL] {msg}")
        telegram(f"⚠️ {msg}")
        log_run("error", "no recipe endpoint", int((time.time() - start) * 1000))
        return

    ok, empty, fail = 0, 0, 0
    for i, (sid, sname) in enumerate(saucers):
        ingredients, raw = fetch_recipe(session, path, pname, method, sid)
        if ingredients:
            if sb_upsert_recipe(sid, sname, ingredients, raw):
                ok += 1
                n = len(ingredients) if isinstance(ingredients, list) else "?"
                print(f"  [{i+1}/{len(saucers)}] {sname}: {n} ingredientes")
            else:
                fail += 1
        else:
            empty += 1
            print(f"  [{i+1}/{len(saucers)}] {sname}: sin receta")
        time.sleep(0.3)

    dur = int((time.time() - start) * 1000)
    summary = f"Recetas Wansoft: {ok} guardadas, {empty} sin receta, {fail} errores (de {len(saucers)} platillos)"
    print(f"\n[DONE] {summary}")
    telegram(f"📖 {summary}")
    log_run("success" if ok > 0 else "error", summary, dur)


if __name__ == "__main__":
    main()
