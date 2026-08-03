#!/usr/bin/env python3
"""
menu_import.py — Import real client menu from CSV into Fullsite.

Replaces 2-4 hours of manual item-by-item data entry (Onboarding §1C).

CSV format (with header row):
    category,name,price,modifier_group,active
    Entradas,Donut Clásica,35.00,,true
    Bebidas Calientes,Café Americano,55.00,Tamaño,true
    Bebidas Frías,Frozen Cappuccino,85.00,Tamaño,true

Rules:
  - category: creates the category if it doesn't exist; order = first-seen
  - modifier_group: optional; links item to an existing modifier group by name
    (group must already exist in pos_modifier_groups for this client)
  - active: defaults to true if omitted

Usage:
    python3 scripts/onboarding/menu_import.py \\
        --client-id  grupo-galeria-dunkin \\
        --csv        menus/dunkin-menu.csv \\
        --confirm-ref <project-ref>

    # Always dry-run first:
    python3 scripts/onboarding/menu_import.py ... --dry-run

    # Resume after partial failure:
    python3 scripts/onboarding/menu_import.py ... --resume

Environment:
    NEXT_PUBLIC_SUPABASE_URL   https://<ref>.supabase.co
    SUPABASE_SERVICE_KEY       service_role key (never printed)
    SANDBOX_ENV                'true' if pointing at sandbox (optional guard)
"""
import argparse
import csv
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from contract import Result, verify_ref

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

AMALAY_REF = "qjiomlvudfmzuvqvhwpk"
JWT_PAT = re.compile(r'eyJ[A-Za-z0-9_\-\.]{50,}')


def redact(s):
    return JWT_PAT.sub("***REDACTED***", str(s))


def _req(method, url, body, headers, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)


def get(url, h):
    return _req("GET", url, None, h)


def post(url, body, h):
    return _req("POST", url, body, h)


# ── Checkpoint ────────────────────────────────────────────────────────────────

class State:
    def __init__(self, client_id, csv_path):
        slug = Path(csv_path).stem
        self.path = Path(f"/tmp/fullsite-menu-import-{client_id}-{slug}.json")
        self.data = self._load()

    def _load(self):
        if self.path.exists():
            try:
                return json.loads(self.path.read_text())
            except Exception:
                pass
        return {"cats": {}, "items": {}, "links": {}, "started_at": time.time()}

    def save(self):
        self.path.write_text(json.dumps(self.data, indent=2))

    def cat_done(self, name):
        return name in self.data["cats"]

    def item_done(self, key):
        return key in self.data["items"]

    def link_done(self, key):
        return key in self.data["links"]

    def record_cat(self, name, cat_id):
        self.data["cats"][name] = cat_id
        self.save()

    def record_item(self, key, item_id):
        self.data["items"][key] = item_id
        self.save()

    def record_link(self, key):
        self.data["links"][key] = True
        self.save()

    def get_cat_id(self, name):
        return self.data["cats"].get(name)

    def reset(self):
        self.path.unlink(missing_ok=True)
        self.data = {"cats": {}, "items": {}, "links": {}, "started_at": time.time()}


# ── CSV parsing ───────────────────────────────────────────────────────────────

def parse_csv(path):
    """
    Returns list of dicts with keys: category, name, price, modifier_group, active.
    Validates required fields and price format.
    """
    rows = []
    errors = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        required = {"category", "name", "price"}
        missing = required - set(c.lower() for c in (reader.fieldnames or []))
        if missing:
            print(f"  ✗ CSV falta columnas requeridas: {missing}", file=sys.stderr)
            sys.exit(1)

        for i, row in enumerate(reader, start=2):
            row = {k.lower().strip(): v.strip() for k, v in row.items()}
            cat = row.get("category", "").strip()
            name = row.get("name", "").strip()
            price_str = row.get("price", "").strip()
            mod_group = row.get("modifier_group", "").strip()
            active_str = row.get("active", "true").strip().lower()

            if not cat:
                errors.append(f"  Fila {i}: 'category' vacío")
                continue
            if not name:
                errors.append(f"  Fila {i}: 'name' vacío")
                continue
            try:
                price = float(price_str)
                if price < 0:
                    raise ValueError
            except ValueError:
                errors.append(f"  Fila {i}: precio inválido '{price_str}'")
                continue

            rows.append({
                "category": cat,
                "name": name,
                "price": round(price, 2),
                "modifier_group": mod_group or None,
                "active": active_str != "false",
            })

    if errors:
        print("\n  ✗ Errores en CSV:", file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)
        sys.exit(1)

    return rows


# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_modifier_groups(rest, client_id, svc_h):
    """Returns dict name→id for all modifier groups of this client."""
    enc = urllib.parse.quote(client_id)
    s, r = get(f"{rest}/pos_modifier_groups?client_id=eq.{enc}&select=id,name&limit=500", svc_h)
    if s != 200 or not isinstance(r, list):
        return {}
    return {g["name"]: g["id"] for g in r}


def upsert_category(rest, client_id, name, sort_order, svc_h, state, dry_run, log):
    if state.cat_done(name):
        log(f"  = [ALREADY_EXISTS ] category: {name}")
        return state.get_cat_id(name)

    enc_c = urllib.parse.quote(client_id)
    enc_n = urllib.parse.quote(name)
    s, existing = get(
        f"{rest}/pos_menu_categories?client_id=eq.{enc_c}&name=eq.{enc_n}&select=id&limit=1",
        svc_h)
    if s == 200 and isinstance(existing, list) and existing:
        cat_id = existing[0]["id"]
        state.record_cat(name, cat_id)
        log(f"  = [ALREADY_EXISTS ] category: {name}")
        return cat_id

    if dry_run:
        log(f"  · [SKIP / DRY-RUN ] category: {name}")
        return f"dry-run-cat-{sort_order}"

    import secrets as _s
    cat_id = str(_s.token_hex(16))
    # Use a UUID-like format
    cat_id = f"{cat_id[:8]}-{cat_id[8:12]}-4{cat_id[13:16]}-{cat_id[16:20]}-{cat_id[20:32]}"

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = post(f"{rest}/pos_menu_categories", {
        "client_id": client_id,
        "name": name,
        "sort_order": sort_order,
        "active": True,
        "color": "bg-blue-600",
    }, h)
    if s2 in (200, 201) and isinstance(r2, list) and r2:
        cat_id = r2[0]["id"]
        state.record_cat(name, cat_id)
        log(f"  ✚ [CREATED        ] category: {name} ({cat_id[:8]}...)")
        return cat_id
    else:
        log(f"  ✗ [FAILED         ] category: {name} — {redact(str(r2)[:80])}")
        return None


def upsert_item(rest, client_id, cat_id, item, sort_order, svc_h, state, dry_run, log):
    key = f"{item['category']}|{item['name']}"
    if state.item_done(key):
        log(f"  = [ALREADY_EXISTS ] item: {item['name']}")
        return state.data["items"].get(key)

    enc_c = urllib.parse.quote(client_id)
    enc_n = urllib.parse.quote(item["name"])
    s, existing = get(
        f"{rest}/pos_menu_items?client_id=eq.{enc_c}&name=eq.{enc_n}"
        f"&category_id=eq.{urllib.parse.quote(cat_id)}&select=id&limit=1",
        svc_h)
    if s == 200 and isinstance(existing, list) and existing:
        item_id = existing[0]["id"]
        state.record_item(key, item_id)
        log(f"  = [ALREADY_EXISTS ] item: {item['name']}")
        return item_id

    if dry_run:
        log(f"  · [SKIP / DRY-RUN ] item: {item['name']}")
        return f"dry-run-item-{sort_order}"

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = post(f"{rest}/pos_menu_items", {
        "client_id": client_id,
        "category_id": cat_id,
        "name": item["name"],
        "price": item["price"],
        "sort_order": sort_order,
        "active": item["active"],
    }, h)
    if s2 in (200, 201) and isinstance(r2, list) and r2:
        item_id = r2[0]["id"]
        state.record_item(key, item_id)
        log(f"  ✚ [CREATED        ] item: {item['name']} — ${item['price']:.2f}")
        return item_id
    else:
        log(f"  ✗ [FAILED         ] item: {item['name']} — {redact(str(r2)[:80])}")
        return None


def link_modifier_group(rest, client_id, item_id, group_id, item_name, group_name,
                        svc_h, state, dry_run, log):
    key = f"{item_id}|{group_id}"
    if state.link_done(key):
        log(f"  = [ALREADY_EXISTS ] link: {item_name} → {group_name}")
        return

    enc_c = urllib.parse.quote(client_id)
    s, existing = get(
        f"{rest}/pos_item_modifier_groups?client_id=eq.{enc_c}"
        f"&item_id=eq.{urllib.parse.quote(item_id)}"
        f"&group_id=eq.{urllib.parse.quote(group_id)}&limit=1",
        svc_h)
    if s == 200 and isinstance(existing, list) and existing:
        state.record_link(key)
        log(f"  = [ALREADY_EXISTS ] link: {item_name} → {group_name}")
        return

    if dry_run:
        log(f"  · [SKIP / DRY-RUN ] link: {item_name} → {group_name}")
        return

    h = {**svc_h, "Content-Type": "application/json", "Prefer": "return=representation"}
    s2, r2 = post(f"{rest}/pos_item_modifier_groups", {
        "client_id": client_id,
        "item_id": item_id,
        "group_id": group_id,
    }, h)
    if s2 in (200, 201):
        state.record_link(key)
        log(f"  ✚ [CREATED        ] link: {item_name} → {group_name}")
    else:
        log(f"  ✗ [FAILED         ] link: {item_name} → {group_name} — {redact(str(r2)[:80])}")


# ── Main ──────────────────────────────────────────────────────────────────────

def run(args):
    client_id = args.client_id
    csv_path  = args.csv
    dry_run   = args.dry_run
    do_resume = args.resume

    result = Result("menu_import")

    def log(msg):
        print(msg)

    # Env validation
    url     = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    svc_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    sbox    = os.environ.get("SANDBOX_ENV", "")

    if not url:
        result.error("NEXT_PUBLIC_SUPABASE_URL vacío")
    if not svc_key:
        result.error("SUPABASE_SERVICE_KEY vacío")
    if AMALAY_REF in url and sbox != "true":
        result.error("URL contiene ref de AMALAY producción — requiere SANDBOX_ENV=true")
    if not Path(csv_path).exists():
        result.error(f"CSV no encontrado: {csv_path}")
    if result.errors:
        result.finish()
        return

    # verify_ref aborts if mismatch (exits with code 1)
    verify_ref(url, args.confirm_ref)

    svc_h = {"apikey": svc_key, "Authorization": f"Bearer {svc_key}"}
    rest  = f"{url}/rest/v1"
    state = State(client_id, csv_path)

    if not do_resume:
        state.reset()

    # Verify client exists
    enc = urllib.parse.quote(client_id)
    s, r = get(f"{rest}/clients?id=eq.{enc}&select=id&limit=1", svc_h)
    if s != 200 or not (isinstance(r, list) and r):
        print(f"  ✗ client_id='{client_id}' no existe en la BD. Ejecuta onboard_client.py primero.",
              file=sys.stderr)
        sys.exit(1)

    # Parse CSV
    print(f"\n── 1 · Parsing CSV {'(DRY-RUN)' if dry_run else ''} {'─'*48}")
    rows = parse_csv(csv_path)
    print(f"  ✓ {len(rows)} filas válidas")

    # Collect unique categories (in first-seen order)
    cats_ordered = list(dict.fromkeys(r["category"] for r in rows))
    print(f"  ✓ {len(cats_ordered)} categorías únicas")
    print(f"  ✓ {sum(1 for r in rows if r['modifier_group'])} items con modifier_group")

    # Fetch existing modifier groups
    print(f"\n── 2 · Modifier groups existentes {'─'*42}")
    mod_groups = fetch_modifier_groups(rest, client_id, svc_h)
    if mod_groups:
        for gname in mod_groups:
            print(f"  ✓ encontrado: {gname}")
    else:
        print("  · ninguno — los modifier_group en CSV serán ignorados (no hay grupos en BD)")

    # Warn about unknown modifier groups in CSV
    used_groups = {r["modifier_group"] for r in rows if r["modifier_group"]}
    unknown = used_groups - set(mod_groups.keys())
    if unknown:
        print(f"\n  ~ WARN: grupos no encontrados en BD (serán omitidos): {unknown}")

    # Upsert categories
    print(f"\n── 3 · Categorías {'─'*55}")
    t0 = time.time()
    for i, cat_name in enumerate(cats_ordered):
        upsert_category(rest, client_id, cat_name, i + 1, svc_h, state, dry_run, log)
    print(f"  tiempo: {time.time()-t0:.1f}s")

    # Upsert items + links
    print(f"\n── 4 · Items y links {'─'*52}")
    t0 = time.time()
    cat_item_count = {}
    failed = 0
    for row in rows:
        cat_id = state.get_cat_id(row["category"])
        if not cat_id:
            print(f"  ✗ sin cat_id para '{row['category']}' — saltando {row['name']}")
            failed += 1
            continue

        sort_order = cat_item_count.get(row["category"], 0) + 1
        cat_item_count[row["category"]] = sort_order

        item_id = upsert_item(rest, client_id, cat_id, row, sort_order, svc_h, state, dry_run, log)
        if not item_id:
            failed += 1
            result.error(f"item '{row['name']}' falló — ver log arriba")
            continue
        else:
            result.add_created()

        if row["modifier_group"] and row["modifier_group"] in mod_groups:
            group_id = mod_groups[row["modifier_group"]]
            link_modifier_group(rest, client_id, item_id, group_id,
                                row["name"], row["modifier_group"],
                                svc_h, state, dry_run, log)

    elapsed = time.time() - t0
    print(f"  tiempo: {elapsed:.1f}s")

    cats_done  = len(state.data["cats"])
    items_done = len(state.data["items"])
    links_done = len(state.data["links"])
    result.created = items_done + cats_done

    print(f"\n{'═'*68}")
    if dry_run:
        print(f"  DRY-RUN — sin cambios. Categorías: {len(cats_ordered)}, "
              f"Items: {len(rows)}, Links: {len(used_groups - unknown)}")
    else:
        print(f"  Categorías: {cats_done}  Items: {items_done}  "
              f"Links: {links_done}  Errores: {failed}")
        if failed:
            result.warn(f"{failed} items fallaron — re-run con --resume")
        else:
            state.reset()
    print(f"{'═'*68}\n")
    print(f"  Siguiente paso: diff_report.py para validar vs CSV fuente")

    result.finish()


def main():
    p = argparse.ArgumentParser(
        description="Importar menú real desde CSV — reemplaza 2-4h de entrada manual",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--client-id",    required=True)
    p.add_argument("--csv",          required=True, help="Ruta al CSV del menú")
    p.add_argument("--confirm-ref",  required=True, help="Supabase project ref para confirmar target")
    p.add_argument("--dry-run",      action="store_true")
    p.add_argument("--resume",       action="store_true", help="Retomar desde checkpoint")
    args = p.parse_args()
    try:
        run(args)
    except KeyboardInterrupt:
        print("\n\nInterrumpido. --resume para continuar.")
        sys.exit(130)


if __name__ == "__main__":
    main()
