#!/usr/bin/env python3
"""
Wansoft SubProduct + Presentations Scraper.

1. Subproductos (Production/SubProductRecipe): lista de subproductos y la
   receta de cada uno. Endpoints descubiertos dinámicamente leyendo
   ScriptsViews/Production/SubProductRecipe.js (mismo patrón que SaucerRecipe).
2. Presentaciones (Inventory/Presentations): catálogo plano Clave + Presentación.

Guarda en wansoft_data:
  - subproduct_list        → [{id, name, ...raw}]
  - subproduct_recipes     → [{id, name, ingredients, raw}]
  - presentations_catalog  → [{...}]

Run on-demand via GitHub Actions (workflow_dispatch).
"""

import os
import json
import re
import time
import requests
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from client_config import get_client, get_wansoft_creds

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


def post_json(session, path, data):
    try:
        r = session.post(f"{WANSOFT_URL}/{path}", data=data, timeout=30)
        if r.status_code != 200:
            print(f"    [!] {path}: status={r.status_code}")
            return None
        try:
            return r.json()
        except ValueError:
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


def unwrap_list(data):
    """Si la respuesta es {key: [...]}, regresa la lista interna."""
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and v:
                return v
    return data if isinstance(data, list) else None


def pick_keys(item, id_names, name_names):
    if not isinstance(item, dict):
        return None, None
    keys = {k.lower(): k for k in item}
    id_key = next((keys[n] for n in id_names if n in keys), None)
    name_key = next((keys[n] for n in name_names if n in keys), None)
    return id_key, name_key


def save_data(data_key, items):
    row = {
        "client_id": CLIENT["id"],
        "fecha": datetime.now(timezone.utc).date().isoformat(),
        "data_key": data_key,
        "data": json.dumps(items, ensure_ascii=False, default=str),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/wansoft_data?on_conflict=client_id,fecha,data_key",
        headers=sb_headers, json=row, timeout=30,
    )
    if not r.ok:
        print(f"    [!] Supabase {data_key}: {r.status_code} {r.text[:150]}")
        return False
    print(f"  [saved] {data_key} ({len(items) if isinstance(items, list) else 1} items)")
    return True


# ── Endpoint discovery ──────────────────────────────────────────────────────

def discover_endpoints(session, js_path):
    """Lee un archivo JS de Wansoft y extrae rutas Controller/Action de los AJAX."""
    try:
        r = session.get(f"{WANSOFT_URL}/{js_path}", timeout=30)
        if r.status_code != 200:
            print(f"[discover] {js_path}: status={r.status_code}")
            return []
        # patrones: url: '/Wansoft.Web/Controller/Action' | url: "../Controller/Action" | Url.Action
        found = re.findall(r"""url\s*:\s*['"]([^'"]+)['"]""", r.text, re.IGNORECASE)
        found += re.findall(r"""['"](?:\.\./|/Wansoft\.Web/)?(\w+/(?:Get|Save|Load)\w+)['"]""", r.text)
        clean = []
        for u in found:
            u = u.split("?")[0].replace("/Wansoft.Web/", "").lstrip("./").lstrip("/")
            if re.fullmatch(r"\w+/\w+", u) and u not in clean:
                clean.append(u)
        print(f"[discover] {js_path}: {clean}")
        return clean
    except Exception as e:
        print(f"[discover] {js_path}: {e}")
        return []


# ── Subproductos ────────────────────────────────────────────────────────────

SUBPRODUCT_LIST_CANDIDATES = [
    "Production/GetSubProductListBySubsidiary",
    "Production/GetSubProductsBySubsidiary",
    "Inventory/GetSubProductsBySubsidiary",
    "Menu/GetSubProductListBySubsidiary",
]
SUBPRODUCT_RECIPE_CANDIDATES = [
    "Production/GetSubProductRecipe",
]


def get_subproducts(session, discovered):
    # 1) endpoints descubiertos en el JS que suenen a lista
    candidates = [e for e in discovered if "subproduct" in e.lower()
                  and "recipe" not in e.lower().split("/")[-1].replace("subproductrecipe", "")] \
        + SUBPRODUCT_LIST_CANDIDATES
    seen = set()
    for ep in candidates:
        if ep in seen or "get" not in ep.lower():
            continue
        seen.add(ep)
        data = unwrap_list(post_json(session, ep, {"subsidiaryId": SUBSIDIARY_ID}))
        if data and isinstance(data[0], (dict, list)):
            print(f"[Subproducts] via {ep}: {len(data)} items. Sample: {json.dumps(data[0], ensure_ascii=False, default=str)[:250]}")
            id_key, name_key = pick_keys(
                data[0] if isinstance(data[0], dict) else {},
                ("id", "subproductid", "value", "productid"),
                ("name", "nombre", "text", "description", "productname"))
            if id_key and name_key:
                return [(str(i[id_key]), str(i[name_key]).strip(), i)
                        for i in data if isinstance(i, dict)], ep

    # 2) fallback: opciones del <select> en el HTML de la página
    r = session.get(f"{WANSOFT_URL}/Production/SubProductRecipe", timeout=30)
    soup = BeautifulSoup(r.text, "html.parser")
    opts = []
    for sel in soup.select("select"):
        cur = [(o.get("value", ""), o.get_text(strip=True))
               for o in sel.select("option") if o.get("value")]
        if len(cur) > len(opts):
            opts = cur
    if opts:
        print(f"[Subproducts] via HTML select: {len(opts)} options")
        return [(v, t, {"id": v, "name": t}) for v, t in opts], "html_select"
    return [], None


def get_sub_recipe(session, sub_id, discovered):
    candidates = [e for e in discovered if "recipe" in e.lower() and "get" in e.lower()] \
        + SUBPRODUCT_RECIPE_CANDIDATES
    seen = set()
    for ep in candidates:
        if ep in seen:
            continue
        seen.add(ep)
        for payload in (
            {"subsidiaryId": SUBSIDIARY_ID, "subProductId": sub_id},
            {"subsidiaryId": SUBSIDIARY_ID, "subProductId": sub_id, "sizeId": 0},
            {"subsidiaryId": SUBSIDIARY_ID, "productId": sub_id},
        ):
            data = post_json(session, ep, payload)
            items = unwrap_list(data)
            if items:
                return items, data, ep
    return None, None, None


# ── Presentaciones ──────────────────────────────────────────────────────────

PRESENTATION_CANDIDATES = [
    "Inventory/GetPresentationsBySubsidiary",
    "Inventory/GetPresentations",
    "Inventory/GetProductPresentationsBySubsidiary",
    "Inventory/GetPresentationList",
]


def dump_js_context(session, js_path, needle):
    """Imprime el contexto alrededor de un endpoint en el JS para ver sus params."""
    try:
        r = session.get(f"{WANSOFT_URL}/{js_path}", timeout=30)
        idx = r.text.lower().find(needle.lower())
        if idx >= 0:
            print(f"[js-context] {js_path} @ {needle}:\n{r.text[max(0, idx-400):idx+600]}")
    except Exception as e:
        print(f"[js-context] {js_path}: {e}")


def normalize_grid_rows(data):
    """jqGrid regresa {total, page, records, rows: [{id, cell: [...]}]}."""
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        out = []
        for row in data["rows"]:
            if isinstance(row, dict) and isinstance(row.get("cell"), list):
                out.append({"id": row.get("id"), "cell": row["cell"]})
            else:
                out.append(row)
        return out
    return unwrap_list(data)


def get_presentations(session, discovered):
    candidates = [e for e in discovered if "presentation" in e.lower() and "get" in e.lower()] \
        + PRESENTATION_CANDIDATES
    jqgrid = {"page": 1, "rows": 2000, "sidx": "", "sord": "asc", "_search": "false",
              "nd": str(int(time.time() * 1000))}
    seen = set()
    for ep in candidates:
        if ep in seen:
            continue
        seen.add(ep)
        for payload in (
            {**jqgrid, "subsidiaryId": SUBSIDIARY_ID},
            jqgrid,
            {"subsidiaryId": SUBSIDIARY_ID},
            {},
        ):
            data = normalize_grid_rows(post_json(session, ep, payload))
            if data:
                print(f"[Presentations] via {ep}: {len(data)} items. Sample: {json.dumps(data[0], ensure_ascii=False, default=str)[:250]}")
                return data, ep
    dump_js_context(session, "ScriptsViews/Inventory/Presentations.js", "GetPresentationList")

    # fallback: tabla en el HTML de la página
    r = session.get(f"{WANSOFT_URL}/Inventory/Presentations", timeout=30)
    soup = BeautifulSoup(r.text, "html.parser")
    rows = []
    for tr in soup.select("table tr"):
        cols = [td.get_text(strip=True) for td in tr.select("td")]
        if len(cols) >= 2 and any(cols):
            rows.append({"clave": cols[0], "presentacion": cols[1]})
    if rows:
        print(f"[Presentations] via HTML table: {len(rows)} rows")
        return rows, "html_table"
    return [], None


# ── Telegram / log ──────────────────────────────────────────────────────────

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
            "agent_id": "wansoft-subproduct-scraper", "tentacle": "ops",
            "status": status, "duration_ms": duration_ms,
            "detail": detail[:500],
        }, timeout=10)
    except Exception:
        pass


def main():
    start = time.time()
    print("=" * 60)
    print(f"WANSOFT SUBPRODUCT + PRESENTATIONS SCRAPER — client={CLIENT['id']} subsidiary={SUBSIDIARY_ID}")
    print("=" * 60)

    session = wansoft_session()
    # Activar sesión visitando las páginas
    session.get(f"{WANSOFT_URL}/Production/SubProductRecipe", timeout=30)
    session.get(f"{WANSOFT_URL}/Inventory/Presentations", timeout=30)

    discovered = (
        discover_endpoints(session, "ScriptsViews/Production/SubProductRecipe.js")
        + discover_endpoints(session, "ScriptsViews/Inventory/Presentations.js")
    )

    # 1) Presentaciones
    presentations, pres_ep = get_presentations(session, discovered)
    if presentations:
        save_data("presentations_catalog", presentations)

    # 2) Subproductos
    subs, list_ep = get_subproducts(session, discovered)
    n_recipes = 0
    if subs:
        save_data("subproduct_list", [s[2] for s in subs])
        recipes = []
        recipe_ep_used = None
        for i, (sid, sname, _extra) in enumerate(subs):
            ingredients, raw, ep = get_sub_recipe(session, sid, discovered)
            if ingredients:
                recipes.append({"id": sid, "name": sname, "ingredients": ingredients})
                recipe_ep_used = recipe_ep_used or ep
                if len(recipes) <= 3:
                    print(f"    Sample ingrediente ({sname}): {json.dumps(ingredients[0], ensure_ascii=False, default=str)[:250]}")
                print(f"  [{i+1}/{len(subs)}] {sname}: {len(ingredients)} ingredientes")
            time.sleep(0.25)
        n_recipes = len(recipes)
        if recipes:
            save_data("subproduct_recipes", recipes)
            print(f"[Recipe endpoint] {recipe_ep_used}")
    else:
        print("[FAIL] No encontré lista de subproductos")

    dur = int((time.time() - start) * 1000)
    summary = (f"Subproductos Wansoft: {len(subs)} en lista (via {list_ep}), {n_recipes} recetas. "
               f"Presentaciones: {len(presentations)} (via {pres_ep}).")
    print(f"\n[DONE] {summary}")
    telegram(f"🧪 {summary}")
    ok = n_recipes > 0 or len(presentations) > 0
    log_run("success" if ok else "error", summary, dur)


if __name__ == "__main__":
    main()
