#!/usr/bin/env python3
"""
Wansoft Recipe Scraper — extrae TODAS las recetas de platillos.

Endpoints reales (descubiertos via ScriptsViews/Production/SaucerRecipe.js):
  - Menu/GetSaucerAndComplementaryListBySubsidiary  POST {subsidiaryId} → lista de platillos
  - Production/GetSaucerRecipe  POST {subsidiaryId, saucerId, sizeId} → ingredientes
  - Inventory/GetRecipeProductsBySubsidiary  POST {subsidiaryId} → catálogo de insumos
  - Inventory/GetUnitsOfMeasureBySubsidiary  POST {subsidiaryId} → unidades de medida

Guarda recetas en wansoft_recipes y catálogos en wansoft_data.
Run on-demand via GitHub Actions (workflow_dispatch).
"""

import os
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


def post_json(session, path, data):
    """POST a un endpoint AJAX de Wansoft, regresa JSON o None."""
    try:
        r = session.post(f"{WANSOFT_URL}/{path}", data=data, timeout=30)
        if r.status_code != 200:
            print(f"    [!] {path}: status={r.status_code}")
            return None
        try:
            return r.json()
        except ValueError:
            # Algunos endpoints regresan HTML con tabla
            soup = BeautifulSoup(r.text, "html.parser")
            rows = []
            for tr in soup.select("table tr"):
                cols = [td.text.strip() for td in tr.select("td")]
                if cols and any(cols):
                    rows.append(cols)
            return rows or None
    except Exception as e:
        print(f"    [!] {path}: {e}")
        return None


def pick_keys(item, id_names, name_names):
    """Encuentra keys de id/nombre en un dict (case-insensitive)."""
    if not isinstance(item, dict):
        return None, None
    keys = {k.lower(): k for k in item}
    id_key = next((keys[n] for n in id_names if n in keys), None)
    name_key = next((keys[n] for n in name_names if n in keys), None)
    return id_key, name_key


# ── Saucer list ─────────────────────────────────────────────────────────────

def get_saucers(session):
    data = post_json(session, "Menu/GetSaucerAndComplementaryListBySubsidiary",
                     {"subsidiaryId": SUBSIDIARY_ID})
    if not data:
        return []
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and v:
                data = v
                break
    if not isinstance(data, list) or not data:
        return []
    print(f"[Saucers raw] {len(data)} items. Sample: {json.dumps(data[0], ensure_ascii=False, default=str)[:300]}")
    id_key, name_key = pick_keys(data[0],
                                 ("id", "saucerid", "value", "saucer_id"),
                                 ("name", "nombre", "text", "description", "saucername"))
    if not id_key or not name_key:
        print(f"    [!] No identifiqué keys id/nombre. Keys: {list(data[0].keys()) if isinstance(data[0], dict) else type(data[0])}")
        return []
    return [(str(i[id_key]), str(i[name_key]).strip(), i) for i in data if isinstance(i, dict)]


# ── Recipe per saucer ───────────────────────────────────────────────────────

def get_recipe(session, saucer_id, size_id=0):
    data = post_json(session, "Production/GetSaucerRecipe", {
        "subsidiaryId": SUBSIDIARY_ID,
        "saucerId": saucer_id,
        "sizeId": size_id,
    })
    if not data:
        return None, None
    raw = data
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                data = v
                break
    if isinstance(data, list) and data:
        return data, raw
    return None, raw


def sb_upsert_recipe(saucer_id, name, ingredients, raw, extra):
    budget = None
    for source in (raw if isinstance(raw, dict) else {}, extra if isinstance(extra, dict) else {}):
        for k in source:
            if "cost" in k.lower() or "costo" in k.lower():
                budget = safe_float(source[k])
                break
        if budget is not None:
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


# ── Catálogos (insumos + unidades) → wansoft_data ───────────────────────────

def save_catalog(session, path, data_key):
    data = post_json(session, path, {"subsidiaryId": SUBSIDIARY_ID})
    if not data:
        print(f"[Catalog] {data_key}: sin datos")
        return 0
    items = data
    if isinstance(items, dict):
        for v in items.values():
            if isinstance(v, list) and v:
                items = v
                break
    n = len(items) if isinstance(items, list) else 1
    print(f"[Catalog] {data_key}: {n} items. Sample: {json.dumps(items[0] if isinstance(items, list) else items, ensure_ascii=False, default=str)[:200]}")
    row = {
        "client_id": CLIENT["id"],
        "fecha": datetime.now(timezone.utc).date().isoformat(),
        "data_key": data_key,
        "data": json.dumps(items, ensure_ascii=False, default=str),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_data?on_conflict=client_id,fecha,data_key",
        headers=sb_headers, json=row, timeout=15,
    )
    if not r.ok:
        print(f"    [!] Supabase wansoft_data: {r.status_code} {r.text[:150]}")
        return 0
    return n


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
    # Visitar la página primero (algunos endpoints requieren la sesión "activada")
    session.get(f"{WANSOFT_URL}/Production/SaucerRecipe", timeout=30)

    # Catálogos
    n_products = save_catalog(session, "Inventory/GetRecipeProductsBySubsidiary", "recipe_products")
    n_units = save_catalog(session, "Inventory/GetUnitsOfMeasureBySubsidiary", "units_of_measure")

    # Platillos
    saucers = get_saucers(session)
    if not saucers:
        msg = "Recipe scraper: Menu/GetSaucerAndComplementaryListBySubsidiary no regresó platillos."
        print(f"[FAIL] {msg}")
        telegram(f"⚠️ {msg}")
        log_run("error", "no saucer list", int((time.time() - start) * 1000))
        return
    print(f"\n[Total] {len(saucers)} platillos")

    ok, empty, fail = 0, 0, 0
    for i, (sid, sname, extra) in enumerate(saucers):
        ingredients, raw = get_recipe(session, sid)
        if ingredients:
            if sb_upsert_recipe(sid, sname, ingredients, raw, extra):
                ok += 1
                if ok <= 3:
                    print(f"    Sample ingrediente: {json.dumps(ingredients[0], ensure_ascii=False, default=str)[:250]}")
                print(f"  [{i+1}/{len(saucers)}] {sname}: {len(ingredients)} ingredientes")
            else:
                fail += 1
        else:
            empty += 1
        time.sleep(0.25)

    dur = int((time.time() - start) * 1000)
    summary = (f"Recetas Wansoft: {ok} guardadas, {empty} sin receta, {fail} errores "
               f"(de {len(saucers)} platillos). Catálogos: {n_products} insumos, {n_units} unidades.")
    print(f"\n[DONE] {summary}")
    telegram(f"📖 {summary}")
    log_run("success" if ok > 0 else "error", summary, dur)


if __name__ == "__main__":
    main()
