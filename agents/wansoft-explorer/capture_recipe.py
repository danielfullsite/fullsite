#!/usr/bin/env python3
"""Captura de receta en Wansoft via Production/InsertIngredientToSaucerRecipe.

Default: DRY-RUN (imprime payloads, no manda nada).
--apply: ejecuta los POSTs, verifica releyendo GetSaucerRecipe, y si algo
no coincide hace rollback con DeleteIngredientFromSaucerRecipe.

Uso:
  .venv/bin/python capture_recipe.py specs/<receta>.json            # dry-run
  .venv/bin/python capture_recipe.py specs/<receta>.json --apply    # captura real

Spec JSON: {"saucer": str, "analog": str|null, "ingredients": [{"product": str, "unit": str, "quantity": num}]}
"""

import json
import re
import sys
import time
import unicodedata

import requests
from dotenv import dotenv_values

ENV = dotenv_values(".env")
WANSOFT_URL = "https://www.wansoft.net/Wansoft.Web"
SUBSIDIARY_ID = 6043

def load_spec():
    args = [a for a in sys.argv[1:] if a != "--apply"]
    if not args:
        raise SystemExit("Falta el spec: capture_recipe.py specs/<receta>.json [--apply]")
    spec = json.load(open(args[0]))
    ings = [(i["product"], i["unit"], i["quantity"]) for i in spec["ingredients"]]
    return spec["saucer"], spec.get("analog"), ings


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return " ".join("".join(c for c in s if unicodedata.category(c) != "Mn").upper().split())


def login():
    s = requests.Session()
    s.get(f"{WANSOFT_URL}/", timeout=30)
    r = s.post(f"{WANSOFT_URL}/", data={"UserName": ENV["WANSOFT_USER"], "Password": ENV["WANSOFT_PASS"]},
               allow_redirects=True, timeout=30)
    if "Dashboard" not in r.url and "MyDocumentsList" not in r.url:
        raise SystemExit(f"Login failed: {r.url}")
    print("[OK] login")
    return s


def post_json(s, path, data):
    r = s.post(f"{WANSOFT_URL}/{path}", data=data, timeout=30)
    r.raise_for_status()
    return r.json()


def unwrap_list(data):
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and v:
                return v
    return data if isinstance(data, list) else []


def find_by_name(items, target, id_keys=("Id", "Value", "id", "value"), name_keys=("Name", "Text", "Description", "name", "text")):
    t = norm(target)
    for it in items:
        if not isinstance(it, dict):
            continue
        name = next((it[k] for k in name_keys if k in it and it[k]), None)
        if not name:
            continue
        # Los catálogos de insumos/unidades agregan la clave al final: "NOMBRE (ABA002)"
        clean = re.sub(r"\s*\([^)]*\)\s*$", "", str(name))
        if norm(name) == t or norm(clean) == t:
            iid = next((it[k] for k in id_keys if k in it and it[k] is not None), None)
            return iid, name, it
    return None, None, None


def get_recipe(s, saucer_id, size_id=0):
    raw = post_json(s, "Production/GetSaucerRecipe",
                    {"subsidiaryId": SUBSIDIARY_ID, "saucerId": saucer_id, "sizeId": size_id})
    # El dict trae varias listas (sizes, ingredientes...) — solo nos sirve la
    # de ingredientes, cuyos items tienen ProductName.
    if isinstance(raw, dict):
        for v in raw.values():
            if isinstance(v, list) and v and isinstance(v[0], dict) and "ProductName" in v[0]:
                return v, raw
        return [], raw
    return (raw if isinstance(raw, list) else []), raw


def fmt_rows(rows):
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append(f"  - {r.get('ProductName')} {r.get('Quantity')} {r.get('UnitOfMeasureDescription')} "
                       f"(detailId={r.get('SaucerRecipeDetailId') or r.get('Id')}, costo={r.get('ProductBudgetedCost')})")
    return "\n".join(out) or "  (vacía)"


def main():
    apply_mode = "--apply" in sys.argv
    SAUCER_NAME, ANALOG_NAME, INGREDIENTS = load_spec()
    s = login()

    # token antiforgery de la página
    page = s.get(f"{WANSOFT_URL}/Production/SaucerRecipe", timeout=30).text
    m = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
    if not m:
        raise SystemExit("No encontré __RequestVerificationToken en la página")
    token = m.group(1)
    print(f"[OK] token antiforgery ({len(token)} chars)")

    # resolver IDs
    saucers = unwrap_list(post_json(s, "Menu/GetSaucerAndComplementaryListBySubsidiary", {"subsidiaryId": SUBSIDIARY_ID}))
    products = unwrap_list(post_json(s, "Inventory/GetRecipeProductsBySubsidiary", {"subsidiaryId": SUBSIDIARY_ID}))
    units = unwrap_list(post_json(s, "Inventory/GetUnitsOfMeasureBySubsidiary", {"subsidiaryId": SUBSIDIARY_ID}))
    print(f"[OK] catálogos: {len(saucers)} platillos, {len(products)} insumos, {len(units)} unidades")

    saucer_id, saucer_name, _ = find_by_name(saucers, SAUCER_NAME)
    if not saucer_id:
        raise SystemExit(f"No encontré platillo {SAUCER_NAME!r}")
    print(f"[OK] platillo: {saucer_name!r} -> saucerId={saucer_id}")

    resolved = []
    for pname, uname, qty in INGREDIENTS:
        pid, pfull, _ = find_by_name(products, pname)
        uid, ufull, _ = find_by_name(units, uname)
        if not pid or not uid:
            raise SystemExit(f"No resolví {pname!r} (pid={pid}) / {uname!r} (uid={uid})")
        resolved.append({"productId": pid, "product": pfull, "unitOfMeasureId": uid, "unit": ufull, "quantity": qty})
        print(f"[OK] insumo: {pfull!r} -> productId={pid}, unidad {ufull!r} -> unitId={uid}, qty={qty}")

    # estado actual + sizeId real
    before, raw_before = get_recipe(s, saucer_id, 0)
    size_id = 0
    if isinstance(raw_before, dict):
        size_id = raw_before.get("selectedSize") or 0
        print(f"[OK] sizes={raw_before.get('sizes')} selectedSize={raw_before.get('selectedSize')} -> usando sizeId={size_id}")
    print(f"\nReceta ACTUAL de {saucer_name}:")
    print(fmt_rows(before))

    # análogo de referencia
    analog_id, analog_name = (None, None)
    if ANALOG_NAME:
        analog_id, analog_name, _ = find_by_name(saucers, ANALOG_NAME)
    if analog_id:
        analog_rows, _ = get_recipe(s, analog_id, 0)
        print(f"\nAnálogo {analog_name}:")
        print(fmt_rows(analog_rows))

    payloads = [{
        "subsidiaryId": SUBSIDIARY_ID, "saucerId": saucer_id, "sizeId": size_id,
        "productId": r["productId"], "unitOfMeasureId": r["unitOfMeasureId"],
        "quantity": r["quantity"], "__RequestVerificationToken": token,
    } for r in resolved]

    print("\nPayloads a POST Production/InsertIngredientToSaucerRecipe:")
    for p in payloads:
        shown = {k: (v[:25] + "..." if k.startswith("__") else v) for k, v in p.items()}
        print(f"  {json.dumps(shown, ensure_ascii=False)}")

    if not apply_mode:
        print("\n[DRY-RUN] No se mandó nada. Corre con --apply para capturar.")
        return

    if before:
        raise SystemExit("La receta NO está vacía — aborto para no duplicar. Revisa manualmente.")

    print("\n[APPLY] capturando...")
    for p in payloads:
        resp = post_json(s, "Production/InsertIngredientToSaucerRecipe", p)
        print(f"  -> {json.dumps(resp, ensure_ascii=False, default=str)[:200]}")
        if isinstance(resp, dict) and resp.get("MessageType") != 1:
            print("  [!] Respuesta no exitosa — verificando estado y haciendo rollback...")
            break
        time.sleep(1)

    after, _ = get_recipe(s, saucer_id, size_id)
    print(f"\nReceta DESPUÉS de capturar:")
    print(fmt_rows(after))

    # verificación: deben ser exactamente los 2 insumos qty 1
    want = {(norm(re.sub(r"\s*\([^)]*\)\s*$", "", r["product"])), float(r["quantity"])) for r in resolved}
    got = {(norm(x.get("ProductName")), float(x.get("Quantity") or 0)) for x in after if isinstance(x, dict)}
    if got == want:
        print("\n[VERIFICADO] La receta quedó exactamente como el análogo. ✓")
    else:
        print(f"\n[MISMATCH] want={want} got={got}")
        print("[ROLLBACK] borrando renglones insertados...")
        for x in after:
            did = x.get("SaucerRecipeDetailId") or x.get("Id")
            if did:
                resp = post_json(s, "Production/DeleteIngredientFromSaucerRecipe", {
                    "saucerRecipeDetailId": did, "subsidiaryId": SUBSIDIARY_ID,
                    "saucerId": saucer_id, "sizeId": size_id,
                    "__RequestVerificationToken": token,
                })
                print(f"  delete {did} -> {json.dumps(resp, default=str)[:120]}")
        rolled, _ = get_recipe(s, saucer_id, size_id)
        print("Estado tras rollback:")
        print(fmt_rows(rolled))


if __name__ == "__main__":
    main()
